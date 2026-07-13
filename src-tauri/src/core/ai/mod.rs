//! Local, on-device AI summarization.
//!
//! A llama.cpp `llama-server` process is spawned on demand, queried over its
//! OpenAI-compatible HTTP endpoint, and killed after an idle timeout. Every
//! request is stateless — no conversation history is retained. See [`sidecar`]
//! for the process lifecycle; this module owns the pure config/prompt/parsing
//! surface.

pub mod sidecar;

pub use sidecar::SidecarManager;

use crate::error::AppError;
use crate::state::Settings;

/// The built-in system prompt. Used as the default value for the editable
/// setting, and as the fallback when the user clears the field. Must stay
/// textually identical to `DEFAULT_AI_SYSTEM_PROMPT` in `shared/settings.ts`.
pub const DEFAULT_SYSTEM_PROMPT: &str = "You write concise Jira/Tempo worklog \
descriptions. Given a developer's raw notes for one block of time, reply with a \
plain worklog description: one sentence, or at most two sentences if there is a \
lot of detail. Use past tense, no first person, no preamble, no markdown, and no \
surrounding quotes. Reply with the description text only.";

/// Resolved AI runtime configuration (paths already checked non-empty).
#[derive(Clone, Debug)]
pub struct AiConfig {
    pub binary_path: String,
    pub model_path: String,
    pub idle_timeout_secs: u64,
    pub system_prompt: String,
}

/// Gate the AI feature: it must be enabled and both paths set, mirroring
/// `IntegrationConfig::require_jira` in [`crate::core::config`].
pub fn require_ai(settings: &Settings) -> Result<AiConfig, AppError> {
    let ai = &settings.ai;
    if !ai.enabled {
        return Err(AppError::not_configured(
            "Local AI summaries are turned off",
            vec!["Enable AI in Settings to use Suggest.".into()],
        ));
    }

    let mut missing = Vec::new();
    if ai.binary_path.trim().is_empty() {
        missing.push("settings.ai.binaryPath");
    }
    if ai.model_path.trim().is_empty() {
        missing.push("settings.ai.modelPath");
    }
    if !missing.is_empty() {
        return Err(AppError::not_configured(
            "Local AI is not fully configured yet",
            missing
                .into_iter()
                .map(|name| format!("Missing setting: {name}"))
                .collect(),
        ));
    }

    // Fall back to the built-in prompt if the user has cleared the field, so
    // summarization never breaks with an empty system prompt.
    let system_prompt = if ai.system_prompt.trim().is_empty() {
        DEFAULT_SYSTEM_PROMPT.to_string()
    } else {
        ai.system_prompt.clone()
    };

    Ok(AiConfig {
        binary_path: ai.binary_path.trim().to_string(),
        model_path: ai.model_path.trim().to_string(),
        idle_timeout_secs: ai.idle_timeout_secs,
        system_prompt,
    })
}

/// Build the (system, user) prompt pair for summarizing one block's notes.
/// The system prompt is caller-supplied (user-configurable); the instruction
/// it carries scales the output length to the amount of detail.
pub fn build_prompt(system_prompt: &str, notes: &str) -> (String, String) {
    let user = format!("Notes:\n{}\n\nWorklog description:", notes.trim());
    (system_prompt.to_string(), user)
}

/// Normalize a raw model completion into a clean 1–2 sentence description:
/// strip an echoed label, drop wrapping quotes, collapse whitespace, and keep
/// at most two sentences.
pub fn sanitize_summary(raw: &str) -> String {
    let mut text = raw.trim().to_string();

    for label in ["Worklog description:", "Description:", "Summary:"] {
        if let Some(rest) = text.strip_prefix(label) {
            text = rest.trim().to_string();
        }
    }

    let chars: Vec<char> = text.chars().collect();
    if chars.len() >= 2 {
        let first = chars[0];
        let last = chars[chars.len() - 1];
        let wrapped = (first == '"' && last == '"')
            || (first == '\'' && last == '\'')
            || (first == '“' && last == '”');
        if wrapped {
            text = chars[1..chars.len() - 1].iter().collect::<String>().trim().to_string();
        }
    }

    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    limit_sentences(&collapsed, 2)
}

/// Keep at most `max` sentences, terminating after the `max`-th sentence-ending
/// punctuation mark. Text with fewer terminators is returned whole.
fn limit_sentences(text: &str, max: usize) -> String {
    if max == 0 {
        return String::new();
    }
    let mut out = String::new();
    let mut count = 0;
    for ch in text.chars() {
        out.push(ch);
        if matches!(ch, '.' | '!' | '?') {
            count += 1;
            if count >= max {
                break;
            }
        }
    }
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::{build_prompt, require_ai, sanitize_summary, DEFAULT_SYSTEM_PROMPT};
    use crate::error::ErrorCode;
    use crate::state::{AiSettings, Settings};

    #[test]
    fn require_ai_reports_disabled() {
        let error = require_ai(&Settings::default()).unwrap_err();
        assert_eq!(error.code, ErrorCode::NotConfigured);
    }

    #[test]
    fn require_ai_reports_missing_paths_when_enabled() {
        let settings = Settings {
            ai: AiSettings {
                enabled: true,
                ..AiSettings::default()
            },
            ..Settings::default()
        };
        let error = require_ai(&settings).unwrap_err();
        assert_eq!(error.code, ErrorCode::NotConfigured);
        assert_eq!(error.details.len(), 2);
    }

    #[test]
    fn require_ai_succeeds_when_configured() {
        let settings = Settings {
            ai: AiSettings {
                enabled: true,
                binary_path: "/opt/llama/llama-server".into(),
                model_path: "/models/gemma.gguf".into(),
                idle_timeout_secs: 60,
                system_prompt: String::new(),
            },
            ..Settings::default()
        };
        let config = require_ai(&settings).unwrap();
        assert_eq!(config.binary_path, "/opt/llama/llama-server");
        assert_eq!(config.idle_timeout_secs, 60);
        // Blank system prompt falls back to the built-in default.
        assert_eq!(config.system_prompt, DEFAULT_SYSTEM_PROMPT);
    }

    #[test]
    fn require_ai_keeps_custom_system_prompt() {
        let settings = Settings {
            ai: AiSettings {
                enabled: true,
                binary_path: "/bin/llama-server".into(),
                model_path: "/models/gemma.gguf".into(),
                idle_timeout_secs: 60,
                system_prompt: "Summarize tersely.".into(),
            },
            ..Settings::default()
        };
        assert_eq!(require_ai(&settings).unwrap().system_prompt, "Summarize tersely.");
    }

    #[test]
    fn build_prompt_embeds_notes_and_uses_given_system_prompt() {
        let (system, user) = build_prompt("Be brief.", "  fixed the parser bug  ");
        assert_eq!(system, "Be brief.");
        assert!(user.contains("fixed the parser bug"));
        assert!(user.trim_end().ends_with("Worklog description:"));
    }

    #[test]
    fn sanitize_strips_quotes_label_and_extra_sentences() {
        let raw = "Description: \"Investigated the flaky test. Patched the retry \
logic. Also refactored the helper.\"";
        let cleaned = sanitize_summary(raw);
        assert_eq!(cleaned, "Investigated the flaky test. Patched the retry logic.");
    }

    #[test]
    fn sanitize_collapses_whitespace_and_keeps_single_sentence() {
        let cleaned = sanitize_summary("  Reviewed\n\n the   pull request  ");
        assert_eq!(cleaned, "Reviewed the pull request");
    }
}
