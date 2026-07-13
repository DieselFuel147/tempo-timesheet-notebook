use std::sync::Mutex;

use keyring::Entry;
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::state::SecretUpdates;

const SERVICE_NAME: &str = "tempo-timesheet-tool";
const SECRET_BUNDLE_KEY: &str = "integration-secrets";
const JIRA_API_TOKEN_KEY: &str = "jira-api-token";
const TEMPO_API_TOKEN_KEY: &str = "tempo-api-token";

#[derive(Default)]
struct SecretCache {
    loaded: bool,
    secrets: StoredSecrets,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
struct StoredSecrets {
    #[serde(default)]
    jira_api_token: String,
    #[serde(default)]
    tempo_api_token: String,
}

pub struct SecretStore {
    cache: Mutex<SecretCache>,
}

pub struct SecretPresence {
    pub jira_api_token_saved: bool,
    pub tempo_api_token_saved: bool,
}

impl SecretStore {
    pub fn new() -> Self {
        Self {
            cache: Mutex::new(SecretCache::default()),
        }
    }

    pub fn get_presence(&self) -> Result<SecretPresence, AppError> {
        let secrets = self.get_stored_secrets()?;
        Ok(SecretPresence {
            jira_api_token_saved: !secrets.jira_api_token.is_empty(),
            tempo_api_token_saved: !secrets.tempo_api_token.is_empty(),
        })
    }

    pub fn get_jira_api_token(&self) -> Result<String, AppError> {
        self.get_secret(JIRA_API_TOKEN_KEY)
    }

    pub fn get_tempo_api_token(&self) -> Result<String, AppError> {
        self.get_secret(TEMPO_API_TOKEN_KEY)
    }

    pub fn apply_updates(&self, updates: &SecretUpdates) -> Result<(), AppError> {
        let mut secrets = self.get_stored_secrets()?;
        if let Some(token) = updates.jira_api_token.as_ref() {
            secrets.jira_api_token = token.clone();
        }
        if let Some(token) = updates.tempo_api_token.as_ref() {
            secrets.tempo_api_token = token.clone();
        }
        self.save_stored_secrets(&secrets)
    }

    fn get_secret(&self, key: &str) -> Result<String, AppError> {
        Ok(self.get_stored_secrets()?.secret(key).unwrap_or_default())
    }

    fn get_stored_secrets(&self) -> Result<StoredSecrets, AppError> {
        {
            let cache = self
                .cache
                .lock()
                .map_err(|_| AppError::internal("Failed to lock secret cache"))?;
            if cache.loaded {
                return Ok(cache.secrets.clone());
            }
        }

        let secrets = self.load_stored_secrets()?;
        self.write_cache(secrets.clone())?;
        Ok(secrets)
    }

    fn load_stored_secrets(&self) -> Result<StoredSecrets, AppError> {
        match self.entry(SECRET_BUNDLE_KEY).get_password() {
            Ok(raw) => parse_stored_secrets(&raw),
            Err(error) if is_missing_secret_error(&error) => self.migrate_legacy_secrets(),
            Err(error) => Err(map_keyring_error(SECRET_BUNDLE_KEY, "read", error)),
        }
    }

    fn migrate_legacy_secrets(&self) -> Result<StoredSecrets, AppError> {
        let secrets = StoredSecrets {
            jira_api_token: self.read_legacy_secret(JIRA_API_TOKEN_KEY)?,
            tempo_api_token: self.read_legacy_secret(TEMPO_API_TOKEN_KEY)?,
        };

        if secrets.is_empty() {
            return Ok(secrets);
        }

        self.save_stored_secrets(&secrets)?;
        Ok(secrets)
    }

    fn read_legacy_secret(&self, key: &str) -> Result<String, AppError> {
        match self.entry(key).get_password() {
            Ok(secret) => Ok(secret),
            Err(error) if is_missing_secret_error(&error) => Ok(String::new()),
            Err(error) => Err(map_keyring_error(key, "read", error)),
        }
    }

    fn save_stored_secrets(&self, secrets: &StoredSecrets) -> Result<(), AppError> {
        if secrets.is_empty() {
            match self.entry(SECRET_BUNDLE_KEY).delete_credential() {
                Ok(()) => {}
                Err(error) if is_missing_secret_error(&error) => {}
                Err(error) => return Err(map_keyring_error(SECRET_BUNDLE_KEY, "delete", error)),
            }
        } else {
            let raw = serde_json::to_string(secrets).map_err(|error| {
                AppError::internal("Failed to encode credentials for the OS keychain")
                    .with_detail(format!("credential={SECRET_BUNDLE_KEY}"))
                    .with_detail(error.to_string())
            })?;

            self.entry(SECRET_BUNDLE_KEY)
                .set_password(&raw)
                .map_err(|error| map_keyring_error(SECRET_BUNDLE_KEY, "save", error))?;
        }

        self.write_cache(secrets.clone())
    }

    fn write_cache(&self, secrets: StoredSecrets) -> Result<(), AppError> {
        let mut cache = self
            .cache
            .lock()
            .map_err(|_| AppError::internal("Failed to lock secret cache"))?;

        cache.loaded = true;
        cache.secrets = secrets;
        Ok(())
    }

    fn entry(&self, key: &str) -> Entry {
        Entry::new(SERVICE_NAME, key).expect("keyring entry creation should not fail for static identifiers")
    }
}

impl StoredSecrets {
    fn is_empty(&self) -> bool {
        self.jira_api_token.is_empty() && self.tempo_api_token.is_empty()
    }

    fn secret(&self, key: &str) -> Option<String> {
        match key {
            JIRA_API_TOKEN_KEY => Some(self.jira_api_token.clone()),
            TEMPO_API_TOKEN_KEY => Some(self.tempo_api_token.clone()),
            _ => None,
        }
    }
}

fn is_missing_secret_error(error: &keyring::Error) -> bool {
    matches!(error, keyring::Error::NoEntry)
}

fn parse_stored_secrets(raw: &str) -> Result<StoredSecrets, AppError> {
    if raw.trim().is_empty() {
        return Ok(StoredSecrets::default());
    }

    serde_json::from_str(raw).map_err(|error| {
        AppError::internal("Failed to parse credentials from the OS keychain")
            .with_detail(format!("credential={SECRET_BUNDLE_KEY}"))
            .with_detail(error.to_string())
    })
}

fn map_keyring_error(key: &str, action: &str, error: keyring::Error) -> AppError {
    AppError::internal(format!("Failed to {action} credential in the OS keychain"))
        .with_detail(format!("credential={key}"))
        .with_detail(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{parse_stored_secrets, SecretStore, StoredSecrets};

    #[test]
    fn secret_store_creation_does_not_touch_system_keychain() {
        let store = SecretStore::new();
        let _ = store;
    }

    #[test]
    fn parses_secret_bundle_payload() {
        let parsed = parse_stored_secrets(r#"{"jira_api_token":"jira","tempo_api_token":"tempo"}"#)
            .expect("bundle payload should parse");

        assert_eq!(
            parsed,
            StoredSecrets {
                jira_api_token: "jira".into(),
                tempo_api_token: "tempo".into(),
            }
        );
    }
}
