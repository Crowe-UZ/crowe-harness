//! Fresh `PATH` and user/system variables from the Windows registry.
//!
//! A process inherits its environment when it starts; Claude Code installed
//! later (or a variable set later) is only visible in the registry until
//! Explorer and the app restart. This reads
//! `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment` and
//! `HKCU\Environment` the way Windows composes a new environment: system
//! `Path` then user `Path`, `REG_EXPAND_SZ` values expanded.
//!
//! Expansion is done here (not with `ExpandEnvironmentStringsW`) so that a
//! `%VAR%` defined in the registry after the app started still resolves, and
//! so that it is testable: lookup order is user registry → system registry →
//! process environment; unknown variables are left as `%VAR%`, like Windows.

use std::collections::BTreeMap;

/// A registry string value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegString {
    pub value: String,
    /// `REG_EXPAND_SZ` (expanded) rather than `REG_SZ` (taken literally).
    pub expand: bool,
}

impl RegString {
    pub fn sz(value: &str) -> Self {
        RegString {
            value: value.to_owned(),
            expand: false,
        }
    }

    pub fn expand_sz(value: &str) -> Self {
        RegString {
            value: value.to_owned(),
            expand: true,
        }
    }
}

/// Values of one `Environment` key, keyed by upper-case name.
pub type RegValues = BTreeMap<String, RegString>;

/// Result of [`compose`].
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RegistryEnv {
    /// System `Path` followed by user `Path`, expanded (`None` when both are empty).
    pub path: Option<String>,
    /// Every other variable (user wins over system), expanded.
    pub vars: BTreeMap<String, String>,
}

/// Expands `%NAME%` references with `lookup`; unknown names are kept verbatim.
pub fn expand_vars(s: &str, lookup: &dyn Fn(&str) -> Option<String>) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let Some(end) = after.find('%') else {
            out.push_str(&rest[start..]);
            return out;
        };
        let name = &after[..end];
        match (!name.is_empty()).then(|| lookup(name)).flatten() {
            Some(value) => out.push_str(&value),
            None => {
                out.push('%');
                out.push_str(name);
                out.push('%');
            }
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    out
}

/// Composes the fresh environment from the system and user `Environment`
/// keys; `process` looks up this process's variables (e.g. `SystemRoot`,
/// `USERPROFILE`, which live outside these keys).
pub fn compose(
    system: &RegValues,
    user: &RegValues,
    process: &dyn Fn(&str) -> Option<String>,
) -> RegistryEnv {
    // One level: a registry variable's own references are expanded with the process environment.
    let single = |r: &RegString| {
        if r.expand {
            expand_vars(&r.value, process)
        } else {
            r.value.clone()
        }
    };
    let lookup = |name: &str| -> Option<String> {
        let key = name.to_ascii_uppercase();
        user.get(&key)
            .or_else(|| system.get(&key))
            .map(single)
            .or_else(|| process(name))
    };
    let full = |r: &RegString| {
        if r.expand {
            expand_vars(&r.value, &lookup)
        } else {
            r.value.clone()
        }
    };
    let parts: Vec<String> = [system.get("PATH"), user.get("PATH")]
        .into_iter()
        .flatten()
        .map(full)
        .map(|p| p.trim_matches(';').to_owned())
        .filter(|p| !p.is_empty())
        .collect();
    let mut vars = BTreeMap::new();
    for (key, value) in system.iter().chain(user.iter()) {
        if key != "PATH" {
            vars.insert(key.clone(), full(value)); // user (later) wins
        }
    }
    RegistryEnv {
        path: (!parts.is_empty()).then(|| parts.join(";")),
        vars,
    }
}

/// Reads both `Environment` keys and composes them. Missing keys are empty.
#[cfg(windows)]
pub fn read_registry_env() -> RegistryEnv {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
    let system = read_values(
        HKEY_LOCAL_MACHINE,
        r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
        KEY_READ,
    );
    let user = read_values(HKEY_CURRENT_USER, "Environment", KEY_READ);
    compose(&system, &user, &|name| std::env::var(name).ok())
}

#[cfg(windows)]
fn read_values(hive: winreg::HKEY, path: &str, access: u32) -> RegValues {
    use winreg::enums::RegType::{REG_EXPAND_SZ, REG_SZ};
    use winreg::types::FromRegValue;
    let Ok(key) = winreg::RegKey::predef(hive).open_subkey_with_flags(path, access) else {
        return RegValues::new();
    };
    key.enum_values()
        .take(1024)
        .filter_map(Result::ok)
        .filter_map(|(name, value)| {
            let expand = match value.vtype {
                REG_EXPAND_SZ => true,
                REG_SZ => false,
                _ => return None,
            };
            let text = String::from_reg_value(&value).ok()?;
            Some((
                name.to_ascii_uppercase(),
                RegString {
                    value: text,
                    expand,
                },
            ))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn process(name: &str) -> Option<String> {
        match name.to_ascii_uppercase().as_str() {
            "SYSTEMROOT" => Some(r"C:\Windows".to_owned()),
            "USERPROFILE" => Some(r"C:\Users\me".to_owned()),
            "LOCALAPPDATA" => Some(r"C:\Users\me\AppData\Local".to_owned()),
            _ => None,
        }
    }

    fn values(entries: &[(&str, RegString)]) -> RegValues {
        entries
            .iter()
            .map(|(k, v)| (k.to_ascii_uppercase(), v.clone()))
            .collect()
    }

    #[test]
    fn expansion() {
        let lookup = |n: &str| process(n);
        assert_eq!(
            expand_vars(r"%SystemRoot%\system32;%systemroot%", &lookup),
            r"C:\Windows\system32;C:\Windows"
        );
        assert_eq!(expand_vars("%UNKNOWN%\\x", &lookup), "%UNKNOWN%\\x");
        assert_eq!(expand_vars("100% sure", &lookup), "100% sure");
        assert_eq!(expand_vars("%%", &lookup), "%%");
        assert_eq!(expand_vars("a%USERPROFILE%b%", &lookup), r"aC:\Users\meb%");
        assert_eq!(expand_vars("", &lookup), "");
    }

    #[test]
    fn composes_system_then_user_path() {
        let system = values(&[(
            "Path",
            RegString::expand_sz(r"%SystemRoot%\system32;%SystemRoot%;"),
        )]);
        let user = values(&[
            (
                "Path",
                RegString::expand_sz(r"%LOCALAPPDATA%\Microsoft\WinGet\Links;%NVM_SYMLINK%"),
            ),
            ("NVM_SYMLINK", RegString::sz(r"C:\nvm4w\nodejs")),
        ]);
        let env = compose(&system, &user, &process);
        assert_eq!(
            env.path.as_deref(),
            Some(
                r"C:\Windows\system32;C:\Windows;C:\Users\me\AppData\Local\Microsoft\WinGet\Links;C:\nvm4w\nodejs"
            )
        );
        assert_eq!(
            env.vars.get("NVM_SYMLINK").map(String::as_str),
            Some(r"C:\nvm4w\nodejs")
        );
        assert!(!env.vars.contains_key("PATH"));
    }

    #[test]
    fn reg_sz_is_not_expanded_and_user_wins() {
        let system = values(&[
            ("Path", RegString::sz(r"%SystemRoot%\literal")),
            ("PNPM_HOME", RegString::sz(r"C:\system-pnpm")),
        ]);
        let user = values(&[
            ("PNPM_HOME", RegString::expand_sz(r"%USERPROFILE%\pnpm")),
            ("TOOLS", RegString::expand_sz(r"%PNPM_HOME%\tools")),
        ]);
        let env = compose(&system, &user, &process);
        assert_eq!(env.path.as_deref(), Some(r"%SystemRoot%\literal"));
        assert_eq!(
            env.vars.get("PNPM_HOME").map(String::as_str),
            Some(r"C:\Users\me\pnpm")
        );
        // A registry variable referencing another registry variable resolves (one level).
        assert_eq!(
            env.vars.get("TOOLS").map(String::as_str),
            Some(r"C:\Users\me\pnpm\tools")
        );
    }

    #[test]
    fn empty_registry() {
        let env = compose(&RegValues::new(), &RegValues::new(), &process);
        assert_eq!(env, RegistryEnv::default());
        let blank = values(&[("Path", RegString::sz(";;"))]);
        assert_eq!(compose(&blank, &RegValues::new(), &process).path, None);
    }

    #[cfg(windows)]
    #[test]
    fn reads_the_real_registry() {
        // The system Path always exists on Windows and always contains system32.
        let env = read_registry_env();
        let path = env.path.expect("registry Path").to_ascii_lowercase();
        assert!(path.contains("system32"), "{path}");
        assert!(!path.contains("%systemroot%"), "{path}");
    }
}
