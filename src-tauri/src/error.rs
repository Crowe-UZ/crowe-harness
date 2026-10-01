//! Typed error returned by every IPC command (`{ code, message }`).
//!
//! Messages are short and never contain internal paths, environment values or
//! transcript content (SPEC §D, security rule 13).

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct NativeError {
    pub code: String,
    pub message: String,
}

pub type NativeResult<T> = Result<T, NativeError>;

impl NativeError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_owned(),
            message: message.into(),
        }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new("invalid_argument", message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new("not_found", message)
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new("forbidden", message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new("internal", message)
    }

    pub fn claude_not_found() -> Self {
        Self::new(
            "claude_not_found",
            "Claude Code was not found. Install Claude Code and try again.",
        )
    }

    /// I/O failure. `std::io::Error`'s `Display` carries the OS message only
    /// (no path), so it is safe to forward.
    pub fn io(context: &str, error: &std::io::Error) -> Self {
        if error.kind() == std::io::ErrorKind::NotFound {
            return Self::not_found(format!("{context}: not found"));
        }
        Self::new("io", format!("{context}: {error}"))
    }
}

impl std::fmt::Display for NativeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for NativeError {}

impl From<tauri::Error> for NativeError {
    fn from(error: tauri::Error) -> Self {
        Self::internal(format!("runtime error: {error}"))
    }
}

/// Joins a blocking task, mapping a panic/cancellation to a typed error.
pub async fn join_blocking<T, F>(f: F) -> NativeResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> NativeResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|_| NativeError::internal("background task failed"))?
}
