use reqwest::{Method, Url};
use serde::Deserialize;
use serde_json::to_value;

use crate::core::auth::AuthHeaderValue;
use crate::core::config::TempoConfig;
use crate::core::http::{HttpClient, JsonRequest};
use crate::error::AppError;
use crate::state::{PlannedRequest, WorklogInput};

#[derive(Clone)]
pub struct TempoClient {
    base_url: String,
    auth: AuthHeaderValue,
    http: HttpClient,
}

impl TempoClient {
    pub fn new(config: TempoConfig, http: HttpClient) -> Self {
        Self {
            base_url: config.base_url,
            auth: AuthHeaderValue::bearer(config.api_token),
            http,
        }
    }

    pub async fn create_worklog(&self, input: &WorklogInput) -> Result<TempoWorklogCreated, AppError> {
        let url = self.base_url.join("/worklogs")?;
        let mut request = JsonRequest::new(Method::POST, url, "Tempo POST /worklogs");
        self.auth.apply(&mut request.headers)?;
        request.body = Some(to_value(input).map_err(|err| {
            AppError::internal("Failed to serialize Tempo worklog payload").with_detail(err.to_string())
        })?);

        self.http.request_json(request).await
    }

    /// Retrieve the confirmed worklogs for a user across a date range. The
    /// numeric issue id is returned as-is; resolving it to an issue key is the
    /// caller's job. Follows `metadata.next` so more than one page is handled.
    pub async fn list_worklogs_for_user(
        &self,
        account_id: &str,
        from: &str,
        to: &str,
    ) -> Result<Vec<TempoWorklogEntry>, AppError> {
        let mut url = Url::parse(&self.base_url).map_err(|err| {
            AppError::not_configured("Tempo base URL is invalid", vec![err.to_string()])
        })?;
        url.path_segments_mut()
            .map_err(|_| AppError::not_configured("Tempo base URL cannot be used for worklog lookups", Vec::new()))?
            .extend(["worklogs", "user", account_id]);
        url.query_pairs_mut()
            .append_pair("from", from)
            .append_pair("to", to)
            .append_pair("limit", "1000");

        let mut entries = Vec::new();
        let mut next_url = Some(url);
        while let Some(page_url) = next_url.take() {
            let mut request = JsonRequest::new(Method::GET, page_url, "Tempo GET /worklogs/user");
            self.auth.apply(&mut request.headers)?;
            let page: PageableWorklog = self.http.request_json(request).await?;

            entries.extend(page.results.into_iter().map(|worklog| TempoWorklogEntry {
                tempo_worklog_id: worklog.tempo_worklog_id,
                issue_id: worklog.issue.id,
                time_spent_seconds: worklog.time_spent_seconds,
                start_date: worklog.start_date,
                start_time: worklog.start_time,
                description: worklog.description,
            }));

            next_url = match page.metadata.next {
                Some(link) if !link.trim().is_empty() => Some(Url::parse(&link).map_err(|err| {
                    AppError::external_api(
                        "Tempo returned an invalid pagination link",
                        vec![err.to_string()],
                        false,
                    )
                })?),
                _ => None,
            };
        }

        Ok(entries)
    }

    pub fn preview_create_worklog(&self, input: &WorklogInput) -> Result<PlannedRequest, AppError> {
        Ok(PlannedRequest {
            method: String::from("POST"),
            url: self.base_url.join("/worklogs")?.to_string(),
            headers: {
                let mut headers = self.auth.redacted_header_map();
                headers.insert(String::from("Accept"), String::from("application/json"));
                headers.insert(String::from("Content-Type"), String::from("application/json"));
                headers
            },
            body: to_value(input).map_err(|err| {
                AppError::internal("Failed to serialize Tempo worklog preview").with_detail(err.to_string())
            })?,
        })
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TempoWorklogCreated {
    pub tempo_worklog_id: i64,
}

/// A single worklog returned by `list_worklogs_for_user`, before the issue id
/// is resolved to a human-facing key.
#[derive(Clone, Debug)]
pub struct TempoWorklogEntry {
    pub tempo_worklog_id: i64,
    pub issue_id: i64,
    pub time_spent_seconds: i64,
    pub start_date: String,
    pub start_time: String,
    pub description: String,
}

#[derive(Debug, Deserialize)]
struct PageableWorklog {
    #[serde(default)]
    results: Vec<TempoWorklogResponse>,
    #[serde(default)]
    metadata: PageableMetadata,
}

#[derive(Debug, Default, Deserialize)]
struct PageableMetadata {
    next: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TempoWorklogResponse {
    tempo_worklog_id: i64,
    issue: TempoIssueRef,
    time_spent_seconds: i64,
    start_date: String,
    #[serde(default)]
    start_time: String,
    #[serde(default)]
    description: String,
}

#[derive(Debug, Deserialize)]
struct TempoIssueRef {
    id: i64,
}

trait BaseUrlExt {
    fn join(&self, path: &str) -> Result<Url, AppError>;
}

impl BaseUrlExt for String {
    fn join(&self, path: &str) -> Result<Url, AppError> {
        Url::parse(&format!("{}{}", self, path))
            .map_err(|err| AppError::not_configured("Tempo base URL is invalid", vec![err.to_string()]))
    }
}

#[cfg(test)]
mod tests {
    use super::TempoClient;
    use crate::core::config::TempoConfig;
    use crate::core::http::HttpClient;
    use crate::state::WorklogInput;

    #[test]
    fn preview_redacts_auth_and_preserves_payload_shape() {
        let client = TempoClient::new(
            TempoConfig {
                base_url: String::from("https://api.tempo.io/4"),
                api_token: String::from("SECRET-TOKEN"),
            },
            HttpClient::new().expect("http client should build"),
        );

        let preview = client
            .preview_create_worklog(&WorklogInput {
                issue_id: 111,
                time_spent_seconds: 1_800,
                start_date: String::from("2025-05-09"),
                start_time: String::from("09:00:00"),
                description: String::from("Work"),
                author_account_id: String::from("acc-1"),
            })
            .expect("preview should build");

        assert_eq!(preview.headers.get("Authorization"), Some(&String::from("Bearer <redacted>")));
        assert_eq!(preview.url, "https://api.tempo.io/4/worklogs");
        assert_eq!(preview.body["issueId"], 111);
        assert_eq!(preview.body["authorAccountId"], "acc-1");
    }
}
