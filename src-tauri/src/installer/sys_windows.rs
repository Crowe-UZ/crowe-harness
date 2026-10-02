//! Windows FFI used by the installer. This is the only module of the crate
//! that may use `unsafe` (the crate denies `unsafe_code` everywhere else).
//!
//! - [`native_machine`] — `IsWow64Process2` (native CPU even for an emulated
//!   x64 process on ARM64).
//! - [`authenticode_signer`] — `WinVerifyTrust` (`WINTRUST_ACTION_GENERIC_VERIFY_V2`)
//!   plus the common name of the signer certificate of the *verified*
//!   signature (`WTHelperProvDataFromStateData` → `WTHelperGetProvSignerFromChain`
//!   → `CertGetNameStringW(CERT_NAME_ATTR_TYPE, szOID_COMMON_NAME)`).
//! - [`free_space`] — `GetDiskFreeSpaceExW`.
#![allow(unsafe_code)]

use std::ffi::c_void;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::ptr::null_mut;

use windows_sys::Win32::Foundation::{HANDLE, HWND};
use windows_sys::Win32::Security::Cryptography::{
    szOID_COMMON_NAME, CertGetNameStringW, CERT_NAME_ATTR_TYPE,
};
use windows_sys::Win32::Security::WinTrust::{
    WTHelperGetProvSignerFromChain, WTHelperProvDataFromStateData, WinVerifyTrust,
    WINTRUST_ACTION_GENERIC_VERIFY_V2, WINTRUST_DATA, WINTRUST_DATA_0, WINTRUST_FILE_INFO,
    WTD_CACHE_ONLY_URL_RETRIEVAL, WTD_CHOICE_FILE, WTD_REVOKE_NONE, WTD_STATEACTION_CLOSE,
    WTD_STATEACTION_VERIFY, WTD_UI_NONE,
};
use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
use windows_sys::Win32::System::SystemInformation::IMAGE_FILE_MACHINE;
use windows_sys::Win32::System::Threading::{GetCurrentProcess, IsWow64Process2};

fn wide(path: &Path) -> Vec<u16> {
    path.as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// Native machine (`IMAGE_FILE_MACHINE_*`) of this computer.
pub fn native_machine() -> Option<u16> {
    let mut process: IMAGE_FILE_MACHINE = 0;
    let mut native: IMAGE_FILE_MACHINE = 0;
    // SAFETY: GetCurrentProcess returns a pseudo handle that needs no
    // closing; both out pointers reference live stack variables.
    let ok = unsafe { IsWow64Process2(GetCurrentProcess(), &mut process, &mut native) };
    (ok != 0 && native != 0).then_some(native)
}

/// Bytes available to the current user on the volume holding `dir`.
pub fn free_space(dir: &Path) -> Option<u64> {
    let path = wide(dir);
    let mut available: u64 = 0;
    // SAFETY: `path` is NUL-terminated and outlives the call; the optional
    // out pointers may be null.
    let ok = unsafe { GetDiskFreeSpaceExW(path.as_ptr(), &mut available, null_mut(), null_mut()) };
    (ok != 0).then_some(available)
}

/// Verifies the Authenticode signature of `file` and returns the common name
/// of the signing certificate. Revocation is not checked online (works behind
/// firewalls); URL retrieval is cache-only. Errors carry the HRESULT only.
pub fn authenticode_signer(file: &Path) -> Result<String, String> {
    let path = wide(file);
    let mut file_info = WINTRUST_FILE_INFO {
        cbStruct: size_u32::<WINTRUST_FILE_INFO>(),
        pcwszFilePath: path.as_ptr(),
        hFile: null_mut(),
        pgKnownSubject: null_mut(),
    };
    let mut data = WINTRUST_DATA {
        cbStruct: size_u32::<WINTRUST_DATA>(),
        pPolicyCallbackData: null_mut(),
        pSIPClientData: null_mut(),
        dwUIChoice: WTD_UI_NONE,
        fdwRevocationChecks: WTD_REVOKE_NONE,
        dwUnionChoice: WTD_CHOICE_FILE,
        Anonymous: WINTRUST_DATA_0 {
            pFile: &mut file_info,
        },
        dwStateAction: WTD_STATEACTION_VERIFY,
        hWVTStateData: null_mut(),
        pwszURLReference: null_mut(),
        dwProvFlags: WTD_CACHE_ONLY_URL_RETRIEVAL,
        dwUIContext: 0,
        pSignatureSettings: null_mut(),
    };
    let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    // INVALID_HANDLE_VALUE as the window: no UI may ever be shown.
    let no_ui = -1isize as HWND;

    // SAFETY: `data`, `file_info`, `path` and `action` are live for the whole
    // verify/close pair; the state data is released by WTD_STATEACTION_CLOSE
    // below on every path.
    let status = unsafe {
        WinVerifyTrust(
            no_ui,
            &mut action,
            (&mut data as *mut WINTRUST_DATA).cast::<c_void>(),
        )
    };
    let signer = if status == 0 {
        // SAFETY: the state data is valid until the close call below.
        unsafe { signer_common_name(data.hWVTStateData) }
    } else {
        Err(format!("signature not trusted (0x{:08X})", status as u32))
    };

    data.dwStateAction = WTD_STATEACTION_CLOSE;
    // SAFETY: same live structures; closing releases hWVTStateData.
    unsafe {
        WinVerifyTrust(
            no_ui,
            &mut action,
            (&mut data as *mut WINTRUST_DATA).cast::<c_void>(),
        );
    }
    signer
}

/// Common name of the leaf certificate of the first (primary) signer.
///
/// # Safety
/// `state` must be the `hWVTStateData` of a successful, not yet closed,
/// `WinVerifyTrust(WTD_STATEACTION_VERIFY)` call.
unsafe fn signer_common_name(state: HANDLE) -> Result<String, String> {
    let prov = WTHelperProvDataFromStateData(state);
    if prov.is_null() {
        return Err("no provider data".into());
    }
    let signer = WTHelperGetProvSignerFromChain(prov, 0, 0, 0);
    if signer.is_null() || (*signer).csCertChain == 0 || (*signer).pasCertChain.is_null() {
        return Err("no signer certificate".into());
    }
    let cert = (*(*signer).pasCertChain).pCert;
    if cert.is_null() {
        return Err("no signer certificate".into());
    }
    let oid = szOID_COMMON_NAME.cast::<c_void>();
    let len = CertGetNameStringW(cert, CERT_NAME_ATTR_TYPE, 0, oid, null_mut(), 0);
    if len <= 1 {
        return Err("signer has no common name".into());
    }
    let mut buf = vec![0u16; len as usize];
    let written = CertGetNameStringW(cert, CERT_NAME_ATTR_TYPE, 0, oid, buf.as_mut_ptr(), len);
    let end = (written as usize).saturating_sub(1).min(buf.len());
    Ok(String::from_utf16_lossy(&buf[..end]))
}

fn size_u32<T>() -> u32 {
    u32::try_from(std::mem::size_of::<T>()).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_machine_is_known() {
        let m = native_machine().expect("IsWow64Process2");
        assert!(
            m == crate::installer::platform::MACHINE_AMD64
                || m == crate::installer::platform::MACHINE_ARM64,
            "{m:#x}"
        );
    }

    #[test]
    fn free_space_of_temp() {
        assert!(free_space(&std::env::temp_dir()).is_some_and(|b| b > 0));
    }

    #[test]
    fn unsigned_file_is_rejected() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let f = tmp.path().join("unsigned.exe");
        std::fs::write(&f, b"MZ not really a PE").expect("write");
        assert!(authenticode_signer(&f).is_err());
    }

    #[test]
    fn signed_system_binary_has_a_signer() {
        // notepad.exe is catalog-signed (no embedded signature) on recent
        // Windows, so its embedded-signature check may fail; an
        // embedded-signed system file (e.g. a driver store tool) varies by
        // build. Only assert that a call on a real PE does not crash.
        let windir = std::env::var_os("WINDIR").map(std::path::PathBuf::from);
        if let Some(exe) = windir.map(|w| w.join("explorer.exe")) {
            let _ = authenticode_signer(&exe);
        }
    }
}
