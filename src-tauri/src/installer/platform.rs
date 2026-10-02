//! Release platform detection, mirroring the official `install.sh` /
//! `install.ps1`:
//!
//! - Windows: the *native* machine (`IsWow64Process2`), so an x64 build of the
//!   app running under emulation on ARM64 still installs `win32-arm64`;
//!   `PROCESSOR_ARCHITEW6432` / `PROCESSOR_ARCHITECTURE` as a fallback.
//! - macOS: process arch, with the Rosetta check (`sysctl.proc_translated`
//!   = 1 means an x64 process on Apple silicon → `darwin-arm64`).
//! - Linux: arch + musl detection (`/lib/libc.musl-<arch>.so.1` or
//!   `ldd --version` mentioning musl).
//!
//! The mapping itself is pure ([`platform_key`]); OS probes are cfg-gated.

use std::path::Path;

/// Every platform key published in the release manifest.
pub const PLATFORMS: [&str; 8] = [
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64",
    "linux-arm64-musl",
    "linux-x64",
    "linux-x64-musl",
    "win32-arm64",
    "win32-x64",
];

/// Normalizes the many spellings of the two supported architectures.
pub fn normalize_arch(arch: &str) -> Option<&'static str> {
    match arch.trim().to_ascii_lowercase().as_str() {
        "x86_64" | "amd64" | "x64" => Some("x86_64"),
        "aarch64" | "arm64" => Some("aarch64"),
        _ => None,
    }
}

/// Maps `(os, native arch, musl)` to a release platform key
/// (`std::env::consts::OS` spelling for `os`). `None` = unsupported.
pub fn platform_key(os: &str, arch: &str, musl: bool) -> Option<&'static str> {
    let arch = normalize_arch(arch)?;
    Some(match (os, arch) {
        ("windows", "x86_64") => "win32-x64",
        ("windows", "aarch64") => "win32-arm64",
        ("macos", "x86_64") => "darwin-x64",
        ("macos", "aarch64") => "darwin-arm64",
        ("linux", "x86_64") if musl => "linux-x64-musl",
        ("linux", "x86_64") => "linux-x64",
        ("linux", "aarch64") if musl => "linux-arm64-musl",
        ("linux", "aarch64") => "linux-arm64",
        _ => return None,
    })
}

/// File name of the binary for a platform key.
pub fn binary_name(platform: &str) -> &'static str {
    if platform.starts_with("win32-") {
        "claude.exe"
    } else {
        "claude"
    }
}

/// `IMAGE_FILE_MACHINE_*` values returned by `IsWow64Process2`.
pub const MACHINE_AMD64: u16 = 0x8664;
pub const MACHINE_ARM64: u16 = 0xAA64;

/// Windows native architecture: the `IsWow64Process2` native machine when
/// available, else the `PROCESSOR_ARCHITEW6432` / `PROCESSOR_ARCHITECTURE`
/// environment variables (like `install.ps1`).
pub fn windows_arch(
    native_machine: Option<u16>,
    env_arch_w6432: Option<&str>,
    env_arch: Option<&str>,
) -> String {
    match native_machine {
        Some(MACHINE_ARM64) => "aarch64".into(),
        Some(MACHINE_AMD64) => "x86_64".into(),
        Some(other) => format!("machine-{other:#x}"),
        None => env_arch_w6432
            .or(env_arch)
            .map(|a| a.trim().to_owned())
            .unwrap_or_default(),
    }
}

/// macOS native architecture: an x64 process translated by Rosetta runs on
/// Apple silicon.
pub fn macos_arch(process_arch: &str, rosetta_translated: bool) -> String {
    if rosetta_translated {
        "aarch64".into()
    } else {
        process_arch.into()
    }
}

/// musl detection: the musl loader exists, or `ldd --version` mentions musl.
pub fn linux_is_musl(
    arch: &str,
    exists: impl Fn(&Path) -> bool,
    ldd_version: impl FnOnce() -> Option<String>,
) -> bool {
    if let Some(a) = normalize_arch(arch) {
        let loader = format!("/lib/libc.musl-{a}.so.1");
        if exists(Path::new(&loader)) {
            return true;
        }
    }
    ldd_version().is_some_and(|out| out.to_ascii_lowercase().contains("musl"))
}

/// Detects the release platform key of this machine.
pub fn detect() -> Option<&'static str> {
    let os = std::env::consts::OS;
    let arch = native_arch();
    let musl = os == "linux" && linux_is_musl(&arch, |p| p.exists(), ldd_version);
    platform_key(os, &arch, musl)
}

#[cfg(windows)]
fn native_arch() -> String {
    let w6432 = std::env::var("PROCESSOR_ARCHITEW6432").ok();
    let arch = std::env::var("PROCESSOR_ARCHITECTURE").ok();
    windows_arch(
        super::sys_windows::native_machine(),
        w6432.as_deref(),
        arch.as_deref(),
    )
}

#[cfg(target_os = "macos")]
fn native_arch() -> String {
    // Same probe as install.sh; spawned by absolute path, never via a shell.
    let translated = std::process::Command::new("/usr/sbin/sysctl")
        .args(["-n", "sysctl.proc_translated"])
        .stdin(std::process::Stdio::null())
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "1")
        .unwrap_or(false);
    macos_arch(std::env::consts::ARCH, translated)
}

#[cfg(not(any(windows, target_os = "macos")))]
fn native_arch() -> String {
    std::env::consts::ARCH.to_owned()
}

/// `ldd --version` output (musl's ldd prints to stderr and exits 1).
fn ldd_version() -> Option<String> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    ["/usr/bin/ldd", "/bin/ldd"]
        .into_iter()
        .filter(|p| Path::new(p).is_file())
        .find_map(|p| {
            std::process::Command::new(p)
                .arg("--version")
                .stdin(std::process::Stdio::null())
                .output()
                .ok()
                .map(|o| {
                    let mut s = String::from_utf8_lossy(&o.stdout).into_owned();
                    s.push_str(&String::from_utf8_lossy(&o.stderr));
                    s.chars().take(4096).collect()
                })
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mapping_table() {
        let cases = [
            ("windows", "x86_64", false, Some("win32-x64")),
            ("windows", "aarch64", false, Some("win32-arm64")),
            ("macos", "x86_64", false, Some("darwin-x64")),
            ("macos", "aarch64", false, Some("darwin-arm64")),
            ("linux", "x86_64", false, Some("linux-x64")),
            ("linux", "x86_64", true, Some("linux-x64-musl")),
            ("linux", "aarch64", false, Some("linux-arm64")),
            ("linux", "arm64", true, Some("linux-arm64-musl")),
            ("windows", "AMD64", false, Some("win32-x64")),
            ("windows", "ARM64", false, Some("win32-arm64")),
            // unsupported
            ("windows", "x86", false, None),
            ("windows", "machine-0x14c", false, None),
            ("linux", "riscv64", false, None),
            ("linux", "arm", false, None),
            ("freebsd", "x86_64", false, None),
            ("macos", "", false, None),
        ];
        for (os, arch, musl, want) in cases {
            assert_eq!(platform_key(os, arch, musl), want, "{os} {arch} {musl}");
        }
        // Every supported combination maps onto a published platform.
        let mut all: Vec<&str> = [
            ("windows", "x86_64", false),
            ("windows", "aarch64", false),
            ("macos", "x86_64", false),
            ("macos", "aarch64", false),
            ("linux", "x86_64", false),
            ("linux", "x86_64", true),
            ("linux", "aarch64", false),
            ("linux", "aarch64", true),
        ]
        .into_iter()
        .filter_map(|(o, a, m)| platform_key(o, a, m))
        .collect();
        all.sort_unstable();
        assert_eq!(all, PLATFORMS.to_vec());
    }

    #[test]
    fn binary_names() {
        assert_eq!(binary_name("win32-x64"), "claude.exe");
        assert_eq!(binary_name("win32-arm64"), "claude.exe");
        assert_eq!(binary_name("darwin-arm64"), "claude");
        assert_eq!(binary_name("linux-x64-musl"), "claude");
    }

    #[test]
    fn windows_native_machine_wins_over_env() {
        // x64 process emulated on ARM64: the env says AMD64, the OS says ARM64.
        assert_eq!(
            windows_arch(Some(MACHINE_ARM64), None, Some("AMD64")),
            "aarch64"
        );
        assert_eq!(windows_arch(Some(MACHINE_AMD64), None, None), "x86_64");
        assert_eq!(windows_arch(None, Some("ARM64"), Some("x86")), "ARM64");
        assert_eq!(windows_arch(None, None, Some("AMD64")), "AMD64");
        assert_eq!(windows_arch(None, None, None), "");
        assert_eq!(
            platform_key("windows", &windows_arch(Some(0x14c), None, None), false),
            None
        );
    }

    #[test]
    fn rosetta_means_arm64() {
        assert_eq!(macos_arch("x86_64", true), "aarch64");
        assert_eq!(macos_arch("x86_64", false), "x86_64");
        assert_eq!(macos_arch("aarch64", false), "aarch64");
    }

    #[test]
    fn musl_detection() {
        let none = |_: &Path| false;
        assert!(linux_is_musl(
            "x86_64",
            |p| p == Path::new("/lib/libc.musl-x86_64.so.1"),
            || None
        ));
        assert!(linux_is_musl(
            "aarch64",
            |p| p == Path::new("/lib/libc.musl-aarch64.so.1"),
            || None
        ));
        assert!(!linux_is_musl(
            "aarch64",
            |p| p == Path::new("/lib/libc.musl-x86_64.so.1"),
            || None
        ));
        assert!(linux_is_musl("x86_64", none, || Some(
            "musl libc (x86_64)\nVersion 1.2.4".into()
        )));
        assert!(!linux_is_musl("x86_64", none, || Some(
            "ldd (GNU libc) 2.39".into()
        )));
        assert!(!linux_is_musl("x86_64", none, || None));
    }

    #[test]
    fn detect_on_this_machine() {
        let p = detect();
        if cfg!(all(windows, target_arch = "x86_64")) {
            assert!(matches!(p, Some("win32-x64" | "win32-arm64")), "{p:?}");
        }
        if let Some(p) = p {
            assert!(PLATFORMS.contains(&p));
        }
    }
}
