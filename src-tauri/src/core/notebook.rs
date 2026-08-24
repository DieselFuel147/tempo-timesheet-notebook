use crate::state::{NotebookBlock, WorklogInput};

// Pseudo-ticket marking a lunch break. Must stay aligned with `LUNCH_TICKET_ID`
// in shared/notebook.ts: it renders like any other entry so the user can see
// the midday gap is accounted for, but it is purely visual — never validated as
// a Jira key, never pushed to Tempo, never counted in totals.
pub const LUNCH_TICKET_ID: &str = "LUNCH";

pub fn is_lunch_ticket_id(ticket_id: &str) -> bool {
    ticket_id.trim().eq_ignore_ascii_case(LUNCH_TICKET_ID)
}

pub fn is_lunch_block(block: &NotebookBlock) -> bool {
    is_lunch_ticket_id(&block.ticket_id)
}

// Must stay textually aligned with `autoSummary` in shared/notebook.ts:
// trim, then cut to `max_chars` characters with a single '…' counted inside
// the limit.
pub fn auto_summary(text: &str, max_summary_chars: usize) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return String::from("Untitled entry");
    }

    let char_count = trimmed.chars().count();
    if char_count <= max_summary_chars {
        return trimmed.to_string();
    }

    let cut = trimmed.chars().take(max_summary_chars.saturating_sub(1)).collect::<String>();
    format!("{cut}\u{2026}")
}

pub fn notebook_block_summary(block: &NotebookBlock, max_summary_chars: usize) -> String {
    let override_summary = block.summary_override.as_deref().unwrap_or_default().trim();
    if !override_summary.is_empty() {
        override_summary.to_string()
    } else {
        auto_summary(&block.text, max_summary_chars)
    }
}

pub fn notebook_block_duration_minutes(block: &NotebookBlock) -> Option<i32> {
    Some(block.end_minute? - block.start_minute?)
}

pub fn notebook_block_to_worklog_input(
    block: &NotebookBlock,
    issue_id: i64,
    author_account_id: &str,
    max_summary_chars: usize,
) -> Result<WorklogInput, String> {
    let minutes = notebook_block_duration_minutes(block)
        .filter(|minutes| *minutes > 0)
        .ok_or_else(|| {
            format!(
                "Block has an invalid time range ({}-{})",
                block.start_minute.map(|value| value.to_string()).unwrap_or_else(|| String::from("none")),
                block.end_minute.map(|value| value.to_string()).unwrap_or_else(|| String::from("none"))
            )
        })?;
    let start_minute = block
        .start_minute
        .ok_or_else(|| String::from("Block has an invalid time range (missing start minute)"))?;
    let start_hours = start_minute.div_euclid(60);
    let start_minutes = start_minute.rem_euclid(60);

    Ok(WorklogInput {
        issue_id,
        time_spent_seconds: i64::from(minutes * 60),
        start_date: block.date.clone(),
        start_time: format!("{:02}:{:02}:00", start_hours, start_minutes),
        description: notebook_block_summary(block, max_summary_chars).trim().to_string(),
        author_account_id: author_account_id.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::{auto_summary, notebook_block_duration_minutes, notebook_block_summary, notebook_block_to_worklog_input};
    use crate::state::NotebookBlock;

    fn block(overrides: impl FnOnce(&mut NotebookBlock)) -> NotebookBlock {
        let mut block = NotebookBlock {
            id: String::from("b1"),
            date: String::from("2025-05-09"),
            start_minute: Some(9 * 60),
            end_minute: Some(9 * 60 + 45),
            text: String::from("Worked on the split-view notebook timeline interactions"),
            closed: true,
            ticket_id: String::from("PEA-1"),
            summary_override: None,
            manual_end: None,
            tempo_worklog_id: None,
            synced_at: None,
        };
        overrides(&mut block);
        block
    }

    #[test]
    fn auto_generates_a_short_summary_from_text() {
        assert_eq!(auto_summary("one two three four five six seven eight", 500), "one two three four five six seven eight");
    }

    #[test]
    fn truncates_long_text_to_the_limit_with_ellipsis_counted_inside() {
        let text = "a".repeat(600);
        let result = auto_summary(&text, 500);
        assert_eq!(result.chars().count(), 500);
        assert!(result.ends_with('\u{2026}'));
        assert_eq!(auto_summary("abcdefghij", 5), String::from("abcd\u{2026}"));
        assert_eq!(auto_summary("short", 5), "short");
    }

    #[test]
    fn blank_text_falls_back_to_placeholder() {
        assert_eq!(auto_summary("   ", 500), "Untitled entry");
    }

    #[test]
    fn prefers_manual_summary_override_when_present() {
        assert_eq!(
            notebook_block_summary(&block(|block| block.summary_override = Some(String::from("Manual summary"))), 500),
            "Manual summary"
        );
    }

    #[test]
    fn computes_block_duration_in_minutes() {
        assert_eq!(notebook_block_duration_minutes(&block(|_| {})), Some(45));
    }

    #[test]
    fn converts_a_notebook_block_to_a_tempo_worklog_payload() {
        let input = notebook_block_to_worklog_input(&block(|_| {}), 111, "acc-1", 500).unwrap();
        assert_eq!(input.issue_id, 111);
        assert_eq!(input.time_spent_seconds, 2700);
        assert_eq!(input.start_date, "2025-05-09");
        assert_eq!(input.start_time, "09:00:00");
        assert_eq!(input.description, "Worked on the split-view notebook timeline interactions");
        assert_eq!(input.author_account_id, "acc-1");
    }

    #[test]
    fn applies_the_configured_limit_to_the_generated_description() {
        let long_text = "x".repeat(600);
        let input = notebook_block_to_worklog_input(&block(|block| block.text = long_text), 111, "acc-1", 100).unwrap();
        assert_eq!(input.description.chars().count(), 100);
    }
}
