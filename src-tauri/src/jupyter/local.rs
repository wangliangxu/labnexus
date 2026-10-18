//! Discovery and lifecycle of the single Jupyter process owned by LabNexus.
use crate::{error::AppError, jupyter::types::JupyterServerConfig};
use serde::Serialize;
use std::{path::PathBuf, process::Stdio, time::Duration};
use tokio::{
    process::{Child, Command},
    sync::Mutex,
};

pub const LOCAL_SERVER_ID: &str = "labnexus-local-jupyter";

#[derive(Clone, Serialize)]
pub struct LocalInstallation {
    pub name: String,
    pub executable: String,
    pub version: String,
    #[serde(skip)]
    args: Vec<String>,
}

pub struct LocalServer {
    pub child: Child,
    pub config: JupyterServerConfig,
}

#[derive(Default)]
pub struct LocalJupyter {
    pub server: Mutex<Option<LocalServer>>,
}

fn search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect())
        .unwrap_or_default();
    for key in ["VIRTUAL_ENV", "CONDA_PREFIX"] {
        if let Some(prefix) = std::env::var_os(key) {
            dirs.push(PathBuf::from(&prefix).join("bin"));
            dirs.push(PathBuf::from(prefix).join("Scripts"));
        }
    }
    for path in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/opt/anaconda3/bin",
        "/opt/miniconda3/bin",
    ] {
        dirs.push(PathBuf::from(path));
    }
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        let home = PathBuf::from(home);
        for path in [
            ".local/bin",
            "miniconda3/bin",
            "anaconda3/bin",
            "opt/miniconda3/bin",
            "opt/anaconda3/bin",
        ] {
            dirs.push(home.join(path));
        }
        if let Ok(versions) = std::fs::read_dir(home.join("Library/Python")) {
            dirs.extend(versions.flatten().map(|entry| entry.path().join("bin")));
        }
    }
    let mut unique = Vec::new();
    for dir in dirs {
        if dir.is_dir() && !unique.contains(&dir) {
            unique.push(dir);
        }
    }
    unique
}

fn command(executable: &str) -> Command {
    let mut cmd = Command::new(executable);
    // GUI apps often inherit a smaller PATH than the user's terminal.
    if let Ok(path) = std::env::join_paths(search_dirs()) {
        cmd.env("PATH", path);
    }
    cmd.kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    cmd
}

pub async fn detect() -> Option<LocalInstallation> {
    let dirs = search_dirs();
    for (binary, name, args) in [
        ("jupyter-lab", "JupyterLab", vec![]),
        ("jupyter-notebook", "Jupyter Notebook", vec![]),
        ("jupyter", "Jupyter Server", vec!["server"]),
        ("python3", "JupyterLab", vec!["-m", "jupyterlab"]),
        ("python", "JupyterLab", vec!["-m", "jupyterlab"]),
        ("python3", "Jupyter Notebook", vec!["-m", "notebook"]),
        ("python", "Jupyter Notebook", vec!["-m", "notebook"]),
    ] {
        for dir in &dirs {
            let path = dir.join(format!("{}{}", binary, std::env::consts::EXE_SUFFIX));
            if !path.is_file() {
                continue;
            }
            let executable = path.to_string_lossy().to_string();
            let result = tokio::time::timeout(
                Duration::from_secs(5),
                command(&executable).args(&args).arg("--version").output(),
            )
            .await;
            if let Ok(Ok(output)) = result {
                if output.status.success() {
                    return Some(LocalInstallation {
                        name: name.into(),
                        executable,
                        version: String::from_utf8_lossy(&output.stdout).trim().to_string(),
                        args: args.into_iter().map(String::from).collect(),
                    });
                }
            }
        }
    }
    None
}

pub async fn launch(installation: &LocalInstallation) -> Result<LocalServer, AppError> {
    // Let the OS choose an available ephemeral port. Disable Jupyter's fallback
    // ports so that a race can never silently connect us to a different service.
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    let token = uuid::Uuid::new_v4().simple().to_string();
    let config = JupyterServerConfig {
        id: LOCAL_SERVER_ID.into(),
        name: format!("Local {}", installation.name),
        base_url: format!("http://127.0.0.1:{}", port),
        token: Some(token.clone()),
        proxy: None,
    };
    let app_class = if installation.name == "Jupyter Notebook" {
        "NotebookApp"
    } else {
        "ServerApp"
    };
    let mut cmd = command(&installation.executable);
    cmd.args(&installation.args)
        .args([
            "--no-browser".to_string(),
            "--ip=127.0.0.1".into(),
            format!("--port={}", port),
            "--port-retries=0".into(),
            format!("--{}.base_url=/", app_class),
            format!("--{}.token={}", app_class, token),
            format!("--{}.password=", app_class),
            format!("--{}.certfile=", app_class),
            format!("--{}.keyfile=", app_class),
        ])
        .env("JUPYTER_TOKEN", &token)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        cmd.arg(format!("--notebook-dir={}", PathBuf::from(&home).display()));
        cmd.current_dir(home);
    }
    drop(listener);
    let mut child = cmd.spawn()?;
    let stderr = child.stderr.take().expect("piped stderr");
    let logs = std::sync::Arc::new(std::sync::Mutex::new(std::collections::VecDeque::new()));
    let log_buffer = logs.clone();
    tokio::spawn(async move {
        use tokio::io::AsyncReadExt;
        let mut stderr = stderr;
        let mut chunk = [0; 1024];
        while let Ok(n) = stderr.read(&mut chunk).await {
            if n == 0 {
                break;
            }
            let mut buffer = log_buffer.lock().unwrap();
            buffer.extend(&chunk[..n]);
            while buffer.len() > 8192 {
                buffer.pop_front();
            }
        }
    });
    let http = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(1))
        .build()?;
    let result = async {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
        while tokio::time::Instant::now() < deadline {
            if let Some(status) = child.try_wait()? {
                return Err(AppError::JupyterConnection(format!(
                    "Local Jupyter exited ({status})."
                )));
            }
            if let Ok(response) = http
                .get(format!("{}/api", config.base_url))
                .header("Authorization", format!("token {}", token))
                .send()
                .await
            {
                if response.status().is_success()
                    && response
                        .json::<serde_json::Value>()
                        .await
                        .ok()
                        .and_then(|body| body.get("version").cloned())
                        .is_some()
                {
                    return Ok(());
                }
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        Err(AppError::JupyterConnection(
            "Local Jupyter did not become ready within 60 seconds.".into(),
        ))
    }
    .await;
    if let Err(error) = result {
        let _ = child.kill().await;
        let bytes: Vec<u8> = logs.lock().unwrap().iter().copied().collect();
        let detail = String::from_utf8_lossy(&bytes).replace(&token, "[redacted]");
        return Err(AppError::JupyterConnection(format!(
            "{}\n{}",
            error, detail
        )));
    }
    Ok(LocalServer { child, config })
}

impl LocalJupyter {
    pub async fn stop(&self) -> Result<(), AppError> {
        if let Some(mut server) = self.server.lock().await.take() {
            if server.child.try_wait()?.is_none() {
                // Jupyter's shutdown endpoint also tears down kernels and terminals.
                if let Ok(http) = reqwest::Client::builder()
                    .no_proxy()
                    .timeout(Duration::from_secs(2))
                    .build()
                {
                    let _ = http
                        .post(format!("{}/api/shutdown", server.config.base_url))
                        .header(
                            "Authorization",
                            format!(
                                "token {}",
                                server.config.token.as_deref().unwrap_or_default()
                            ),
                        )
                        .send()
                        .await;
                }
                if tokio::time::timeout(Duration::from_secs(3), server.child.wait())
                    .await
                    .is_err()
                {
                    server.child.kill().await?;
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires a local Jupyter installation and starts a server"]
    async fn installed_jupyter_starts_authenticates_lists_files_and_stops() {
        let installation = detect().await.expect("local Jupyter installation");
        let server = launch(&installation).await.expect("server becomes ready");
        let url = server.config.base_url.clone();
        assert!(url.starts_with("http://127.0.0.1:"));
        assert_ne!(url, "http://127.0.0.1:0");
        let http = reqwest::Client::builder().no_proxy().build().unwrap();
        let denied = http
            .get(format!("{url}/api/contents"))
            .send()
            .await
            .unwrap();
        assert!(
            !denied.status().is_success(),
            "contents must require authentication"
        );
        let client = crate::jupyter::client::JupyterClient::new(&server.config).unwrap();
        assert!(!client.get_server_info().await.unwrap().version.is_empty());
        client
            .list_contents("")
            .await
            .expect("authenticated file browsing");
        let manager = LocalJupyter::default();
        *manager.server.lock().await = Some(server);
        manager.stop().await.unwrap();
        assert!(http.get(format!("{url}/api")).send().await.is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn startup_failure_reports_the_error_without_exposing_token() {
        let installation = LocalInstallation {
            name: "JupyterLab".into(),
            executable: "/bin/sh".into(),
            version: "test".into(),
            args: vec![
                "-c".into(),
                "echo failed-token-$JUPYTER_TOKEN >&2; exit 1".into(),
            ],
        };
        let error = match launch(&installation).await {
            Ok(_) => panic!("broken entry point should fail"),
            Err(error) => error.to_string(),
        };
        assert!(error.contains("exited"));
        assert!(error.contains("failed-token-[redacted]"));
    }

    #[tokio::test]
    async fn stopping_an_owned_process_reaps_it_and_is_repeatable() {
        #[cfg(unix)]
        {
            let child = command("/bin/sh")
                .args(["-c", "exec sleep 30"])
                .spawn()
                .unwrap();
            let pid = child.id().unwrap();
            let manager = LocalJupyter::default();
            *manager.server.lock().await = Some(LocalServer {
                child,
                config: JupyterServerConfig {
                    id: LOCAL_SERVER_ID.into(),
                    name: "test".into(),
                    base_url: "http://127.0.0.1:1".into(),
                    token: None,
                    proxy: None,
                },
            });
            manager.stop().await.unwrap();
            manager.stop().await.unwrap();
            assert!(manager.server.lock().await.is_none());
            let status = Command::new("/bin/kill")
                .args(["-0", &pid.to_string()])
                .status()
                .await
                .unwrap();
            assert!(!status.success(), "owned child must have exited");
        }
    }
}
