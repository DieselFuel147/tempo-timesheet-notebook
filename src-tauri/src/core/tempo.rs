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

    pub async fn list_worklogs(&self, limit: usize) -> Result<serde_json::Value, AppError> {
        let mut url = self.base_url.join("/worklogs")?;
        url.query_pairs_mut().append_pair("limit", &limit.to_string());

        let mut request = JsonRequest::new(Method::GET, url, "Tempo GET /worklogs");
        self.auth.apply(&mut request.headers)?;
        self.http.request_json(request).await
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
