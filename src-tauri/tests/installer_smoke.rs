//! Manual network smoke test of the in-app installer: plan + full download +
//! checksum + publisher verification for this machine's platform, into a
//! temp directory that is deleted afterwards. It never runs `install`, so
//! the machine's Claude Code installation is not modified.
//!
//! ```text
//! cargo test --test installer_smoke -- --ignored --nocapture
//! ```

use std::time::Instant;

use crowe_harness_lib::installer::{self, download, release, verify, Cancel, InstallChannel};

#[tokio::test]
#[ignore = "downloads ~250 MB from downloads.claude.ai"]
async fn download_and_verify_without_installing() {
    let cancel = Cancel::never();
    let t = Instant::now();
    let platform = installer::detect_platform().await.expect("platform");
    let client = release::client().expect("client");
    let rel = release::resolve(&client, InstallChannel::Stable, platform, &cancel, || {})
        .await
        .expect("plan (version + signed manifest)");
    println!(
        "plan: version={} platform={} size={} bytes, manifest signature OK ({:?})",
        rel.version,
        rel.platform,
        rel.entry.size,
        t.elapsed()
    );

    let tmp = tempfile::tempdir().expect("tempdir");
    let dir = tmp.path().join("installer");
    download::ensure_private_dir(&dir).expect("dir");
    let t = Instant::now();
    let mut events = 0u32;
    let (file, digest) = download::download(&client, &rel, &dir, &cancel, |_, _| events += 1)
        .await
        .expect("download");
    let secs = t.elapsed().as_secs_f64();
    let bytes = std::fs::metadata(file.path()).expect("meta").len();
    println!(
        "download: {bytes} bytes in {secs:.1} s ({:.1} MB/s), {events} progress events",
        bytes as f64 / secs / 1e6
    );
    assert_eq!(bytes, rel.entry.size);

    verify::ensure_checksum(&digest, &rel.entry.checksum).expect("sha256");
    println!("sha256: OK ({})", rel.entry.checksum);

    let t = Instant::now();
    let publisher = verify::verify_publisher(file.path()).expect("publisher");
    println!("publisher: {publisher:?} ({:?})", t.elapsed());

    let path = file.path().to_path_buf();
    assert!(file.remove().await, "temp file removed");
    assert!(!path.exists());
    drop(tmp);
    println!("cleanup: OK (install was NOT run)");
}
