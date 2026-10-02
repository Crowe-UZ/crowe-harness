# Crowe Harness — Roadmap до 1.0

Требования — в [SPEC.md](SPEC.md). Каждый milestone заканчивается проверками и отдельным commit:

```
pnpm check          # = lint && typecheck (tsc -b) && test && build
pnpm lint:rust      # = cargo fmt --check && cargo clippy --all-targets -- -D warnings
cargo test          # в src-tauri, с M2
```

плюс ручная проверка UI в `pnpm tauri dev` (с M2 `pnpm dev` в обычном браузере показывает только экран «Open Crowe Harness desktop app»: все данные приходят из Rust).

| Milestone | Статус |
|---|---|
| M0 — Окружение и документы | ✅ |
| M1 — Foundation / UI shell | ✅ |
| M2 — Claude Code и вход по подписке | ✅ UI (обязательный sign-in gate, установка Claude Code из приложения) · Rust — по контракту [NATIVE_API.md](NATIVE_API.md) |
| M3 — Чат с реальным runtime | ✅ headless (`claude -p`, `--resume`); вместо интерактивных permission prompts — уведомления `permission_denied` |
| M4 — Persistence | 🟡 частично: проекты и чаты читаются из истории Claude Code; SQLite, поиск, rename/archive — ☐ |
| M5 — Files | 🟡 read-only: ленивое дерево и просмотр; редактор, Ctrl+P, watcher — ☐ |
| M6 — Terminal | ☐ (вкладка Terminal убрана до PTY) |
| M7 — Git | ☐ |
| M8 — Agents / Skills / MCP | 🟡 read-only списки (agents, skills, `claude mcp list`); редакторы и шаблоны — ☐ |
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

## Сделано: реальные данные Claude Code вместо mock (M2, M3, read-only части M5/M8)

- **Удалены** mock-данные и демо-код из runtime приложения: `src/data/mock.ts`, `MockAIProvider`, `MockAuthService`, `MockFsService`, mock-терминал, бейдж «Demo runtime», демо-переключатель состояний входа, «Reset demo data», засеянный разговор, фейковая статистика inspector, mock-списки agents/skills/MCP, диалоги создания/переключения. Тестовые фейки — только в `src/test/fakes/` (`FakeNativeClient` + fixtures).
- **Native client** (`src/features/native/client.ts`): типизированные обёртки `invoke` для всех команд `NATIVE_COMMANDS`, `Channel` для `turn_start`, нормализация `NativeError`, `isDesktopRuntime()`.
- **Сервисы** (`src/features/ai/services.ts` — единая точка сборки): `ClaudeCodeAuthService`, `ClaudeCodeProvider` (TurnEvent → AIEvent, `exit` закрывает поток, Stop → `turn_cancel`), `NativeHistoryService`, `NativeFsService`, `NativeConfigService`.
- **Sign-in gate** (обязательный): checking · не desktop runtime · Claude Code не найден (команда установки, «Check again») · не вошёл («Sign in with Claude» → `claude_auth_login`, опрос статуса каждые 2 с до 10 мин, отмена) · вход без подписки (Console/API key — заблокирован, «Sign out») · ошибка с повтором. Повторная проверка при фокусе окна и каждые 5 мин; выход из аккаунта возвращает к gate.
- **Данные:** проекты/чаты/транскрипты — непостоянные кэши из истории Claude Code; сохраняются только настройки (тема, inspector, permission mode по умолчанию, открытие последнего проекта) с миграцией v1/v2 → v3 и удалением ключей `crowe-harness.projects` / `.sessions`.
- **Маршруты:** `/`, `/projects`, `/projects/:projectId` (→ последний чат или «Start a new chat»), `/projects/:projectId/sessions/new` (первый ход создаёт сессию, затем `replace` на реальный id), `/projects/:projectId/sessions/:sessionId` (продолжение через `--resume`), `/projects/:projectId/sessions/:sessionId/agents/:agentId` (read-only чат субагента), `/agents`, `/skills`, `/mcp`, `/settings`, 404.
- **Чат:** транскрипт с карточками tool calls (результат по `tool_use` id, ошибки выделены, ссылка «Open agent chat» для Task/Agent), стриминг, Stop, ошибки, уведомления об отказе в разрешении с подсказкой переключить режим на «Accept edits», выбор permission mode в composer, «earlier messages truncated», постепенная подгрузка длинных чатов.
- **Sidebar:** Open folder, проекты (топ-8 + All projects), чаты текущего проекта, вложенные agent chats активного чата. Inspector: модель, ветка, счётчики, использование инструментов, агенты, usage/стоимость последнего хода.

### Открытые вопросы
- Интерактивные разрешения (`--permission-prompt-tool`) — не реализованы: headless Claude Code сообщает об отказах, UI prompt остаётся для runtime, который пришлёт `permission_request`.
- Внешние ссылки (документация установки) показываются как текст для копирования: навигация webview за пределы приложения запрещена; нужна отдельная команда `open_external` с проверкой `https:`.
- Markdown/подсветка кода в ответах (B4) — пока plain text с сохранением пробелов.

## M2 — Claude Code и вход по подписке
- Rust `claude/`: detect (`which` + override-путь), `auth_status`, `auth_login` (видимый терминал с `claude auth login`), `auth_logout`.
- `TauriAuthService`, онбординг, Settings → Account, статус в status bar.
- **Установка Claude Code из приложения** (экран «Claude Code not found» → «Install Claude Code»), контракт — раздел «Installing Claude Code» в [NATIVE_API.md](NATIVE_API.md):
  - UI ✅: `ClaudeInstallerService` (`claude_install_plan|start|cancel`, события через `Channel<InstallEvent>`), `installStore` (idle → confirming → running → done | error | cancelled, одна установка за раз, отмена, повтор; после done — повторная проверка статуса и переход к sign-in).
  - Согласие: версия, размер, источник `downloads.claude.ai`, папка установки, канал Stable (рекомендуется) / Latest, «Updates automatically», проверка подписи и checksum, без прав администратора; уже установленный Claude Code — «Check again» вместо установки.
  - Прогресс: шаги по `InstallPhase` (aria-live только при смене шага), progressbar, байты, скорость и оставшееся время (сглаженные на клиенте), Cancel.
  - Ошибки по `InstallErrorCode` с понятными текстами, «Try again», «Other ways to install» (официальные команды для ОС с копированием). Settings → Advanced: путь, версия и источник (PATH / Native install / Package manager / Claude desktop app).
  - Rust (загрузка, проверка OpenPGP-подписи манифеста, SHA-256, подписи издателя, `claude install`) — реализуется по тому же контракту.
- Требует действий пользователя: пройти OAuth в браузере (и подтвердить установку Claude Code, если его нет).
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
