//! Streaming download of the release binary into a private temp file:
//! incremental SHA-256, exact size enforcement, HTTP `Range` resume on
//! transient failures, throttled progress, cancellation. The temp file is
//! deleted on every failure (and on drop).

use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use reqwest::{header, StatusCode, Url};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncSeekExt, AsyncWriteExt, BufWriter};

use super::release::{is_allowed_url, is_transient_status, status_error, transport_error, Release};
use super::{codes, ierr, Cancel};
use crate::error::{NativeError, NativeResult};

/// Resume attempts after the first request.
pub const MAX_RETRIES: u32 = 3;
pub const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);
const TEMP_PREFIX: &str = "claude-install-";
const WRITE_BUFFER: usize = 1024 * 1024;
/// Extra room required on top of the binary size.
const DISK_MARGIN: u64 = 64 * 1024 * 1024;

// ---------------------------------------------------------------- errors

#[cfg(windows)]
const DISK_FULL_OS_CODES: &[i32] = &[39, 112]; // ERROR_HANDLE_DISK_FULL, ERROR_DISK_FULL
#[cfg(target_os = "linux")]
const DISK_FULL_OS_CODES: &[i32] = &[28, 122]; // ENOSPC, EDQUOT
#[cfg(not(any(windows, target_os = "linux")))]
const DISK_FULL_OS_CODES: &[i32] = &[28, 69]; // ENOSPC, EDQUOT (BSD/macOS)

pub fn is_disk_full(e: &std::io::Error) -> bool {
    e.kind() == std::io::ErrorKind::StorageFull
        || e.raw_os_error()
            .is_some_and(|c| DISK_FULL_OS_CODES.contains(&c))
}

pub fn disk_full() -> NativeError {
    ierr(
        codes::DISK_FULL,
        "not enough free disk space to install Claude Code",
    )
}

/// I/O error with `ENOSPC`-like errors mapped to `disk_full`.
pub fn io_error(context: &str, e: &std::io::Error) -> NativeError {
    if is_disk_full(e) {
        disk_full()
    } else {
        NativeError::io(context, e)
    }
}

// ---------------------------------------------------------------- temp file

/// A temp file that is deleted when dropped (best effort) or explicitly via
/// [`TempFile::remove`] (with retries for Windows sharing violations).
#[derive(Debug)]
pub struct TempFile {
    path: PathBuf,
    armed: bool,
}

impl TempFile {
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub async fn remove(mut self) -> bool {
        self.armed = false;
        remove_with_retry(&self.path).await
    }
}

impl Drop for TempFile {
    fn drop(&mut self) {
        if self.armed {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

/// Deletes `path`, retrying while another process (antivirus scan, the
/// installer that just exited) still holds it open.
pub async fn remove_with_retry(path: &Path) -> bool {
    for attempt in 1..=6u32 {
        match tokio::fs::remove_file(path).await {
            Ok(()) => return true,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return true,
            Err(_) => tokio::time::sleep(Duration::from_millis(200 * u64::from(attempt))).await,
        }
    }
    false
}

/// Creates the private download directory (0700 on Unix).
pub fn ensure_private_dir(dir: &Path) -> NativeResult<()> {
    std::fs::create_dir_all(dir).map_err(|e| io_error("download folder", &e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| io_error("download folder", &e))?;
    }
    Ok(())
}

/// Removes leftovers of interrupted installs (only our own file names).
pub fn sweep_stale(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let is_ours = e.file_name().to_string_lossy().starts_with(TEMP_PREFIX);
        let is_file = e.file_type().is_ok_and(|t| t.is_file());
        if is_ours && is_file {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

async fn create_temp(dir: &Path) -> NativeResult<(TempFile, tokio::fs::File)> {
    let ext = if cfg!(windows) { ".exe" } else { "" };
    let path = dir.join(format!("{TEMP_PREFIX}{}{ext}", uuid::Uuid::new_v4()));
    let mut opts = tokio::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    opts.mode(0o600);
    let file = opts
        .open(&path)
        .await
        .map_err(|e| io_error("download file", &e))?;
    Ok((TempFile { path, armed: true }, file))
}

/// Best-effort free-space check (Windows; elsewhere `ENOSPC` is mapped).
pub fn check_free_space(dirs: &[&Path], needed: u64) -> NativeResult<()> {
    #[cfg(windows)]
    for dir in dirs {
        if let Some(free) = super::sys_windows::free_space(dir) {
            if free < needed.saturating_add(DISK_MARGIN) {
                return Err(disk_full());
            }
        }
    }
    #[cfg(not(windows))]
    let _ = (dirs, needed, DISK_MARGIN);
    Ok(())
}

// ---------------------------------------------------------------- pure helpers

/// Rejects a chunk that would exceed the signed size.
pub fn check_chunk(received: u64, chunk_len: usize, total: u64) -> NativeResult<()> {
    if received.saturating_add(chunk_len as u64) > total {
        return Err(ierr(
            codes::UNEXPECTED_RESPONSE,
            "the download is larger than the signed size",
        ));
    }
    Ok(())
}

/// `Content-Range: bytes <start>-<total-1>/<total>` for a resumed request.
pub fn content_range_ok(value: &str, start: u64, total: u64) -> bool {
    let Some(rest) = value.trim().strip_prefix("bytes ") else {
        return false;
    };
    let Some((range, len)) = rest.split_once('/') else {
        return false;
    };
    let Some((a, b)) = range.split_once('-') else {
        return false;
    };
    let parse = |s: &str| s.trim().parse::<u64>().ok();
    parse(a) == Some(start) && parse(b) == total.checked_sub(1) && parse(len) == Some(total)
}

/// Exponential backoff before retry `n` (1-based): 1 s, 2 s, 4 s.
pub fn backoff(n: u32) -> Duration {
    Duration::from_secs(1u64 << n.saturating_sub(1).min(4))
}

/// Rate limiter for progress events.
#[derive(Debug)]
pub struct Throttle {
    interval: Duration,
    last: Option<Instant>,
}

impl Throttle {
    pub fn new(interval: Duration) -> Self {
        Throttle {
            interval,
            last: None,
        }
    }

    pub fn ready(&mut self, now: Instant) -> bool {
        match self.last {
            Some(last) if now.duration_since(last) < self.interval => false,
            _ => {
                self.last = Some(now);
                true
            }
        }
    }
}

// ---------------------------------------------------------------- download

enum Failure {
    /// Retry (with `Range`) after a backoff.
    Transient(NativeError),
    Fatal(NativeError),
}

struct State {
    writer: BufWriter<tokio::fs::File>,
    hasher: Sha256,
    received: u64,
    total: u64,
}

impl State {
    async fn restart(&mut self) -> NativeResult<()> {
        self.writer
            .flush()
            .await
            .map_err(|e| io_error("download file", &e))?;
        let file = self.writer.get_mut();
        file.set_len(0)
            .await
            .map_err(|e| io_error("download file", &e))?;
        file.seek(SeekFrom::Start(0))
            .await
            .map_err(|e| io_error("download file", &e))?;
        self.hasher = Sha256::new();
        self.received = 0;
        Ok(())
    }
}

/// Downloads `release` into a new temp file under `dir`. Returns the file
/// (deleted on drop) and its SHA-256; the caller compares the digest.
pub async fn download(
    client: &reqwest::Client,
    release: &Release,
    dir: &Path,
    cancel: &Cancel,
    mut on_progress: impl FnMut(u64, u64),
) -> NativeResult<(TempFile, [u8; 32])> {
    let total = release.entry.size;
    let url = release.binary_url()?;
    let (temp, file) = create_temp(dir).await?;
    let mut st = State {
        writer: BufWriter::with_capacity(WRITE_BUFFER, file),
        hasher: Sha256::new(),
        received: 0,
        total,
    };
    let mut throttle = Throttle::new(PROGRESS_INTERVAL);
    on_progress(0, total);
    throttle.ready(Instant::now());

    let mut retries = 0;
    loop {
        let result = fetch_into(client, &url, &mut st, cancel, &mut |r, t| {
            if throttle.ready(Instant::now()) {
                on_progress(r, t);
            }
        })
        .await;
        match result {
            Ok(()) => break,
            Err(Failure::Fatal(e)) => return Err(e),
            Err(Failure::Transient(e)) => {
                retries += 1;
                if retries > MAX_RETRIES {
                    return Err(e);
                }
                cancel.sleep(backoff(retries)).await?;
            }
        }
    }
    on_progress(st.received, total);

    st.writer
        .flush()
        .await
        .map_err(|e| io_error("download file", &e))?;
    let file = st.writer.into_inner();
    file.sync_all()
        .await
        .map_err(|e| io_error("download file", &e))?;
    drop(file);
    let digest: [u8; 32] = st.hasher.finalize().into();
    Ok((temp, digest))
}

async fn fetch_into(
    client: &reqwest::Client,
    url: &Url,
    st: &mut State,
    cancel: &Cancel,
    progress: &mut impl FnMut(u64, u64),
) -> Result<(), Failure> {
    use Failure::{Fatal, Transient};
    let fatal_cancel = |e: NativeError| Fatal(e);

    let mut req = client.get(url.clone());
    let resuming = st.received > 0;
    if resuming {
        req = req.header(header::RANGE, format!("bytes={}-", st.received));
    }
    let mut resp = match cancel.run(req.send()).await.map_err(fatal_cancel)? {
        Ok(r) => r,
        Err(e) if e.is_redirect() => return Err(Fatal(transport_error(&e))),
        Err(e) => return Err(Transient(transport_error(&e))),
    };
    if !is_allowed_url(resp.url()) {
        return Err(Fatal(ierr(
            codes::UNEXPECTED_RESPONSE,
            "unexpected final URL",
        )));
    }
    match resp.status() {
        StatusCode::OK => {
            if resuming {
                // The server ignored the range: start over.
                st.restart().await.map_err(Fatal)?;
            }
        }
        StatusCode::PARTIAL_CONTENT if resuming => {
            let range_ok = resp
                .headers()
                .get(header::CONTENT_RANGE)
                .and_then(|v| v.to_str().ok())
                .is_some_and(|v| content_range_ok(v, st.received, st.total));
            if !range_ok {
                st.restart().await.map_err(Fatal)?;
                return Err(Transient(ierr(
                    codes::NETWORK,
                    "the download could not be resumed",
                )));
            }
        }
        s if is_transient_status(s.as_u16()) => {
            return Err(Transient(status_error(s.as_u16(), None)));
        }
        s => {
            let ct = resp
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned);
            return Err(Fatal(status_error(s.as_u16(), ct.as_deref())));
        }
    }
    if let Some(len) = resp.content_length() {
        if st.received.saturating_add(len) != st.total {
            return Err(Fatal(ierr(
                codes::UNEXPECTED_RESPONSE,
                "the download size does not match the signed size",
            )));
        }
    }

    loop {
        let chunk = match cancel.run(resp.chunk()).await.map_err(fatal_cancel)? {
            Ok(Some(c)) => c,
            Ok(None) => break,
            Err(e) => return Err(Transient(transport_error(&e))),
        };
        check_chunk(st.received, chunk.len(), st.total).map_err(Fatal)?;
        st.writer
            .write_all(&chunk)
            .await
            .map_err(|e| Fatal(io_error("download file", &e)))?;
        st.hasher.update(&chunk);
        st.received += chunk.len() as u64;
        progress(st.received, st.total);
    }
    if st.received < st.total {
        return Err(Transient(ierr(
            codes::NETWORK,
            "the connection was closed before the download completed",
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn size_enforcement() {
        check_chunk(0, 10, 10).expect("exact");
        check_chunk(5, 5, 10).expect("exact");
        let err = check_chunk(5, 6, 10).expect_err("over");
        assert_eq!(err.code, codes::UNEXPECTED_RESPONSE);
        assert!(check_chunk(u64::MAX, 1, 10).is_err());
    }

    #[test]
    fn content_range_parsing() {
        assert!(content_range_ok("bytes 100-999/1000", 100, 1000));
        assert!(!content_range_ok("bytes 0-999/1000", 100, 1000));
        assert!(!content_range_ok("bytes 100-998/1000", 100, 1000));
        assert!(!content_range_ok("bytes 100-999/*", 100, 1000));
        assert!(!content_range_ok("items 100-999/1000", 100, 1000));
        assert!(!content_range_ok("", 100, 1000));
    }

    #[test]
    fn backoff_grows() {
        assert_eq!(backoff(1), Duration::from_secs(1));
        assert_eq!(backoff(2), Duration::from_secs(2));
        assert_eq!(backoff(3), Duration::from_secs(4));
        assert_eq!(backoff(100), Duration::from_secs(16));
    }

    #[test]
    fn throttle_limits_rate() {
        let mut t = Throttle::new(Duration::from_millis(100));
        let t0 = Instant::now();
        assert!(t.ready(t0));
        assert!(!t.ready(t0 + Duration::from_millis(50)));
        assert!(t.ready(t0 + Duration::from_millis(100)));
        assert!(!t.ready(t0 + Duration::from_millis(150)));
        // ≤ 10 events per simulated second of 1000 ticks
        let mut t = Throttle::new(PROGRESS_INTERVAL);
        let n = (0..1000)
            .filter(|i| t.ready(t0 + Duration::from_millis(*i)))
            .count();
        assert!(n <= 10, "{n}");
    }

    #[test]
    fn disk_full_mapping() {
        let e = std::io::Error::from(std::io::ErrorKind::StorageFull);
        assert_eq!(io_error("x", &e).code, codes::DISK_FULL);
        let raw = std::io::Error::from_raw_os_error(DISK_FULL_OS_CODES[0]);
        assert_eq!(io_error("x", &raw).code, codes::DISK_FULL);
        let denied = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        assert_eq!(io_error("x", &denied).code, "io");
    }

    #[tokio::test]
    async fn temp_files_are_private_and_cleaned() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let dir = tmp.path().join("installer");
        ensure_private_dir(&dir).expect("dir");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&dir).expect("meta").permissions().mode();
            assert_eq!(mode & 0o777, 0o700);
        }
        let (temp, _file) = create_temp(&dir).await.expect("create");
        let path = temp.path().to_path_buf();
        assert!(path.is_file());
        drop(_file);
        drop(temp); // armed: deleted on drop
        assert!(!path.exists());

        let (temp, file) = create_temp(&dir).await.expect("create");
        drop(file);
        let path = temp.path().to_path_buf();
        assert!(temp.remove().await);
        assert!(!path.exists());

        std::fs::write(dir.join("claude-install-old.exe"), b"x").expect("write");
        std::fs::write(dir.join("keep.txt"), b"x").expect("write");
        sweep_stale(&dir);
        assert!(!dir.join("claude-install-old.exe").exists());
        assert!(dir.join("keep.txt").exists());
    }

    #[test]
    fn free_space_check() {
        check_free_space(&[&std::env::temp_dir()], 1).expect("1 byte fits");
        if cfg!(windows) {
            let err = check_free_space(&[&std::env::temp_dir()], u64::MAX / 2).expect_err("full");
            assert_eq!(err.code, codes::DISK_FULL);
        }
    }
}
