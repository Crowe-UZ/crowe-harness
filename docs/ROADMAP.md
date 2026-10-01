# Crowe Harness — Roadmap до 1.0

Требования — в [SPEC.md](SPEC.md). Каждый milestone заканчивается проверками и отдельным commit:

```
pnpm check          # = lint && typecheck (tsc -b) && test && build
pnpm lint:rust      # = cargo fmt --check && cargo clippy --all-targets -- -D warnings
cargo test          # в src-tauri, с M2
```

плюс ручная проверка UI (`pnpm dev` → http://localhost:1420 или `pnpm tauri dev`).

| Milestone | Статус |
|---|---|
| M0 — Окружение и документы | ✅ |
| M1 — Foundation / UI shell | ✅ |
| M2 — Claude Code и вход по подписке | ⏳ следующий |
| M3 — Чат с реальным runtime | ☐ |
| M4 — Persistence | ☐ |
| M5 — Files | ☐ |
| M6 — Terminal | ☐ |
| M7 — Git | ☐ |
| M8 — Agents / Skills / MCP | ☐ |
| M9 — Settings, UX polish, accessibility | ☐ |
| M10 — Quality и релиз 1.0 | ☐ |

---

## M0 — Окружение и документы
- Rust через `winget install --id Rustlang.Rustup -e`, `rustup default stable-msvc`; `npm i -g pnpm`.
- `pnpm create tauri-app . --template react-ts --manager pnpm --identifier com.crowe.harness --yes`; `git init`; SPEC/ROADMAP.

## M1 — Foundation / UI shell (исходный v0.1)
- Tooling: Tailwind 4, shadcn (Radix), ESLint, Vitest, alias `@`, скрипты. `tauri.conf.json`: Crowe Harness, 1280×800, min 960×600, CSP, `targets: ["nsis"]`. Удалить greet/opener.
- Design tokens (`:root`/`.dark`, `--brand-*`), ThemeProvider, AppLayout, TopBar, AppSidebar (collapsible), StatusBar, Inspector.
- Все routes и страницы на mock-данных (Atlas/Mercury/Phoenix): Home, Projects, Project (Chat/Files/Terminal), Session, Agents, Skills, MCP, Settings, 404. Переключение темы.
- Слой сервисов: интерфейсы `AIProvider`/`AuthService` + `MockAIProvider`/`MockAuthService`; Zustand stores.
- **Приёмка:** DoD исходного ТЗ (пп. 1–22) + `pnpm tauri build` → NSIS-инсталлятор.

## M2 — Claude Code и вход по подписке
- Rust `claude/`: detect (`which` + override-путь), `auth_status`, `auth_login` (видимый терминал с `claude auth login`), `auth_logout`.
- `TauriAuthService`, онбординг, Settings → Account, статус в status bar.
- Требует действий пользователя: установить Claude Code и пройти OAuth в браузере.
- **Приёмка:** реальный статус «Signed in as … (план)»; sign-in/out работают; код не читает credentials (grep).

## M3 — Чат с реальным runtime
- Менеджер процессов: `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages`, `--session-id`/`--resume`, `--permission-mode`, `--model`; NDJSON → `AIEvent` → `ipc::Channel`.
- `ClaudeCodeProvider`; Markdown/код, tool cards, inline diff, interrupt, permission prompts (`--permission-prompt-tool`; fallback — permission modes + allowlist).
- **Приёмка:** диалог в реальном проекте со стримингом, tool calls, Stop и resume после перезапуска.

## M4 — Persistence
- SQLite (rusqlite): projects, sessions, messages, events, settings; миграции; stores → ProjectService/SessionService; поиск.
- **Приёмка:** данные переживают перезапуск; удаление из истории — с подтверждением.

## M5 — Files
- Rust fs: tree (`ignore`), read/write, watcher (`notify`), path guard. UI: дерево, Ctrl+P, CodeMirror 6 (просмотр/редактирование), подсветка изменённого.
- **Приёмка:** правки агента видны live; выход за корень проекта отклоняется (unit-тест).

## M6 — Terminal
- Rust PTY (`portable-pty`) через Channel; xterm.js, вкладки, resize, cleanup.
- **Приёмка:** команды выполняются в PowerShell внутри приложения; после закрытия вкладок нет процессов-сирот.

## M7 — Git
- Rust-обёртка над git CLI; панель: status, diff, stage/unstage, commit, ветки, log; Changes в inspector.
- **Приёмка:** цикл «агент изменил → diff → stage → commit»; деструктивное — только с подтверждением.

## M8 — Agents / Skills / MCP
- Config-сервис для `.claude/agents`, `.claude/skills`, `.mcp.json` (project/user scope); редакторы и шаблоны; `claude mcp list` для статусов; keychain для секретов MCP.
- **Приёмка:** subagent, созданный в UI, вызывается в сессии; MCP-сервер виден в `claude mcp list`.

## M9 — Settings, UX polish, accessibility
- Все разделы Settings, command palette (Ctrl+K), горячие клавиши, уведомления, window-state, a11y/контраст, локальные логи.

## M10 — Quality и релиз 1.0
- Тесты ключевой логики (NDJSON-парсер, path guard, stores, сервисы), e2e smoke.
- CI (GitLab CI или GitHub Actions): lint, typecheck, test, clippy, NSIS.
- Иконки (`pnpm tauri icon`), версия 1.0.0, updater (ключи подписи — у владельца), code signing при наличии сертификата.
- README: prerequisites, Claude Code и вход, разработка, сборка, архитектура, безопасность.
