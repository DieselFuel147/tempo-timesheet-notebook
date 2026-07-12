use serde_json::Value;

use crate::core::validation::{default_ticket_pattern, ValidationConfig};
use crate::state::Settings;

pub fn default_settings() -> Settings {
    Settings::default()
}

pub fn merge_settings_value(raw: &Value) -> Settings {
    let defaults = default_settings();
    let Some(raw) = raw.as_object() else {
        return defaults;
    };
    let Some(validation) = raw.get("validation").and_then(Value::as_object) else {
        return defaults;
    };

    let mut merged = defaults.validation.clone();

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

    Settings { validation: merged }
}

pub fn to_validation_config(settings: &Settings) -> ValidationConfig {
    ValidationConfig {
        admin_ticket: settings.validation.admin_ticket.clone(),
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

    Ok(())
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
            "other": {}
        }));

        assert_eq!(merged.validation.max_day_hours, 10.0);
        assert_eq!(merged.validation.min_day_hours, default_settings().validation.min_day_hours);
        assert_eq!(merged.validation.admin_ticket, default_settings().validation.admin_ticket);
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
        };
        assert_eq!(
            validate_settings(&invalid).unwrap_err(),
            "Admin ticket must be a valid key, e.g. ABC-123."
        );
    }
}
