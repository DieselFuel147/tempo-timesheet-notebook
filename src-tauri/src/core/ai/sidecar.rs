//! On-demand llama.cpp `llama-server` lifecycle manager.
//!
//! The process is spawned lazily on the first summary request, reused while
//! warm, and killed by a background reaper once it has been idle longer than
//! the configured timeout. A single request holds the state lock for its whole
//! duration, so the reaper can never kill a process mid-generation.

use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use reqwest::{Method, Url};
use serde::Deserialize;
use serde_json::json;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::sleep;

use super::{build_prompt, sanitize_summary, AiConfig};
use crate::core::http::{HttpClient, JsonRequest};
use crate::error::AppError;

const CTX_SIZE: u32 = 4096;
const MAX_OUTPUT_TOKENS: u32 = 120;
const COMPLETE_TIMEOUT_MS: u64 = 60_000;
/// First-run model loading can be slow, so allow a generous readiness window.
const HEALTH_TIMEOUT_SECS: u64 = 120;
const HEALTH_POLL_MS: u64 = 300;
const REAP_INTERVAL_SECS: u64 = 15;

struct Running {
    child: Child,
    port: u16,
    last_used: Instant,
    idle_timeout: Duration,
}

/// Manages the single, on-demand `llama-server` child process.
pub struct SidecarManager {
    state: Arc<Mutex<Option<Running>>>,
    http: HttpClient,
    reaper_started: AtomicBool,
}

impl SidecarManager {
    pub fn new() -> Result<Self, AppError> {
        Ok(Self {
            state: Arc::new(Mutex::new(None)),
            http: HttpClient::new()?,
            reaper_started: AtomicBool::new(false),
        })
    }

    /// Summarize a block's notes into a clean 1–2 sentence description.
    /// Holds the state lock for the whole request so the reaper can't kill the
    /// server between readiness and completion.
    pub async fn summarize(&self, config: &AiConfig, notes: &str) -> Result<String, AppError> {
        let (system, user) = build_prompt(&config.system_prompt, notes);

        let mut guard = self.state.lock().await;
        let port = self.ensure_running(&mut guard, config).await?;
        self.ensure_reaper();

        let raw = self.complete(port, &system, &user).await?;
        if let Some(running) = guard.as_mut() {
            running.last_used = Instant::now();
        }
        Ok(sanitize_summary(&raw))
    }

    /// Whether the model process is currently loaded. Reaps a dead child so the
    /// reported state stays honest even if the process crashed between requests.
    pub async fn is_running(&self) -> bool {
        let mut guard = self.state.lock().await;
        if let Some(running) = guard.as_mut() {
            if let Ok(None) = running.child.try_wait() {
                return true;
            }
            *guard = None;
        }
        false
    }

    /// Return the port of a warm server, (re)spawning and health-polling one if
    /// none is running or the previous child has exited.
    async fn ensure_running(
        &self,
        guard: &mut Option<Running>,
        config: &AiConfig,
    ) -> Result<u16, AppError> {
        if let Some(running) = guard.as_mut() {
            match running.child.try_wait() {
                Ok(None) => {
                    running.last_used = Instant::now();
                    return Ok(running.port);
                }
                // Exited or unqueryable — drop and respawn below.
                _ => {
                    *guard = None;
                }
            }
        }

        let port = free_port()?;
        let mut child = spawn_server(config, port)?;

        let health_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
            .map_err(|error| {
                AppError::internal(format!("Failed to build health-check client: {error}"))
            })?;
        let health_url = format!("http://127.0.0.1:{port}/health");
        let deadline = Instant::now() + Duration::from_secs(HEALTH_TIMEOUT_SECS);

        loop {
            if let Ok(Some(status)) = child.try_wait() {
                return Err(AppError::internal(format!(
                    "llama-server exited during startup (status {status}); check the binary and model paths"
                )));
            }
            if let Ok(response) = health_client.get(&health_url).send().await {
                if response.status().is_success() {
                    break;
                }
            }
            if Instant::now() >= deadline {
                let _ = child.start_kill();
                return Err(AppError::internal(format!(
                    "llama-server did not become ready within {HEALTH_TIMEOUT_SECS}s"
                )));
            }
            sleep(Duration::from_millis(HEALTH_POLL_MS)).await;
        }

        *guard = Some(Running {
            child,
            port,
            last_used: Instant::now(),
            idle_timeout: Duration::from_secs(config.idle_timeout_secs),
        });
        Ok(port)
    }

    /// Stateless chat completion against the OpenAI-compatible endpoint.
    async fn complete(&self, port: u16, system: &str, user: &str) -> Result<String, AppError> {
        let url = Url::parse(&format!("http://127.0.0.1:{port}/v1/chat/completions"))
            .map_err(|error| AppError::internal(format!("Invalid sidecar URL: {error}")))?;

        let mut request = JsonRequest::new(Method::POST, url, "llama-server POST /v1/chat/completions");
        request.retries = 1;
        request.timeout_ms = COMPLETE_TIMEOUT_MS;
        request.body = Some(json!({
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": user },
            ],
            "temperature": 0.2,
            "max_tokens": MAX_OUTPUT_TOKENS,
            "stream": false,
        }));

        let payload: ChatCompletionResponse = self.http.request_json(request).await?;
        payload
            .choices
            .into_iter()
            .next()
            .map(|choice| choice.message.content)
            .ok_or_else(|| {
                AppError::external_api("llama-server returned no completion choices", Vec::new(), false)
            })
    }

    /// Spawn the idle reaper exactly once. It kills the child after it has been
    /// idle past its timeout; while a request holds the state lock, the reaper
    /// simply waits.
    fn ensure_reaper(&self) {
        if self.reaper_started.swap(true, Ordering::SeqCst) {
            return;
        }
        let state = Arc::clone(&self.state);
        tauri::async_runtime::spawn(async move {
            loop {
                sleep(Duration::from_secs(REAP_INTERVAL_SECS)).await;
                let mut guard = state.lock().await;
                if let Some(running) = guard.as_mut() {
                    if running.last_used.elapsed() >= running.idle_timeout {
                        let _ = running.child.start_kill();
                        *guard = None;
                    }
                }
            }
        });
    }
}

fn spawn_server(config: &AiConfig, port: u16) -> Result<Child, AppError> {
    Command::new(&config.binary_path)
        .arg("--model")
        .arg(&config.model_path)
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("--ctx-size")
        .arg(CTX_SIZE.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| {
            AppError::internal(format!(
                "Failed to start llama-server at '{}': {error}",
                config.binary_path
            ))
        })
}

/// Grab an ephemeral local port by binding to :0 and releasing it; llama-server
/// re-binds it a moment later. A benign race, acceptable for a single local app.
fn free_port() -> Result<u16, AppError> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|error| AppError::internal(format!("Failed to allocate a local port: {error}")))?;
    let port = listener
        .local_addr()
        .map_err(|error| AppError::internal(format!("Failed to read local port: {error}")))?
        .port();
    Ok(port)
}

#[derive(Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Deserialize)]
struct ChatMessage {
    content: String,
}
