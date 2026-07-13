use std::collections::HashMap;

use async_trait::async_trait;

use crate::core::notebook::{notebook_block_summary, notebook_block_to_worklog_input};
use crate::core::settings::to_validation_config;
use crate::core::validation::{validate_notebook_day, IssueLevel};
use crate::error::AppError;
use crate::state::{
    BlockPushResult, DryRunSummary, JiraIssueRef, JiraProfile, NotebookBlock, NotebookDay,
    PlannedRequest, PlannedWorklog, PushSummary, Settings, WorklogInput,
};

#[async_trait]
pub trait PushRepository {
    async fn get_day(&self, date: &str) -> Result<NotebookDay, AppError>;
    async fn mark_synced(&self, id: &str, tempo_worklog_id: i64) -> Result<(), AppError>;
    async fn get_cached_issue_id(&self, key: &str) -> Result<Option<String>, AppError>;
    async fn cache_issue(&self, key: &str, issue_id: &str, summary: &str) -> Result<(), AppError>;
    async fn get_settings(&self) -> Result<Settings, AppError>;
}

#[async_trait]
pub trait JiraPushClient {
    async fn myself(&self) -> Result<JiraProfile, AppError>;
    async fn resolve_issue(&self, key: &str) -> Result<JiraIssueRef, AppError>;
}

#[async_trait]
pub trait TempoPushClient {
    async fn create_worklog(&self, input: &WorklogInput) -> Result<i64, AppError>;
    async fn preview_create_worklog(&self, input: &WorklogInput) -> Result<PlannedRequest, AppError>;
}

pub async fn push_day<R, J, T>(
    date: &str,
    jira: &J,
    tempo: &T,
    repo: &R,
) -> Result<PushSummary, AppError>
where
    R: PushRepository + Sync,
    J: JiraPushClient + Sync,
    T: TempoPushClient + Sync,
{
    let day = repo.get_day(date).await?;
    let pushable = day
        .blocks
        .iter()
        .filter(|block| pushable_block(block))
        .cloned()
        .collect::<Vec<_>>();
    let blocked = validation_blockers(&pushable, &repo.get_settings().await?);
    if !blocked.is_empty() {
        return Ok(PushSummary {
            results: Vec::new(),
            synced: 0,
            failed: 0,
            skipped: 0,
            blocked,
        });
    }

    let unsynced = pushable
        .iter()
        .filter(|block| block.tempo_worklog_id.is_none())
        .cloned()
        .collect::<Vec<_>>();
    let skipped = pushable.len().saturating_sub(unsynced.len());

    if unsynced.is_empty() {
        return Ok(PushSummary {
            results: Vec::new(),
            synced: 0,
            failed: 0,
            skipped,
            blocked: Vec::new(),
        });
    }

    let me = jira.myself().await?;
    let mut results = Vec::new();

    for block in unsynced {
        match resolve_issue_id(&block.ticket_id, jira, repo).await {
            Ok(issue_id) => match notebook_block_to_worklog_input(&block, issue_id, &me.account_id) {
                Ok(input) => match tempo.create_worklog(&input).await {
                    Ok(tempo_worklog_id) => {
                        repo.mark_synced(&block.id, tempo_worklog_id).await?;
                        results.push(BlockPushResult {
                            block_id: block.id,
                            ticket_id: block.ticket_id,
                            ok: true,
                            tempo_worklog_id: Some(tempo_worklog_id),
                            error: None,
                        });
                    }
                    Err(error) => {
                        results.push(failed_result(block.id, block.ticket_id, error.message));
                    }
                },
                Err(message) => {
                    results.push(failed_result(block.id, block.ticket_id, message));
                }
            },
            Err(error) => {
                results.push(failed_result(block.id, block.ticket_id, error.message));
            }
        }
    }

    Ok(PushSummary {
        synced: results.iter().filter(|result| result.ok).count(),
        failed: results.iter().filter(|result| !result.ok).count(),
        skipped,
        blocked: Vec::new(),
        results,
    })
}

pub async fn dry_run_day<R, J, T>(
    date: &str,
    jira: &J,
    tempo: &T,
    repo: &R,
) -> Result<DryRunSummary, AppError>
where
    R: PushRepository + Sync,
    J: JiraPushClient + Sync,
    T: TempoPushClient + Sync,
{
    let day = repo.get_day(date).await?;
    let pushable = day
        .blocks
        .iter()
        .filter(|block| pushable_block(block))
        .cloned()
        .collect::<Vec<_>>();
    let blocked = validation_blockers(&pushable, &repo.get_settings().await?);
    if !blocked.is_empty() {
        return Ok(DryRunSummary {
            dry_run: true,
            planned: Vec::new(),
            skipped: 0,
            blocked,
        });
    }

    let unsynced = pushable
        .iter()
        .filter(|block| block.tempo_worklog_id.is_none())
        .cloned()
        .collect::<Vec<_>>();
    let skipped = pushable.len().saturating_sub(unsynced.len());
    let me = jira.myself().await?;
    let mut planned = Vec::new();

    for block in unsynced {
        let issue_id = resolve_issue_id(&block.ticket_id, jira, repo).await?;
        let input = notebook_block_to_worklog_input(&block, issue_id, &me.account_id)
            .map_err(|message| AppError::internal(message))?;
        let mut request = tempo.preview_create_worklog(&input).await?;
        request.headers = redact_auth(request.headers);
        planned.push(PlannedWorklog {
            block_id: block.id,
            ticket_id: block.ticket_id,
            issue_id,
            request,
        });
    }

    Ok(DryRunSummary {
        dry_run: true,
        planned,
        skipped,
        blocked: Vec::new(),
    })
}

fn validation_blockers(blocks: &[NotebookBlock], settings: &Settings) -> Vec<String> {
    validate_notebook_day(blocks, &to_validation_config(settings))
        .into_iter()
        .filter(|issue| issue.level == IssueLevel::Error)
        .map(|issue| issue.message)
        .collect()
}

fn pushable_block(block: &NotebookBlock) -> bool {
    block.closed && block.start_minute.is_some() && block.end_minute.is_some() && !notebook_block_summary(block).trim().is_empty()
}

async fn resolve_issue_id<R, J>(key: &str, jira: &J, repo: &R) -> Result<i64, AppError>
where
    R: PushRepository + Sync,
    J: JiraPushClient + Sync,
{
    if let Some(cached) = repo.get_cached_issue_id(key).await? {
        return cached.parse::<i64>().map_err(|error| {
            AppError::internal("Cached Jira issue id was not numeric").with_detail(error.to_string())
        });
    }

    let issue = jira.resolve_issue(key).await?;
    repo.cache_issue(&issue.key, &issue.id, &issue.summary).await?;
    issue.id.parse::<i64>().map_err(|error| {
        AppError::internal("Resolved Jira issue id was not numeric").with_detail(error.to_string())
    })
}

fn redact_auth(mut headers: HashMap<String, String>) -> HashMap<String, String> {
    if let Some(auth) = headers.get("Authorization").cloned() {
        let scheme = auth.split(' ').next().unwrap_or_default();
        headers.insert("Authorization".into(), format!("{} <redacted>", scheme));
    }
    headers
}

fn failed_result(block_id: String, ticket_id: String, error: String) -> BlockPushResult {
    BlockPushResult {
        block_id,
        ticket_id,
        ok: false,
        tempo_worklog_id: None,
        error: Some(error),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    use async_trait::async_trait;
    use serde_json::json;

    use super::{dry_run_day, push_day, JiraPushClient, PushRepository, TempoPushClient};
    use crate::error::AppError;
    use crate::state::{
        DryRunSummary, JiraIssueRef, JiraProfile, NotebookBlock, NotebookDay, PlannedRequest,
        Settings, WorklogInput,
    };

    fn block(overrides: impl FnOnce(&mut NotebookBlock)) -> NotebookBlock {
        let mut block = NotebookBlock {
            id: "b1".into(),
            date: "2025-05-09".into(),
            start_minute: Some(9 * 60),
            end_minute: Some(9 * 60 + 45),
            text: "Work".into(),
            closed: true,
            ticket_id: "PEA-777".into(),
            summary_override: None,
            tempo_worklog_id: None,
            synced_at: None,
        };
        overrides(&mut block);
        block
    }

    struct FakeRepo {
        day: Mutex<NotebookDay>,
        cache: Mutex<HashMap<String, String>>,
        settings: Settings,
        get_settings_calls: AtomicUsize,
    }

    impl FakeRepo {
        fn new(blocks: Vec<NotebookBlock>) -> Self {
            Self {
                day: Mutex::new(NotebookDay {
                    date: "2025-05-09".into(),
                    blocks,
                }),
                cache: Mutex::new(HashMap::new()),
                settings: Settings::default(),
                get_settings_calls: AtomicUsize::new(0),
            }
        }
    }

    #[async_trait]
    impl PushRepository for FakeRepo {
        async fn get_day(&self, _date: &str) -> Result<NotebookDay, AppError> {
            Ok(self.day.lock().map_err(|_| AppError::internal("day lock poisoned"))?.clone())
        }

        async fn mark_synced(&self, id: &str, tempo_worklog_id: i64) -> Result<(), AppError> {
            let mut day = self.day.lock().map_err(|_| AppError::internal("day lock poisoned"))?;
            if let Some(block) = day.blocks.iter_mut().find(|block| block.id == id) {
                block.tempo_worklog_id = Some(tempo_worklog_id);
            }
            Ok(())
        }

        async fn get_cached_issue_id(&self, key: &str) -> Result<Option<String>, AppError> {
            Ok(self
                .cache
                .lock()
                .map_err(|_| AppError::internal("cache lock poisoned"))?
                .get(key)
                .cloned())
        }

        async fn cache_issue(&self, key: &str, issue_id: &str, _summary: &str) -> Result<(), AppError> {
            self.cache
                .lock()
                .map_err(|_| AppError::internal("cache lock poisoned"))?
                .insert(key.into(), issue_id.into());
            Ok(())
        }

        async fn get_settings(&self) -> Result<Settings, AppError> {
            self.get_settings_calls.fetch_add(1, Ordering::Relaxed);
            Ok(self.settings.clone())
        }
    }

    struct FakeJira {
        resolve_calls: AtomicUsize,
    }

    #[async_trait]
    impl JiraPushClient for FakeJira {
        async fn myself(&self) -> Result<JiraProfile, AppError> {
            Ok(JiraProfile {
                account_id: "acc-1".into(),
                display_name: "Me".into(),
                email_address: None,
                time_zone: "UTC".into(),
            })
        }

        async fn resolve_issue(&self, key: &str) -> Result<JiraIssueRef, AppError> {
            self.resolve_calls.fetch_add(1, Ordering::Relaxed);
            Ok(JiraIssueRef {
                id: if key == "PEA-777" { "111" } else { "222" }.into(),
                key: key.into(),
                summary: "S".into(),
            })
        }
    }

    struct FakeTempo {
        created: Mutex<Vec<WorklogInput>>,
    }

    #[async_trait]
    impl TempoPushClient for FakeTempo {
        async fn create_worklog(&self, input: &WorklogInput) -> Result<i64, AppError> {
            let mut created = self.created.lock().map_err(|_| AppError::internal("created lock poisoned"))?;
            created.push(input.clone());
            Ok(900 + created.len() as i64)
        }

        async fn preview_create_worklog(&self, input: &WorklogInput) -> Result<PlannedRequest, AppError> {
            Ok(PlannedRequest {
                method: "POST".into(),
                url: "https://api.tempo.io/4/worklogs".into(),
                headers: HashMap::from([
                    ("Accept".into(), "application/json".into()),
                    ("Content-Type".into(), "application/json".into()),
                    ("Authorization".into(), "Bearer SECRET-TOKEN".into()),
                ]),
                body: serde_json::to_value(input).unwrap(),
            })
        }
    }

    struct FailingFirstTempo {
        calls: AtomicUsize,
    }

    #[async_trait]
    impl TempoPushClient for FailingFirstTempo {
        async fn create_worklog(&self, _input: &WorklogInput) -> Result<i64, AppError> {
            if self.calls.fetch_add(1, Ordering::Relaxed) == 0 {
                Err(AppError::external_api(
                    "Tempo 400: account attribute required",
                    Vec::new(),
                    false,
                ))
            } else {
                Ok(42)
            }
        }

        async fn preview_create_worklog(&self, _input: &WorklogInput) -> Result<PlannedRequest, AppError> {
            Ok(PlannedRequest {
                method: "POST".into(),
                url: String::new(),
                headers: HashMap::new(),
                body: serde_json::Value::Null,
            })
        }
    }

    #[tokio::test]
    async fn pushes_unsynced_entries_and_marks_them_synced() {
        let repo = FakeRepo::new(vec![
            block(|block| {
                block.id = "a".into();
                block.start_minute = Some(9 * 60);
                block.end_minute = Some(9 * 60 + 30);
            }),
            block(|block| {
                block.id = "b".into();
                block.ticket_id = "REACT-1".into();
                block.start_minute = Some(9 * 60 + 30);
                block.end_minute = Some(10 * 60);
            }),
        ]);
        let jira = FakeJira {
            resolve_calls: AtomicUsize::new(0),
        };
        let tempo = FakeTempo {
            created: Mutex::new(Vec::new()),
        };

        let result = push_day("2025-05-09", &jira, &tempo, &repo).await.unwrap();
        assert_eq!(result.synced, 2);
        assert_eq!(result.failed, 0);
        let created = tempo.created.lock().unwrap();
        assert_eq!(created.len(), 2);
        assert_eq!(created[0].issue_id, 111);
        assert_eq!(created[0].author_account_id, "acc-1");
    }

    #[tokio::test]
    async fn skips_already_synced_entries() {
        let repo = FakeRepo::new(vec![
            block(|block| {
                block.id = "a".into();
                block.tempo_worklog_id = Some(555);
                block.start_minute = Some(9 * 60);
                block.end_minute = Some(9 * 60 + 30);
            }),
            block(|block| {
                block.id = "b".into();
                block.ticket_id = "REACT-1".into();
                block.start_minute = Some(9 * 60 + 30);
                block.end_minute = Some(10 * 60);
            }),
        ]);
        let jira = FakeJira {
            resolve_calls: AtomicUsize::new(0),
        };
        let tempo = FakeTempo {
            created: Mutex::new(Vec::new()),
        };

        let result = push_day("2025-05-09", &jira, &tempo, &repo).await.unwrap();
        assert_eq!(result.synced, 1);
        assert_eq!(result.skipped, 1);
        let created = tempo.created.lock().unwrap();
        assert_eq!(created.len(), 1);
        assert_eq!(created[0].issue_id, 222);
    }

    #[tokio::test]
    async fn blocks_the_whole_push_when_any_entry_is_invalid() {
        let repo = FakeRepo::new(vec![block(|block| block.ticket_id = "not a ticket".into())]);
        let jira = FakeJira {
            resolve_calls: AtomicUsize::new(0),
        };
        let tempo = FakeTempo {
            created: Mutex::new(Vec::new()),
        };

        let result = push_day("2025-05-09", &jira, &tempo, &repo).await.unwrap();
        assert!(!result.blocked.is_empty());
        assert_eq!(result.synced, 0);
        assert!(tempo.created.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn resolves_each_distinct_ticket_only_once() {
        let repo = FakeRepo::new(vec![
            block(|block| {
                block.id = "a".into();
                block.start_minute = Some(9 * 60);
                block.end_minute = Some(9 * 60 + 30);
            }),
            block(|block| {
                block.id = "b".into();
                block.start_minute = Some(9 * 60 + 30);
                block.end_minute = Some(10 * 60);
            }),
        ]);
        let jira = FakeJira {
            resolve_calls: AtomicUsize::new(0),
        };
        let tempo = FakeTempo {
            created: Mutex::new(Vec::new()),
        };

        push_day("2025-05-09", &jira, &tempo, &repo).await.unwrap();
        assert_eq!(jira.resolve_calls.load(Ordering::Relaxed), 1);
    }

    #[tokio::test]
    async fn dry_run_builds_requests_sends_nothing_and_redacts_auth() {
        let repo = FakeRepo::new(vec![block(|block| {
            block.id = "a".into();
            block.start_minute = Some(9 * 60);
            block.end_minute = Some(9 * 60 + 30);
        })]);
        let jira = FakeJira {
            resolve_calls: AtomicUsize::new(0),
        };
        let tempo = FakeTempo {
            created: Mutex::new(Vec::new()),
        };

        let dry: DryRunSummary = dry_run_day("2025-05-09", &jira, &tempo, &repo).await.unwrap();
        assert!(dry.dry_run);
        assert_eq!(dry.planned.len(), 1);
        assert_eq!(dry.planned[0].request.body["issueId"], json!(111));
        assert_eq!(dry.planned[0].request.body["authorAccountId"], json!("acc-1"));
        assert_eq!(
            dry.planned[0].request.headers.get("Authorization"),
            Some(&String::from("Bearer <redacted>"))
        );
        assert!(tempo.created.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn dry_run_still_blocks_when_entry_is_invalid() {
        let repo = FakeRepo::new(vec![block(|block| block.ticket_id = "nope".into())]);
        let jira = FakeJira {
            resolve_calls: AtomicUsize::new(0),
        };
        let tempo = FakeTempo {
            created: Mutex::new(Vec::new()),
        };

        let result = dry_run_day("2025-05-09", &jira, &tempo, &repo).await.unwrap();
        assert!(!result.blocked.is_empty());
        assert!(result.planned.is_empty());
        assert!(tempo.created.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn validates_against_stored_settings() {
        let repo = FakeRepo::new(vec![block(|block| {
            block.id = "a".into();
            block.start_minute = Some(9 * 60);
            block.end_minute = Some(9 * 60 + 30);
        })]);
        let jira = FakeJira {
            resolve_calls: AtomicUsize::new(0),
        };
        let tempo = FakeTempo {
            created: Mutex::new(Vec::new()),
        };

        push_day("2025-05-09", &jira, &tempo, &repo).await.unwrap();
        assert!(repo.get_settings_calls.load(Ordering::Relaxed) > 0);
    }

    #[tokio::test]
    async fn records_per_entry_error_without_aborting_the_rest() {
        let repo = FakeRepo::new(vec![
            block(|block| {
                block.id = "a".into();
                block.start_minute = Some(9 * 60);
                block.end_minute = Some(9 * 60 + 30);
            }),
            block(|block| {
                block.id = "b".into();
                block.ticket_id = "REACT-1".into();
                block.start_minute = Some(9 * 60 + 30);
                block.end_minute = Some(10 * 60);
            }),
        ]);
        let jira = FakeJira {
            resolve_calls: AtomicUsize::new(0),
        };
        let tempo = FailingFirstTempo {
            calls: AtomicUsize::new(0),
        };

        let result = push_day("2025-05-09", &jira, &tempo, &repo).await.unwrap();
        assert_eq!(result.synced, 1);
        assert_eq!(result.failed, 1);
        assert!(result
            .results
            .iter()
            .find(|result| !result.ok)
            .and_then(|result| result.error.clone())
            .unwrap()
            .to_lowercase()
            .contains("account attribute"));
    }

    #[tokio::test]
    async fn ignores_open_or_untimed_blocks_when_counting_pushable_work() {
        let repo = FakeRepo::new(vec![
            block(|_| {}),
            block(|block| {
                block.id = "draft".into();
                block.start_minute = None;
                block.end_minute = None;
                block.closed = false;
                block.text = String::from("Draft note");
                block.ticket_id = String::new();
            }),
        ]);
        let jira = FakeJira {
            resolve_calls: AtomicUsize::new(0),
        };
        let tempo = FakeTempo {
            created: Mutex::new(Vec::new()),
        };

        let dry = dry_run_day("2025-05-09", &jira, &tempo, &repo).await.unwrap();
        assert_eq!(dry.planned.len(), 1);
        assert_eq!(dry.skipped, 0);
    }
}
