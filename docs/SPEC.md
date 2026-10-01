# Crowe Harness 1.0 — техническое задание

> Статус: утверждено · Дата ревизии: 2026-10-01 · Версии технологий и политики Anthropic проверены по официальным источникам на эту дату.

## Назначение

Crowe Harness — собственная desktop-платформа Crowe для AI-разработки (Tauri 2 + React). Это не клон ChatGPT/Claude Desktop/VS Code: это workspace из проектов, сессий, файлов, терминала, git, агентов, skills и MCP, где AI runtime — **Claude Code**, в который пользователь входит **своей подпиской Claude** (Pro/Max/Team/Enterprise).

Архитектурный принцип (неизменен с исходного ТЗ):

```
UI → Provider abstraction (AIProvider / AuthService) → AI runtime (Mock → Claude Code CLI)
```

UI не зависит от конкретного runtime. Порядок реализации — в [ROADMAP.md](ROADMAP.md).

### Эталонное окружение разработки
Windows 11 x64 · Node ≥ 22 LTS · pnpm ≥ 10 · Rust stable-msvc · Visual Studio Build Tools («Desktop development with C++») · WebView2 · git · Claude Code CLI (с M2).

---

## A. Исправления исходного ТЗ (проверено по официальным источникам)

| # | В исходном ТЗ | Проблема | Исправление |
|---|---|---|---|
| 1 | `uname`, `source ~/.cargo/env`, `curl sh.rustup.rs` | Unix-команды, а у нас Windows | `winget install --id Rustlang.Rustup -e`, `rustup default stable-msvc` (Tauri требует MSVC), обновить PATH в сессии |
| 2 | `corepack prepare pnpm@latest` | Corepack убран из Node ≥25 | `npm i -g pnpm` (pnpm.io/installation) |
| 3 | Создать вложенную `crowe-harness/` | Рабочая папка уже является проектом | `pnpm create tauri-app . --template react-ts --manager pnpm --identifier com.crowe.harness --yes`; **не** использовать `--force` (удаляет всё, кроме .git) |
| 4 | identifier не задан | `com.tauri.dev` отклоняется `tauri build` | `com.crowe.harness` |
| 5 | Window controls в top bar | Кастомный titlebar = `decorations:false` + window-permissions, теряются Snap Layouts | Нативная рамка окна; top bar — внутри окна |
| 6 | React Router | Актуальна **v8** (пакет `react-router`; `react-router-dom` удалён) | `createHashRouter` из `react-router`, `RouterProvider` из `react-router/dom` (hash безопасен для `http://tauri.localhost`) |
| 7 | Tailwind | Актуальна **v4.3**: `@tailwindcss/vite`, без config/postcss | Официальный Vite-гайд |
| 8 | shadcn/ui | С 07.2026 по умолчанию Base UI, OKLCH, `tw-animate-css` | `pnpm dlx shadcn@latest init -t vite -b radix -d -y` |
| 9 | Alias `@/*` | В шаблоне Tauri нет `tsconfig.app.json`; в TS 6 `baseUrl` deprecated | `paths` в `tsconfig.json`, alias в vite.config, `@types/node` |
| 10 | `pnpm lint` | В шаблоне create-tauri-app нет ESLint | ESLint flat config + скрипты `lint`, `typecheck`, `test` |
| 11 | TypeScript latest | TS 7 не поддерживается typescript-eslint | Зафиксировать `typescript ~6.0` |
| 12 | `tauri build` (all targets) | MSI требует WiX + компонент VBSCRIPT | `bundle.targets: ["nsis"]`; MSI — опционально позже |
| 13 | Zustand | v5: селектор, который возвращает новый объект, зацикливает ре-рендер | Атомарные селекторы / `useShallow` |
| 14 | `AIProvider.sendMessage(): Promise<void>` | Runtime отдаёт поток событий, а также нужны interrupt, permissions и resume | Событийный интерфейс (раздел C) |
| 15 | Будущий ClaudeAgentProvider на Agent SDK | Agent SDK не работает в webview. Главное: **в продуктах его можно использовать только с API key**, а это несовместимо с входом по подписке | Runtime — **Claude Code CLI adapter**: Rust запускает установленный у пользователя `claude` в headless stream-json. Node-backend не нужен |
| 16 | «Claude authentication» в приложении | Политика Anthropic (code.claude.com/docs/en/legal-and-compliance, ужесточена в 01–02.2026) запрещает свой claude.ai-логин, сбор, хранение и проксирование токенов, `setup-token`, подмену Claude Code. **Разрешено**: пользователь сам входит своей подпиской в немодифицированный Claude Code | Вход через собственный flow Claude Code (`claude auth login`); приложение не касается токенов |
| 17 | `/projects` в routes без страницы | Нет страниц Projects/Agents/Skills/MCP в структуре | Добавить страницы |
| 18 | «CROWЕ» | Кириллическая «Е» | Латиница |
| 19 | Шаблон: `csp:null`, `greet`, `plugin-opener` | Лишняя поверхность атаки | Строгий CSP, удалить demo-код |
| 20 | «Мы не делаем real git/terminal/MCP» | Это ограничение v0.1, а в 1.0 эти функции нужны | Перенесено в milestones M5–M8 |

---

## B. ТЗ Crowe Harness 1.0 — функциональные требования

### B1. Вход и аккаунт (подписка Claude)
- Онбординг при первом запуске: проверка Claude Code → вход → выбор/добавление первого проекта.
- `claude` не найден → экран «Install Claude Code» (официальные способы установки, кнопка «Check again»; поле для пути к `claude` в Advanced).
- `claude auth status` (exit 0 — вошёл, 1 — нет; JSON парсить защитно: `loggedIn`, `authMethod`, `email`, `orgName`, `subscriptionType`) → показывать email, организацию и план.
- «Sign in with Claude» → видимое окно терминала с `claude auth login` (OAuth в браузере проводит Claude Code), приложение опрашивает статус. «Sign out» → `claude auth logout`.
- Fallback-режимы (в Settings → Account → Advanced): API key / Bedrock / Vertex. Ключ хранится в OS keychain, передаётся в env процесса только в этом режиме.
- **Запреты:** не читать `%USERPROFILE%\.claude\.credentials.json`; не собирать и не хранить токены; не просить `setup-token`/`CLAUDE_CODE_OAUTH_TOKEN`; не использовать `--bare`; в режиме подписки не выставлять `ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN` в env дочернего процесса; не модифицировать бинарь и не подделывать заголовки; логотип Claude Code не использовать, только текст «Powered by Claude Code».
- Корпоративно: `forceLoginOrgUUID` через managed settings (`C:\Program Files\ClaudeCode\managed-settings.json` / `HKLM\SOFTWARE\Policies\ClaudeCode`). Значение `forceLoginMethod` в документации расходится (`claudeai`/`claude-ai`), проверить на установленной версии.
- **Юридический риск:** документация называет `claude -p` «Agent SDK via the CLI», это серая зона. Перед корпоративным rollout нужно принять Commercial Terms и получить письменное подтверждение Anthropic.

### B2. Projects
- Добавить существующую папку (dialog plugin), задать имя и язык (автоопределение по файлам: package.json → TS/JS, pyproject → Python, go.mod → Go, Cargo.toml → Rust).
- Список, поиск, сортировка по последнему открытию, pin. «Remove from Harness» не удаляет файлы на диске (с подтверждением).
- Карточка проекта: путь, язык, git-ветка, число сессий, last opened.

### B3. Sessions
- Несколько сессий на проект: создать, переименовать, архивировать, удалить из истории (с подтверждением).
- Каждая сессия связана с `session_id` Claude Code; продолжение через `--resume`.
- История сообщений и событий хранится локально (SQLite), поиск по сессиям.
- Индикатор статуса: idle / running / waiting for permission / error.

### B4. Chat (основное рабочее окно)
- Стриминг ответа (text deltas), Markdown + GFM, подсветка кода, копирование блоков.
- Карточки tool calls (Read/Edit/Write/Bash/Grep/MCP…): имя, аргументы, статус, результат (сворачиваемый); для Edit/Write — inline diff.
- Permission prompts: Allow once / Always allow for session / Deny. Реализуются через `--permission-prompt-tool` (MCP-инструмент, который отвечает приложение) — проверить в M3.
- Выбор permission mode (default / acceptEdits / plan) и модели (из доступных Claude Code).
- Interrupt (Stop), повтор последнего сообщения, Attach: файлы проекта через @-mention и изображения.
- Activity timeline и счётчик usage/стоимости из `result`-сообщений.
- Composer: Enter — отправка, Shift+Enter — перенос строки, история ввода (↑).

### B5. Files
- Реальное дерево проекта (Rust, учитывает `.gitignore`, lazy-загрузка), поиск файла по имени (Ctrl+P).
- Просмотр с подсветкой синтаксиса (CodeMirror 6), редактирование и сохранение (Ctrl+S), предупреждение о несохранённых изменениях.
- Live-обновление при изменении файлов агентом (file watcher), подсветка изменённых в сессии файлов.
- Доступ только внутри корня зарегистрированного проекта (canonicalize, запрет path traversal).

### B6. Terminal
- Настоящий PTY (portable-pty + xterm.js), shell по умолчанию — PowerShell на Windows, cwd = корень проекта.
- Несколько вкладок, Clear, resize, копирование/вставка; процессы корректно завершаются при закрытии.

### B7. Git
- Статус (staged/unstaged/untracked), diff viewer (side-by-side / unified), stage/unstage файла или всего.
- Commit с сообщением, список веток, переключение и создание ветки, лог (последние N коммитов).
- Через системный `git` CLI из Rust. Деструктивные операции (discard changes, checkout с грязным деревом) только с явным подтверждением. Push/pull — по кнопке, с подтверждением.
- Changes-панель сессии: файлы, изменённые агентом, +/− строки.

### B8. Agents
- CRUD subagents в формате Claude Code: `.claude/agents/*.md` (project scope) и `~/.claude/agents/` (user scope), с frontmatter `name`, `description`, `tools`, `model` и системным промптом.
- Шаблоны: Code Reviewer, Test Engineer, Security Reviewer. Claude Code подхватывает их сам.

### B9. Skills
- Список skills из `.claude/skills/*/SKILL.md` (project) и `~/.claude/skills/` (user): имя, описание, источник.
- Создание и редактирование SKILL.md, enable/disable. Механизм отключения проверить в M8 (native-настройка Claude Code или перенос в `.claude/skills-disabled/`).

### B10. MCP
- Список серверов project (`.mcp.json`) / user scope, статус (`claude mcp list`), add/edit/remove (stdio / http / sse).
- Секреты MCP хранятся в OS keychain и подставляются в env процесса Claude Code (в `.mcp.json` остаются `${VAR}`), в git не попадают.
- Пресеты: GitLab, Jira, Confluence (без готовых credentials).

### B11. Settings
- **General**: папка проектов по умолчанию, поведение при старте, уведомления о завершении сессии.
- **Appearance**: Light / Dark / System, плотность интерфейса, размер шрифта редактора и терминала.
- **Account**: статус Claude-подписки, Sign in/out, fallback-режимы.
- **Security**: permission mode по умолчанию, allow/deny-списки инструментов, информация о managed settings, «telemetry: off» (приложение ничего не отправляет).
- **Advanced**: путь к `claude`, логи (открыть папку), экспорт/сброс локальных данных.

### B12. Общий UX
- Layout из исходного ТЗ: top bar, сворачиваемый sidebar (Ctrl+B), main workspace, правый inspector, status bar (`● Local`, `Claude: <статус/план>`, версия).
- Command palette (Ctrl+K), горячие клавиши, полная клавиатурная навигация, focus states, tooltips, loading / empty / error states, toasts (sonner).
- Визуальный стиль из исходного ТЗ (enterprise, минимализм, семантические токены, бренд через CSS variables, без неона и эмодзи).
- Сохранение размера и положения окна (window-state plugin), системные уведомления о завершении долгих задач.

---

## C. Архитектура

```
React UI (webview)
  ├─ stores (Zustand) + router (React Router 8, hash)
  ├─ services: AIProvider · AuthService · ProjectService · FsService · PtyService · GitService · ConfigService
  │     └─ Tauri implementations (invoke + ipc::Channel)  |  Mock implementations (dev/tests)
  ↓ Tauri IPC (commands + Channels for streams)
Rust core (src-tauri/src/)
  ├─ claude/   detect, auth (status/login/logout), session process manager (spawn claude -p, NDJSON → events, stdin stream-json, interrupt)
  ├─ fs/       tree (ignore crate), read/write, watcher (notify), path guard
  ├─ pty/      portable-pty sessions
  ├─ git/      git CLI wrapper
  ├─ config/   agents / skills / .mcp.json, keychain (keyring)
  ├─ db/       SQLite (rusqlite, bundled): projects, sessions, messages, events, settings
  └─ security  capabilities: only own commands, no shell/fs plugins in the frontend
↓
Claude Code CLI (installed by the user, logged in with their subscription) → Anthropic
```

Интерфейсы фронта (`src/features/ai/types.ts`):
```ts
export type AIEvent =
  | { type: 'session_started'; sessionId: string; model?: string }
  | { type: 'message_start'; messageId: string }
  | { type: 'text_delta'; messageId: string; text: string }
  | { type: 'tool_call_start'; id: string; name: string; input?: unknown }
  | { type: 'tool_call_end'; id: string; status: 'success' | 'error'; output?: string }
  | { type: 'permission_request'; id: string; tool: string; input: unknown }
  | { type: 'message_end'; messageId: string; usage?: { inputTokens: number; outputTokens: number; costUsd?: number } }
  | { type: 'error'; message: string };

export interface AIProvider {
  readonly id: 'mock' | 'claude-code';
  startSession(o: { projectPath: string; resumeSessionId?: string; permissionMode?: string; model?: string }): Promise<string>;
  sendMessage(sessionId: string, text: string, attachments?: Attachment[]): AsyncIterable<AIEvent>;
  interrupt(sessionId: string): Promise<void>;
  respondToPermission(requestId: string, decision: 'allow' | 'allow_session' | 'deny'): Promise<void>;
  stopSession(sessionId: string): Promise<void>;
}

export type AuthStatus =
  | { state: 'cli_not_found' } | { state: 'signed_out' }
  | { state: 'signed_in'; method: 'claude.ai' | 'console' | 'api_key' | 'cloud'; email?: string; orgName?: string; subscriptionType?: string };
export interface AuthService { getStatus(): Promise<AuthStatus>; startLogin(): Promise<void>; logout(): Promise<void> }
```
UI зависит только от интерфейсов. `MockAIProvider`/`MockAuthService` используются в M1 и в тестах, `ClaudeCodeProvider` — с M3.

### Стек 1.0
Базовый: Tauri 2, Rust (stable-msvc), React 19, TypeScript ~6.0, Vite 8, Tailwind 4, shadcn/ui (Radix), lucide-react, Zustand 5, React Router 8, pnpm.
Добавляется по необходимости (каждый — под конкретную функцию):
- Frontend: `@tauri-apps/plugin-dialog | -notification | -window-state | -log | -updater`, `@xterm/xterm` + `@xterm/addon-fit`, CodeMirror 6 (+ `@codemirror/merge` для diff), `react-markdown` + `remark-gfm` + `shiki`.
- Тесты: Vitest + Testing Library.
- Rust: `serde`, `tokio`, `portable-pty`, `notify`, `ignore`, `rusqlite` (bundled), `keyring`, `which`, `uuid`, `thiserror`.

---

## D. Нефункциональные требования
- Безопасность: минимальные capabilities, строгий CSP, все пути проверяются в Rust, секреты только в OS keychain, никакой телеметрии, `.env*` в `.gitignore` (кроме `.env.example`).
- Производительность: холодный старт < 2 с, дерево в 10k файлов с lazy-загрузкой, стриминг без подтормаживаний (батчинг delta-обновлений).
- Надёжность: падение процесса `claude` не роняет UI (error state + restart), корректное завершение дочерних процессов при выходе.
- Доступность: клавиатура, ARIA-роли, контраст по WCAG AA в обеих темах.
- Платформы: Windows 10/11 x64 — основная (NSIS-инсталлятор); macOS и Linux — сборка без регрессий, best effort.
- Качество: ESLint и TypeScript без ошибок, Vitest и `cargo test`/`cargo clippy -D warnings` зелёные, CI собирает инсталлятор.

---

## E. План реализации

Milestones M0–M10 с критериями приёмки — в [ROADMAP.md](ROADMAP.md).

---

## F. Definition of Done 1.0
1. Онбординг: обнаружение Claude Code, вход по подписке через `claude auth login`, отображение плана; приложение не читает и не хранит токены.
2. Проекты — реальные папки, сохраняются между запусками.
3. Сессии стримят реальные ответы Claude Code, показывают tool calls и diff, поддерживают permissions, Stop и resume.
4. Files: просмотр и редактирование с live-обновлением в пределах проекта.
5. Terminal: настоящий PTY с вкладками.
6. Git: status, diff, stage, commit, branches, log.
7. Agents, Skills и MCP управляются из UI и подхватываются Claude Code.
8. Settings полностью работают, тема переключается, есть command palette и клавиатурная навигация.
9. lint, typecheck, Vitest, `cargo clippy`, `cargo test` и build зелёные; `pnpm tauri build` выдаёт NSIS-инсталлятор; CI зелёный.
10. README и `docs/SPEC.md` актуальны; git-дерево чистое; все milestones закоммичены.

