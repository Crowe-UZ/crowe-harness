//! Release metadata: HTTP client (host allow-list), channel → version,
//! signed manifest.

use std::collections::HashMap;
use std::sync::Once;
use std::time::Duration;

use reqwest::{redirect, StatusCode, Url};
use serde::Deserialize;

use super::verify::verify_manifest_signature;
use super::{codes, ierr, Cancel, InstallChannel};
use crate::error::{NativeError, NativeResult};

/// The only host the installer ever talks to.
pub const HOST: &str = "downloads.claude.ai";
pub const BASE_URL: &str = "https://downloads.claude.ai/claude-code-releases";

pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// Idle timeout between two reads of a response body.
pub const READ_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_REDIRECTS: usize = 5;

const MAX_VERSION_BYTES: usize = 64;
const MAX_MANIFEST_BYTES: usize = 256 * 1024;
const MAX_SIGNATURE_BYTES: usize = 16 * 1024;
/// Upper bound for the binary size taken from the manifest (sanity check).
pub const MAX_BINARY_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// `true` only for `https://downloads.claude.ai[:443]/...` without userinfo.
pub fn is_allowed_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some(HOST)
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
}

/// Redirects are followed only within the allow-listed host.
pub fn redirect_allowed(next: &Url, previous_hops: usize) -> bool {
    previous_hops < MAX_REDIRECTS && is_allowed_url(next)
}

/// HTTP client for the installer: rustls (ring) + OS trust store, HTTPS only,
/// host-pinned redirects, proxy from the environment / system settings,
/// no cookies, no compression (exact byte counts).
pub fn client() -> NativeResult<reqwest::Client> {
    static PROVIDER: Once = Once::new();
    PROVIDER.call_once(|| {
        // Err = another provider is already installed process-wide; fine.
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
    let policy = redirect::Policy::custom(|attempt| {
        if redirect_allowed(attempt.url(), attempt.previous().len()) {
            attempt.follow()
        } else {
            attempt.error("redirect to a host outside the allow-list")
        }
    });
    reqwest::Client::builder()
        .user_agent(concat!("CroweHarness/", env!("CARGO_PKG_VERSION")))
        .https_only(true)
        .redirect(policy)
        .referer(false)
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(READ_TIMEOUT)
        .build()
        .map_err(|_| ierr(codes::NETWORK, "could not initialize the network client"))
}

pub fn url(path: &str) -> NativeResult<Url> {
    let url = Url::parse(&format!("{BASE_URL}/{path}"))
        .map_err(|_| NativeError::internal("invalid release URL"))?;
    if !is_allowed_url(&url) {
        return Err(NativeError::internal("invalid release URL"));
    }
    Ok(url)
}

/// `^\d+\.\d+\.\d+$` (ASCII digits only), surrounding whitespace trimmed.
pub fn validate_version(text: &str) -> Option<String> {
    let v = text.trim();
    if v.is_empty() || v.len() > 32 {
        return None;
    }
    let parts: Vec<&str> = v.split('.').collect();
    let ok = parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.len() <= 9 && p.bytes().all(|b| b.is_ascii_digit()));
    ok.then(|| v.to_owned())
}

/// Error for a non-success HTTP status. HTML / 403 typically mean a region
/// block, captive portal or intercepting proxy.
pub fn status_error(status: u16, content_type: Option<&str>) -> NativeError {
    let html = content_type.is_some_and(|c| c.to_ascii_lowercase().contains("html"));
    if is_transient_status(status) {
        return ierr(
            codes::NETWORK,
            format!("the download server is temporarily unavailable (HTTP {status})"),
        );
    }
    let hint = if status == 403 || status == 451 || html {
        " — Claude Code may not be available in your region, or a proxy/firewall blocked the request"
    } else {
        ""
    };
    ierr(
        codes::UNEXPECTED_RESPONSE,
        format!("unexpected response from {HOST} (HTTP {status}){hint}"),
    )
}

pub fn is_transient_status(status: u16) -> bool {
    matches!(status, 408 | 429 | 500..=599)
}

/// Maps a transport error.
pub fn transport_error(e: &reqwest::Error) -> NativeError {
    if e.is_redirect() {
        return ierr(
            codes::UNEXPECTED_RESPONSE,
            format!("the request was redirected away from {HOST}"),
        );
    }
    if e.is_timeout() {
        return ierr(codes::NETWORK, format!("{HOST} did not respond in time"));
    }
    if e.is_connect() {
        return ierr(
            codes::NETWORK,
            format!(
                "could not connect to {HOST} — check your internet connection or proxy settings"
            ),
        );
    }
    ierr(
        codes::NETWORK,
        format!("network error while talking to {HOST}"),
    )
}

/// GETs a small resource into memory (capped), cancellable.
pub async fn fetch_small(
    client: &reqwest::Client,
    url: Url,
    max_bytes: usize,
    cancel: &Cancel,
) -> NativeResult<Vec<u8>> {
    let mut resp = cancel
        .run(client.get(url).send())
        .await?
        .map_err(|e| transport_error(&e))?;
    if !is_allowed_url(resp.url()) {
        return Err(ierr(codes::UNEXPECTED_RESPONSE, "unexpected final URL"));
    }
    if resp.status() != StatusCode::OK {
        let ct = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        return Err(status_error(resp.status().as_u16(), ct.as_deref()));
    }
    if resp.content_length().is_some_and(|l| l > max_bytes as u64) {
        return Err(ierr(codes::UNEXPECTED_RESPONSE, "response is too large"));
    }
    let mut body = Vec::new();
    while let Some(chunk) = cancel
        .run(resp.chunk())
        .await?
        .map_err(|e| transport_error(&e))?
    {
        if body.len() + chunk.len() > max_bytes {
            return Err(ierr(codes::UNEXPECTED_RESPONSE, "response is too large"));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// Release manifest (`{version}/manifest.json`). Unknown fields are allowed.
#[derive(Debug, Clone, Deserialize)]
pub struct Manifest {
    pub version: String,
    pub platforms: HashMap<String, PlatformEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct PlatformEntry {
    pub binary: String,
    pub checksum: String,
    pub size: u64,
}

/// Parses an already signature-verified manifest and picks `platform`.
pub fn parse_manifest(bytes: &[u8], version: &str, platform: &str) -> NativeResult<PlatformEntry> {
    let bad = |what: &str| {
        ierr(
            codes::UNEXPECTED_RESPONSE,
            format!("the release manifest is not usable ({what})"),
        )
    };
    let manifest: Manifest = serde_json::from_slice(bytes).map_err(|_| bad("malformed"))?;
    if manifest.version != version {
        return Err(bad("version mismatch"));
    }
    let entry = manifest.platforms.get(platform).cloned().ok_or_else(|| {
        ierr(
            codes::UNSUPPORTED_PLATFORM,
            format!("Claude Code {version} is not available for {platform}"),
        )
    })?;
    // `binary` becomes part of the download URL and of nothing else; it must
    // be exactly the expected file name.
    if entry.binary != super::platform::binary_name(platform) {
        return Err(bad("unexpected binary name"));
    }
    if super::verify::parse_sha256_hex(&entry.checksum).is_none() {
        return Err(bad("invalid checksum"));
    }
    if entry.size == 0 || entry.size > MAX_BINARY_BYTES {
        return Err(bad("invalid size"));
    }
    Ok(entry)
}

/// A resolved, signature-verified release for one platform.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Release {
    pub version: String,
    pub platform: &'static str,
    pub entry: PlatformEntry,
}

impl Release {
    pub fn binary_url(&self) -> NativeResult<Url> {
        url(&format!(
            "{}/{}/{}",
            self.version, self.platform, self.entry.binary
        ))
    }
}

/// channel → version → signed manifest → platform entry.
/// `on_verifying` is called between version resolution and manifest checks.
pub async fn resolve(
    client: &reqwest::Client,
    channel: InstallChannel,
    platform: &'static str,
    cancel: &Cancel,
    on_verifying: impl FnOnce(),
) -> NativeResult<Release> {
    let text = fetch_small(client, url(channel.as_str())?, MAX_VERSION_BYTES, cancel).await?;
    let version = std::str::from_utf8(&text)
        .ok()
        .and_then(validate_version)
        .ok_or_else(|| {
            ierr(
                codes::UNEXPECTED_RESPONSE,
                format!(
                    "unexpected response from {HOST} — Claude Code may not be available in your region, or a proxy/firewall intercepted the request"
                ),
            )
        })?;
    on_verifying();
    let manifest_url = url(&format!("{version}/manifest.json"))?;
    let sig_url = url(&format!("{version}/manifest.json.sig"))?;
    let (manifest, sig) = tokio::try_join!(
        fetch_small(client, manifest_url, MAX_MANIFEST_BYTES, cancel),
        fetch_small(client, sig_url, MAX_SIGNATURE_BYTES, cancel),
    )?;
    verify_manifest_signature(&manifest, &sig)?;
    let entry = parse_manifest(&manifest, &version, platform)?;
    Ok(Release {
        version,
        platform,
        entry,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const MANIFEST: &[u8] = include_bytes!("../../tests/fixtures/manifest-2.1.285.json");

    #[test]
    fn version_validation() {
        assert_eq!(validate_version("2.1.285\n").as_deref(), Some("2.1.285"));
        assert_eq!(validate_version(" 10.0.1 ").as_deref(), Some("10.0.1"));
        for bad in [
            "",
            "2.1",
            "2.1.285.1",
            "2.1.x",
            "v2.1.285",
            "2.1.285-beta",
            "2..1",
            "<html>",
            "2.1.\u{0663}", // Arabic-Indic digit: not ASCII
            "1234567890.1.1",
            "2.1.285 2.1.286",
        ] {
            assert_eq!(validate_version(bad), None, "{bad:?}");
        }
        let long = "1".repeat(40);
        assert_eq!(validate_version(&long), None);
    }

    #[test]
    fn host_allow_list() {
        let ok = |s: &str| is_allowed_url(&Url::parse(s).expect("url"));
        assert!(ok(
            "https://downloads.claude.ai/claude-code-releases/stable"
        ));
        assert!(ok("https://downloads.claude.ai:443/x")); // default port normalizes away
        assert!(!ok("http://downloads.claude.ai/x"));
        assert!(!ok("https://downloads.claude.ai:8443/x"));
        assert!(!ok("https://evil.example/x"));
        assert!(!ok("https://downloads.claude.ai.evil.example/x"));
        assert!(!ok("https://claude.ai/x"));
        assert!(!ok("https://user:pw@downloads.claude.ai/x"));
        assert!(!ok("https://user@downloads.claude.ai/x"));
        assert!(!ok("file:///etc/passwd"));
    }

    #[test]
    fn redirect_policy() {
        let u = |s: &str| Url::parse(s).expect("url");
        assert!(redirect_allowed(&u("https://downloads.claude.ai/a"), 0));
        assert!(!redirect_allowed(&u("https://storage.example.com/a"), 0));
        assert!(!redirect_allowed(&u("http://downloads.claude.ai/a"), 0));
        assert!(!redirect_allowed(
            &u("https://downloads.claude.ai/a"),
            MAX_REDIRECTS
        ));
    }

    #[test]
    fn client_builds() {
        client().expect("client");
    }

    #[test]
    fn release_urls() {
        assert_eq!(
            url("stable").expect("url").as_str(),
            "https://downloads.claude.ai/claude-code-releases/stable"
        );
        let r = Release {
            version: "2.1.285".into(),
            platform: "win32-x64",
            entry: parse_manifest(MANIFEST, "2.1.285", "win32-x64").expect("entry"),
        };
        assert_eq!(
            r.binary_url().expect("url").as_str(),
            "https://downloads.claude.ai/claude-code-releases/2.1.285/win32-x64/claude.exe"
        );
    }

    #[test]
    fn manifest_parsing() {
        let e = parse_manifest(MANIFEST, "2.1.285", "win32-x64").expect("win");
        assert_eq!(e.binary, "claude.exe");
        assert_eq!(e.size, 243_751_072);
        assert_eq!(
            e.checksum,
            "121fc8151ed40bd9c144d68aa1cea23427803628ffab65e23da1cceda155697e"
        );
        for p in super::super::platform::PLATFORMS {
            parse_manifest(MANIFEST, "2.1.285", p).expect(p);
        }
        // version mismatch
        let err = parse_manifest(MANIFEST, "2.1.286", "win32-x64").expect_err("mismatch");
        assert_eq!(err.code, codes::UNEXPECTED_RESPONSE);
        // missing platform
        let err = parse_manifest(MANIFEST, "2.1.285", "win32-x86").expect_err("missing");
        assert_eq!(err.code, codes::UNSUPPORTED_PLATFORM);
        // malformed
        let err = parse_manifest(b"<html>", "2.1.285", "win32-x64").expect_err("html");
        assert_eq!(err.code, codes::UNEXPECTED_RESPONSE);
    }

    #[test]
    fn manifest_unknown_fields_and_bad_entries() {
        let m = |binary: &str, checksum: &str, size: u64| {
            serde_json::json!({
                "version": "1.2.3",
                "newField": {"x": 1},
                "platforms": {"linux-x64": {"binary": binary, "checksum": checksum, "size": size, "extra": true}}
            })
            .to_string()
        };
        let sum = "a".repeat(64);
        parse_manifest(m("claude", &sum, 10).as_bytes(), "1.2.3", "linux-x64")
            .expect("unknown fields ok");
        for (binary, checksum, size) in [
            ("../claude", sum.as_str(), 10),
            ("claude.exe", sum.as_str(), 10),
            ("claude", "abc", 10),
            ("claude", sum.as_str(), 0),
            ("claude", sum.as_str(), MAX_BINARY_BYTES + 1),
        ] {
            let err = parse_manifest(m(binary, checksum, size).as_bytes(), "1.2.3", "linux-x64")
                .expect_err(binary);
            assert_eq!(err.code, codes::UNEXPECTED_RESPONSE);
        }
    }

    #[test]
    fn status_mapping() {
        assert_eq!(status_error(403, None).code, codes::UNEXPECTED_RESPONSE);
        assert!(status_error(403, None).message.contains("region"));
        assert!(status_error(200, Some("text/html; charset=utf-8"))
            .message
            .contains("proxy"));
        assert_eq!(status_error(404, None).code, codes::UNEXPECTED_RESPONSE);
        assert!(!status_error(404, None).message.contains("region"));
        assert_eq!(status_error(503, None).code, codes::NETWORK);
        assert_eq!(status_error(429, None).code, codes::NETWORK);
        assert!(is_transient_status(500) && is_transient_status(408));
        assert!(!is_transient_status(404) && !is_transient_status(416));
    }
}
