//! `claude auth status` parsing and the `ClaudeStatus` payload.

use std::path::PathBuf;

use serde::Serialize;
use serde_json::Value;

use super::locate::InstallSource;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeInstall {
    pub path: String,
    pub version: Option<String>,
    pub source: InstallSource,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeStatus {
    pub install: Option<ClaudeInstall>,
    pub logged_in: bool,
    pub auth_method: Option<String>,
    pub subscription: bool,
    pub subscription_type: Option<String>,
    pub email: Option<String>,
    pub org_name: Option<String>,
}

/// Parsed `claude auth status --json`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AuthInfo {
    pub logged_in: bool,
    pub auth_method: Option<String>,
    pub subscription: bool,
    pub subscription_type: Option<String>,
    pub email: Option<String>,
    pub org_name: Option<String>,
    pub projects_dir: Option<PathBuf>,
    pub config_dir: Option<PathBuf>,
}

/// Parses the JSON printed by `claude auth status` (exit code 1 when signed
/// out is expected, so callers parse stdout regardless of the exit code).
/// Tolerates log lines around the JSON object.
pub fn parse_auth_status(stdout: &str) -> Option<AuthInfo> {
    let start = stdout.find('{')?;
    let end = stdout.rfind('}')?;
    if end < start {
        return None;
    }
    let v: Value = serde_json::from_str(&stdout[start..=end]).ok()?;
    if !v.is_object() {
        return None;
    }
    let logged_in = v.get("loggedIn").and_then(Value::as_bool).unwrap_or(false);
    let auth_method = pick_str(&v, &["authMethod", "authenticationMethod"]);
    let subscription_type = pick_str(&v, &["subscriptionType", "subscription", "plan"]);
    let subscription =
        logged_in && is_subscription(auth_method.as_deref(), subscription_type.as_deref());
    Some(AuthInfo {
        logged_in,
        subscription,
        email: pick_str(&v, &["email", "emailAddress", "accountEmail"]),
        org_name: pick_str(&v, &["orgName", "organizationName", "orgDisplayName"]),
        projects_dir: pick_str(&v, &["projectsDirectory"]).map(PathBuf::from),
        config_dir: pick_str(&v, &["configDirectory"]).map(PathBuf::from),
        auth_method,
        subscription_type,
    })
}

/// First non-empty string among `keys`, at the top level or inside a nested
/// `account` / `oauthAccount` / `organization` object.
fn pick_str(v: &Value, keys: &[&str]) -> Option<String> {
    let scopes = [
        Some(v),
        v.get("account"),
        v.get("oauthAccount"),
        v.get("organization"),
    ];
    scopes.into_iter().flatten().find_map(|scope| {
        keys.iter().find_map(|k| {
            scope
                .get(*k)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
        })
    })
}

/// `true` only for a Claude subscription sign-in (claude.ai OAuth), never
/// for Console / API-key / cloud-provider auth.
pub fn is_subscription(method: Option<&str>, subscription_type: Option<&str>) -> bool {
    let m: String = method
        .unwrap_or_default()
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .collect::<String>()
        .to_ascii_lowercase();
    let not_subscription = ["console", "apikey", "bedrock", "vertex", "foundry", "none"];
    if not_subscription.iter().any(|n| m.contains(n)) {
        return false;
    }
    if ["claudeai", "subscription", "oauth"]
        .iter()
        .any(|s| m.contains(s))
    {
        return true;
    }
    subscription_type.is_some_and(|t| !t.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOGGED_OUT: &str = r#"{
  "loggedIn": false,
  "authMethod": "none",
  "apiProvider": "firstParty",
  "analyticsDisabled": false,
  "projectsDirectory": "C:\\Users\\someone\\.claude\\projects",
  "configDirectory": "C:\\Users\\someone\\.claude"
}"#;

    #[test]
    fn logged_out() {
        let a = parse_auth_status(LOGGED_OUT).expect("parsed");
        assert!(!a.logged_in);
        assert!(!a.subscription);
        assert_eq!(a.auth_method.as_deref(), Some("none"));
        assert_eq!(a.email, None);
        assert_eq!(
            a.config_dir,
            Some(PathBuf::from("C:\\Users\\someone\\.claude"))
        );
        assert_eq!(
            a.projects_dir,
            Some(PathBuf::from("C:\\Users\\someone\\.claude\\projects"))
        );
    }

    #[test]
    fn logged_in_subscription() {
        let out = r#"some warning line
{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty",
 "email":"dev@example.com","orgName":"Example Org","subscriptionType":"max"}"#;
        let a = parse_auth_status(out).expect("parsed");
        assert!(a.logged_in && a.subscription);
        assert_eq!(a.subscription_type.as_deref(), Some("max"));
        assert_eq!(a.email.as_deref(), Some("dev@example.com"));
        assert_eq!(a.org_name.as_deref(), Some("Example Org"));
    }

    #[test]
    fn nested_account_fields() {
        let out = r#"{"loggedIn":true,"authMethod":"oauth_token",
 "account":{"emailAddress":"a@b.c","organizationName":"Org"}}"#;
        let a = parse_auth_status(out).expect("parsed");
        assert!(a.subscription);
        assert_eq!(a.email.as_deref(), Some("a@b.c"));
        assert_eq!(a.org_name.as_deref(), Some("Org"));
    }

    #[test]
    fn console_and_api_key_are_not_subscription() {
        for method in [
            "console",
            "api_key",
            "apiKey",
            "ANTHROPIC_API_KEY",
            "bedrock",
        ] {
            let out = format!(
                r#"{{"loggedIn":true,"authMethod":"{method}","email":"x@y.z","subscriptionType":"pro"}}"#
            );
            let a = parse_auth_status(&out).expect("parsed");
            assert!(a.logged_in);
            assert!(!a.subscription, "{method}");
        }
        // Unknown method but a subscription plan => subscription.
        assert!(is_subscription(Some("something"), Some("team")));
        assert!(!is_subscription(Some("something"), None));
        assert!(!is_subscription(None, Some("  ")));
    }

    #[test]
    fn garbage_is_none() {
        assert!(parse_auth_status("").is_none());
        assert!(parse_auth_status("not json").is_none());
        assert!(parse_auth_status("} {").is_none());
    }
}
