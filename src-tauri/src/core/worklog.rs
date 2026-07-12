use crate::core::validation::entry_duration_minutes;
use crate::state::{Entry, WorklogInput};

pub fn to_worklog_input(
    entry: &Entry,
    issue_id: i64,
    author_account_id: &str,
) -> Result<WorklogInput, String> {
    let minutes = entry_duration_minutes(entry)
        .filter(|minutes| *minutes > 0)
        .ok_or_else(|| format!("Entry has an invalid time range ({}-{})", entry.start, entry.end))?;

    Ok(WorklogInput {
        issue_id,
        time_spent_seconds: i64::from(minutes * 60),
        start_date: entry.date.clone(),
        start_time: format!("{}:00", entry.start),
        description: entry.summary.trim().to_string(),
        author_account_id: author_account_id.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::to_worklog_input;
    use crate::state::Entry;

    fn entry(overrides: impl FnOnce(&mut Entry)) -> Entry {
        let mut entry = Entry {
            id: "e".into(),
            date: "2025-05-09".into(),
            start: "09:00".into(),
            end: "09:45".into(),
            ticket_key: "PEA-1".into(),
            summary: "Did stuff".into(),
            tempo_worklog_id: None,
            synced_at: None,
        };
        overrides(&mut entry);
        entry
    }

    #[test]
    fn converts_duration_to_seconds_and_formats_fields() {
        let input = to_worklog_input(
            &entry(|entry| {
                entry.start = "09:00".into();
                entry.end = "10:30".into();
            }),
            111,
            "acc-1",
        )
        .unwrap();

        assert_eq!(input.issue_id, 111);
        assert_eq!(input.time_spent_seconds, 5400);
        assert_eq!(input.start_date, "2025-05-09");
        assert_eq!(input.start_time, "09:00:00");
        assert_eq!(input.description, "Did stuff");
        assert_eq!(input.author_account_id, "acc-1");
    }

    #[test]
    fn trims_the_description() {
        let input = to_worklog_input(&entry(|entry| entry.summary = "  hi  ".into()), 1, "a").unwrap();
        assert_eq!(input.description, "hi");
    }

    #[test]
    fn throws_on_invalid_time_range() {
        let result = to_worklog_input(
            &entry(|entry| {
                entry.start = "10:00".into();
                entry.end = "09:00".into();
            }),
            1,
            "a",
        );
        assert!(result.is_err());
    }
}
