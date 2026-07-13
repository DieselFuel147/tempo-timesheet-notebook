use std::sync::OnceLock;

use regex::Regex;

use crate::core::notebook::notebook_block_summary;
use crate::state::{Entry, NotebookBlock};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IssueLevel {
    Error,
    Warning,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationIssue {
    pub level: IssueLevel,
    pub code: String,
    pub message: String,
    pub entry_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ValidationConfig {
    pub admin_ticket: String,
    pub ticket_pattern: Regex,
    pub workday_start_min: i32,
    pub workday_end_min: i32,
    pub min_entry_minutes: i32,
    pub max_entry_hours: f64,
    pub min_day_hours: f64,
    pub max_day_hours: f64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationSummary {
    pub errors: Vec<ValidationIssue>,
    pub warnings: Vec<ValidationIssue>,
    pub has_errors: bool,
}

pub fn default_ticket_pattern() -> Regex {
    static TICKET_PATTERN: OnceLock<Regex> = OnceLock::new();
    TICKET_PATTERN
        .get_or_init(|| Regex::new(r"^[A-Z][A-Z0-9]*-\d+$").expect("ticket pattern must be valid"))
        .clone()
}

pub fn parse_time(hhmm: &str) -> Option<i32> {
    static TIME_PATTERN: OnceLock<Regex> = OnceLock::new();
    let pattern = TIME_PATTERN
        .get_or_init(|| Regex::new(r"^([01]?\d|2[0-3]):([0-5]\d)$").expect("time pattern must be valid"));
    let trimmed = hhmm.trim();
    let captures = pattern.captures(trimmed)?;
    let hours = captures.get(1)?.as_str().parse::<i32>().ok()?;
    let minutes = captures.get(2)?.as_str().parse::<i32>().ok()?;
    Some(hours * 60 + minutes)
}

pub fn entry_duration_minutes(entry: &Entry) -> Option<i32> {
    let start = parse_time(&entry.start)?;
    let end = parse_time(&entry.end)?;
    Some(end - start)
}

pub fn validate_entry(entry: &Entry, config: &ValidationConfig) -> Vec<ValidationIssue> {
    let mut issues = Vec::new();
    let mut add = |level: IssueLevel, code: &str, message: String| {
        issues.push(ValidationIssue {
            level,
            code: code.to_string(),
            message,
            entry_id: Some(entry.id.clone()),
        });
    };

    let key = entry.ticket_key.trim();
    if key.is_empty() {
        add(
            IssueLevel::Error,
            "INVALID_TICKET",
            "Ticket is required (e.g. ABC-123).".into(),
        );
    } else if !config.ticket_pattern.is_match(key) {
        add(
            IssueLevel::Error,
            "INVALID_TICKET",
            format!(
                "\"{}\" is not a valid ticket key (expected e.g. ABC-123).",
                entry.ticket_key
            ),
        );
    }

    let start = parse_time(&entry.start);
    let end = parse_time(&entry.end);
    if start.is_none() {
        add(
            IssueLevel::Error,
            "INVALID_START",
            format!("Start time \"{}\" is not valid (use HH:mm).", entry.start),
        );
    }
    if end.is_none() {
        add(
            IssueLevel::Error,
            "INVALID_END",
            format!("End time \"{}\" is not valid (use HH:mm).", entry.end),
        );
    }

    if let (Some(start), Some(end)) = (start, end) {
        let duration = end - start;
        if duration <= 0 {
            add(
                IssueLevel::Error,
                "BAD_RANGE",
                format!("End ({}) must be after start ({}).", entry.end, entry.start),
            );
        } else {
            if duration < config.min_entry_minutes {
                add(
                    IssueLevel::Warning,
                    "TOO_SHORT",
                    format!(
                        "Only {} min - shorter than {} min.",
                        duration, config.min_entry_minutes
                    ),
                );
            }
            if f64::from(duration) > config.max_entry_hours * 60.0 {
                add(
                    IssueLevel::Warning,
                    "TOO_LONG",
                    format!(
                        "{:.2}h in one block - over {}h.",
                        f64::from(duration) / 60.0,
                        config.max_entry_hours
                    ),
                );
            }
        }

        if start < config.workday_start_min {
            add(
                IssueLevel::Warning,
                "EARLY",
                format!(
                    "Starts {}, before normal hours ({}).",
                    entry.start,
                    fmt_min(config.workday_start_min)
                ),
            );
        }
        if end > config.workday_end_min {
            add(
                IssueLevel::Warning,
                "LATE",
                format!(
                    "Ends {}, after normal hours ({}).",
                    entry.end,
                    fmt_min(config.workday_end_min)
                ),
            );
        }
    }

    if entry.summary.trim().is_empty() {
        add(
            IssueLevel::Warning,
            "NO_SUMMARY",
            "No summary - add a short note of what you did.".into(),
        );
    }

    issues
}

pub fn validate_day(entries: &[Entry], config: &ValidationConfig) -> Vec<ValidationIssue> {
    let mut issues = Vec::new();
    for entry in entries {
        issues.extend(validate_entry(entry, config));
    }

    let mut timed = entries
        .iter()
        .filter_map(|entry| {
            let start = parse_time(&entry.start)?;
            let end = parse_time(&entry.end)?;
            if end > start {
                Some((entry, start, end))
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    timed.sort_by_key(|(_, start, _)| *start);

    for pair in timed.windows(2) {
        let (left_entry, _, left_end) = pair[0];
        let (right_entry, right_start, _) = pair[1];
        if left_end > right_start {
            issues.push(ValidationIssue {
                level: IssueLevel::Error,
                code: "OVERLAP".into(),
                message: format!(
                    "Overlaps: {}-{} and {}-{}.",
                    left_entry.start, left_entry.end, right_entry.start, right_entry.end
                ),
                entry_id: Some(right_entry.id.clone()),
            });
        }
    }

    let total_hours = timed
        .iter()
        .map(|(_, start, end)| f64::from(end - start))
        .sum::<f64>()
        / 60.0;
    if !entries.is_empty() && total_hours < config.min_day_hours {
        issues.push(ValidationIssue {
            level: IssueLevel::Warning,
            code: "DAY_LOW".into(),
            message: format!(
                "Only {:.2}h logged (under {}h).",
                total_hours, config.min_day_hours
            ),
            entry_id: None,
        });
    }
    if total_hours > config.max_day_hours {
        issues.push(ValidationIssue {
            level: IssueLevel::Warning,
            code: "DAY_HIGH".into(),
            message: format!("{:.2}h logged (over {}h).", total_hours, config.max_day_hours),
            entry_id: None,
        });
    }

    issues
}

pub fn validate_notebook_day(blocks: &[NotebookBlock], config: &ValidationConfig) -> Vec<ValidationIssue> {
    let mut issues = Vec::new();
    for block in blocks {
        issues.extend(validate_notebook_block(block, config));
    }

    let mut timed = blocks
        .iter()
        .filter_map(|block| {
            let start = block.start_minute?;
            let end = block.end_minute?;
            if end > start {
                Some((block, start, end))
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    timed.sort_by_key(|(_, start, _)| *start);

    for pair in timed.windows(2) {
        let (left_block, _, left_end) = pair[0];
        let (right_block, right_start, _) = pair[1];
        if left_end > right_start {
            issues.push(ValidationIssue {
                level: IssueLevel::Error,
                code: String::from("OVERLAP"),
                message: format!(
                    "Overlaps: {}-{} and {}-{}.",
                    left_block.start_minute.unwrap_or_default(),
                    left_block.end_minute.unwrap_or_default(),
                    right_block.start_minute.unwrap_or_default(),
                    right_block.end_minute.unwrap_or_default()
                ),
                entry_id: Some(right_block.id.clone()),
            });
        }
    }

    let total_hours = timed
        .iter()
        .map(|(_, start, end)| f64::from(end - start))
        .sum::<f64>()
        / 60.0;
    if !timed.is_empty() && total_hours < config.min_day_hours {
        issues.push(ValidationIssue {
            level: IssueLevel::Warning,
            code: String::from("DAY_LOW"),
            message: format!(
                "Only {:.2}h logged (under {}h).",
                total_hours, config.min_day_hours
            ),
            entry_id: None,
        });
    }
    if total_hours > config.max_day_hours {
        issues.push(ValidationIssue {
            level: IssueLevel::Warning,
            code: String::from("DAY_HIGH"),
            message: format!("{:.2}h logged (over {}h).", total_hours, config.max_day_hours),
            entry_id: None,
        });
    }

    issues
}

pub fn validate_notebook_block(block: &NotebookBlock, config: &ValidationConfig) -> Vec<ValidationIssue> {
    let mut issues = Vec::new();
    let mut add = |level: IssueLevel, code: &str, message: String| {
        issues.push(ValidationIssue {
            level,
            code: code.to_string(),
            message,
            entry_id: Some(block.id.clone()),
        });
    };

    let key = block.ticket_id.trim();
    if key.is_empty() {
        add(
            IssueLevel::Error,
            "INVALID_TICKET",
            "Ticket is required (e.g. ABC-123).".into(),
        );
    } else if !config.ticket_pattern.is_match(key) {
        add(
            IssueLevel::Error,
            "INVALID_TICKET",
            format!(
                "\"{}\" is not a valid ticket key (expected e.g. ABC-123).",
                block.ticket_id
            ),
        );
    }

    if block.start_minute.is_none() && block.end_minute.is_some() {
        add(
            IssueLevel::Error,
            "INVALID_START",
            "Block end time cannot exist without a start time.".into(),
        );
    }

    if let Some(start) = block.start_minute {
        if !(0..=1439).contains(&start) {
            add(
                IssueLevel::Error,
                "INVALID_START",
                format!("Start minute {} is out of range.", start),
            );
        }
        if start < config.workday_start_min {
            add(
                IssueLevel::Warning,
                "EARLY",
                format!("Starts before normal hours ({}).", fmt_min(config.workday_start_min)),
            );
        }
    }

    if let Some(end) = block.end_minute {
        if !(0..=1440).contains(&end) {
            add(
                IssueLevel::Error,
                "INVALID_END",
                format!("End minute {} is out of range.", end),
            );
        }
        if end > config.workday_end_min {
            add(
                IssueLevel::Warning,
                "LATE",
                format!("Ends after normal hours ({}).", fmt_min(config.workday_end_min)),
            );
        }
    }

    let duration = block.end_minute.zip(block.start_minute).map(|(end, start)| end - start);
    if block.closed {
        if block.start_minute.is_none() || block.end_minute.is_none() {
            add(
                IssueLevel::Error,
                "INCOMPLETE_BLOCK",
                "Closed blocks must have both start and end times.".into(),
            );
        } else if let Some(duration) = duration {
            if duration <= 0 {
                add(
                    IssueLevel::Error,
                    "BAD_RANGE",
                    format!(
                        "End ({}) must be after start ({}).",
                        block.end_minute.unwrap_or_default(),
                        block.start_minute.unwrap_or_default()
                    ),
                );
            } else {
                if duration < config.min_entry_minutes {
                    add(
                        IssueLevel::Warning,
                        "TOO_SHORT",
                        format!("Only {} min - shorter than {} min.", duration, config.min_entry_minutes),
                    );
                }
                if f64::from(duration) > config.max_entry_hours * 60.0 {
                    add(
                        IssueLevel::Warning,
                        "TOO_LONG",
                        format!(
                            "{:.2}h in one block - over {}h.",
                            f64::from(duration) / 60.0,
                            config.max_entry_hours
                        ),
                    );
                }
            }
        }
    } else if block.end_minute.is_some() {
        add(
            IssueLevel::Error,
            "OPEN_BLOCK_HAS_END",
            "Open blocks cannot have an end time.".into(),
        );
    }

    if block.text.trim().is_empty() {
        add(
            IssueLevel::Warning,
            "NO_TEXT",
            "No note text - add detail for what you did.".into(),
        );
    }
    if notebook_block_summary(block).trim().is_empty() {
        add(
            IssueLevel::Warning,
            "NO_SUMMARY",
            "No summary - add a short note of what you did.".into(),
        );
    }

    issues
}

pub fn summarize_issues(issues: &[ValidationIssue]) -> ValidationSummary {
    let errors = issues
        .iter()
        .filter(|issue| issue.level == IssueLevel::Error)
        .cloned()
        .collect::<Vec<_>>();
    let warnings = issues
        .iter()
        .filter(|issue| issue.level == IssueLevel::Warning)
        .cloned()
        .collect::<Vec<_>>();

    ValidationSummary {
        has_errors: !errors.is_empty(),
        errors,
        warnings,
    }
}

fn fmt_min(minutes: i32) -> String {
    let hours = minutes.div_euclid(60);
    let mins = minutes.rem_euclid(60);
    format!("{:02}:{:02}", hours, mins)
}

#[cfg(test)]
mod tests {
    use super::{
        default_ticket_pattern, entry_duration_minutes, parse_time, summarize_issues, validate_day,
        validate_entry, IssueLevel, ValidationConfig, ValidationIssue,
    };
    use crate::state::Entry;

    fn entry(overrides: impl FnOnce(&mut Entry)) -> Entry {
        let mut entry = Entry {
            id: "e1".into(),
            date: "2025-05-09".into(),
            start: "09:00".into(),
            end: "09:45".into(),
            ticket_key: "REACT-1540".into(),
            summary: "Work".into(),
            tempo_worklog_id: None,
            synced_at: None,
        };
        overrides(&mut entry);
        entry
    }

    fn default_validation_config() -> ValidationConfig {
        ValidationConfig {
            admin_ticket: "ADMIN-TICKET".into(),
            ticket_pattern: default_ticket_pattern(),
            workday_start_min: 8 * 60,
            workday_end_min: 18 * 60,
            min_entry_minutes: 10,
            max_entry_hours: 4.0,
            min_day_hours: 4.0,
            max_day_hours: 12.0,
        }
    }

    fn codes(issues: &[ValidationIssue]) -> Vec<String> {
        let mut values = issues.iter().map(|issue| issue.code.clone()).collect::<Vec<_>>();
        values.sort();
        values
    }

    #[test]
    fn parses_valid_times() {
        assert_eq!(parse_time("09:00"), Some(540));
        assert_eq!(parse_time("9:00"), Some(540));
        assert_eq!(parse_time("18:30"), Some(1110));
        assert_eq!(parse_time("00:00"), Some(0));
        assert_eq!(parse_time("23:59"), Some(1439));
    }

    #[test]
    fn rejects_malformed_times() {
        assert_eq!(parse_time("24:00"), None);
        assert_eq!(parse_time("9"), None);
        assert_eq!(parse_time("9:60"), None);
        assert_eq!(parse_time("nope"), None);
    }

    #[test]
    fn computes_duration() {
        assert_eq!(entry_duration_minutes(&entry(|_| {})), Some(45));
    }

    #[test]
    fn is_null_on_bad_input() {
        assert_eq!(entry_duration_minutes(&entry(|entry| entry.end = "x".into())), None);
    }

    #[test]
    fn passes_clean_entry_with_no_issues() {
        assert_eq!(validate_entry(&entry(|_| {}), &default_validation_config()), Vec::new());
    }

    #[test]
    fn accepts_default_admin_ticket() {
        let config = default_validation_config();
        assert_eq!(
            validate_entry(
                &entry(|entry| entry.ticket_key = config.admin_ticket.clone()),
                &config,
            ),
            Vec::new()
        );
    }

    #[test]
    fn flags_invalid_ticket_as_error() {
        let issues = validate_entry(
            &entry(|entry| entry.ticket_key = "Team standup".into()),
            &default_validation_config(),
        );
        assert!(issues
            .iter()
            .any(|issue| issue.code == "INVALID_TICKET" && issue.level == IssueLevel::Error));
    }

    #[test]
    fn flags_blank_ticket_with_required_message() {
        let issues = validate_entry(
            &entry(|entry| entry.ticket_key = "  ".into()),
            &default_validation_config(),
        );
        let issue = issues.iter().find(|issue| issue.code == "INVALID_TICKET").unwrap();
        assert_eq!(issue.level, IssueLevel::Error);
        assert!(issue.message.to_lowercase().contains("required"));
    }

    #[test]
    fn errors_when_end_is_before_or_equal_to_start() {
        let before = validate_entry(
            &entry(|entry| {
                entry.start = "10:00".into();
                entry.end = "09:00".into();
            }),
            &default_validation_config(),
        );
        assert!(before.iter().any(|issue| issue.code == "BAD_RANGE"));

        let equal = validate_entry(
            &entry(|entry| {
                entry.start = "10:00".into();
                entry.end = "10:00".into();
            }),
            &default_validation_config(),
        );
        assert!(equal.iter().any(|issue| issue.code == "BAD_RANGE"));
    }

    #[test]
    fn errors_on_malformed_times() {
        assert!(validate_entry(&entry(|entry| entry.start = "25:00".into()), &default_validation_config())
            .iter()
            .any(|issue| issue.code == "INVALID_START"));
        assert!(validate_entry(&entry(|entry| entry.end = "noon".into()), &default_validation_config())
            .iter()
            .any(|issue| issue.code == "INVALID_END"));
    }

    #[test]
    fn warns_on_too_short_and_too_long_entries() {
        assert!(validate_entry(
            &entry(|entry| {
                entry.start = "09:00".into();
                entry.end = "09:05".into();
            }),
            &default_validation_config(),
        )
        .iter()
        .any(|issue| issue.code == "TOO_SHORT"));
        assert!(validate_entry(
            &entry(|entry| {
                entry.start = "09:00".into();
                entry.end = "14:00".into();
            }),
            &default_validation_config(),
        )
        .iter()
        .any(|issue| issue.code == "TOO_LONG"));
    }

    #[test]
    fn warns_on_out_of_hours_starts_and_ends() {
        assert!(validate_entry(
            &entry(|entry| {
                entry.start = "06:30".into();
                entry.end = "07:00".into();
            }),
            &default_validation_config(),
        )
        .iter()
        .any(|issue| issue.code == "EARLY"));
        assert!(validate_entry(
            &entry(|entry| {
                entry.start = "18:30".into();
                entry.end = "19:00".into();
            }),
            &default_validation_config(),
        )
        .iter()
        .any(|issue| issue.code == "LATE"));
    }

    #[test]
    fn warns_does_not_block_on_missing_summary() {
        let issues = validate_entry(
            &entry(|entry| entry.summary = "  ".into()),
            &default_validation_config(),
        );
        assert!(issues
            .iter()
            .any(|issue| issue.code == "NO_SUMMARY" && issue.level == IssueLevel::Warning));
        assert!(!summarize_issues(&issues).has_errors);
    }

    #[test]
    fn detects_overlapping_entries_as_error() {
        let issues = validate_day(
            &[
                entry(|entry| {
                    entry.id = "a".into();
                    entry.start = "09:00".into();
                    entry.end = "10:30".into();
                }),
                entry(|entry| {
                    entry.id = "b".into();
                    entry.start = "10:00".into();
                    entry.end = "11:00".into();
                }),
            ],
            &default_validation_config(),
        );
        assert!(issues
            .iter()
            .any(|issue| issue.code == "OVERLAP" && issue.level == IssueLevel::Error));
    }

    #[test]
    fn allows_back_to_back_entries_no_overlap() {
        let issues = validate_day(
            &[
                entry(|entry| {
                    entry.id = "a".into();
                    entry.start = "09:00".into();
                    entry.end = "10:00".into();
                }),
                entry(|entry| {
                    entry.id = "b".into();
                    entry.start = "10:00".into();
                    entry.end = "11:00".into();
                }),
            ],
            &default_validation_config(),
        );
        assert!(!issues.iter().any(|issue| issue.code == "OVERLAP"));
    }

    #[test]
    fn warns_when_daily_total_is_too_low() {
        let issues = validate_day(
            &[entry(|entry| {
                entry.start = "09:00".into();
                entry.end = "10:00".into();
            })],
            &default_validation_config(),
        );
        assert!(issues.iter().any(|issue| issue.code == "DAY_LOW"));
    }

    #[test]
    fn warns_when_daily_total_is_too_high() {
        let issues = validate_day(
            &[entry(|entry| {
                entry.start = "06:00".into();
                entry.end = "20:00".into();
            })],
            &default_validation_config(),
        );
        assert!(codes(&issues).contains(&"DAY_HIGH".to_string()));
    }

    #[test]
    fn aggregates_per_entry_issues_across_the_day() {
        let issues = validate_day(
            &[
                entry(|entry| {
                    entry.id = "a".into();
                    entry.ticket_key = "Lunch".into();
                }),
                entry(|entry| {
                    entry.id = "b".into();
                    entry.start = "10:00".into();
                    entry.end = "09:00".into();
                }),
            ],
            &default_validation_config(),
        );
        assert!(issues
            .iter()
            .filter(|issue| issue.entry_id.as_deref() == Some("a"))
            .any(|issue| issue.code == "INVALID_TICKET"));
        assert!(issues
            .iter()
            .filter(|issue| issue.entry_id.as_deref() == Some("b"))
            .any(|issue| issue.code == "BAD_RANGE"));
    }
}
