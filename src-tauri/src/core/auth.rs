use std::collections::HashMap;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};

use crate::error::AppError;

#[derive(Clone, Debug)]
pub struct AuthHeaderValue {
    value: String,
    redacted_value: String,
}

impl AuthHeaderValue {
    pub fn bearer(token: impl AsRef<str>) -> Self {
        Self {
            value: format!("Bearer {}", token.as_ref()),
            redacted_value: "Bearer <redacted>".into(),
        }
    }

    pub fn basic(email: impl AsRef<str>, token: impl AsRef<str>) -> Self {
        let encoded = BASE64_STANDARD.encode(format!("{}:{}", email.as_ref(), token.as_ref()));
        Self {
            value: format!("Basic {encoded}"),
            redacted_value: "Basic <redacted>".into(),
        }
    }

    pub fn apply(&self, headers: &mut HeaderMap) -> Result<(), AppError> {
        let value = HeaderValue::from_str(&self.value)
            .map_err(|err| AppError::internal("Failed to build auth header").with_detail(err.to_string()))?;
        headers.insert(AUTHORIZATION, value);
        Ok(())
    }

    pub fn redacted_header_map(&self) -> HashMap<String, String> {
        HashMap::from([(String::from("Authorization"), self.redacted_value.clone())])
    }
}

#[cfg(test)]
mod tests {
    use reqwest::header::{HeaderMap, AUTHORIZATION};

    use super::AuthHeaderValue;

    #[test]
    fn bearer_redaction_matches_dry_run_contract() {
        let auth = AuthHeaderValue::bearer("SECRET-TOKEN");
        assert_eq!(
            auth.redacted_header_map().get("Authorization"),
            Some(&String::from("Bearer <redacted>"))
        );
    }

    #[test]
    fn basic_auth_builds_expected_prefix() {
        let auth = AuthHeaderValue::basic("user@example.com", "token-123");
        let mut headers = HeaderMap::new();
        auth.apply(&mut headers).expect("auth header should be valid");
        let value = headers
            .get(AUTHORIZATION)
            .and_then(|header| header.to_str().ok())
            .unwrap_or_default();
        assert!(value.starts_with("Basic "));
    }
}
