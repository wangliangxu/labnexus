//! LabNexus — OS credential storage.
//!
//! Secrets are stored in the platform credential store via the `keyring` crate:
//! macOS Keychain, Windows Credential Manager, or the Linux Secret Service.
//! Secrets are passed through native APIs and never appear in process arguments.

use keyring::{Entry, Error as KeyringError};

fn entry(service: &str, account: &str) -> Result<Entry, String> {
    Entry::new(service, account)
        .map_err(|error| format!("Could not open credential store entry: {}", error))
}

/// Load a secret. Returns `Ok(None)` when no entry exists.
pub fn load_secret(service: &str, account: &str) -> Result<Option<String>, String> {
    match entry(service, account)?.get_password() {
        Ok(secret) if secret.is_empty() => Ok(None),
        Ok(secret) => Ok(Some(secret)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("Could not read credential store: {}", error)),
    }
}

/// Save a secret. An empty secret deletes the entry.
pub fn save_secret(service: &str, account: &str, secret: &str) -> Result<(), String> {
    if secret.is_empty() {
        return delete_secret(service, account);
    }
    entry(service, account)?
        .set_password(secret)
        .map_err(|error| format!("Could not write credential store: {}", error))
}

/// Delete a secret. Missing entries are not an error.
pub fn delete_secret(service: &str, account: &str) -> Result<(), String> {
    match entry(service, account)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!("Could not delete credential: {}", error)),
    }
}
