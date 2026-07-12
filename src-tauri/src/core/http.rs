use std::error::Error;
use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, CONTENT_TYPE};
use reqwest::{Method, StatusCode, Url};
use serde::de::DeserializeOwned;
use serde_json::Value;
use tokio::time::sleep;

use crate::error::AppError;

const DEFAULT_TIMEOUT_MS: u64 = 15_000;
const DEFAULT_RETRIES: usize = 3;

#[derive(Clone, Debug)]
pub struct JsonRequest {
    pub method: Method,
    pub url: Url,
    pub headers: HeaderMap,
    pub body: Option<Value>,
    pub timeout_ms: u64,
    pub retries: usize,
    pub label: String,
}

impl JsonRequest {
    pub fn new(method: Method, url: Url, label: impl Into<String>) -> Self {
        Self {
            method,
            url,
            headers: HeaderMap::new(),
            body: None,
            timeout_ms: DEFAULT_TIMEOUT_MS,
            retries: DEFAULT_RETRIES,
            label: label.into(),
        }
    }
}

#[derive(Clone)]
pub struct HttpClient {
    inner: reqwest::Client,
}

impl HttpClient {
    pub fn new() -> Result<Self, AppError> {
        let inner = reqwest::Client::builder()
            .user_agent(format!("tempo-timesheet-tool/{}", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|err| AppError::internal("Failed to initialize HTTP client").with_detail(err.to_string()))?;
        Ok(Self { inner })
    }

    pub async fn request_json<T>(&self, request: JsonRequest) -> Result<T, AppError>
    where
        T: DeserializeOwned,
    {
        let JsonRequest {
            method,
            url,
            headers,
            body,
            timeout_ms,
            retries,
            label,
        } = request;

        let mut final_headers = headers.clone();
        final_headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
        if body.is_some() {
            final_headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        }

        let total_attempts = retries.max(1);
        for attempt in 1..=total_attempts {
            let request_builder = self
                .inner
                .request(method.clone(), url.clone())
                .headers(final_headers.clone())
                .timeout(Duration::from_millis(timeout_ms));
            let request_builder = if let Some(body_value) = body.as_ref() {
                request_builder.json(body_value)
            } else {
                request_builder
            };
            let result = request_builder.send().await;

            match result {
                Ok(response) => {
                    let status = response.status();
                    if !status.is_success() {
                        let body_text = response.text().await.unwrap_or_default();
                        if is_retryable_status(status) && attempt < total_attempts {
                            log_retry(&label, attempt, total_attempts, &format!("HTTP {status}"));
                            sleep(retry_backoff(attempt)).await;
                            continue;
                        }
                        return Err(map_status_error(&label, status, body_text));
                    }

                    let text = response.text().await.map_err(|err| {
                        AppError::network(
                            format!("{label} -> failed to read response body"),
                            vec![err.to_string()],
                            true,
                        )
                    })?;

                    let payload = if text.trim().is_empty() {
                        Value::Null
                    } else {
                        serde_json::from_str::<Value>(&text).map_err(|err| {
                            AppError::external_api(
                                format!("{label} -> returned invalid JSON"),
                                vec![err.to_string()],
                                false,
                            )
                        })?
                    };

                    return serde_json::from_value(payload).map_err(|err| {
                        AppError::external_api(
                            format!("{label} -> response shape did not match expectations"),
                            vec![err.to_string()],
                            false,
                        )
                    });
                }
                Err(err) => {
                    let detail = source_chain_message(&err);
                    let retryable = is_retryable_transport_error(&err, &detail);
                    if retryable && attempt < total_attempts {
                        log_retry(&label, attempt, total_attempts, &detail);
                        sleep(retry_backoff(attempt)).await;
                        continue;
                    }
                    return Err(map_transport_error(&label, attempt, &detail, retryable));
                }
            }
        }

        Err(AppError::internal(format!("{label} -> request loop exited unexpectedly")))
    }
}

fn map_status_error(label: &str, status: StatusCode, body: String) -> AppError {
    let message = format!(
        "{label} -> {} {}: {}",
        status.as_u16(),
        status.canonical_reason().unwrap_or("Unknown Status"),
        truncate_for_message(&body)
    );
    if matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN) {
        AppError::auth(message, status_details(status, body), false)
    } else {
        AppError::external_api(message, status_details(status, body), is_retryable_status(status))
    }
}

fn status_details(status: StatusCode, body: String) -> Vec<String> {
    let mut details = vec![format!("HTTP status: {}", status.as_u16())];
    if !body.trim().is_empty() {
        details.push(format!("Response body: {}", truncate_for_message(&body)));
    }
    details
}

fn map_transport_error(label: &str, attempt: usize, detail: &str, retryable: bool) -> AppError {
    let message = format!("{label} -> connection failed after {attempt} attempt(s): {detail}");
    if is_tls_error_message(detail) {
        AppError::tls(
            message,
            vec![
                String::from("Rust desktop builds rely on the OS trust store. If your company intercepts TLS, its root CA must be installed in the macOS or Windows system trust store."),
                String::from("This native client does not depend on NODE_USE_SYSTEM_CA; that hint was only for the old Node runtime."),
            ],
            retryable,
        )
    } else if is_proxy_error_message(detail) {
        AppError::network(
            message,
            vec![
                String::from("If your corporate network requires an outbound proxy, make sure the desktop process receives HTTPS_PROXY, HTTP_PROXY, or ALL_PROXY."),
            ],
            retryable,
        )
    } else {
        AppError::network(message, Vec::new(), retryable)
    }
}

fn retry_backoff(attempt: usize) -> Duration {
    Duration::from_millis((attempt as u64) * 500)
}

fn log_retry(label: &str, attempt: usize, total_attempts: usize, reason: &str) {
    eprintln!(
        "[integrations/http] retrying {label} after attempt {attempt}/{total_attempts}: {reason}"
    );
}

fn truncate_for_message(value: &str) -> String {
    value.chars().take(300).collect()
}

fn source_chain_message(error: &reqwest::Error) -> String {
    let mut details = vec![error.to_string()];
    let mut current = error.source();
    while let Some(source) = current {
        details.push(source.to_string());
        current = source.source();
    }
    details.join(": ")
}

fn is_retryable_status(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::TOO_MANY_REQUESTS
            | StatusCode::BAD_GATEWAY
            | StatusCode::SERVICE_UNAVAILABLE
            | StatusCode::GATEWAY_TIMEOUT
    )
}

fn is_retryable_transport_error(error: &reqwest::Error, detail: &str) -> bool {
    let lower = detail.to_ascii_lowercase();
    error.is_timeout()
        || lower.contains("connection reset")
        || lower.contains("connection refused")
        || lower.contains("timed out")
        || lower.contains("dns error")
        || lower.contains("temporary failure")
        || lower.contains("eai_again")
        || lower.contains("enotfound")
        || lower.contains("socket")
}

fn is_tls_error_message(detail: &str) -> bool {
    let lower = detail.to_ascii_lowercase();
    lower.contains("certificate")
        || lower.contains("cert")
        || lower.contains("self signed")
        || lower.contains("unknown issuer")
        || lower.contains("invalid peer certificate")
        || lower.contains("tls")
}

fn is_proxy_error_message(detail: &str) -> bool {
    let lower = detail.to_ascii_lowercase();
    lower.contains("proxy")
}

#[cfg(test)]
mod tests {
    use reqwest::StatusCode;

    use super::{is_retryable_status, is_tls_error_message, map_transport_error};
    use crate::error::ErrorCode;

    #[test]
    fn retryable_status_set_matches_node_behavior() {
        assert!(is_retryable_status(StatusCode::TOO_MANY_REQUESTS));
        assert!(is_retryable_status(StatusCode::BAD_GATEWAY));
        assert!(is_retryable_status(StatusCode::SERVICE_UNAVAILABLE));
        assert!(is_retryable_status(StatusCode::GATEWAY_TIMEOUT));
        assert!(!is_retryable_status(StatusCode::BAD_REQUEST));
    }

    #[test]
    fn tls_errors_map_to_tls_code() {
        let error = map_transport_error(
            "Jira GET /myself",
            3,
            "certificate verify failed: self signed certificate in certificate chain",
            false,
        );

        assert_eq!(error.code, ErrorCode::TlsError);
        assert!(is_tls_error_message(&error.message));
    }
}
