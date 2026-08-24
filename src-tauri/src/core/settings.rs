use serde_json::Value;

use crate::core::validation::{default_ticket_pattern, ValidationConfig};
use crate::state::{Settings, ThresholdSettings};

pub fn default_settings() -> Settings {
    Settings::default()
}

pub fn merge_settings_value(raw: &Value) -> Settings {
    let defaults = default_settings();
    let Some(raw) = raw.as_object() else {
        return defaults;
    };
    let mut merged = defaults.clone();

    if let Some(validation) = raw.get("validation").and_then(Value::as_object) {
        merged.validation = merge_validation(validation, &defaults.validation);
    }

    if let Some(connections) = raw.get("connections").and_then(Value::as_object) {
        if let Some(jira) = connections.get("jira").and_then(Value::as_object) {
            if let Some(value) = jira.get("baseUrl").and_then(Value::as_str) {
                merged.connections.jira.base_url = trim_trailing_slashes(value);
            }
            if let Some(value) = jira.get("email").and_then(Value::as_str) {
                merged.connections.jira.email = value.trim().to_string();
            }
        }

        if let Some(tempo) = connections.get("tempo").and_then(Value::as_object) {
            if let Some(value) = tempo.get("baseUrl").and_then(Value::as_str) {
                merged.connections.tempo.base_url = trim_trailing_slashes(value);
            }
        }
    }

    if let Some(ai) = raw.get("ai").and_then(Value::as_object) {
        if let Some(value) = ai.get("enabled").and_then(Value::as_bool) {
            merged.ai.enabled = value;
        }
        if let Some(value) = ai.get("binaryPath").and_then(Value::as_str) {
            merged.ai.binary_path = value.trim().to_string();
        }
        if let Some(value) = ai.get("modelPath").and_then(Value::as_str) {
            merged.ai.model_path = value.trim().to_string();
        }
        if let Some(value) = ai.get("idleTimeoutSecs").and_then(Value::as_u64) {
            merged.ai.idle_timeout_secs = value;
        }
        if let Some(value) = ai.get("systemPrompt").and_then(Value::as_str) {
            merged.ai.system_prompt = value.to_string();
        }
    }

    if let Some(notifications) = raw.get("notifications").and_then(Value::as_object) {
        if let Some(value) = notifications.get("inactivityEnabled").and_then(Value::as_bool) {
            merged.notifications.inactivity_enabled = value;
        }
        if let Some(value) = notifications
            .get("inactivityThresholdMinutes")
            .and_then(Value::as_i64)
        {
            merged.notifications.inactivity_threshold_minutes = value as i32;
        }
    }

    merged
}

pub fn to_validation_config(settings: &Settings) -> ValidationConfig {
    ValidationConfig {
        ticket_pattern: default_ticket_pattern(),
        workday_start_min: settings.validation.workday_start_min,
        workday_end_min: settings.validation.workday_end_min,
        min_entry_minutes: settings.validation.min_entry_minutes,
        max_entry_hours: settings.validation.max_entry_hours,
        min_day_hours: settings.validation.min_day_hours,
        max_day_hours: settings.validation.max_day_hours,
    }
}

pub fn validate_settings(settings: &Settings) -> Result<(), String> {
    let validation = &settings.validation;
    let ticket_pattern = default_ticket_pattern();

    if !ticket_pattern.is_match(validation.admin_ticket.trim()) {
        return Err("Admin ticket must be a valid key, e.g. ABC-123.".into());
    }
    if !(0..=1439).contains(&validation.workday_start_min) {
        return Err("Workday start must be between 0 and 1439 minutes.".into());
    }
    if !(1..=1440).contains(&validation.workday_end_min) {
        return Err("Workday end must be between 1 and 1440 minutes.".into());
    }
    if validation.workday_end_min <= validation.workday_start_min {
        return Err("End of the working day must be after the start.".into());
    }
    if !(0..=24 * 60).contains(&validation.min_entry_minutes) {
        return Err("Minimum entry minutes must be between 0 and 1440.".into());
    }
    if !(validation.max_entry_hours > 0.0 && validation.max_entry_hours <= 24.0) {
        return Err("Max entry hours must be greater than 0 and at most 24.".into());
    }
    if !(0.0..=24.0).contains(&validation.min_day_hours) {
        return Err("Min day hours must be between 0 and 24.".into());
    }
    if !(validation.max_day_hours > 0.0 && validation.max_day_hours <= 24.0) {
        return Err("Max day hours must be greater than 0 and at most 24.".into());
    }
    if validation.max_day_hours < validation.min_day_hours {
        return Err("Max day hours must be at least the min day hours.".into());
    }
    if !(20..=10000).contains(&validation.max_summary_chars) {
        return Err("Max summary length must be between 20 and 10000 characters.".into());
    }
    if !settings.connections.jira.base_url.is_empty() && !is_valid_url(&settings.connections.jira.base_url) {
        return Err("Jira base URL must be a valid absolute URL.".into());
    }
    if settings.connections.jira.email.contains(' ') {
        return Err("Jira email must not contain spaces.".into());
    }
    if !settings.connections.tempo.base_url.is_empty() && !is_valid_url(&settings.connections.tempo.base_url) {
        return Err("Tempo base URL must be a valid absolute URL.".into());
    }

    if !(1..=1440).contains(&settings.notifications.inactivity_threshold_minutes) {
        return Err("Inactivity reminder threshold must be between 1 and 1440 minutes.".into());
    }

    Ok(())
}

fn merge_validation(validation: &serde_json::Map<String, Value>, defaults: &ThresholdSettings) -> ThresholdSettings {
    let mut merged = defaults.clone();

    if let Some(value) = validation.get("adminTicket").and_then(Value::as_str) {
        merged.admin_ticket = value.to_string();
    }
    if let Some(value) = validation.get("workdayStartMin").and_then(Value::as_i64) {
        merged.workday_start_min = value as i32;
    }
    if let Some(value) = validation.get("workdayEndMin").and_then(Value::as_i64) {
        merged.workday_end_min = value as i32;
    }
    if let Some(value) = validation.get("minEntryMinutes").and_then(Value::as_i64) {
        merged.min_entry_minutes = value as i32;
    }
    if let Some(value) = validation.get("maxEntryHours").and_then(Value::as_f64) {
        merged.max_entry_hours = value;
    }
    if let Some(value) = validation.get("minDayHours").and_then(Value::as_f64) {
        merged.min_day_hours = value;
    }
    if let Some(value) = validation.get("maxDayHours").and_then(Value::as_f64) {
        merged.max_day_hours = value;
    }
    if let Some(value) = validation.get("maxSummaryChars").and_then(Value::as_i64) {
        merged.max_summary_chars = value as i32;
    }

    merged
}

fn trim_trailing_slashes(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

fn is_valid_url(value: &str) -> bool {
    reqwest::Url::parse(value).is_ok()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{default_settings, merge_settings_value, validate_settings};
    use crate::state::{Settings, ThresholdSettings};

    #[test]
    fn merge_ignores_unknown_keys_and_keeps_defaults() {
        let merged = merge_settings_value(&json!({
            "validation": {
                "maxDayHours": 10,
                "unknown": true
            },
            "connections": {
                "jira": {
                    "baseUrl": "https://jira.example.com///",
                    "email": " user@example.com ",
                    "apiTokenSaved": true
                },
                "tempo": {
                    "baseUrl": "https://api.tempo.io/4///",
                    "apiTokenSaved": true
                }
            },
            "other": {}
        }));

        assert_eq!(merged.validation.max_day_hours, 10.0);
        assert_eq!(merged.validation.min_day_hours, default_settings().validation.min_day_hours);
        assert_eq!(merged.validation.admin_ticket, default_settings().validation.admin_ticket);
        assert_eq!(merged.connections.jira.base_url, "https://jira.example.com");
        assert_eq!(merged.connections.jira.email, "user@example.com");
        assert!(!merged.connections.jira.api_token_saved);
        assert_eq!(merged.connections.tempo.base_url, "https://api.tempo.io/4");
        assert!(!merged.connections.tempo.api_token_saved);
    }

    #[test]
    fn merge_reads_ai_section_and_defaults_when_absent() {
        let merged = merge_settings_value(&json!({
            "ai": {
                "enabled": true,
                "binaryPath": "  /opt/llama/llama-server  ",
                "modelPath": "/models/gemma-3-1b-it-Q4_K_M.gguf",
                "idleTimeoutSecs": 120
            }
        }));
        assert!(merged.ai.enabled);
        assert_eq!(merged.ai.binary_path, "/opt/llama/llama-server");
        assert_eq!(merged.ai.model_path, "/models/gemma-3-1b-it-Q4_K_M.gguf");
        assert_eq!(merged.ai.idle_timeout_secs, 120);

        // Absent ai section falls back to defaults.
        let defaulted = merge_settings_value(&json!({ "validation": {} }));
        assert_eq!(defaulted.ai, default_settings().ai);
    }

    #[test]
    fn merge_returns_defaults_for_non_objects() {
        assert_eq!(merge_settings_value(&json!(null)), default_settings());
        assert_eq!(merge_settings_value(&json!([])), default_settings());
    }

    #[test]
    fn validation_matches_threshold_rules() {
        let invalid = Settings {
            validation: ThresholdSettings {
                admin_ticket: "bad-ticket".into(),
                ..ThresholdSettings::default()
            },
            ..Settings::default()
        };
        assert_eq!(
            validate_settings(&invalid).unwrap_err(),
            "Admin ticket must be a valid key, e.g. ABC-123."
        );
    }

    #[test]
    fn merge_reads_notifications_section_and_defaults_when_absent() {
        let merged = merge_settings_value(&json!({
            "notifications": {
                "inactivityEnabled": true,
                "inactivityThresholdMinutes": 45
            }
        }));
        assert!(merged.notifications.inactivity_enabled);
        assert_eq!(merged.notifications.inactivity_threshold_minutes, 45);

        // Absent notifications section falls back to defaults.
        let defaulted = merge_settings_value(&json!({ "validation": {} }));
        assert_eq!(defaulted.notifications, default_settings().notifications);
    }

    #[test]
    fn validation_rejects_invalid_connection_urls() {
        let invalid = Settings {
            connections: crate::state::ConnectionSettings {
                jira: crate::state::JiraConnectionSettings {
                    base_url: String::from("not a url"),
                    ..Default::default()
                },
                ..Default::default()
            },
            ..Settings::default()
        };

        assert_eq!(
            validate_settings(&invalid).unwrap_err(),
            "Jira base URL must be a valid absolute URL."
        );
    }
}
