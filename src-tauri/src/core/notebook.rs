use crate::state::{NotebookBlock, WorklogInput};

const DEFAULT_AUTO_SUMMARY_WORDS: usize = 7;

pub fn auto_summary(text: &str) -> String {
    let words = text.split_whitespace().collect::<Vec<_>>();
    if words.is_empty() {
        return String::from("Untitled entry");
    }

    let short = words
        .iter()
        .take(DEFAULT_AUTO_SUMMARY_WORDS)
        .copied()
        .collect::<Vec<_>>()
        .join(" ");
    if words.len() > DEFAULT_AUTO_SUMMARY_WORDS {
        format!("{}...", short)
    } else {
        short
    }
}

pub fn notebook_block_summary(block: &NotebookBlock) -> String {
    let override_summary = block.summary_override.as_deref().unwrap_or_default().trim();
    if !override_summary.is_empty() {
        override_summary.to_string()
    } else {
        auto_summary(&block.text)
    }
}

pub fn notebook_block_duration_minutes(block: &NotebookBlock) -> Option<i32> {
    Some(block.end_minute? - block.start_minute?)
}

pub fn notebook_block_to_worklog_input(
    block: &NotebookBlock,
    issue_id: i64,
    author_account_id: &str,
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
        description: notebook_block_summary(block).trim().to_string(),
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
            tempo_worklog_id: None,
            synced_at: None,
        };
        overrides(&mut block);
        block
    }

    #[test]
    fn auto_generates_a_short_summary_from_text() {
        assert_eq!(auto_summary("one two three four five six seven eight"), "one two three four five six seven...");
    }

    #[test]
    fn prefers_manual_summary_override_when_present() {
        assert_eq!(notebook_block_summary(&block(|block| block.summary_override = Some(String::from("Manual summary")))), "Manual summary");
    }

    #[test]
    fn computes_block_duration_in_minutes() {
        assert_eq!(notebook_block_duration_minutes(&block(|_| {})), Some(45));
    }

    #[test]
    fn converts_a_notebook_block_to_a_tempo_worklog_payload() {
        let input = notebook_block_to_worklog_input(&block(|_| {}), 111, "acc-1").unwrap();
        assert_eq!(input.issue_id, 111);
        assert_eq!(input.time_spent_seconds, 2700);
        assert_eq!(input.start_date, "2025-05-09");
        assert_eq!(input.start_time, "09:00:00");
        assert_eq!(input.description, "Worked on the split-view notebook timeline interactions");
        assert_eq!(input.author_account_id, "acc-1");
    }
}
