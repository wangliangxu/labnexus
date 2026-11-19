//! Owns the OpenSSH process for a Jupyter SOCKS5 tunnel.

use std::net::{Ipv4Addr, SocketAddrV4, TcpListener};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::process::{Child, ChildStderr, Command};
use tokio::task::JoinHandle;
use tokio::time::{sleep, timeout};

use crate::error::AppError;
use crate::jupyter::types::{ProxyConfig, ProxyType};

const SSH_START_TIMEOUT: Duration = Duration::from_secs(30);

pub struct SshTunnel {
    address: SocketAddrV4,
    child: Child,
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
        let mut child = Command::new("ssh")
            .args([
                "-N",
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
                "-D",
            ])
            .arg(address.to_string())
            .arg("--")
            .arg(alias)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| AppError::Proxy(format!("Could not start OpenSSH: {error}")))?;

        let stderr = tokio::spawn(read_ssh_stderr(
            child.stderr.take().expect("piped SSH stderr"),
        ));
        let mut tunnel = Self {
            address,
            child,
            stderr,
        };

        tokio::select! {
            biased;
            status = tunnel.child.wait() => {
                let status = status?;
                let stderr = timeout(Duration::from_millis(200), &mut tunnel.stderr)
                    .await
                    .ok()
                    .and_then(Result::ok)
                    .unwrap_or_default();
                let stderr = String::from_utf8_lossy(&stderr);
                let detail = stderr.trim();
                let detail = if detail.is_empty() { status.to_string() } else { detail.to_owned() };
                Err(AppError::Proxy(format!("SSH tunnel for {alias} failed: {detail}")))
            }
            ready = timeout(SSH_START_TIMEOUT, wait_for_socks(address)) => match ready {
                Ok(Ok(())) => Ok(tunnel),
                Ok(Err(error)) => Err(AppError::Proxy(format!("SSH tunnel for {alias} failed: {error}"))),
                Err(_) => Err(AppError::Proxy(format!("Timed out opening SSH tunnel for {alias}"))),
            },
        }
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
