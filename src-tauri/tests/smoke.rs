//! Manual smoke run against the real Claude Code install and history of the
//! machine running it. Ignored by default; prints counts and timings only
//! (never transcript content):
//!
//! ```text
//! cargo test --test smoke -- --ignored --nocapture
//! ```

use std::time::Instant;

use crowe_harness_lib::claude::auth::parse_auth_status;
use crowe_harness_lib::claude::history::{self, HistoryCache};
use crowe_harness_lib::claude::{cli, locate};
use crowe_harness_lib::guard::ConfigGuard;
use crowe_harness_lib::projects::{self, CwdCache, OpenedRegistry};

#[tokio::test]
#[ignore = "uses the real Claude Code install and history of this machine"]
async fn smoke_real_machine() {
    let t = Instant::now();
    let Some(loc) = locate::locate() else {
        println!("claude: not found");
        return;
    };
    println!(
        "locate: {:?} source={:?} in {:?}",
        loc.exe,
        loc.source,
        t.elapsed()
    );

    let timeout = std::time::Duration::from_secs(20);
    let v = cli::run(&loc.exe, &["--version"], timeout)
        .await
        .expect("version");
    println!("version: {:?}", locate::parse_version(&v.stdout));
    let t = Instant::now();
    let a = cli::run(&loc.exe, &["auth", "status", "--json"], timeout)
        .await
        .expect("auth");
    let auth = parse_auth_status(&a.stdout).expect("auth json");
    println!(
        "auth status: exit={:?} loggedIn={} method={:?} subscription={} ({:?})",
        a.code,
        auth.logged_in,
        auth.auth_method,
        auth.subscription,
        t.elapsed()
    );

    let config = auth.config_dir.clone().expect("configDirectory");
    let guard = ConfigGuard::new(&config, auth.projects_dir.as_deref()).expect("guard");
    let cache = HistoryCache::default();
    let cwd_cache = CwdCache::default();

    let t = Instant::now();
    let hist = projects::scan_history(&guard, &cache, &cwd_cache);
    let list = projects::merge_projects(&hist, &OpenedRegistry::new(None).load());
    println!(
        "projects_list (cold): {} projects ({} history dirs, {} with a resolvable folder) in {:?}",
        list.len(),
        hist.len(),
        hist.iter().filter(|p| p.root().is_some()).count(),
        t.elapsed()
    );

    for pass in ["cold", "warm"] {
        let t = Instant::now();
        let mut sessions = 0usize;
        let mut subagents = 0u32;
        let mut max_title = 0usize;
        let mut slowest = (std::time::Duration::ZERO, 0usize);
        for p in &hist {
            let tp = Instant::now();
            let s =
                history::sessions_list(&guard, &cache, &p.dir_name, std::slice::from_ref(&p.dir))
                    .expect("sessions");
            if tp.elapsed() > slowest.0 {
                slowest = (tp.elapsed(), s.len());
            }
            sessions += s.len();
            subagents += s.iter().map(|x| x.subagent_count).sum::<u32>();
            max_title = max_title.max(s.iter().map(|x| x.title.chars().count()).max().unwrap_or(0));
        }
        println!(
            "sessions_list ({pass}, all projects): {sessions} sessions, {subagents} subagents, max title {max_title} chars, in {:?}; slowest project {:?} ({} sessions)",
            t.elapsed(),
            slowest.0,
            slowest.1
        );
    }

    // Largest transcript: full read timing.
    let mut largest: Option<(u64, String, std::path::PathBuf, String)> = None;
    for p in &hist {
        if let Ok((files, _)) = history::list_session_files(&guard, &p.dir) {
            for f in files {
                if largest.as_ref().is_none_or(|l| f.len > l.0) {
                    let id = f
                        .path
                        .file_stem()
                        .map(|s| s.to_string_lossy().into_owned())
                        .unwrap_or_default();
                    largest = Some((f.len, p.dir_name.clone(), p.dir.clone(), id));
                }
            }
        }
    }
    if let Some((len, pid, dir, sid)) = largest {
        let t = Instant::now();
        match history::session_read(&guard, &cache, &pid, &[dir], &sid) {
            Ok(tr) => println!(
                "session_read (largest, {:.1} MB): {} messages (truncated={}), {} subagents in {:?}",
                len as f64 / 1e6,
                tr.messages.len(),
                tr.truncated,
                tr.subagents.len(),
                t.elapsed()
            ),
            Err(e) => println!("session_read (largest) failed: {e}"),
        }
    }

    // The guard refuses the credential store and session keys.
    for forbidden in [".credentials.json", "sessions", "settings.json"] {
        let p = guard.config_dir().join(forbidden);
        if p.exists() {
            assert!(guard.check(&p).is_err(), "{forbidden} must be refused");
        }
    }
    println!("guard: credential store / sessions / settings refused");
}
