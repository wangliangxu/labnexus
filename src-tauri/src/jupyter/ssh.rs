//! Owns the OpenSSH process for a Jupyter SOCKS5 tunnel.

use std::net::{Ipv4Addr, SocketAddrV4, TcpListener};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::process::{Child, ChildStderr, Command};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio::time::{sleep, timeout};

use crate::error::AppError;
use crate::jupyter::types::{ProxyConfig, ProxyType};

const SSH_START_TIMEOUT: Duration = Duration::from_secs(30);

pub struct SshTunnel {
    address: SocketAddrV4,
    child: Mutex<Child>,
    stderr: JoinHandle<Vec<u8>>,
}

impl SshTunnel {
    pub async fn for_proxy(proxy: Option<&ProxyConfig>) -> Result<Option<Arc<Self>>, AppError> {
        match proxy {
            Some(proxy) if matches!(proxy.proxy_type, ProxyType::Ssh) => {
                Self::start(&proxy.host).await.map(Arc::new).map(Some)
            }
            _ => Ok(None),
        }
    }

    pub fn address(&self) -> SocketAddrV4 {
        self.address
    }

    async fn start(alias: &str) -> Result<Self, AppError> {
        let mut tunnel = Self::spawn(alias, None)?;
        let ready = timeout(SSH_START_TIMEOUT, wait_for_socks(tunnel.address));
        tokio::select! {
            biased;
            status = tunnel.child.get_mut().wait() => {
                Err(tunnel.failure(alias, &status?.to_string(), "").await)
            }
            result = ready => match result {
                Ok(Ok(())) => Ok(tunnel),
                Ok(Err(error)) => Err(AppError::Proxy(format!("SSH tunnel for {alias} failed: {error}"))),
                Err(_) => Err(AppError::Proxy(format!("Timed out opening SSH tunnel for {alias}"))),
            },
        }
    }

    pub async fn start_remote(
        alias: &str,
        command: &str,
        token: &str,
    ) -> Result<(Arc<Self>, u16), AppError> {
        let mut tunnel = Self::spawn(alias, Some(command))?;
        let address = tunnel.address;
        let child = tunnel.child.get_mut();
        let mut stdout = BufReader::new(child.stdout.take().expect("piped SSH stdout").take(65536));
        let stdin = child.stdin.as_mut().expect("piped SSH stdin");
        let startup = timeout(Duration::from_secs(90), async {
            stdin.write_all(format!("{token}\n").as_bytes()).await?;
            let mut line = String::new();
            while stdout.read_line(&mut line).await? != 0 {
                if let Some(port) = line.trim().strip_prefix("LABNEXUS_JUPYTER_PORT=") {
                    let port = port
                        .parse::<u16>()
                        .ok()
                        .filter(|port| *port != 0)
                        .ok_or_else(|| {
                            std::io::Error::new(
                                std::io::ErrorKind::InvalidData,
                                "Invalid remote Jupyter port",
                            )
                        })?;
                    wait_for_socks(address).await?;
                    return Ok(port);
                }
                line.clear();
            }
            Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "Remote Jupyter exited before announcing its port",
            ))
        });
        match startup.await {
            Ok(Ok(port)) => Ok((Arc::new(tunnel), port)),
            Ok(Err(error)) => Err(tunnel.failure(alias, &error.to_string(), token).await),
            Err(_) => Err(AppError::JupyterConnection(format!(
                "Timed out starting Jupyter on {alias}"
            ))),
        }
    }

    pub async fn is_running(&self) -> bool {
        matches!(self.child.lock().await.try_wait(), Ok(None))
    }

    pub async fn stop_remote(&self) {
        let mut child = self.child.lock().await;
        // EOF tells the remote launcher to stop Jupyter before closing the SSH session.
        drop(child.stdin.take());
        if timeout(Duration::from_secs(5), child.wait()).await.is_err() {
            let _ = child.kill().await;
        }
    }

    fn spawn(alias: &str, remote_command: Option<&str>) -> Result<Self, AppError> {
        let alias = alias.trim();
        if alias.is_empty()
            || alias.starts_with('-')
            || !alias
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
        {
            return Err(AppError::Proxy(
                "Enter an SSH host alias using letters, digits, dots, underscores or hyphens"
                    .into(),
            ));
        }

        // OpenSSH binds its own listener, so release the ephemeral port before spawning it.
        let port = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?
            .local_addr()?
            .port();
        let address = SocketAddrV4::new(Ipv4Addr::LOCALHOST, port);
        let mut command = Command::new("ssh");
        command.args([
            "-T",
            "-o",
            "BatchMode=yes",
            "-o",
            "ExitOnForwardFailure=yes",
            "-o",
            "ClearAllForwardings=no",
            "-o",
            "ForkAfterAuthentication=no",
            "-o",
            "ControlPath=none",
        ]);
        if remote_command.is_some() {
            command.args([
                "-o",
                "RemoteCommand=none",
                "-o",
                "SessionType=default",
                "-o",
                "StdinNull=no",
            ]);
        } else {
            command.arg("-N");
        }
        command
            .arg("-D")
            .arg(address.to_string())
            .arg("--")
            .arg(alias);
        if let Some(remote_command) = remote_command {
            command
                .arg(remote_command)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped());
        } else {
            command.stdin(Stdio::null()).stdout(Stdio::null());
        }
        let mut child = command
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| AppError::Proxy(format!("Could not start OpenSSH: {error}")))?;

        let stderr = tokio::spawn(read_ssh_stderr(
            child.stderr.take().expect("piped SSH stderr"),
        ));
        Ok(Self {
            address,
            child: Mutex::new(child),
            stderr,
        })
    }

    async fn failure(&mut self, alias: &str, fallback: &str, token: &str) -> AppError {
        let stderr = timeout(Duration::from_millis(250), &mut self.stderr)
            .await
            .ok()
            .and_then(Result::ok)
            .unwrap_or_default();
        let stderr = String::from_utf8_lossy(&stderr);
        let detail = stderr.trim();
        let detail = if detail.is_empty() { fallback } else { detail };
        let detail = if token.is_empty() {
            detail.to_owned()
        } else {
            detail.replace(token, "[redacted]")
        };
        AppError::Proxy(format!("SSH session for {alias} failed: {detail}"))
    }
}

impl Drop for SshTunnel {
    fn drop(&mut self) {
        self.stderr.abort();
    }
}

async fn wait_for_socks(address: SocketAddrV4) -> std::io::Result<()> {
    let mut stream = loop {
        match TcpStream::connect(address).await {
            Ok(stream) => break stream,
            Err(error) if error.kind() == std::io::ErrorKind::ConnectionRefused => {
                sleep(Duration::from_millis(50)).await;
            }
            Err(error) => return Err(error),
        }
    };

    // OpenSSH only answers the SOCKS5 greeting once its forward is ready.
    stream.write_all(&[5, 1, 0]).await?;
    let mut response = [0; 2];
    stream.read_exact(&mut response).await?;
    if response != [5, 0] {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Unexpected response from the local SOCKS5 listener",
        ));
    }
    Ok(())
}

async fn read_ssh_stderr(mut stderr: ChildStderr) -> Vec<u8> {
    let mut output = Vec::new();
    let mut buffer = [0; 1024];
    while let Ok(count) = stderr.read(&mut buffer).await {
        if count == 0 {
            break;
        }
        // Keep draining the pipe while retaining only a bounded startup diagnostic.
        output.extend_from_slice(&buffer[..count.min(8192 - output.len())]);
    }
    output
}
