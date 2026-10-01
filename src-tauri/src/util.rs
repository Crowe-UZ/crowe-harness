//! Small shared helpers: string truncation, id validation, time formatting
//! and path normalization.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Truncates `s` to at most `max_bytes` bytes on a char boundary.
/// Returns the (possibly shortened) string and whether it was truncated.
pub fn truncate_bytes(s: &str, max_bytes: usize) -> (&str, bool) {
    if s.len() <= max_bytes {
        return (s, false);
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    (&s[..end], true)
}

/// Truncates to `max_bytes` and appends a visible marker when shortened.
pub fn truncate_marked(s: &str, max_bytes: usize) -> String {
    match truncate_bytes(s, max_bytes) {
        (head, false) => head.to_owned(),
        (head, true) => format!("{head}\u{2026} [truncated]"),
    }
}

/// Truncates to `max_chars` characters (with an ellipsis when shortened),
/// collapsing all whitespace runs into single spaces.
pub fn one_line(s: &str, max_chars: usize) -> String {
    let collapsed = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= max_chars {
        return collapsed;
    }
    let mut out: String = collapsed
        .chars()
        .take(max_chars.saturating_sub(1))
        .collect();
    out.push('\u{2026}');
    out
}

/// `8-4-4-4-12` hexadecimal UUID (any version, either case).
pub fn is_uuid(s: &str) -> bool {
    let groups = [8usize, 4, 4, 4, 12];
    let parts: Vec<&str> = s.split('-').collect();
    parts.len() == groups.len()
        && parts
            .iter()
            .zip(groups)
            .all(|(p, n)| p.len() == n && p.bytes().all(|b| b.is_ascii_hexdigit()))
}

/// Conservative identifier: `[A-Za-z0-9_-]{1,128}`.
pub fn is_safe_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Formats a time like JavaScript's `Date#toISOString` (UTC, milliseconds).
pub fn iso_time(t: SystemTime) -> String {
    let (secs, millis) = match t.duration_since(UNIX_EPOCH) {
        Ok(d) => (d.as_secs() as i64, d.subsec_millis()),
        Err(_) => (0, 0),
    };
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Days since 1970-01-01 to (year, month, day). Howard Hinnant's algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Strips the Windows verbatim prefix (`\\?\C:\x` -> `C:\x`) for display and
/// for handing to child processes. UNC verbatim paths are left untouched.
pub fn display_path(p: &Path) -> String {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => rest.to_owned(),
        _ => s.into_owned(),
    }
}

/// Plain (non-verbatim) path for a canonical path.
pub fn plain_path(p: &Path) -> PathBuf {
    PathBuf::from(display_path(p))
}

/// Comparison key for "same folder" checks: display form, no trailing
/// separator, case-insensitive on Windows.
pub fn path_key(p: &Path) -> String {
    let s = display_path(p);
    let s = s.trim_end_matches(['\\', '/']);
    let s = s.replace('/', std::path::MAIN_SEPARATOR_STR);
    if cfg!(windows) {
        s.to_lowercase()
    } else {
        s
    }
}

/// `true` for UNC / network / device paths, which projects may not use.
pub fn is_unc_like(p: &Path) -> bool {
    let s = p.to_string_lossy();
    s.starts_with(r"\\?\UNC\")
        || s.starts_with(r"\\.\")
        || (s.starts_with(r"\\") && !s.starts_with(r"\\?\"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn truncation_respects_char_boundaries() {
        let s = "a\u{00e9}\u{00e9}b"; // 1 + 2 + 2 + 1 bytes
        assert_eq!(truncate_bytes(s, 2), ("a", true));
        assert_eq!(truncate_bytes(s, 3), ("a\u{00e9}", true));
        assert_eq!(truncate_bytes(s, 100), (s, false));
        assert!(truncate_marked("abcdef", 3).starts_with("abc\u{2026}"));
    }

    #[test]
    fn one_line_collapses_and_limits() {
        assert_eq!(one_line("  a \n b\tc ", 80), "a b c");
        assert_eq!(one_line("abcdef", 4), "abc\u{2026}");
    }

    #[test]
    fn ids() {
        assert!(is_uuid("a0d5bd7b-ef20-441f-a3c9-be62c7acb13b"));
        assert!(!is_uuid("a0d5bd7b-ef20-441f-a3c9-be62c7acb13"));
        assert!(!is_uuid("../../x"));
        assert!(is_safe_id("a1b2-c_3"));
        assert!(!is_safe_id("a/b"));
        assert!(!is_safe_id(""));
    }

    #[test]
    fn iso_formatting() {
        assert_eq!(iso_time(UNIX_EPOCH), "1970-01-01T00:00:00.000Z");
        let t = UNIX_EPOCH + Duration::from_millis(1_709_251_200_123); // 2024-03-01
        assert_eq!(iso_time(t), "2024-03-01T00:00:00.123Z");
    }

    #[test]
    fn display_and_keys() {
        assert_eq!(display_path(Path::new(r"\\?\C:\x\y")), r"C:\x\y");
        assert_eq!(
            display_path(Path::new(r"\\?\UNC\srv\share")),
            r"\\?\UNC\srv\share"
        );
        assert!(is_unc_like(Path::new(r"\\server\share")));
        assert!(is_unc_like(Path::new(r"\\?\UNC\server\share")));
        assert!(!is_unc_like(Path::new(r"\\?\C:\x")));
        if cfg!(windows) {
            assert_eq!(
                path_key(Path::new(r"\\?\C:\Foo\")),
                path_key(Path::new(r"c:\foo"))
            );
        }
    }
}
