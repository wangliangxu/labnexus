//! Monitor SSH and SOCKS5 connections independently of notebook activity.

use std::sync::{Arc, Weak};
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tokio::task::AbortHandle;
use tokio::time::{interval_at, timeout, Instant, MissedTickBehavior};

use crate::jupyter::client::JupyterClient;
use crate::jupyter::ssh::SshTunnel;
use crate::jupyter::types::{ConnectionStatus, ProxyType};
use crate::state::{AppState, ManagedConnection};

const SSH_CHECK_INTERVAL: Duration = Duration::from_secs(2);
const API_CHECK_INTERVAL: Duration = Duration::from_secs(10);
const API_CHECK_TIMEOUT: Duration = Duration::from_secs(5);

pub struct ConnectionMonitor(AbortHandle);

impl ConnectionMonitor {
    pub fn start(state: &AppState, app: AppHandle, connection: &ManagedConnection) -> Option<Self> {
        let proxy = connection.config.proxy.as_ref()?;
        if !matches!(proxy.proxy_type, ProxyType::Ssh | ProxyType::Socks5) {
            return None;
        }
        let connections = Arc::downgrade(&state.connections);
        let client = connection.client.clone()?;
        let server_id = connection.config.id.clone();
        let ssh = connection.ssh.as_ref().map(Arc::downgrade);
        let task = tokio::spawn(async move {
            let (message, tunnel_exited) = match ssh {
                Some(ssh) => tokio::select! {
                    _ = wait_for_tunnel_exit(ssh) => ("SSH tunnel disconnected.", true),
                    _ = wait_for_unreachable(&client, API_CHECK_INTERVAL, API_CHECK_TIMEOUT) => {
                        ("Jupyter server is unreachable through the SSH tunnel.", false)
                    }
                },
                None => {
                    wait_for_unreachable(&client, API_CHECK_INTERVAL, API_CHECK_TIMEOUT).await;
                    (
                        "Jupyter server is unreachable through the SOCKS5 proxy.",
                        false,
                    )
                }
            };

            let Some(connections) = connections.upgrade() else {
                return;
            };
            let mut connections = connections.write().await;
            let Some(connection) = connections.get_mut(&server_id) else {
                return;
            };
            // A manual disconnect or a newer connection supersedes this check.
            if connection.status != ConnectionStatus::Connected
                || connection
                    .monitor
                    .as_ref()
                    .is_none_or(|monitor| monitor.0.id() != tokio::task::id())
            {
                return;
            }
            connection.status = ConnectionStatus::Disconnected;
            connection.server_info = None;
            // An unresponsive Jupyter API can still have an active SSH session.
            // Keep it when the session owns the remote Jupyter process.
            if tunnel_exited || connection.config.remote_launch.is_none() {
                connection.client = None;
                connection.ssh = None;
            }
            connection.error_message = Some(message.to_owned());
            let _ = app.emit(
                "jupyter:connection",
                serde_json::json!({
                    "server_id": server_id,
                    "status": "disconnected",
                    "message": message,
                }),
            );
        });
        Some(Self(task.abort_handle()))
    }
}

impl Drop for ConnectionMonitor {
    fn drop(&mut self) {
        self.0.abort();
    }
}

async fn wait_for_tunnel_exit(ssh: Weak<SshTunnel>) {
    let mut checks = interval_at(Instant::now() + SSH_CHECK_INTERVAL, SSH_CHECK_INTERVAL);
    checks.set_missed_tick_behavior(MissedTickBehavior::Delay);
    loop {
        checks.tick().await;
        match ssh.upgrade() {
            Some(ssh) if ssh.is_running().await => {}
            _ => return,
        }
    }
}

async fn wait_for_unreachable(client: &JupyterClient, interval: Duration, deadline: Duration) {
    let mut checks = interval_at(Instant::now() + interval, interval);
    checks.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut previous_failed = false;
    loop {
        checks.tick().await;
        let failed = !matches!(timeout(deadline, client.get_server_info()).await, Ok(Ok(_)));
        if failed && previous_failed {
            return;
        }
        previous_failed = failed;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jupyter::local::LOCAL_SERVER_ID;
    use crate::jupyter::types::JupyterServerConfig;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn successful_probe_resets_failure_streak() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let client = JupyterClient::new(
            &JupyterServerConfig {
                id: LOCAL_SERVER_ID.into(),
                name: "Test".into(),
                base_url: format!("http://{}", listener.local_addr().unwrap()),
                token: None,
                proxy: None,
                remote_launch: None,
            },
            None,
        )
        .unwrap();

        let server = tokio::spawn(async move {
            for status in [
                "503 Service Unavailable",
                "200 OK",
                "503 Service Unavailable",
                "503 Service Unavailable",
            ] {
                let (stream, _) = listener.accept().await.unwrap();
                let mut stream = BufReader::new(stream);
                let mut request = String::new();
                stream.read_line(&mut request).await.unwrap();
                assert!(request.starts_with("GET /api "));
                let body = r#"{"version":"test"}"#;
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                stream
                    .get_mut()
                    .write_all(response.as_bytes())
                    .await
                    .unwrap();
            }
        });

        timeout(Duration::from_secs(4), async {
            tokio::join!(
                wait_for_unreachable(&client, Duration::from_millis(25), Duration::from_secs(1)),
                async { server.await.unwrap() },
            );
        })
        .await
        .expect("a disconnect is reported after the final two failures");
    }
    #[tokio::test]
    #[ignore = "requires an SSH alias and remote Python with Jupyter installed"]
    async fn detects_exited_open_ssh_process() {
        use crate::jupyter::types::RemoteJupyterLaunch;

        let launch = RemoteJupyterLaunch {
            alias: std::env::var("LABNEXUS_TEST_SSH_ALIAS").unwrap(),
            python: std::env::var("LABNEXUS_TEST_REMOTE_PYTHON")
                .unwrap_or_else(|_| "python3".into()),
        };
        let (_, ssh) = crate::jupyter::remote::launch(launch, None).await.unwrap();
        assert!(ssh.is_running().await);
        let monitor = tokio::spawn(wait_for_tunnel_exit(Arc::downgrade(&ssh)));
        ssh.stop_remote().await;
        timeout(SSH_CHECK_INTERVAL + Duration::from_secs(1), monitor)
            .await
            .expect("monitor observes the exited SSH process")
            .unwrap();
    }
}
