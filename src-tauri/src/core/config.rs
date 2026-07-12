use std::env;

use crate::error::AppError;

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

impl IntegrationConfig {
    // Interim parity path: until the Tauri settings and secret-storage work lands,
    // native integrations still bootstrap from env vars instead of UI-managed config.
    pub fn from_env() -> Self {
        Self {
            jira: JiraConfig {
                base_url: trim_trailing_slashes(env::var("JIRA_BASE_URL").unwrap_or_default()),
                email: env::var("JIRA_EMAIL").unwrap_or_default(),
                api_token: env::var("JIRA_API_TOKEN").unwrap_or_default(),
            },
            tempo: TempoConfig {
                base_url: trim_trailing_slashes(
                    env::var("TEMPO_BASE_URL").unwrap_or_else(|_| String::from("https://api.tempo.io/4")),
                ),
                api_token: env::var("TEMPO_API_TOKEN").unwrap_or_default(),
            },
        }
    }

    pub fn require_jira(&self) -> Result<&JiraConfig, AppError> {
        let mut missing = Vec::new();
        if self.jira.base_url.is_empty() {
            missing.push("JIRA_BASE_URL");
        }
        if self.jira.email.is_empty() {
            missing.push("JIRA_EMAIL");
        }
        if self.jira.api_token.is_empty() {
            missing.push("JIRA_API_TOKEN");
        }
        if missing.is_empty() {
            Ok(&self.jira)
        } else {
            Err(AppError::not_configured(
                "Jira integration is not configured yet",
                missing
                    .into_iter()
                    .map(|name| format!("Missing env var: {name}"))
                    .collect(),
            ))
        }
    }

    pub fn require_tempo(&self) -> Result<&TempoConfig, AppError> {
        let mut missing = Vec::new();
        if self.tempo.base_url.is_empty() {
            missing.push("TEMPO_BASE_URL");
        }
        if self.tempo.api_token.is_empty() {
            missing.push("TEMPO_API_TOKEN");
        }
        if missing.is_empty() {
            Ok(&self.tempo)
        } else {
            Err(AppError::not_configured(
                "Tempo integration is not configured yet",
                missing
                    .into_iter()
                    .map(|name| format!("Missing env var: {name}"))
                    .collect(),
            ))
        }
    }
}

fn trim_trailing_slashes(value: String) -> String {
    value.trim_end_matches('/').to_string()
}

#[cfg(test)]
mod tests {
    use super::IntegrationConfig;

    #[test]
    fn tempo_base_url_defaults_for_parity() {
        let config = IntegrationConfig::from_env();
        assert!(!config.tempo.base_url.is_empty());
    }
}
