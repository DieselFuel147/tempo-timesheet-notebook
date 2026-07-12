use crate::error::AppError;
use crate::state::Settings;

#[derive(Clone, Debug)]
pub struct JiraConfig {
    pub base_url: String,
    pub email: String,
    pub api_token: String,
}

#[derive(Clone, Debug)]
pub struct TempoConfig {
    pub base_url: String,
    pub api_token: String,
}

#[derive(Clone, Debug)]
pub struct IntegrationConfig {
    pub jira: JiraConfig,
    pub tempo: TempoConfig,
}

#[derive(Clone, Debug, Default)]
pub struct IntegrationSecrets {
    pub jira_api_token: String,
    pub tempo_api_token: String,
}

impl IntegrationConfig {
    pub fn from_settings(settings: &Settings, secrets: IntegrationSecrets) -> Self {
        Self {
            jira: JiraConfig {
                base_url: trim_trailing_slashes(settings.connections.jira.base_url.clone()),
                email: settings.connections.jira.email.trim().to_string(),
                api_token: secrets.jira_api_token,
            },
            tempo: TempoConfig {
                base_url: trim_trailing_slashes(settings.connections.tempo.base_url.clone()),
                api_token: secrets.tempo_api_token,
            },
        }
    }

    pub fn require_jira(&self) -> Result<&JiraConfig, AppError> {
        let mut missing = Vec::new();
        if self.jira.base_url.is_empty() {
            missing.push("settings.connections.jira.baseUrl");
        }
        if self.jira.email.is_empty() {
            missing.push("settings.connections.jira.email");
        }
        if self.jira.api_token.is_empty() {
            missing.push("OS keychain: jiraApiToken");
        }
        if missing.is_empty() {
            Ok(&self.jira)
        } else {
            Err(AppError::not_configured(
                "Jira integration is not configured yet",
                missing.into_iter().map(|name| format!("Missing setting: {name}")).collect(),
            ))
        }
    }

    pub fn require_tempo(&self) -> Result<&TempoConfig, AppError> {
        let mut missing = Vec::new();
        if self.tempo.base_url.is_empty() {
            missing.push("settings.connections.tempo.baseUrl");
        }
        if self.tempo.api_token.is_empty() {
            missing.push("OS keychain: tempoApiToken");
        }
        if missing.is_empty() {
            Ok(&self.tempo)
        } else {
            Err(AppError::not_configured(
                "Tempo integration is not configured yet",
                missing.into_iter().map(|name| format!("Missing setting: {name}")).collect(),
            ))
        }
    }
}

fn trim_trailing_slashes(value: String) -> String {
    value.trim_end_matches('/').to_string()
}

#[cfg(test)]
mod tests {
    use super::{IntegrationConfig, IntegrationSecrets};
    use crate::state::Settings;

    #[test]
    fn tempo_base_url_defaults_for_settings() {
        let config = IntegrationConfig::from_settings(&Settings::default(), IntegrationSecrets::default());
        assert!(!config.tempo.base_url.is_empty());
    }
}
