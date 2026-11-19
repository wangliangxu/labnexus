//! Launch Jupyter in a Python environment selected on an SSH host.

use std::sync::Arc;

use sha2::{Digest, Sha256};

use crate::error::AppError;
use crate::jupyter::ssh::SshTunnel;
use crate::jupyter::types::{JupyterServerConfig, ProxyConfig, ProxyType, RemoteJupyterLaunch};

const SERVER_ID_PREFIX: &str = "labnexus-ssh-jupyter-";

pub fn is_managed(server_id: &str) -> bool {
    server_id.starts_with(SERVER_ID_PREFIX)
}

pub fn server_id(launch: &RemoteJupyterLaunch) -> String {
    let digest = Sha256::digest(format!("{}\0{}", launch.alias, launch.python));
    format!("{SERVER_ID_PREFIX}{digest:x}")
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn remote_command(python: &str) -> Result<String, AppError> {
    if python.starts_with('-') || python.chars().any(char::is_control) {
        return Err(AppError::JupyterConnection(
            "Enter a remote Python executable, such as python3 or ~/venv/bin/python.".into(),
        ));
    }
    let executable = if let Some(path) = python.strip_prefix("~/") {
        format!("\"$HOME\"/{}", shell_quote(path))
    } else {
        shell_quote(python)
    };
    let launcher = shell_quote(include_str!("remote_launcher.py"));
    Ok(format!("exec {executable} -u -c {launcher}"))
}

pub async fn launch(
    launch: RemoteJupyterLaunch,
    name: Option<String>,
) -> Result<(JupyterServerConfig, Arc<SshTunnel>), AppError> {
    let command = remote_command(&launch.python)?;
    let token = uuid::Uuid::new_v4().simple().to_string();
    let (ssh, port) = SshTunnel::start_remote(&launch.alias, &command, &token).await?;
    let config = JupyterServerConfig {
        id: server_id(&launch),
        name: name
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| format!("Jupyter @ {}", launch.alias)),
        base_url: format!("http://127.0.0.1:{port}"),
        token: Some(token),
        proxy: Some(ProxyConfig {
            proxy_type: ProxyType::Ssh,
            host: launch.alias.clone(),
            port: 0,
            username: None,
            password: None,
        }),
        remote_launch: Some(launch),
    };
    Ok((config, ssh))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jupyter::client::JupyterClient;

    #[test]
    fn quotes_remote_executable_paths_as_single_shell_arguments() {
        let command = remote_command("~/env's $(ignored)/bin/python").unwrap();
        assert!(command.starts_with("exec \"$HOME\"/'env'\\''s $(ignored)/bin/python' -u -c "));
        assert!(remote_command("python3\ninvalid").is_err());
    }

    #[tokio::test]
    #[ignore = "requires an SSH alias and remote Python with Jupyter installed"]
    async fn starts_and_stops_jupyter_through_ssh() {
        let launch_profile = RemoteJupyterLaunch {
            alias: std::env::var("LABNEXUS_TEST_SSH_ALIAS").unwrap(),
            python: std::env::var("LABNEXUS_TEST_REMOTE_PYTHON")
                .unwrap_or_else(|_| "python3".into()),
        };
        let (config, tunnel) = launch(launch_profile, None).await.unwrap();
        let client = JupyterClient::new(&config, Some(&tunnel)).unwrap();
        assert!(!client.get_server_info().await.unwrap().version.is_empty());
        assert_eq!(
            client.list_contents("").await.unwrap().content_type,
            crate::jupyter::types::ContentType::Directory
        );
        let terminal = client.create_terminal().await.unwrap();
        assert!(client
            .list_terminals()
            .await
            .unwrap()
            .iter()
            .any(|entry| entry.name == terminal.name));
        let kernel = client.start_kernel("python3").await.unwrap();
        client.shutdown_kernel(&kernel.id).await.unwrap();

        tunnel.stop_remote().await;
        assert!(!tunnel.is_running().await);
        assert!(client.get_server_info().await.is_err());
    }
}
