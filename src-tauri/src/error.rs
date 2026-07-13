use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    ValidationError,
    NotConfigured,
    AuthError,
    NetworkError,
    TlsError,
    ExternalApiError,
    DbError,
    InternalError,
}

#[derive(Debug, Clone, Serialize)]
pub struct FieldError {
    pub field: String,
    pub message: String,
}

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(rename_all = "camelCase")]
#[error("{message}")]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub details: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub field_errors: Vec<FieldError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retryable: Option<bool>,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            details: Vec::new(),
            field_errors: Vec::new(),
            retryable: None,
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InternalError, message)
    }

    pub fn not_configured(message: impl Into<String>, details: Vec<String>) -> Self {
        Self::new(ErrorCode::NotConfigured, message).with_details(details)
    }

    pub fn auth(message: impl Into<String>, details: Vec<String>, retryable: bool) -> Self {
        Self::new(ErrorCode::AuthError, message)
            .with_details(details)
            .with_retryable(retryable)
    }

    pub fn network(message: impl Into<String>, details: Vec<String>, retryable: bool) -> Self {
        Self::new(ErrorCode::NetworkError, message)
            .with_details(details)
            .with_retryable(retryable)
    }

    pub fn tls(message: impl Into<String>, details: Vec<String>, retryable: bool) -> Self {
        Self::new(ErrorCode::TlsError, message)
            .with_details(details)
            .with_retryable(retryable)
    }

    pub fn external_api(message: impl Into<String>, details: Vec<String>, retryable: bool) -> Self {
        Self::new(ErrorCode::ExternalApiError, message)
            .with_details(details)
            .with_retryable(retryable)
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.details.push(detail.into());
        self
    }

    pub fn with_details(mut self, details: Vec<String>) -> Self {
        self.details = details;
        self
    }

    pub fn with_retryable(mut self, retryable: bool) -> Self {
        self.retryable = Some(retryable);
        self
    }
}
