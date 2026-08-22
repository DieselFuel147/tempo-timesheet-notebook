use std::sync::OnceLock;

use regex::Regex;

use crate::state::NotebookBlock;

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
    pub ticket_pattern: Regex,
    pub workday_start_min: i32,
    pub workday_end_min: i32,
    pub min_entry_minutes: i32,
    pub max_entry_hours: f64,
    pub min_day_hours: f64,
    pub max_day_hours: f64,
}

pub fn default_ticket_pattern() -> Regex {
    static TICKET_PATTERN: OnceLock<Regex> = OnceLock::new();
    TICKET_PATTERN
        .get_or_init(|| Regex::new(r"^[A-Z][A-Z0-9]*-\d+$").expect("ticket pattern must be valid"))
        .clone()
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
    issues
}

fn fmt_min(minutes: i32) -> String {
    let hours = minutes.div_euclid(60);
    let mins = minutes.rem_euclid(60);
    format!("{:02}:{:02}", hours, mins)
}

#[cfg(test)]
mod tests {
    use super::{default_ticket_pattern, validate_notebook_day, validate_notebook_block, IssueLevel, ValidationConfig, ValidationIssue};
    use crate::state::NotebookBlock;

    fn default_validation_config() -> ValidationConfig {
        ValidationConfig {
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

    fn block(overrides: impl FnOnce(&mut NotebookBlock)) -> NotebookBlock {
        let mut block = NotebookBlock {
            id: "b1".into(),
            date: "2025-05-09".into(),
            start_minute: Some(9 * 60),
            end_minute: Some(9 * 60 + 45),
            text: "Worked on notebook UI".into(),
            closed: true,
            ticket_id: "REACT-1540".into(),
            summary_override: None,
            manual_end: None,
            tempo_worklog_id: None,
            synced_at: None,
        };
        overrides(&mut block);
        block
    }

    #[test]
    fn accepts_admin_style_ticket() {
        let config = default_validation_config();
        assert_eq!(
            validate_notebook_block(
                &block(|block| block.ticket_id = "ADMINTICKET-123".into()),
                &config,
            ),
            Vec::new()
        );
    }

    #[test]
    fn flags_invalid_ticket_as_error() {
        let issues = validate_notebook_block(
            &block(|block| block.ticket_id = "Team standup".into()),
            &default_validation_config(),
        );
        assert!(issues
            .iter()
            .any(|issue| issue.code == "INVALID_TICKET" && issue.level == IssueLevel::Error));
    }

    #[test]
    fn errors_when_closed_block_is_missing_timing() {
        let issues = validate_notebook_block(
            &block(|block| block.start_minute = None),
            &default_validation_config(),
        );
        assert!(issues.iter().any(|issue| issue.code == "INCOMPLETE_BLOCK"));
    }

    #[test]
    fn detects_overlapping_blocks_as_error() {
        let issues = validate_notebook_day(
            &[
                block(|block| {
                    block.id = "a".into();
                    block.start_minute = Some(9 * 60);
                    block.end_minute = Some(10 * 60 + 30);
                }),
                block(|block| {
                    block.id = "b".into();
                    block.start_minute = Some(10 * 60);
                    block.end_minute = Some(11 * 60);
                }),
            ],
            &default_validation_config(),
        );
        assert!(issues
            .iter()
            .any(|issue| issue.code == "OVERLAP" && issue.level == IssueLevel::Error));
    }

    #[test]
    fn allows_back_to_back_blocks_no_overlap() {
        let issues = validate_notebook_day(
            &[
                block(|block| {
                    block.id = "a".into();
                    block.start_minute = Some(9 * 60);
                    block.end_minute = Some(10 * 60);
                }),
                block(|block| {
                    block.id = "b".into();
                    block.start_minute = Some(10 * 60);
                    block.end_minute = Some(11 * 60);
                }),
            ],
            &default_validation_config(),
        );
        assert!(!issues.iter().any(|issue| issue.code == "OVERLAP"));
    }
}
