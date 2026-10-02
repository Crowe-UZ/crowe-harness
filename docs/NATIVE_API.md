# Native API contract (Rust ⇄ UI)

Single source of truth for the Tauri commands that replace all mock data.
TypeScript mirror: `src/features/native/contract.ts`. Rust: `src-tauri/src/**`.
All JSON is camelCase (`#[serde(rename_all = "camelCase")]`). Errors are returned as
`{ code: string, message: string }` (`NativeError`). Codes used by the Rust side:
`invalid_argument`, `not_found`, `forbidden`, `claude_not_found`, `invalid_executable`, `spawn_failed`, `timeout`,
`cli_failed`, `too_many_turns`, `io`, `internal`. Messages are short and never contain internal paths.

Security rules (see SPEC §D, "Security rules for native commands"):

- The webview never sends filesystem paths or executable paths. It sends **ids**; Rust resolves ids to paths it
  owns (Claude Code history directory, the app's own project registry) and canonicalizes them. Paths the user
  chooses come from native pickers opened by Rust (`projects_open_folder`, `claude_pick_executable`).
- Claude credentials are never read: Rust never opens `~/.claude/.credentials.json`, `~/.claude/sessions/*`,
  `~/.claude.json`. Only `~/.claude/projects/**` (transcripts + subagent meta), `~/.claude/agents`,
  `~/.claude/skills` and project `.claude/{agents,skills}` are read.
- `claude` is spawned by absolute path, never through `cmd /c`; prompts go through stdin; `ANTHROPIC_API_KEY`,
  `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` are removed from the child environment; `--bare` is never used.

## Claude Code install and sign-in

| Command | Args | Returns |
|---|---|---|
| `claude_status` | `{ forceRefresh?: boolean }` | `ClaudeStatus` — uses the cached location; `forceRefresh: true` ("Check again") re-discovers |
| `claude_auth_login` | – | `null` — opens a visible console running `claude auth login --claudeai` (CREATE_NEW_CONSOLE) |
| `claude_auth_logout` | – | `null` — runs `claude auth logout` |
| `claude_pick_executable` | – | `ClaudeStatus \| null` — native file picker (Rust side); `null` when cancelled; rejects with `invalid_executable` |
| `claude_clear_executable` | – | `ClaudeStatus` — forgets the manual location and re-discovers |
| `claude_locate_report` | – | `LocateReport` — diagnostics: every location checked (validates every candidate) |

`ClaudeStatus`:

```ts
{
  install: { path: string; version: string | null; source: "custom" | "path" | "local" | "package" | "desktop" } | null;
  loggedIn: boolean;
  authMethod: string | null;        // raw value from `claude auth status`
  subscription: boolean;            // true only for Claude subscription sign-in (claude.ai), false for console/API key
  subscriptionType: string | null;  // "pro" | "max" | "team" | "enterprise" | ... (raw)
  email: string | null;
  orgName: string | null;
}
```

`LocateReport`:

```ts
{
  chosen: ClaudeInstall | null;     // the install that would run (first candidate that validates)
  checked: {
    path: string;                   // home directory shown as "~"; wildcards as "*"
    source: "custom" | "path" | "local" | "package" | "desktop";
    result: "ok" | "missing" | "rejected";
    reason?: "not_executable" | "timeout" | "bad_output" | "spawn_failed" | "summarized";
  }[];                              // priority order, at most 60 entries
}
```

### Locating `claude`

Candidates, highest priority first. Executables only — never `.cmd` / `.bat` / `.ps1` (for an npm shim on Windows
the package's native `node_modules\@anthropic-ai\claude-code\bin\claude.exe` is used); relative directories are
never resolved; candidates are deduplicated by canonical path (first source wins).

1. `custom` — the file chosen with `claude_pick_executable` (persisted in `<app config dir>/claude-code.json`).
2. `path` — this process's `PATH`.
3. `path` — a fresh `PATH`: Windows reads `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment\Path`
   then `HKCU\Environment\Path` (`REG_EXPAND_SZ` expanded; lookup user registry → system registry → process env;
   unknown `%VAR%` kept), so Claude Code installed after the app / Explorer started is found. macOS/Linux run the
   user's `$SHELL` (absolute, and in `/etc/shells` or one of zsh, bash, fish, sh) as `-ilc` (fish: `-lc` with
   `string join : $PATH`) printing `PATH` between unique markers — stdin null, 5 s timeout, output outside the markers
   ignored, resolved once per app run (started in the background at launch), like VS Code's `resolveShellEnv`.
   Registry variables missing from the process environment (e.g. `PNPM_HOME`, `NVM_SYMLINK`) feed step 5.
4. `local` — native installer: `~/.local/bin/claude[.exe]`; macOS/Linux also the legacy `~/.claude/local/claude`.
5. `package` — package managers:
   - Windows: `%LOCALAPPDATA%\Microsoft\WinGet\Links\claude.exe`,
     `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Anthropic.ClaudeCode_*\[*\]claude.exe`,
     Scoop `(%SCOOP% or ~\scoop)\shims\claude.exe` and `\apps\claude-code\current\claude.exe`,
     Chocolatey `(%ChocolateyInstall% or %ProgramData%\chocolatey)\bin\claude.exe`,
     npm global `%APPDATA%\npm` and the `prefix=` of `~\.npmrc` → `node_modules\@anthropic-ai\claude-code\bin\claude.exe`,
     pnpm `(%PNPM_HOME% or %LOCALAPPDATA%\pnpm)\global\*\node_modules\@anthropic-ai\claude-code\bin\claude.exe`,
     Volta `%LOCALAPPDATA%\Volta\bin` and `~\.volta\bin`, nvm-windows
     `%NVM_SYMLINK%\node_modules\@anthropic-ai\claude-code\bin\claude.exe`, Bun `~\.bun\bin\claude.exe`.
   - macOS: `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`; Linux: `/usr/local/bin`, `/home/linuxbrew/.linuxbrew/bin`,
     `~/.linuxbrew/bin`, `/usr/bin`, `/snap/bin`; both: `~/.npm-global/bin`, `<~/.npmrc prefix>/bin`, `~/.volta/bin`,
     `~/.bun/bin`, the highest `~/.nvm/versions/node/v*/bin`, `$PNPM_HOME`, `~/Library/pnpm` (macOS),
     `~/.local/share/pnpm`.
6. `desktop` — binary bundled with the Claude desktop app: Windows `%APPDATA%\Claude\claude-code\<version>\claude.exe`
   and the MSIX location `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude\claude-code\<version>\claude.exe`;
   macOS `~/Library/Application Support/Claude/claude-code/<version>/claude` (**UNCONFIRMED** layout, mirrors Windows).

Within one wildcard the highest semantic version is tried first (at most 3 files per location). Work is bounded:
at most 40 existing candidates, 512 entries read and 8 children followed per wildcard, no recursive scans.

Validation: candidates are tried in order; the first whose `<exe> --version` (10 s timeout, no shell, no console
window, stdin null, API-key variables removed) prints a semantic version as its first token and the text
"Claude Code" (any case, e.g. `2.1.284 (Claude Code)`) is chosen. Rejection reasons: `not_executable` (not an
`.exe` on Windows / no execute bit on Unix / the OS refuses to run it), `timeout`, `bad_output`, `spawn_failed`.

Caching: the chosen install is kept for the app lifetime. `claude_status`, sign-in, turns, `mcp_list` and the
installer plan use it; discovery runs again when nothing is cached, when the cached file no longer exists, on
`claude_status { forceRefresh: true }`, after a successful in-app install and on `claude_clear_executable`
(the registry is re-read each time; the login-shell `PATH` is reused). Discoveries are serialized.

Manual override (`claude_pick_executable`): the file must be absolute, not a `.cmd`/`.bat`/`.ps1`, on Windows named
`claude.exe`, not on a network (UNC) location, and must validate as above; then it is persisted and becomes the
`custom` install. Otherwise the command rejects with `invalid_executable` and a message ending in the reason code,
e.g. `"…: it did not report a Claude Code version (bad_output)."`; nothing is persisted. A persisted override that
no longer validates is skipped (reported as `custom` `missing` / `rejected` in `claude_locate_report`), never fatal.

Diagnostics (`claude_locate_report`): runs a fresh discovery that validates every candidate (it also refreshes the
cache). Missing locations beyond the 60-entry limit are summarized per source as `"N more locations"` with reason
`"summarized"`.

Child processes on macOS/Linux: every `claude` spawn (status, sign-in, turns, `mcp list`, validation, the
installer) gets `PATH` = this process's `PATH` + the login-shell `PATH` + the directory of the executable,
deduplicated, relative entries dropped — so npm / nvm `#!/usr/bin/env node` launchers work in a GUI app. Windows
children inherit the process environment.

## Installing Claude Code (in-app, native installer replicated in Rust)

| Command | Args | Returns |
|---|---|---|
| `claude_install_plan` | `{ channel: "stable" \| "latest" }` | `InstallPlan` — resolves version, fetches + **verifies** the signed manifest; no binary download |
| `claude_install_start` | `{ channel: "stable" \| "latest", onEvent: Channel<InstallEvent> }` | `installId: string` |
| `claude_install_cancel` | `{ installId }` | `null` (no-op for unknown/finished ids) |

```ts
InstallPlan {
  version: string;            // e.g. "2.1.285"
  channel: "stable" | "latest";
  platform: string;           // "win32-x64" | "win32-arm64" | "darwin-arm64" | "darwin-x64" | "linux-x64" | "linux-arm64" | "linux-x64-musl" | "linux-arm64-musl"
  sizeBytes: number;
  sourceHost: "downloads.claude.ai";
  installDir: string;         // where the launcher ends up, e.g. "C:\Users\me\.local\bin" (display only)
  autoUpdates: true;          // native installs update themselves
  alreadyInstalled: ClaudeInstall | null;
}
InstallEvent =
  | { type: "phase"; phase: "resolving" | "verifying_manifest" | "downloading" | "verifying_binary" | "installing" | "checking" }
  | { type: "progress"; receivedBytes: number; totalBytes: number }   // throttled (≤ 10/s)
  | { type: "done"; install: ClaudeInstall }
  | { type: "error"; code: string; message: string }                  // codes below
  | { type: "cancelled" }
// exactly one of done | error | cancelled is the last event
```

Algorithm (mirrors the official `install.sh` / `install.ps1`, without piping a remote script into a shell):

1. Platform detection as the official scripts: Windows `PROCESSOR_ARCHITECTURE`/`IsWow64Process2` → `win32-arm64|win32-x64`;
   macOS arch with Rosetta check (`sysctl.proc_translated` = 1 → `darwin-arm64`); Linux arch + musl detection
   (`/lib/libc.musl-{x86_64,aarch64}.so.1` exists or `ldd --version` mentions musl). Unsupported → `unsupported_platform`.
2. `GET https://downloads.claude.ai/claude-code-releases/{stable|latest}` → must match `^\d+\.\d+\.\d+$` (else `unexpected_response`,
   e.g. region block / captive portal HTML).
3. `GET …/{version}/manifest.json` and `…/{version}/manifest.json.sig`; verify the detached OpenPGP signature with the
   **embedded** Anthropic release key, pinned to fingerprint `31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE`
   (else `signature_invalid`); `manifest.version` must equal the requested version; take `platforms[platform]
   {binary, checksum (sha256 hex), size}`.
4. Stream `…/{version}/{platform}/{binary}` into a unique temp file in the per-user app cache dir, hashing SHA-256 on the
   fly, enforcing the exact `size`; resume with HTTP `Range` on transient failures (≤ 3 attempts); constant-time hash
   compare (else `checksum_mismatch`, file deleted).
5. Defense in depth: Windows `WinVerifyTrust` + signer subject must be "Anthropic, PBC"; macOS `codesign --verify --strict`
   + Team ID / "Anthropic PBC" authority check; Linux: manifest signature only (binaries are unsigned upstream).
   Failure → `publisher_untrusted`.
6. Run `<temp binary> install <channel>` (no elevation, stdin null, no console window, timeout 10 min, API-key env vars
   removed); then locate `~/.local/bin/claude[.exe]` and run `--version` (else `install_failed` with a short output tail).
7. Delete the temp file (retry on Windows file locks). Never elevate; never modify PATH (the app spawns by absolute path).

Network: HTTPS only (rustls + OS certificate store), host allowlist `downloads.claude.ai` (redirects to other hosts
are refused), standard proxy env vars honored (`HTTPS_PROXY`, `NO_PROXY`), connect timeout 15 s, read timeout 60 s.
Error codes: `unsupported_platform`, `network`, `unexpected_response`, `signature_invalid`, `checksum_mismatch`,
`publisher_untrusted`, `install_failed`, `disk_full`, `busy` (an install is already running), `cancelled` is an event, not an error.

Notes (installer implementation):
- `claude_install_plan` rejects with the installer codes of steps 1-3 (`unsupported_platform`, `network`,
  `unexpected_response`, `signature_invalid`). `claude_install_start` rejects only with `busy` / `internal`; every
  later failure is an `error` event. It returns a UUID `installId`; `claude_install_cancel` rejects a non-UUID id with
  `invalid_argument`. One install at a time; a running install is cancelled on app exit.
- The published `manifest.json.sig` is ASCII-armored; binary detached signatures are accepted too. Signature type must
  be binary/text, the issuer fingerprint (when present) must be the pinned one, and the embedded key's own
  self-signature is checked. `manifest.platforms[p].binary` must be exactly `claude` / `claude.exe`, `checksum`
  64 hex chars, `0 < size <= 2 GiB` (else `unexpected_response`); a missing platform entry is `unsupported_platform`.
- Version text: ASCII digits only, each part <= 9 digits, total <= 32 chars. HTTP 403/451 or an HTML response add a
  "region / proxy" hint to `unexpected_response`; 408/429/5xx and transport errors are `network`.
- Download: temp file `<app cache>/installer/claude-install-<uuid>[.exe]` (dir 0700, file 0600 -> 0700 after
  verification on Unix); leftovers of interrupted installs are swept at the next start. Up to 3 resumes (`Range`,
  backoff 1/2/4 s); a server ignoring `Range` restarts from 0; a body longer than the signed `size` is
  `unexpected_response`. Free space (Windows) must be `size + 64 MB` on the cache and home volumes, else `disk_full`.
- Windows publisher check: `WinVerifyTrust` (no UI, no online revocation, cache-only URL retrieval) + common name of the
  verified primary signer == `Anthropic, PBC`. macOS: `codesign --verify --strict --deep`, leaf
  `Authority=Developer ID Application: Anthropic…(TEAMID)` with matching `TeamIdentifier`; `spctl` is informational.
- `install` output (stdout+stderr, last 64 KB) is sanitized for error messages: ANSI/control characters removed, the
  home directory shown as `~`, last 300 characters. Linux exit 137 is reported as out-of-memory.
- The app itself never modifies PATH or shell profiles; what `claude install` does to the user's environment is the
  official installer's behaviour.

Notes (implementation):
- `claude_status` returns `install: null` (and `loggedIn: false`) when no candidate validates; it rejects with
  `timeout` / `spawn_failed` / `cli_failed` when the CLI cannot be run or its status JSON cannot be read.
  `install.path` is the canonical path on Windows (for the desktop app this is the MSIX-redirected location under
  `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\...`) and the path as found on macOS/Linux (a launcher
  symlink keeps working across updates). `install.version` is re-read with `--version` on every status call
  (falls back to the version seen at validation).
- `subscription` is `true` only when `loggedIn` and the auth method is a claude.ai/OAuth sign-in (or unknown with a
  `subscriptionType`); Console / API key / Bedrock / Vertex are never a subscription.
- `claude_auth_login` returns as soon as the console is spawned; poll `claude_status` until `loggedIn`.
  `claude_auth_logout` rejects with `cli_failed` on a non-zero exit.

## Projects and sessions (Claude Code history)

Projects = directories under `<configDir>/projects` (Claude Code history) merged with folders the user opened in
Crowe Harness (app registry in the app data dir). Project path = `cwd` recorded in the newest transcript.

| Command | Args | Returns |
|---|---|---|
| `projects_list` | – | `ProjectInfo[]` sorted by `lastActivity` desc |
| `projects_open_folder` | – | `ProjectInfo \| null` — native folder picker (Rust side), registers the folder |
| `sessions_list` | `{ projectId }` | `SessionInfo[]` sorted by `updatedAt` desc |
| `session_read` | `{ projectId, sessionId }` | `Transcript` |
| `subagent_read` | `{ projectId, sessionId, agentId }` | `SubagentTranscript` |

```ts
ProjectInfo   { id; name; path: string | null; sessionCount; lastActivity: string | null; source: "history" | "opened" }
SessionInfo   { id; projectId; title; createdAt; updatedAt; messageCount; gitBranch: string | null; model: string | null; subagentCount }
SubagentInfo  { id; agentType: string | null; description: string | null; toolUseId: string | null; messageCount; updatedAt }
Transcript    { session: SessionInfo; messages: TranscriptMessage[]; subagents: SubagentInfo[]; truncated: boolean }
SubagentTranscript { subagent: SubagentInfo; messages: TranscriptMessage[]; truncated: boolean }
TranscriptMessage { id; role: "user" | "assistant"; timestamp: string | null; model: string | null; blocks: Block[] }
Block =
  | { type: "text"; text }
  | { type: "tool_use"; id; name; input: string }                 // JSON, truncated to 4 KB
  | { type: "tool_result"; toolUseId; isError: boolean; text }    // truncated to 8 KB
```

Title: last `custom-title` → last `ai-title` → first user text (≤ 80 chars). Thinking blocks, attachments,
`system`/meta records are skipped. At most the last 1000 messages are returned (`truncated: true` otherwise).

Notes (implementation):
- Project ids: history projects use the history directory name; opened folders use `opened-<12 hex>`. When an
  opened folder has Claude Code history it is listed once, under the history id (`projects_open_folder` then
  returns that history project); the `opened-…` id keeps resolving for every command. History directories without
  any non-empty session are not listed.
- `ProjectInfo.sessionCount` counts non-empty transcript files (sessions with only meta records may be included
  until `sessions_list` has scanned them); `lastActivity` is the newest transcript's mtime. `path` is the folder
  recorded in the newest transcript (`null` if none); commands that need the folder (`fs_*`, `turn_start`, project
  agents/skills) reject with `not_found` when it no longer exists.
- Session ids are UUIDs (`<uuid>.jsonl`); `agentId` is `[A-Za-z0-9_-]{1,128}` (from `agent-<id>.jsonl`).
- Consecutive assistant records with the same API message id are merged into one `TranscriptMessage` (id = API
  message id; user messages use the record `uuid`). Slash-command wrappers become `/name args`; local command
  output, caveats and system reminders are hidden; images become a `[image]` text block. A single text block is
  capped at 256 KB. `SessionInfo.messageCount` counts the messages as `session_read` would return them.
- `createdAt`/`updatedAt` are the first/last message timestamps (file mtime as fallback). `subagents` are ordered
  oldest first; `SubagentInfo.updatedAt` is the last message timestamp.

## Live turns (headless Claude Code)

| Command | Args | Returns |
|---|---|---|
| `turn_start` | `{ projectId, sessionId: string \| null, prompt, permissionMode: "default" \| "acceptEdits" \| "plan", onEvent: Channel<TurnEvent> }` | `turnId: string` |
| `turn_cancel` | `{ turnId }` | `null` — kills the process tree |

Spawn: `claude -p --output-format stream-json --verbose --include-partial-messages --input-format stream-json
--permission-mode <mode> [--resume <sessionId>]`, cwd = project path, one user message written to stdin then closed.

`TurnEvent` (tag `type`, mirrors the UI `AIEvent`):

```ts
| { type: "session_started"; sessionId; model: string | null }
| { type: "message_start"; messageId }
| { type: "text_delta"; messageId; text }
| { type: "tool_call_start"; id; messageId; name; input: string }
| { type: "tool_call_end"; id; status: "success" | "error"; output: string }
| { type: "subagent_started"; toolUseId; agentType: string | null; description: string | null }
| { type: "message_end"; messageId; stopReason: "end_turn" | "interrupted"; usage: { inputTokens; outputTokens; costUsd: number | null } | null }
| { type: "permission_denied"; toolName; toolUseId }
| { type: "error"; message }
| { type: "exit"; code: number | null }        // always the last event
```

Event semantics (implementation):
- Validation: `prompt` non-empty and ≤ 100 000 chars, `sessionId` a UUID, `permissionMode` exactly one of the three
  values (anything else is a deserialization error). At most 8 turns run at once (`too_many_turns`). `turnId` is a UUID.
- An assistant message gets `message_end` (`end_turn`, `usage: null`) when the next assistant message starts; the
  last one gets `message_end` with `usage` at the CLI `result`. `usage.inputTokens` includes cache creation + cache
  read tokens; `costUsd` is the CLI's `total_cost_usd`.
- `tool_call_end` has no `messageId` (attribute it via the tool id). `permission_denied` events precede the final
  `message_end`. An `error` follows the final `message_end` when the result is an error, or is emitted alone
  (with a short stderr tail) when the process exits non-zero without a result; a message still open at that point
  gets `message_end` `interrupted`.
- Records of subagents (non-null `parent_tool_use_id`) are not forwarded; the subagent itself is visible through
  `subagent_started` and later through `subagent_read`.
- `turn_cancel` kills the process tree (Windows Job Object), then emits `message_end` `interrupted` for an open
  message and `exit` (`code` may be `null`). Cancelling an unknown or finished turn is a no-op. All turns are killed
  when the app exits.

## Workspace (read-only files) and Claude configuration

| Command | Args | Returns |
|---|---|---|
| `fs_list_dir` | `{ projectId, relPath }` | `DirEntry[]` (`{ name; relPath; kind: "file" \| "dir" }`, gitignore-aware, dirs first) |
| `fs_read_file` | `{ projectId, relPath }` | `{ content: string; truncated: boolean; binary: boolean }` (≤ 1 MB) |
| `agents_list` | `{ projectId: string \| null }` | `AgentInfo[]` (`{ name; description; tools: string[]; model: string \| null; scope: "user" \| "project" }`) |
| `skills_list` | `{ projectId: string \| null }` | `SkillInfo[]` (`{ name; description; scope: "user" \| "project" }`) |
| `mcp_list` | – | `McpServerInfo[]` (`{ name; target; status: "connected" \| "failed" \| "needs_auth" \| "unknown" }`, from `claude mcp list`) |

Notes (implementation):
- `relPath` uses `/` separators; `""` is the project root. `..`, absolute paths, drive/ADS syntax and symlinks or
  junctions leaving the project are rejected (`invalid_argument` / `forbidden`). `.git` is always hidden, other dot
  files are listed; `.gitignore` files from the root down plus `.git/info/exclude` are honoured. A listing is capped
  at 10 000 entries. Binary files (NUL byte in the first 8 KB) return `content: ""`, `binary: true`.
- `agents_list` / `skills_list` read `~/.claude/agents/*.md`, `~/.claude/skills/*/SKILL.md` and, with a
  `projectId`, `<project>/.claude/agents/*.md`, `<project>/.claude/skills/*/SKILL.md`; sorted by name. `name` falls
  back to the file/dir name, `tools` accepts a comma-separated string or a YAML list.
- `mcp_list` runs in a neutral directory (user-scope servers). `target` is redacted (URL userinfo and query, and
  secret-looking CLI arguments become `***`). "Pending approval" and other states map to `unknown`.
