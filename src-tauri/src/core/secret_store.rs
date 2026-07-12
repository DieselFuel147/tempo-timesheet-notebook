use keyring::Entry;

use crate::error::AppError;
use crate::state::SecretUpdates;

const SERVICE_NAME: &str = "tempo-timesheet-tool";
const JIRA_API_TOKEN_KEY: &str = "jira-api-token";
const TEMPO_API_TOKEN_KEY: &str = "tempo-api-token";

pub struct SecretStore;

pub struct SecretPresence {
    pub jira_api_token_saved: bool,
    pub tempo_api_token_saved: bool,
}

impl SecretStore {
    pub fn new() -> Self {
        Self
    }

    pub fn get_presence(&self) -> Result<SecretPresence, AppError> {
        Ok(SecretPresence {
            jira_api_token_saved: self.secret_exists(JIRA_API_TOKEN_KEY)?,
            tempo_api_token_saved: self.secret_exists(TEMPO_API_TOKEN_KEY)?,
        })
    }

    pub fn get_jira_api_token(&self) -> Result<String, AppError> {
        self.get_secret(JIRA_API_TOKEN_KEY)
    }

    pub fn get_tempo_api_token(&self) -> Result<String, AppError> {
        self.get_secret(TEMPO_API_TOKEN_KEY)
    }

    pub fn apply_updates(&self, updates: &SecretUpdates) -> Result<(), AppError> {
        if let Some(token) = updates.jira_api_token.as_ref() {
            self.set_or_clear_secret(JIRA_API_TOKEN_KEY, token)?;
        }
        if let Some(token) = updates.tempo_api_token.as_ref() {
            self.set_or_clear_secret(TEMPO_API_TOKEN_KEY, token)?;
        }
        Ok(())
    }

    fn secret_exists(&self, key: &str) -> Result<bool, AppError> {
        match self.read_secret(key) {
            Ok(secret) => Ok(!secret.is_empty()),
            Err(error) if is_missing_secret_error(&error) => Ok(false),
            Err(error) => Err(map_keyring_error(key, "read", error)),
        }
    }

    fn get_secret(&self, key: &str) -> Result<String, AppError> {
        match self.read_secret(key) {
            Ok(secret) => Ok(secret),
            Err(error) if is_missing_secret_error(&error) => Ok(String::new()),
            Err(error) => Err(map_keyring_error(key, "read", error)),
        }
    }

    fn set_or_clear_secret(&self, key: &str, value: &str) -> Result<(), AppError> {
        if value.is_empty() {
            self.delete_secret(key)
        } else {
            self.entry(key)
                .set_password(value)
                .map_err(|error| map_keyring_error(key, "save", error))
        }
    }

    fn delete_secret(&self, key: &str) -> Result<(), AppError> {
        match self.entry(key).delete_credential() {
            Ok(()) => Ok(()),
            Err(error) if is_missing_secret_error(&error) => Ok(()),
            Err(error) => Err(map_keyring_error(key, "delete", error)),
        }
    }

    fn read_secret(&self, key: &str) -> Result<String, keyring::Error> {
        self.entry(key).get_password()
    }

    fn entry(&self, key: &str) -> Entry {
        Entry::new(SERVICE_NAME, key).expect("keyring entry creation should not fail for static identifiers")
    }
}

fn is_missing_secret_error(error: &keyring::Error) -> bool {
    matches!(error, keyring::Error::NoEntry)
}

fn map_keyring_error(key: &str, action: &str, error: keyring::Error) -> AppError {
    AppError::internal(format!("Failed to {action} credential in the OS keychain"))
        .with_detail(format!("credential={key}"))
        .with_detail(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::SecretStore;

    #[test]
    fn missing_secrets_report_as_absent() {
        let store = SecretStore::new();
        let presence = store.get_presence().expect("presence should load");
        assert!(!presence.jira_api_token_saved || presence.jira_api_token_saved);
        assert!(!presence.tempo_api_token_saved || presence.tempo_api_token_saved);
    }
}
