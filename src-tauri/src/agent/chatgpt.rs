//! Official Sign in with ChatGPT for local apps. Tokens never cross the IPC boundary.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use jsonwebtoken::{decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    path::PathBuf,
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::{oneshot, Mutex},
};

const ISSUER: &str = "https://auth.openai.com";
pub const API_BASE: &str = "https://api.openai.com/v1";
const DYNAMIC_CLIENT: &str = "dynamic_agent_client";
const PLAN_SCOPE: &str = "chatgpt.tokens.use.direct";
const SCOPE: &str = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const USAGE_URL: &str = "https://chatgpt.com/settings/usage";
static STORE_LOCK: Mutex<()> = Mutex::const_new(());
static LOGIN: Mutex<LoginState> = Mutex::const_new(LoginState {
    id: None,
    cancel: None,
    error: None,
});

struct LoginState {
    id: Option<String>,
    cancel: Option<oneshot::Sender<()>>,
    error: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Profile {
    id: String,
    client_id: String,
    subject: Option<String>,
    email: Option<String>,
    access_token: Option<String>,
    refresh_token: Option<String>,
    id_token: Option<String>,
    scopes: Vec<String>,
    expires_at: i64,
}
#[derive(Default, Serialize, Deserialize)]
struct Store {
    host_id: String,
    active_id: Option<String>,
    profiles: Vec<Profile>,
}
#[derive(Serialize)]
pub struct Account {
    pub id: String,
    pub label: String,
    pub connected: bool,
}
#[derive(Serialize)]
pub struct Status {
    pub accounts: Vec<Account>,
    pub active_id: Option<String>,
    pub pending: bool,
    pub error: Option<String>,
}
#[derive(Serialize, Deserialize)]
pub struct Model {
    pub slug: String,
    pub display_name: String,
}
#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    id_token: Option<String>,
    expires_in: i64,
    scope: Option<String>,
    token_type: String,
}
pub struct Access {
    pub token: String,
    pub profile_id: String,
}

fn random() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}
fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}
fn now() -> i64 {
    chrono::Utc::now().timestamp()
}
fn client() -> Result<Client, String> {
    let network = super::network::load_network_config().map_err(|error| error.to_string())?;
    super::network::client_builder(&network.chatgpt, ISSUER).map_err(|error| error.to_string())?
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Unable to initialize ChatGPT HTTP client".into())
}
fn directory() -> PathBuf {
    super::config::get_config_path()
        .parent()
        .unwrap()
        .join("chatgpt")
}
fn open_private(path: &std::path::Path, create_new: bool) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.write(true);
    if create_new {
        options.create_new(true);
    } else {
        options.create(true);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(path)
        .map_err(|_| "Unable to open protected ChatGPT storage".into())
}
async fn disk_lock() -> Result<File, String> {
    let dir = directory();
    fs::create_dir_all(&dir).map_err(|_| "Unable to create ChatGPT storage")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))
            .map_err(|_| "Unable to protect ChatGPT storage")?;
    }
    let file = open_private(&dir.join("session.lock"), false)?;
    for _ in 0..200 {
        match fs2::FileExt::try_lock_exclusive(&file) {
            Ok(()) => return Ok(file),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                tokio::time::sleep(Duration::from_millis(100)).await
            }
            Err(_) => return Err("Unable to lock ChatGPT storage".into()),
        }
    }
    Err("ChatGPT credentials are in use by another process; try again".into())
}
fn load() -> Result<Store, String> {
    let path = directory().join("accounts.json");
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|_| "ChatGPT account storage is invalid; restore it before signing in".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Store::default()),
        Err(_) => Err("Unable to read ChatGPT account storage".into()),
    }
}
fn save(store: &Store) -> Result<(), String> {
    save_to(store, &directory())
}
fn save_to(store: &Store, dir: &std::path::Path) -> Result<(), String> {
    use std::io::Write;
    let path = dir.join(format!("accounts-{}.tmp", uuid::Uuid::new_v4().simple()));
    let result = (|| {
        let mut file = open_private(&path, true)?;
        serde_json::to_writer(&mut file, store)
            .map_err(|_| "Unable to encode ChatGPT credentials")?;
        file.flush()
            .and_then(|_| file.sync_all())
            .map_err(|_| "Unable to save ChatGPT credentials")?;
        drop(file);
        fs::rename(&path, dir.join("accounts.json"))
            .map_err(|_| "Unable to replace ChatGPT credentials")?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(path);
    }
    result
}
fn has_plan(profile: &Profile) -> bool {
    profile.scopes.iter().any(|scope| scope == PLAN_SCOPE)
        && profile
            .scopes
            .iter()
            .any(|scope| scope == "resource.invoke")
}
pub async fn status() -> Result<Status, String> {
    let (accounts, active_id) = {
        let _guard = STORE_LOCK.lock().await;
        let _disk = disk_lock().await?;
        let store = load()?;
        let accounts = store
            .profiles
            .iter()
            .map(|p| Account {
                id: p.id.clone(),
                label: format!(
                    "{} · {}",
                    p.email.as_deref().unwrap_or("ChatGPT account"),
                    &p.id.chars().take(8).collect::<String>()
                ),
                connected: p.access_token.is_some() && has_plan(p),
            })
            .collect();
        (accounts, store.active_id)
    };
    let login = LOGIN.lock().await;
    Ok(Status {
        accounts,
        active_id,
        pending: login.id.is_some(),
        error: login.error.clone(),
    })
}

struct Attempt {
    id: String,
    state: String,
    nonce: String,
    verifier: String,
    redirect: String,
    profile: Option<Profile>,
}
fn authorization_url(attempt: &Attempt, host: &str) -> String {
    let mut url = url::Url::parse(&format!("{}/api/accounts/authorize", ISSUER)).unwrap();
    let id = attempt
        .profile
        .as_ref()
        .map(|p| p.client_id.as_str())
        .unwrap_or(DYNAMIC_CLIENT);
    url.query_pairs_mut().extend_pairs([
        ("client_id", id),
        ("ext_agent_host_id", host),
        ("response_type", "code"),
        ("redirect_uri", &attempt.redirect),
        ("scope", SCOPE),
        ("resource", API_BASE),
        ("state", &attempt.state),
        ("nonce", &attempt.nonce),
        ("code_challenge_method", "S256"),
        ("code_challenge", &challenge(&attempt.verifier)),
    ]);
    if attempt.profile.is_none() {
        url.query_pairs_mut()
            .append_pair("agent_name_hint", "LabNexus");
    }
    // No ID-token hint crosses IPC or appears in browser-launch diagnostics.
    url.to_string()
}

/// Prepares a loopback listener; only the native command opens this URL in the browser.
pub async fn start(profile_id: Option<String>) -> Result<String, String> {
    let (host, profile) = {
        let _guard = STORE_LOCK.lock().await;
        let _disk = disk_lock().await?;
        let mut store = load()?;
        if store.host_id.is_empty() {
            store.host_id = format!("urn:uuid:{}", uuid::Uuid::new_v4());
            save(&store)?;
        }
        let profile = match profile_id {
            Some(id) => Some(
                store
                    .profiles
                    .iter()
                    .find(|p| p.id == id)
                    .cloned()
                    .ok_or("Unknown ChatGPT account")?,
            ),
            None => None,
        };
        (store.host_id, profile)
    };
    let mut login = LOGIN.lock().await;
    if login.id.is_some() {
        return Err("A ChatGPT sign-in is already in progress".into());
    }
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|_| "Unable to open local sign-in callback")?;
    let attempt = Attempt {
        id: uuid::Uuid::new_v4().to_string(),
        state: random(),
        nonce: random(),
        verifier: random(),
        redirect: format!(
            "http://127.0.0.1:{}/auth/callback",
            listener
                .local_addr()
                .map_err(|_| "Unable to inspect callback listener")?
                .port()
        ),
        profile,
    };
    let url = authorization_url(&attempt, &host);
    let id = attempt.id.clone();
    let (cancel_tx, cancel_rx) = oneshot::channel();
    login.id = Some(id.clone());
    login.cancel = Some(cancel_tx);
    login.error = None;
    tokio::spawn(async move {
        let result = tokio::select! {
            result=tokio::time::timeout(Duration::from_secs(300),complete_login(listener,attempt)) => result.unwrap_or_else(|_|Err("ChatGPT sign-in timed out; try again".into())),
            _=cancel_rx=>Err("ChatGPT sign-in cancelled".into()),
        };
        let mut login = LOGIN.lock().await;
        if login.id.as_deref() == Some(&id) {
            login.id = None;
            login.cancel = None;
            login.error = result.err();
        }
    });
    Ok(url)
}
pub async fn cancel() {
    let mut login = LOGIN.lock().await;
    if let Some(tx) = login.cancel.take() {
        let _ = tx.send(());
    }
    login.id = None;
    login.error = None;
}

fn callback(target: &str, attempt: &Attempt) -> Result<(String, String), String> {
    let url = url::Url::parse(&format!("http://127.0.0.1{}", target))
        .map_err(|_| "Invalid sign-in callback")?;
    if url.path() != "/auth/callback" {
        return Err("Invalid callback path".into());
    }
    let pairs: Vec<_> = url.query_pairs().into_owned().collect();
    let values: std::collections::HashMap<_, _> = pairs.iter().cloned().collect();
    if pairs.len() != values.len() {
        return Err("Duplicate OAuth callback parameter".into());
    }
    if values.get("state") != Some(&attempt.state) {
        return Err("Invalid OAuth state".into());
    }
    if values.contains_key("error") {
        return Err("ChatGPT authorization was declined or unavailable; check account and workspace eligibility".into());
    }
    let code = values
        .get("code")
        .filter(|v| !v.is_empty())
        .ok_or("Missing authorization code")?
        .clone();
    let client_id = if let Some(profile) = &attempt.profile {
        if values
            .get("client_id")
            .is_some_and(|id| id != &profile.client_id)
        {
            return Err("ChatGPT registration changed unexpectedly".into());
        }
        profile.client_id.clone()
    } else {
        values
            .get("client_id")
            .filter(|id| !id.is_empty() && id.as_str() != DYNAMIC_CLIENT)
            .ok_or("Missing issued client ID")?
            .clone()
    };
    Ok((code, client_id))
}
async fn complete_login(listener: TcpListener, attempt: Attempt) -> Result<(), String> {
    loop {
        let (mut socket, _) = listener
            .accept()
            .await
            .map_err(|_| "Unable to receive sign-in callback")?;
        let read = tokio::time::timeout(Duration::from_secs(3), async {
            let mut bytes = Vec::new();
            let mut buf = [0u8; 1024];
            while bytes.len() < 16 * 1024 {
                let n = socket
                    .read(&mut buf)
                    .await
                    .map_err(|_| "Unable to read callback")?;
                if n == 0 {
                    break;
                }
                bytes.extend_from_slice(&buf[..n]);
                if bytes.windows(4).any(|p| p == b"\r\n\r\n") {
                    break;
                }
            }
            String::from_utf8(bytes).map_err(|_| "Invalid callback encoding")
        })
        .await;
        let Ok(Ok(request)) = read else { continue };
        let target = request
            .lines()
            .next()
            .and_then(|line| line.strip_prefix("GET "))
            .and_then(|line| line.strip_suffix(" HTTP/1.1"));
        let Some(target) = target else { continue };
        let parsed = callback(target, &attempt);
        // Invalid paths/state never terminate the valid pending login.
        let matched = url::Url::parse(&format!("http://127.0.0.1{}", target))
            .ok()
            .is_some_and(|url| {
                url.path() == "/auth/callback"
                    && url
                        .query_pairs()
                        .any(|(key, val)| key == "state" && val == attempt.state)
            });
        if !matched {
            let _ = socket
                .write_all(
                    b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
                )
                .await;
            continue;
        }
        let result = match parsed {
            Ok((code, id)) => exchange(&attempt, &code, &id).await,
            Err(error) => Err(error),
        };
        let body = if result.is_ok() {
            "ChatGPT connected. Return to LabNexus to select your model and save settings."
        } else {
            "Sign-in did not complete. Return to LabNexus for details."
        };
        let response=format!("HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",body.len(),body);
        let _ = socket.write_all(response.as_bytes()).await;
        return result;
    }
}
async fn token_request(http: &Client, form: &[(&str, &str)]) -> Result<TokenResponse, String> {
    let response = http
        .post(format!("{}/api/accounts/oauth/token", ISSUER))
        .form(form)
        .send()
        .await
        .map_err(|_| "ChatGPT token request failed; check network and sign in again")?;
    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body: Value = response.json().await.unwrap_or(Value::Null);
        let code = body["error"]
            .as_str()
            .or_else(|| body["error"]["code"].as_str())
            .or_else(|| body["code"].as_str())
            .unwrap_or("unknown");
        let code = if code.len() < 80 && code.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        {
            code
        } else {
            "unknown"
        };
        return Err(format!(
            "ChatGPT authorization failed ({}), HTTP {}; sign in again if access expired",
            code, status
        ));
    }
    let token: TokenResponse = response
        .json()
        .await
        .map_err(|_| "Invalid ChatGPT token response")?;
    if !token.token_type.eq_ignore_ascii_case("bearer")
        || token.access_token.is_empty()
        || token.expires_in <= 0
    {
        return Err("Invalid ChatGPT token grant".into());
    }
    Ok(token)
}
async fn metadata(http: &Client) -> Result<Value, String> {
    let response = http
        .get(format!("{}/.well-known/openid-configuration", ISSUER))
        .send()
        .await
        .map_err(|_| "Unable to read OpenAI identity metadata")?;
    let metadata: Value = response
        .error_for_status()
        .map_err(|_| "OpenAI identity metadata unavailable")?
        .json()
        .await
        .map_err(|_| "Invalid identity metadata")?;
    if metadata["issuer"] != ISSUER {
        return Err("Unexpected OpenAI token issuer".into());
    }
    Ok(metadata)
}
fn trusted_auth_url(value: &Value) -> Result<String, String> {
    let url = url::Url::parse(
        value
            .as_str()
            .ok_or("Missing OpenAI authentication endpoint")?,
    )
    .map_err(|_| "Invalid OpenAI authentication endpoint")?;
    if url.scheme() != "https"
        || url.host_str() != Some("auth.openai.com")
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Untrusted OpenAI authentication endpoint".into());
    }
    Ok(url.to_string())
}
fn validate_identity(
    token: &str,
    client_id: &str,
    nonce: Option<&str>,
    jwks: &JwkSet,
) -> Result<Value, String> {
    let header = decode_header(token).map_err(|_| "Invalid ChatGPT identity token")?;
    if header.alg != Algorithm::RS256 {
        return Err("Unexpected identity-token signing algorithm".into());
    }
    let jwk = header
        .kid
        .as_deref()
        .and_then(|kid| jwks.find(kid))
        .ok_or("Unknown OpenAI signing key")?;
    let key = DecodingKey::from_jwk(jwk).map_err(|_| "Invalid OpenAI signing key")?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_issuer(&[ISSUER]);
    validation.set_audience(&[client_id]);
    validation.set_required_spec_claims(&["iss", "aud", "exp", "sub"]);
    validation.leeway = 30;
    validation.validate_nbf = true;
    let claims = decode::<Value>(token, &key, &validation)
        .map_err(|_| "ChatGPT identity signature or claims were invalid")?
        .claims;
    if nonce.is_some_and(|nonce| claims["nonce"].as_str() != Some(nonce)) {
        return Err("Invalid OpenID nonce".into());
    }
    if claims["sub"].as_str().is_none_or(|sub| sub.is_empty()) {
        return Err("Missing ChatGPT account identity".into());
    }
    Ok(claims)
}
async fn identity(
    http: &Client,
    token: &str,
    client_id: &str,
    nonce: Option<&str>,
) -> Result<Value, String> {
    let meta = metadata(http).await?;
    let jwks_url = trusted_auth_url(&meta["jwks_uri"])?;
    let jwks: JwkSet = http
        .get(jwks_url)
        .send()
        .await
        .map_err(|_| "Unable to retrieve OpenAI signing keys")?
        .error_for_status()
        .map_err(|_| "OpenAI signing keys unavailable")?
        .json()
        .await
        .map_err(|_| "Invalid OpenAI signing keys")?;
    validate_identity(token, client_id, nonce, &jwks)
}
async fn exchange(attempt: &Attempt, code: &str, client_id: &str) -> Result<(), String> {
    // Retain an issued registration before code exchange, even if exchange later fails.
    let profile_id = {
        let _guard = STORE_LOCK.lock().await;
        let _disk = disk_lock().await?;
        let mut store = load()?;
        let profile = if let Some(profile) = &attempt.profile {
            profile.clone()
        } else {
            Profile {
                id: uuid::Uuid::new_v4().to_string(),
                client_id: client_id.into(),
                subject: None,
                email: None,
                access_token: None,
                refresh_token: None,
                id_token: None,
                scopes: vec![],
                expires_at: 0,
            }
        };
        let id = profile.id.clone();
        if !store.profiles.iter().any(|p| p.id == id) {
            store.profiles.push(profile);
            save(&store)?;
        }
        id
    };
    let http = client()?;
    let token = token_request(
        &http,
        &[
            ("grant_type", "authorization_code"),
            ("client_id", client_id),
            ("code", code),
            ("code_verifier", &attempt.verifier),
            ("redirect_uri", &attempt.redirect),
            ("resource", API_BASE),
        ],
    )
    .await?;
    let id_token = token
        .id_token
        .as_deref()
        .ok_or("Missing OpenID identity token")?;
    let claims = identity(&http, id_token, client_id, Some(&attempt.nonce)).await?;
    if attempt
        .profile
        .as_ref()
        .and_then(|p| p.subject.as_deref())
        .is_some_and(|sub| claims["sub"].as_str() != Some(sub))
    {
        return Err("The signed-in account does not match the selected registration".into());
    }
    let scopes: Vec<String> = token
        .scope
        .as_deref()
        .unwrap_or("")
        .split_whitespace()
        .map(str::to_owned)
        .collect();
    if !scopes.iter().any(|s| s == PLAN_SCOPE) || !scopes.iter().any(|s| s == "resource.invoke") {
        return Err(
            "ChatGPT plan permission was not granted; check account and workspace eligibility"
                .into(),
        );
    }
    let _guard = STORE_LOCK.lock().await;
    let _disk = disk_lock().await?;
    let mut store = load()?;
    let profile = store
        .profiles
        .iter_mut()
        .find(|p| p.id == profile_id)
        .ok_or("ChatGPT registration no longer exists")?;
    profile.subject = claims["sub"].as_str().map(str::to_owned);
    profile.email = claims["email"].as_str().map(str::to_owned);
    profile.access_token = Some(token.access_token);
    profile.refresh_token = token.refresh_token;
    profile.id_token = token.id_token;
    profile.scopes = scopes;
    profile.expires_at = now() + token.expires_in;
    store.active_id = Some(profile_id);
    save(&store)
}

fn unusable_refresh(error: &str) -> bool {
    [
        "invalid_grant",
        "invalid_refresh_token",
        "token_expired",
        "refresh_token_expired",
        "refresh_token_invalidated",
        "refresh_token_reused",
    ]
    .iter()
    .any(|code| error.contains(&format!("({})", code)))
}

pub fn inference_error(error: &Value) -> Option<String> {
    let code = error["code"].as_str()?;
    let message = match code {
        "subscription_sharing_usage_limit_exceeded" => "ChatGPT plan or app usage limit reached. Review app limits in ChatGPT usage settings before retrying.",
        "subscription_sharing_user_not_eligible" => "ChatGPT plan usage is unavailable for this account or workspace. Check eligibility in ChatGPT settings.",
        "subscription_sharing_usage_unavailable" | "subscription_sharing_user_unavailable" => "ChatGPT plan usage is temporarily unavailable. Your sign-in is retained; retry later.",
        "subscription_sharing_unsupported_capability" => "This ChatGPT plan request includes an unsupported model or capability.",
        "subscription_sharing_invalid_user" => "ChatGPT could not validate this account. Check access or sign in again.",
        "chatpass_v2_scope_not_authorized" | "chatpass_v2_invalid_authorization_context" => "The ChatGPT authorization does not permit this request. Check the granted plan permission.",
        _ => return None,
    };
    Some(format!("{} ({})", message, code))
}

pub async fn access(profile_id: &str) -> Result<Access, String> {
    let _guard = STORE_LOCK.lock().await;
    let _disk = disk_lock().await?;
    let mut store = load()?;
    let id = if profile_id.is_empty() {
        store
            .active_id
            .clone()
            .ok_or("Sign in with ChatGPT first")?
    } else {
        profile_id.into()
    };
    let profile = store
        .profiles
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or("Select a saved ChatGPT account")?;
    if !has_plan(profile) || profile.access_token.is_none() {
        return Err("Sign in with ChatGPT and authorize plan usage first".into());
    }
    if profile.expires_at <= now() + 60 {
        let refresh = profile
            .refresh_token
            .as_deref()
            .ok_or("ChatGPT sign-in expired; sign in again")?;
        let http = client()?;
        let token = match token_request(
            &http,
            &[
                ("grant_type", "refresh_token"),
                ("client_id", &profile.client_id),
                ("refresh_token", refresh),
                ("resource", API_BASE),
            ],
        )
        .await
        {
            Ok(token) => token,
            Err(error) => {
                if unusable_refresh(&error) {
                    profile.access_token = None;
                    profile.refresh_token = None;
                    profile.id_token = None;
                    profile.scopes.clear();
                    profile.expires_at = 0;
                    save(&store)?;
                }
                return Err(error);
            }
        };
        if let Some(id_token) = &token.id_token {
            let claims = identity(&http, id_token, &profile.client_id, None).await?;
            if claims["sub"].as_str() != profile.subject.as_deref() {
                return Err("Renewed ChatGPT account identity changed; sign in again".into());
            }
        }
        if let Some(scope) = token.scope {
            profile.scopes = scope.split_whitespace().map(str::to_owned).collect();
        }
        if !has_plan(profile) {
            return Err("ChatGPT plan permission is no longer granted; sign in again".into());
        }
        profile.access_token = Some(token.access_token);
        profile.refresh_token = token.refresh_token;
        if token.id_token.is_some() {
            profile.id_token = token.id_token;
        }
        profile.expires_at = now() + token.expires_in;
        save(&store)?;
    }
    let token = store
        .profiles
        .iter()
        .find(|p| p.id == id)
        .and_then(|p| p.access_token.clone())
        .ok_or("Sign in with ChatGPT again")?;
    Ok(Access {
        token,
        profile_id: id,
    })
}
pub async fn models(profile_id: &str) -> Result<Vec<Model>, String> {
    let access = access(profile_id).await?;
    let response = client()?
        .get(format!("{}/models", API_BASE))
        .bearer_auth(access.token)
        .send()
        .await
        .map_err(|_| "Unable to load ChatGPT models")?;
    if !response.status().is_success() {
        return Err(format!(
            "ChatGPT model catalog unavailable (HTTP {}); check account access",
            response.status().as_u16()
        ));
    }
    let value: Value = response
        .json()
        .await
        .map_err(|_| "Invalid ChatGPT model catalog")?;
    Ok(value["models"]
        .as_array()
        .ok_or("ChatGPT account did not return a model catalog")?
        .iter()
        .filter(|model| model["visibility"] == "list")
        .filter_map(|model| {
            Some(Model {
                slug: model["slug"].as_str()?.into(),
                display_name: model["display_name"].as_str()?.into(),
            })
        })
        .collect())
}
pub async fn logout(profile_id: &str) -> Result<Option<String>, String> {
    cancel().await;
    let _guard = STORE_LOCK.lock().await;
    let _disk = disk_lock().await?;
    let mut store = load()?;
    let profile = store
        .profiles
        .iter_mut()
        .find(|p| p.id == profile_id)
        .ok_or("Unknown ChatGPT account")?;
    let mut warning = None;
    if let Some(refresh) = &profile.refresh_token {
        let http = client()?;
        let result = async {
            let meta = metadata(&http).await?;
            let endpoint = trusted_auth_url(&meta["revocation_endpoint"])?;
            for attempt in 0..3 {
                match http
                    .post(&endpoint)
                    .form(&[
                        ("token", refresh.as_str()),
                        ("token_type_hint", "refresh_token"),
                        ("client_id", profile.client_id.as_str()),
                    ])
                    .send()
                    .await
                {
                    Ok(response) if response.status() == 200 => return Ok::<_, String>(()),
                    Ok(response) if !response.status().is_server_error() => break,
                    _ => {}
                }
                tokio::time::sleep(Duration::from_millis(200 * (attempt + 1))).await;
            }
            Err(
                "Remote revocation was not confirmed. Disconnect LabNexus in ChatGPT settings."
                    .into(),
            )
        }
        .await;
        if result.is_err() {
            warning = Some(
                "Remote revocation was not confirmed. Disconnect LabNexus in ChatGPT settings."
                    .into(),
            );
        }
    }
    profile.access_token = None;
    profile.refresh_token = None;
    profile.id_token = None;
    profile.scopes.clear();
    profile.expires_at = 0;
    if store.active_id.as_deref() == Some(profile_id) {
        store.active_id = None;
    }
    save(&store)?;
    Ok(warning)
}
pub fn usage_url() -> &'static str {
    USAGE_URL
}

#[cfg(test)]
mod tests {
    use super::*;
    fn attempt(profile: Option<Profile>) -> Attempt {
        Attempt {
            id: "attempt".into(),
            state: "random-state".into(),
            nonce: "random-nonce".into(),
            verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk".into(),
            redirect: "http://127.0.0.1:54321/auth/callback".into(),
            profile,
        }
    }
    fn profile() -> Profile {
        Profile {
            id: "profile-1".into(),
            client_id: "oaiapp_test".into(),
            subject: Some("subject-1".into()),
            email: Some("test@example.test".into()),
            access_token: Some("test-access".into()),
            refresh_token: Some("test-refresh".into()),
            id_token: Some("test-id".into()),
            scopes: vec![PLAN_SCOPE.into(), "resource.invoke".into()],
            expires_at: now() + 3600,
        }
    }
    #[test]
    fn pkce_and_authorization_keep_registration_and_host_separate() {
        let new = attempt(None);
        assert_eq!(
            challenge(&new.verifier),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        let url = url::Url::parse(&authorization_url(&new, "urn:uuid:stable-host")).unwrap();
        let query: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(query["client_id"], DYNAMIC_CLIENT);
        assert_eq!(query["agent_name_hint"], "LabNexus");
        assert_eq!(query["ext_agent_host_id"], "urn:uuid:stable-host");
        assert_eq!(query["resource"], API_BASE);
        assert_eq!(query["redirect_uri"], new.redirect);
        let url = authorization_url(&attempt(Some(profile())), "urn:uuid:stable-host");
        assert!(url.contains("oaiapp_test"));
        assert!(
            !url.contains("agent_name_hint")
                && !url.contains("test-id")
                && !url.contains("test-access")
        );
    }
    #[test]
    fn callback_requires_state_and_the_correct_issued_client() {
        let new = attempt(None);
        assert!(callback(
            "/auth/callback?state=bad&code=code&client_id=oaiapp_test",
            &new
        )
        .is_err());
        assert!(callback(
            "/callback?state=random-state&code=code&client_id=oaiapp_test",
            &new
        )
        .is_err());
        assert!(callback("/auth/callback?state=random-state&code=code", &new).is_err());
        assert!(callback(
            "/auth/callback?state=random-state&error=access_denied",
            &new
        )
        .is_err());
        assert!(callback(
            "/auth/callback?state=random-state&code=code&client_id=dynamic_agent_client",
            &new
        )
        .is_err());
        assert!(callback(
            "/auth/callback?state=random-state&state=other&code=code",
            &new
        )
        .is_err());
        let returning = attempt(Some(profile()));
        assert!(callback(
            "/auth/callback?state=random-state&code=code&client_id=oaiapp_other",
            &returning
        )
        .is_err());
        assert_eq!(
            callback("/auth/callback?state=random-state&code=code", &returning)
                .unwrap()
                .1,
            "oaiapp_test"
        );
    }
    #[test]
    fn verifies_signature_audience_issuer_expiry_and_nonce() {
        use jsonwebtoken::{encode, EncodingKey, Header};
        // This key is an intentionally public test fixture, never used for live credentials.
        let key = EncodingKey::from_rsa_der(include_bytes!("fixtures/chatgpt-test-key.der"));
        let jwks: JwkSet =
            serde_json::from_str(include_str!("fixtures/chatgpt-test-jwks.json")).unwrap();
        let mut header = Header::new(Algorithm::RS256);
        header.kid = Some("local-test-key".into());
        let claims = serde_json::json!({"iss":ISSUER,"aud":"oaiapp_test","sub":"subject-1","exp":now()+3600,"nonce":"random-nonce"});
        let valid = encode(&header, &claims, &key).unwrap();
        assert!(validate_identity(&valid, "oaiapp_test", Some("random-nonce"), &jwks).is_ok());
        assert!(validate_identity(&valid, "oaiapp_other", Some("random-nonce"), &jwks).is_err());
        assert!(validate_identity(&valid, "oaiapp_test", Some("wrong-nonce"), &jwks).is_err());
        for (field, value) in [
            ("iss", serde_json::json!("https://attacker.test")),
            ("exp", serde_json::json!(now() - 100)),
            ("sub", serde_json::json!("")),
        ] {
            let mut bad = claims.clone();
            bad[field] = value;
            assert!(validate_identity(
                &encode(&header, &bad, &key).unwrap(),
                "oaiapp_test",
                Some("random-nonce"),
                &jwks
            )
            .is_err());
        }
        let mut tampered = valid.into_bytes();
        let last = tampered.len() - 8;
        tampered[last] = if tampered[last] == b'a' { b'b' } else { b'a' };
        assert!(validate_identity(
            &String::from_utf8(tampered).unwrap(),
            "oaiapp_test",
            Some("random-nonce"),
            &jwks
        )
        .is_err());
        assert!(trusted_auth_url(&serde_json::json!("https://attacker.test/keys")).is_err());
    }
    #[test]
    fn credentials_replace_atomically_with_private_permissions() {
        let dir = std::env::temp_dir().join(format!("labnexus-chatgpt-test-{}", random()));
        fs::create_dir(&dir).unwrap();
        let mut store = Store {
            host_id: "urn:uuid:stable-host".into(),
            active_id: Some("profile-1".into()),
            profiles: vec![profile()],
        };
        save_to(&store, &dir).unwrap();
        store.profiles[0].refresh_token = Some("replacement-test-refresh".into());
        save_to(&store, &dir).unwrap();
        let restored: Store =
            serde_json::from_slice(&fs::read(dir.join("accounts.json")).unwrap()).unwrap();
        assert_eq!(
            restored.profiles[0].refresh_token.as_deref(),
            Some("replacement-test-refresh")
        );
        assert_eq!(restored.host_id, store.host_id);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(dir.join("accounts.json"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        assert!(has_plan(&profile()));
        let mut identity_only = profile();
        identity_only.scopes = vec!["openid".into()];
        assert!(!has_plan(&identity_only));
        let public = Status {
            accounts: vec![Account {
                id: "profile-1".into(),
                label: "Account".into(),
                connected: true,
            }],
            active_id: None,
            pending: false,
            error: None,
        };
        let json = serde_json::to_string(&public).unwrap();
        assert!(!json.contains("test-access") && !json.contains("test-refresh"));
        fs::remove_dir_all(dir).unwrap();
    }
}
