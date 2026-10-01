//! `claude mcp list` output parsing (lenient).
//!
//! Lines look like `name: <command or url> - ✓ Connected`,
//! `... - ✗ Failed to connect`, `... - ! Needs authentication`. Targets are
//! redacted (URL userinfo/query values, secret-looking CLI arguments) before
//! they reach the webview.

use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum McpStatus {
    Connected,
    Failed,
    NeedsAuth,
    Unknown,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInfo {
    pub name: String,
    pub target: String,
    pub status: McpStatus,
}

const STATUS_MARKS: &[&str] = &["✓", "✔", "✗", "✘", "×", "!", "⚠", "⏸", "…", "?"];
const STATUS_WORDS: &[&str] = &[
    "connected",
    "failed",
    "needs",
    "pending",
    "disabled",
    "error",
];

fn looks_like_status(rest: &str) -> bool {
    let r = rest.trim_start();
    let lower = r.to_lowercase();
    STATUS_MARKS.iter().any(|m| r.starts_with(m))
        || STATUS_WORDS.iter().any(|w| lower.starts_with(w))
}

fn status_of(text: &str) -> McpStatus {
    let t = text.trim_start().to_lowercase();
    if t.starts_with('!') || t.contains("needs auth") || t.contains("requires auth") {
        McpStatus::NeedsAuth
    } else if t.contains("fail") || t.contains('✗') || t.contains('✘') || t.contains("error") {
        McpStatus::Failed
    } else if t.contains("connected") || t.contains('✓') || t.contains('✔') {
        McpStatus::Connected
    } else {
        McpStatus::Unknown
    }
}

pub fn parse_mcp_list(output: &str) -> Vec<McpServerInfo> {
    output.lines().filter_map(parse_line).collect()
}

fn parse_line(line: &str) -> Option<McpServerInfo> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    // First " - " that is followed by a status marker separates the status.
    let mut split = None;
    let mut from = 0;
    while let Some(pos) = line[from..].find(" - ") {
        let at = from + pos;
        if looks_like_status(&line[at + 3..]) {
            split = Some(at);
            break;
        }
        from = at + 3;
    }
    let at = split?;
    let (head, status_text) = (&line[..at], &line[at + 3..]);
    let (name, target) = head.split_once(": ")?;
    let name = name.trim();
    if name.is_empty() || name.len() > 200 {
        return None;
    }
    Some(McpServerInfo {
        name: name.to_owned(),
        target: redact_target(target.trim()),
        status: status_of(status_text),
    })
}

fn is_secretish(s: &str) -> bool {
    let l = s.to_lowercase();
    [
        "key",
        "token",
        "secret",
        "password",
        "passwd",
        "auth",
        "bearer",
        "credential",
    ]
    .iter()
    .any(|w| l.contains(w))
}

/// Removes credentials from an MCP target (URL or command line).
pub fn redact_target(target: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut redact_next = false;
    for token in target.split_whitespace() {
        if redact_next {
            out.push("***".into());
            redact_next = false;
            continue;
        }
        if token.contains("://") {
            out.push(redact_url(token));
        } else if let Some((k, _)) = token.split_once('=') {
            if is_secretish(k) {
                out.push(format!("{k}=***"));
            } else {
                out.push(token.to_owned());
            }
        } else {
            if token.starts_with('-') && is_secretish(token) {
                redact_next = true;
            }
            out.push(token.to_owned());
        }
    }
    out.join(" ")
}

fn redact_url(url: &str) -> String {
    let (scheme, rest) = match url.split_once("://") {
        Some(p) => p,
        None => return url.to_owned(),
    };
    let (authority_path, query) = match rest.split_once('?') {
        Some((a, _)) => (a, true),
        None => (rest, false),
    };
    let (authority, path) = match authority_path.find('/') {
        Some(i) => (&authority_path[..i], &authority_path[i..]),
        None => (authority_path, ""),
    };
    let host = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
    let userinfo = if authority.contains('@') { "***@" } else { "" };
    let q = if query { "?***" } else { "" };
    format!("{scheme}://{userinfo}{host}{path}{q}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_typical_output() {
        let out = "Checking MCP server health…\n\n\
            syncra: node C:/x/dist/index.js - ✘ Failed to connect — CONNECTION_CLOSED: Connection closed\n\
            github: https://api.example.com/mcp (HTTP) - ✓ Connected\n\
            linear: https://mcp.linear.app/sse (SSE) - ! Needs authentication\n\
            my-tool: npx -y some-pkg - with - dashes - ✗ Failed to connect\n\
            local: uvx thing - ⏸ Pending approval\n\
            No MCP servers configured. Use `claude mcp add` to add a server.\n";
        let list = parse_mcp_list(out);
        let got: Vec<(&str, McpStatus)> =
            list.iter().map(|s| (s.name.as_str(), s.status)).collect();
        assert_eq!(
            got,
            vec![
                ("syncra", McpStatus::Failed),
                ("github", McpStatus::Connected),
                ("linear", McpStatus::NeedsAuth),
                ("my-tool", McpStatus::Failed),
                ("local", McpStatus::Unknown),
            ]
        );
        assert_eq!(list[0].target, "node C:/x/dist/index.js");
        assert_eq!(list[3].target, "npx -y some-pkg - with - dashes");
        assert_eq!(list[1].target, "https://api.example.com/mcp (HTTP)");
    }

    #[test]
    fn redacts_secrets() {
        assert_eq!(
            redact_target("https://user:pw@host.io/mcp?token=abc&x=1 (HTTP)"),
            "https://***@host.io/mcp?*** (HTTP)"
        );
        assert_eq!(
            redact_target("npx srv --api-key sk-123 API_TOKEN=xyz --verbose"),
            "npx srv --api-key *** API_TOKEN=*** --verbose"
        );
        assert_eq!(redact_target("node index.js"), "node index.js");
    }
}
