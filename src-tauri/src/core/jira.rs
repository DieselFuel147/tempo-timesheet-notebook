use reqwest::{Method, Url};
use serde::Deserialize;

use crate::core::auth::AuthHeaderValue;
use crate::core::config::JiraConfig;
use crate::core::http::{HttpClient, JsonRequest};
use crate::error::AppError;
use crate::state::{JiraIssueRef, JiraProfile, TicketSuggestion};

#[derive(Clone)]
pub struct JiraClient {
    base_url: String,
    auth: AuthHeaderValue,
    http: HttpClient,
}

impl JiraClient {
    pub fn new(config: JiraConfig, http: HttpClient) -> Self {
        Self {
            base_url: config.base_url,
            auth: AuthHeaderValue::basic(config.email, config.api_token),
            http,
        }
    }

    pub async fn myself(&self) -> Result<JiraProfile, AppError> {
        let url = self.base_url.join("/rest/api/3/myself")?;
        let mut request = JsonRequest::new(Method::GET, url, "Jira GET /rest/api/3/myself");
        self.auth.apply(&mut request.headers)?;

        let payload: JiraMyselfResponse = self.http.request_json(request).await?;
        Ok(JiraProfile {
            account_id: payload.account_id,
            display_name: payload.display_name.unwrap_or_default(),
            email_address: payload.email_address,
            time_zone: payload.time_zone.unwrap_or_default(),
        })
    }

    pub async fn resolve_issue(&self, key: &str) -> Result<JiraIssueRef, AppError> {
        let mut url = Url::parse(&self.base_url).map_err(|err| {
            AppError::not_configured("Jira base URL is invalid", vec![err.to_string()])
        })?;
        url.path_segments_mut()
            .map_err(|_| AppError::not_configured("Jira base URL cannot be used for issue lookups", Vec::new()))?
            .extend(["rest", "api", "3", "issue", key]);
        url.query_pairs_mut().append_pair("fields", "summary");

        let mut request = JsonRequest::new(Method::GET, url, format!("Jira GET /rest/api/3/issue/{key}"));
        self.auth.apply(&mut request.headers)?;

        let payload: JiraIssueResponse = self.http.request_json(request).await?;
        Ok(JiraIssueRef {
            id: payload.id,
            key: payload.key,
            summary: payload.fields.and_then(|fields| fields.summary).unwrap_or_default(),
        })
    }

    /// Resolve an issue by its numeric id. Jira's issue endpoint accepts either
    /// a key or an id in the path and returns both, so this reuses the same
    /// lookup as `resolve_issue`.
    pub async fn resolve_issue_by_id(&self, issue_id: i64) -> Result<JiraIssueRef, AppError> {
        self.resolve_issue(&issue_id.to_string()).await
    }

    pub async fn pick_issues(&self, query: &str) -> Result<Vec<TicketSuggestion>, AppError> {
        let mut url = self.base_url.join("/rest/api/3/issue/picker")?;
        url.query_pairs_mut()
            .append_pair("query", query)
            .append_pair("showSubTasks", "true");

        let mut request = JsonRequest::new(Method::GET, url, "Jira GET /rest/api/3/issue/picker");
        self.auth.apply(&mut request.headers)?;

        let payload: JiraIssuePickerResponse = self.http.request_json(request).await?;
        let mut seen = std::collections::HashSet::new();
        let mut results = Vec::new();
        for section in payload.sections.unwrap_or_default() {
            for issue in section.issues.unwrap_or_default() {
                if seen.insert(issue.key.clone()) {
                    results.push(TicketSuggestion {
                        key: issue.key,
                        summary: issue.summary_text.unwrap_or_default(),
                    });
                }
            }
        }
        Ok(results)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JiraMyselfResponse {
    account_id: String,
    display_name: Option<String>,
    email_address: Option<String>,
    time_zone: Option<String>,
}

#[derive(Debug, Deserialize)]
struct JiraIssueResponse {
    id: String,
    key: String,
    fields: Option<JiraIssueFields>,
}

#[derive(Debug, Deserialize)]
struct JiraIssueFields {
    summary: Option<String>,
}

#[derive(Debug, Deserialize)]
struct JiraIssuePickerResponse {
    sections: Option<Vec<JiraIssueSection>>,
}

#[derive(Debug, Deserialize)]
struct JiraIssueSection {
    issues: Option<Vec<JiraPickerIssue>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JiraPickerIssue {
    key: String,
    summary_text: Option<String>,
}

trait BaseUrlExt {
    fn join(&self, path: &str) -> Result<Url, AppError>;
}

impl BaseUrlExt for String {
    fn join(&self, path: &str) -> Result<Url, AppError> {
        Url::parse(&format!("{}{}", self, path))
            .map_err(|err| AppError::not_configured("Jira base URL is invalid", vec![err.to_string()]))
    }
}
