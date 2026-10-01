# Crowe Harness

Crowe Harness is a desktop AI development workspace: projects, chats, files, terminal, git, agents, skills and MCP in one native app. **Claude Code** is its AI runtime, and you sign in with your own Claude subscription.

> **Status: milestones M2–M3 — real Claude Code data, no demo mode.** Sign-in with a Claude subscription (M2), chats with the real runtime in headless mode (M3), and read-only Files, Agents, Skills and MCP views. Terminal and git arrive in later milestones. See [docs/ROADMAP.md](docs/ROADMAP.md) and the full specification in [docs/SPEC.md](docs/SPEC.md).

## Stack

- Tauri 2 (Rust)
- React 19 and TypeScript
- Vite 8
- Tailwind CSS 4
- shadcn/ui (Radix) and Lucide icons
- Zustand 5
- React Router 8
- Vitest and ESLint
- pnpm

## Prerequisites

| Tool                      | Version                                                 | Windows install                                                             |
| ------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------- |
| Node.js                   | 22 LTS or newer                                         | https://nodejs.org                                                          |
| pnpm                      | 10 or newer (the repo pins 12.8.1 via `packageManager`) | `npm i -g pnpm`                                                             |
| Rust                      | stable, MSVC toolchain                                  | `winget install --id Rustlang.Rustup -e`, then `rustup default stable-msvc` |
| Microsoft C++ Build Tools | the "Desktop development with C++" workload             | Visual Studio Installer                                                     |
| WebView2                  | Evergreen runtime                                       | Preinstalled on Windows 10 (1803+) and 11                                   |

On macOS and Linux, follow the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) instead.

To use the app you also need:

| Requirement         | Details                                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code         | `winget install Anthropic.ClaudeCode` or another method from [code.claude.com/docs](https://code.claude.com/docs). The copy bundled with the Claude desktop app is detected too. |
| Claude subscription | Pro, Max, Team or Enterprise. Console accounts and API keys are **not** accepted: the app stays locked behind the sign-in screen.                                                |

## Signing in

Crowe Harness never sees your Claude credentials. It only reads the sign-in status that Claude Code reports.

1. On start, the app runs `claude auth status` (through Rust) and shows a sign-in screen until Claude Code is signed in **with a Claude subscription**. The sidebar and pages are not reachable before that.
2. **Sign in with Claude** opens a console window running `claude auth login --claudeai`; Claude Code continues in your browser. The app checks the status every 2 seconds (for up to 10 minutes, cancellable) and opens as soon as sign-in completes.
3. If Claude Code is missing, the screen shows the install command and a **Check again** button. If Claude Code is signed in with a Console account or API key, the screen explains that a subscription is required and offers **Sign out**.
4. The status is re-checked whenever the window regains focus and every 5 minutes. Signing out — in **Settings → Account** (with confirmation) or with `claude auth logout` in a terminal — returns the app to the sign-in screen.

Opening the UI in a plain browser (`pnpm dev`) only shows an "Open Crowe Harness desktop app" screen: all data comes from the Rust core, which exists only in the desktop app.

## Installation

```bash
pnpm install
```

## Development

```bash
pnpm tauri dev      # native desktop window with hot reload (the real app)
pnpm dev            # browser-only UI at http://localhost:1420, shows the "desktop app required" screen
```

Quality checks:

```bash
pnpm check          # lint + typecheck + test + build, run before every commit
pnpm lint:rust      # cargo fmt --check + cargo clippy --all-targets -D warnings (in src-tauri)
```

| Script                              | What it does                                                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                         | ESLint with type-aware rules (`no-floating-promises`, `no-misused-promises`), Testing Library and Vitest rules for tests         |
| `pnpm typecheck`                    | `tsc -b` over `tsconfig.app.json` (app), `tsconfig.test.json` (tests) and `tsconfig.node.json` (`vite.config.ts`); emits nothing |
| `pnpm test` / `pnpm test:watch`     | Vitest (jsdom) once / in watch mode                                                                                              |
| `pnpm coverage`                     | Tests with V8 coverage; HTML report in `coverage/`                                                                               |
| `pnpm format` / `pnpm format:check` | Prettier write / check                                                                                                           |
| `pnpm build`                        | Type-check and build the frontend into `dist/`                                                                                   |

Tests live next to the code (`*.test.ts(x)`); shared helpers are in `src/test/` (`renderApp`, a controllable `matchMedia`). Tests run the real service implementations against `FakeNativeClient` (`src/test/fakes/`), an in-memory stand-in for the Rust commands with fixture data, failure injection and scriptable turns (`turn.emit(...)`, `turn.exit()`). Every test starts with a fresh fake, fresh stores, empty storage and zero-delay sign-in polling. Fakes and fixtures are never imported by application code.

## Build

```bash
pnpm tauri build
```

This produces an NSIS installer at `src-tauri/target/release/bundle/nsis/Crowe Harness_<version>_x64-setup.exe`. The first build downloads the NSIS tooling, so it needs internet access.

## Project structure

```
src/
  app/router.tsx             hash-based routes (React Router 8)
  layouts/AppLayout.tsx      top bar, sidebar, workspace, status bar
  pages/                     Home, Projects, Project (Chat/Files), Agents, Skills, MCP, Settings, 404
  components/
    auth/                    AuthGate (mandatory sign-in screens)
    layout/                  TopBar, StatusBar, ThemeProvider, CommandPalette, Logo
    sidebar/                 AppSidebar (projects, chats, nested agent chats; Ctrl+B)
    chat/                    ChatView, AgentChatView, tool cards, composer, notices
    files/                   lazy file tree and preview
    projects/ sessions/      project cards, chat inspector
    common/                  EmptyState, PageHeader, loading and error states
    ui/                      shadcn/ui primitives (generated)
  features/
    native/                  contract.ts (Rust/UI types) and client.ts (typed invoke wrappers)
    ai/                      AIProvider + AuthService contracts, Claude Code implementations, services.ts
    history/ workspace/ config/   HistoryService, FsService, ConfigService and native implementations
    chat/                    view model shared by stored transcripts and live turns
  stores/                    Zustand: auth, projects and sessions (caches), chat (live turns), settings (persisted), ui
  data/                      domain type aliases
  lib/                       utils, theme, time helpers
  test/                      setup, renderApp, fakes/ (FakeNativeClient and fixtures)
  index.css                  design tokens (brand colors live in --brand-*)
src-tauri/                   Rust shell, capabilities, tauri.conf.json
docs/                        SPEC.md, ROADMAP.md, NATIVE_API.md (command contract)
```

## Architecture

```
UI (pages, components, stores)
  → services: AIProvider · AuthService · HistoryService · FsService · ConfigService   (interfaces)
    → ClaudeCodeProvider, ClaudeCodeAuthService, Native*Service                      (src/features/**)
      → NativeClient (src/features/native/client.ts: invoke + Channel)
        → Rust core (src-tauri) → installed Claude Code CLI → Anthropic
```

- The UI talks only to the interfaces. `src/features/ai/services.ts` is the single composition point; tests swap the native client for `FakeNativeClient`.
- **Chats** come from Claude Code's own history (`~/.claude/projects`). Projects and chat lists are in-memory caches loaded from Rust; only preferences are persisted (theme, inspector, default permission mode, open last project). Mock-era storage keys are dropped on start.
- **Live turns** run headless Claude Code (`claude -p --output-format stream-json`, `--resume <id>` to continue). A new chat starts with `sessionId: null`; when `session_started` arrives the view continues under `/projects/:projectId/sessions/:id`, and after the turn the chat list and transcript are reloaded from history.
- **Permissions:** headless Claude Code cannot ask interactively. Tools denied by the selected permission mode are reported as `permission_denied` and shown in the chat with a hint to switch the composer to **Accept edits**. The interactive prompt UI remains for runtimes that emit `permission_request`.
- **Routes:** `/`, `/projects`, `/projects/:projectId` (redirects to the newest chat), `/projects/:projectId/sessions/new`, `/projects/:projectId/sessions/:sessionId`, `/projects/:projectId/sessions/:sessionId/agents/:agentId` (read-only agent chat), `/agents`, `/skills`, `/mcp`, `/settings`.

## Security

- No credentials, API keys or tokens are stored in this repository or by the app. The frontend never receives tokens: Rust returns only the sign-in status fields (logged in, method, plan, email, organization).
- Claude sign-in goes through Claude Code's own flow (`claude auth login`). Crowe Harness never reads Claude credential files.
- The webview sends ids, never paths or command lines; Rust resolves and guards every path (see [docs/NATIVE_API.md](docs/NATIVE_API.md)).
- Secrets added later (for example MCP server tokens) go to the OS keychain.
- No telemetry.

### Desktop shell hardening

- **Capabilities.** `src-tauri/capabilities/default.json` grants only the app's own commands (`allow-<command>` for each entry of `NATIVE_COMMANDS`), no `core:*` and no plugin permissions. Every native command must be listed in `APP_COMMANDS` in `src-tauri/build.rs` _and_ granted in a capability. See the "Security rules for native commands (M2+)" section in [docs/SPEC.md](docs/SPEC.md).
- **CSP** (`app.security.csp` in `tauri.conf.json`): `'self'` only, no `data:`/`blob:`, no external hosts, `object-src`/`frame-src`/`base-uri`/`form-action` set to `'none'`.
  - The CSP is applied only to the bundled frontend (packaged builds and `tauri build`). In `pnpm tauri dev` the page is served by Vite at `http://localhost:1420` and the CSP is **not** enforced, so always test CSP-sensitive changes in a packaged build.
  - `index.html` must never contain an inline `<style>` or `<script>`. Tauri adds hashes/nonces for inline content it finds; a nonce in `style-src` makes browsers ignore `'unsafe-inline'`, which would break the inline styles Radix/React set at runtime.
  - Vite inlines assets smaller than 4 KB as `data:` URIs, which this CSP blocks. Keep imported images/fonts above that size or set `build.assetsInlineLimit: 0`.
- **`useHttpsScheme: false`** (main window) is set explicitly: on Windows the app is served from `http://tauri.localhost`. Changing this later changes the origin, which wipes `localStorage`/IndexedDB for existing users, so it must stay fixed.
- **`freezePrototype: true`** freezes `Object.prototype` before any app script runs (prototype-pollution hardening).
- **Navigation guard** (`src-tauri/src/lib.rs`): the webview may only navigate to the app origin (`tauri://localhost`, `http://tauri.localhost`, or the dev server in `tauri dev`). `window.open` / `target="_blank"` popups are denied. The main window is therefore declared with `"create": false` in `tauri.conf.json` and built in `setup()`, because the new-window handler can only be set on the window builder.
- **Release profile** keeps `panic = "unwind"` so a panic in a background task does not kill the UI and destructors (child-process cleanup) still run.
- **Dependencies.** `pnpm-workspace.yaml` enables pnpm supply-chain policies: dependency build scripts are blocked unless listed in `allowBuilds` (`strictDepBuilds`), new releases must be at least 24 hours old (`minimumReleaseAge`), and installs fail on a trust downgrade (`trustPolicy: no-downgrade`).
- Code-signing and updater keys (`*.pfx`, `*.p12`, `*.pem`, `*.key`, `.tauri/`) are git-ignored and must never be committed.

## Theming

All colors are semantic tokens in `src/index.css` (`background`, `foreground`, `muted`, `border`, `primary`, `secondary`, `success`, `warning`, `danger`). To re-brand the app, change the `--brand-*` variables there.
