//! Verification steps:
//!
//! 1. the detached OpenPGP signature over the exact manifest bytes, with the
//!    **embedded** Anthropic release key, pinned to its fingerprint;
//! 2. the SHA-256 of the downloaded binary (constant-time compare);
//! 3. the OS publisher signature (defense in depth): Authenticode on
//!    Windows, `codesign` on macOS; Linux binaries are unsigned upstream.

use std::path::Path;
use std::sync::OnceLock;

use pgp::composed::{Deserializable, DetachedSignature, SignedPublicKey};
use pgp::packet::SignatureType;
use pgp::types::KeyDetails;
use subtle::ConstantTimeEq;

use super::{codes, ierr};
use crate::error::{NativeError, NativeResult};

/// "Anthropic Claude Code Release Signing <security@anthropic.com>",
/// from https://downloads.claude.ai/keys/claude-code.asc.
const RELEASE_KEY_ASC: &str = include_str!("../../keys/claude-code-release.asc");

/// Pinned primary-key fingerprint (v4, 20 bytes). Any other key is rejected,
/// even if the embedded file were swapped.
pub const RELEASE_KEY_FINGERPRINT: &str = "31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE";

/// Signer common name of the Windows binaries.
pub const WINDOWS_PUBLISHER: &str = "Anthropic, PBC";
/// Required prefix of the macOS signing authority.
pub const MACOS_AUTHORITY_PREFIX: &str = "Developer ID Application: Anthropic";

fn sig_invalid(detail: &str) -> NativeError {
    ierr(
        codes::SIGNATURE_INVALID,
        format!("the release manifest signature is not valid ({detail})"),
    )
}

fn hex_upper(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02X}")).collect()
}

/// The embedded release key, parsed once and checked against the pin.
fn release_key() -> NativeResult<&'static SignedPublicKey> {
    static KEY: OnceLock<Result<SignedPublicKey, String>> = OnceLock::new();
    KEY.get_or_init(|| {
        let (key, _) = SignedPublicKey::from_string(RELEASE_KEY_ASC)
            .map_err(|_| "embedded key unreadable".to_owned())?;
        if hex_upper(key.fingerprint().as_bytes()) != RELEASE_KEY_FINGERPRINT {
            return Err("embedded key does not match the pinned fingerprint".into());
        }
        key.verify_bindings()
            .map_err(|_| "embedded key self-signature invalid".to_owned())?;
        Ok(key)
    })
    .as_ref()
    .map_err(|e| sig_invalid(e))
}

/// Verifies the detached signature `sig` (binary or ASCII-armored) over the
/// exact bytes of `manifest`.
pub fn verify_manifest_signature(manifest: &[u8], sig: &[u8]) -> NativeResult<()> {
    let key = release_key()?;
    let detached = if sig.starts_with(b"-----BEGIN PGP SIGNATURE-----") {
        let text = std::str::from_utf8(sig).map_err(|_| sig_invalid("malformed signature"))?;
        DetachedSignature::from_string(text).map(|(s, _)| s)
    } else {
        DetachedSignature::from_bytes(sig)
    }
    .map_err(|_| sig_invalid("malformed signature"))?;
    let signature = &detached.signature;

    if !matches!(
        signature.typ(),
        Some(SignatureType::Binary | SignatureType::Text)
    ) {
        return Err(sig_invalid("not a document signature"));
    }
    // An issuer fingerprint, when present, must be the pinned key (the
    // verification below additionally matches the issuer key id).
    let pinned_fp = key.fingerprint();
    if signature
        .issuer_fingerprint()
        .iter()
        .any(|fp| fp.as_bytes() != pinned_fp.as_bytes())
    {
        return Err(sig_invalid("signed by an unknown key"));
    }
    detached
        .verify(key, manifest)
        .map_err(|_| sig_invalid("verification failed"))
}

/// Decodes a 64-character SHA-256 hex string.
pub fn parse_sha256_hex(hex: &str) -> Option<[u8; 32]> {
    let bytes = hex.as_bytes();
    if bytes.len() != 64 {
        return None;
    }
    let mut out = [0u8; 32];
    let (pairs, _) = bytes.as_chunks::<2>();
    for (slot, [h, l]) in out.iter_mut().zip(pairs) {
        let hi = (*h as char).to_digit(16)?;
        let lo = (*l as char).to_digit(16)?;
        *slot = u8::try_from(hi * 16 + lo).ok()?;
    }
    Some(out)
}

/// Constant-time comparison of a computed digest with the manifest checksum.
pub fn checksum_matches(actual: &[u8; 32], expected_hex: &str) -> bool {
    parse_sha256_hex(expected_hex).is_some_and(|expected| bool::from(actual.ct_eq(&expected)))
}

pub fn ensure_checksum(actual: &[u8; 32], expected_hex: &str) -> NativeResult<()> {
    if checksum_matches(actual, expected_hex) {
        Ok(())
    } else {
        Err(ierr(
            codes::CHECKSUM_MISMATCH,
            "the downloaded file does not match the signed checksum",
        ))
    }
}

/// Result of the OS publisher check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Publisher {
    /// Windows Authenticode signer common name.
    Authenticode { signer: String },
    /// macOS Developer ID authority and Team ID.
    CodeSign { authority: String, team_id: String },
    /// Linux: binaries are unsigned upstream; the signed manifest checksum
    /// is the integrity check.
    NotApplicable,
}

fn untrusted(detail: impl std::fmt::Display) -> NativeError {
    ierr(
        codes::PUBLISHER_UNTRUSTED,
        format!("the downloaded file is not signed by Anthropic ({detail})"),
    )
}

/// Exact signer check for Windows.
pub fn check_windows_signer(signer: &str) -> NativeResult<()> {
    if signer == WINDOWS_PUBLISHER {
        Ok(())
    } else {
        Err(untrusted("unexpected signer"))
    }
}

/// Parses `codesign -dv --verbose=4` output (printed on stderr): the leaf
/// `Authority=` line must be a Developer ID Application certificate of
/// Anthropic, and its `(TEAMID)` suffix must equal `TeamIdentifier=`.
pub fn parse_codesign_details(output: &str) -> NativeResult<(String, String)> {
    let mut authority = None;
    let mut team = None;
    for line in output.lines() {
        let line = line.trim();
        if let Some(a) = line.strip_prefix("Authority=") {
            authority.get_or_insert_with(|| a.to_owned()); // first = leaf
        } else if let Some(t) = line.strip_prefix("TeamIdentifier=") {
            team = Some(t.to_owned());
        }
    }
    let authority = authority.ok_or_else(|| untrusted("no signing authority"))?;
    let team = team
        .filter(|t| !t.is_empty() && t != "not set")
        .ok_or_else(|| untrusted("no team identifier"))?;
    if !authority.starts_with(MACOS_AUTHORITY_PREFIX) {
        return Err(untrusted("unexpected signing authority"));
    }
    if !authority.ends_with(&format!("({team})")) {
        return Err(untrusted("team identifier mismatch"));
    }
    Ok((authority, team))
}

/// OS publisher verification of the downloaded binary (blocking).
pub fn verify_publisher(file: &Path) -> NativeResult<Publisher> {
    #[cfg(windows)]
    {
        let signer = super::sys_windows::authenticode_signer(file).map_err(untrusted)?;
        check_windows_signer(&signer)?;
        Ok(Publisher::Authenticode { signer })
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::{Command, Stdio};
        let codesign = |args: &[&str]| {
            Command::new("/usr/bin/codesign")
                .args(args)
                .arg(file)
                .stdin(Stdio::null())
                .output()
                .map_err(|_| untrusted("codesign unavailable"))
        };
        let strict = codesign(&["--verify", "--strict", "--deep"])?;
        if !strict.status.success() {
            return Err(untrusted("invalid code signature"));
        }
        let details = codesign(&["-dv", "--verbose=4"])?;
        let text = format!(
            "{}\n{}",
            String::from_utf8_lossy(&details.stderr),
            String::from_utf8_lossy(&details.stdout)
        );
        let (authority, team_id) = parse_codesign_details(&text)?;
        // Gatekeeper assessment is informational only: `spctl` rejects bare
        // command-line binaries that are not app bundles.
        if let Ok(o) = Command::new("/usr/sbin/spctl")
            .args(["-a", "-t", "exec"])
            .arg(file)
            .stdin(Stdio::null())
            .output()
        {
            eprintln!(
                "[installer] spctl assessment exit={:?} (informational)",
                o.status.code()
            );
        }
        Ok(Publisher::CodeSign { authority, team_id })
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = file;
        Ok(Publisher::NotApplicable)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MANIFEST: &[u8] = include_bytes!("../../tests/fixtures/manifest-2.1.285.json");
    const SIG: &[u8] = include_bytes!("../../tests/fixtures/manifest-2.1.285.json.sig");

    #[test]
    fn embedded_key_is_the_pinned_key() {
        let key = release_key().expect("key");
        assert_eq!(
            hex_upper(key.fingerprint().as_bytes()),
            RELEASE_KEY_FINGERPRINT
        );
    }

    #[test]
    fn real_manifest_signature_verifies() {
        verify_manifest_signature(MANIFEST, SIG).expect("valid signature");
    }

    #[test]
    fn tampered_manifest_is_rejected() {
        let mut tampered = MANIFEST.to_vec();
        // Change one byte inside a checksum.
        let pos = tampered
            .windows(8)
            .position(|w| w == b"checksum")
            .expect("checksum field")
            + 13;
        tampered[pos] = if tampered[pos] == b'0' { b'1' } else { b'0' };
        let err = verify_manifest_signature(&tampered, SIG).expect_err("tampered");
        assert_eq!(err.code, codes::SIGNATURE_INVALID);

        // Appending a byte also breaks it.
        let mut longer = MANIFEST.to_vec();
        longer.push(b'\n');
        assert!(verify_manifest_signature(&longer, SIG).is_err());
    }

    #[test]
    fn tampered_or_garbage_signature_is_rejected() {
        // The published `.sig` is ASCII-armored; the binary (dearmored) form
        // is accepted as well.
        assert!(SIG.starts_with(b"-----BEGIN PGP SIGNATURE-----"));
        let text = std::str::from_utf8(SIG).expect("armored");
        let (parsed, _) = DetachedSignature::from_string(text).expect("parse");
        let binary = pgp::ser::Serialize::to_bytes(&parsed).expect("binary");
        verify_manifest_signature(MANIFEST, &binary).expect("binary form verifies");

        // One flipped bit in the RSA signature value.
        let mut bad = binary.clone();
        let last = bad.len() - 1;
        bad[last] ^= 0x01;
        let err = verify_manifest_signature(MANIFEST, &bad).expect_err("bad sig");
        assert_eq!(err.code, codes::SIGNATURE_INVALID);

        // One changed character inside the armored body.
        let mut armored = SIG.to_vec();
        let pos = armored.len() / 2;
        armored[pos] = if armored[pos] == b'A' { b'B' } else { b'A' };
        let err = verify_manifest_signature(MANIFEST, &armored).expect_err("bad armor");
        assert_eq!(err.code, codes::SIGNATURE_INVALID);
        for bad in [
            &b""[..],
            b"not a signature",
            b"-----BEGIN PGP SIGNATURE-----\nxx",
        ] {
            let err = verify_manifest_signature(MANIFEST, bad).expect_err("garbage");
            assert_eq!(err.code, codes::SIGNATURE_INVALID);
        }
    }

    #[test]
    fn sha256_hex_parsing() {
        let h = "121fc8151ed40bd9c144d68aa1cea23427803628ffab65e23da1cceda155697e";
        let b = parse_sha256_hex(h).expect("hex");
        assert_eq!(b[0], 0x12);
        assert_eq!(b[31], 0x7e);
        assert_eq!(parse_sha256_hex(&h.to_uppercase()), Some(b));
        assert!(parse_sha256_hex(&h[..62]).is_none());
        assert!(parse_sha256_hex(&format!("{}zz", &h[..62])).is_none());
        assert!(parse_sha256_hex(&format!("{}\u{e9}", &h[..62])).is_none());
    }

    #[test]
    fn checksum_compare() {
        use sha2::{Digest, Sha256};
        let digest: [u8; 32] = Sha256::digest(b"hello").into();
        let good = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
        assert!(checksum_matches(&digest, good));
        ensure_checksum(&digest, good).expect("match");
        let bad = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9825";
        let err = ensure_checksum(&digest, bad).expect_err("mismatch");
        assert_eq!(err.code, codes::CHECKSUM_MISMATCH);
        assert!(!checksum_matches(&digest, "nothex"));
    }

    #[test]
    fn windows_signer_must_be_exact() {
        check_windows_signer("Anthropic, PBC").expect("ok");
        for bad in ["Anthropic PBC", "anthropic, pbc", "Anthropic, PBC Evil", ""] {
            let err = check_windows_signer(bad).expect_err(bad);
            assert_eq!(err.code, codes::PUBLISHER_UNTRUSTED);
        }
    }

    #[test]
    fn codesign_details() {
        let ok = "Executable=/tmp/claude\nIdentifier=claude\nAuthority=Developer ID Application: Anthropic PBC (ABCDE12345)\nAuthority=Developer ID Certification Authority\nAuthority=Apple Root CA\nTeamIdentifier=ABCDE12345\n";
        let (authority, team) = parse_codesign_details(ok).expect("ok");
        assert_eq!(team, "ABCDE12345");
        assert!(authority.starts_with(MACOS_AUTHORITY_PREFIX));

        let other = ok.replace("Anthropic PBC", "Mallory Inc");
        assert!(parse_codesign_details(&other).is_err());
        let mismatch = ok.replace("TeamIdentifier=ABCDE12345", "TeamIdentifier=ZZZZZ99999");
        assert!(parse_codesign_details(&mismatch).is_err());
        let unsigned = "Executable=/tmp/claude\nSignature=adhoc\nTeamIdentifier=not set\n";
        let err = parse_codesign_details(unsigned).expect_err("adhoc");
        assert_eq!(err.code, codes::PUBLISHER_UNTRUSTED);
    }
}
