# Crowe Harness

Crowe Harness is a desktop AI development workspace: projects, sessions, files, terminal, git, agents, skills and MCP in one native app. **Claude Code** is its AI runtime, and you sign in with your own Claude subscription.

> **Status: v0.1, milestone M1 (UI shell).** The interface runs on demo data and a mock runtime. Claude integration, the real file system, terminal and git arrive in the next milestones. See [docs/ROADMAP.md](docs/ROADMAP.md) and the full specification in [docs/SPEC.md](docs/SPEC.md).

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

| Tool | Version | Windows install |
|---|---|---|
| Node.js | 22 LTS or newer | https://nodejs.org |
| pnpm | 10 or newer | `npm i -g pnpm` |
| Rust | stable, MSVC toolchain | `winget install --id Rustlang.Rustup -e`, then `rustup default stable-msvc` |
| Microsoft C++ Build Tools | the "Desktop development with C++" workload | Visual Studio Installer |
| WebView2 | Evergreen runtime | Preinstalled on Windows 10 (1803+) and 11 |

On macOS and Linux, follow the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) instead.

From milestone M2 you also need [Claude Code](https://code.claude.com/docs) installed, with a sign-in through your Claude plan.

## Installation

```bash
pnpm install
```

## Development

```bash
pnpm tauri dev      # native desktop window with hot reload
pnpm dev            # browser-only UI at http://localhost:1420
```

Quality checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

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
  pages/                     Home, Projects, Project (Chat/Files/Terminal), Agents, Skills, MCP, Settings, 404
  components/
    layout/                  TopBar, StatusBar, ThemeProvider, CommandPalette, Logo
    sidebar/                 AppSidebar (collapsible, Ctrl+B)
    chat/ files/ terminal/   workspace panels
    projects/ sessions/      cards, dialogs, inspector
    common/                  EmptyState, PageHeader
    ui/                      shadcn/ui primitives (generated)
  features/
    ai/                      AIProvider + AuthService contracts, mock implementations, services.ts
    workspace/               mock file system
  stores/                    Zustand stores (projects, sessions, chat, settings, auth, ui)
  data/                      domain types and demo data
  lib/                       utils, theme, time helpers
  index.css                  design tokens (brand colors live in --brand-*)
src-tauri/                   Rust shell, capabilities, tauri.conf.json
docs/                        SPEC.md and ROADMAP.md
```

## Architecture

```
UI  →  AIProvider / AuthService (src/features/ai)  →  runtime
                                                      ├─ MockAIProvider       (now)
                                                      └─ Claude Code adapter  (M2–M3, through Rust)
```

The UI talks only to the interfaces. `src/features/ai/services.ts` is the single place where the implementation is chosen.

## Security

- No credentials, API keys or tokens are stored in this repository or by the app.
- Claude sign-in goes through Claude Code's own flow (`claude auth login`). Crowe Harness never reads Claude credential files and never handles tokens.
- Secrets added later (for example MCP server tokens) go to the OS keychain.
- No telemetry.
- The demo terminal never executes commands.

## Theming

All colors are semantic tokens in `src/index.css` (`background`, `foreground`, `muted`, `border`, `primary`, `secondary`, `success`, `warning`, `danger`). To re-brand the app, change the `--brand-*` variables there.
