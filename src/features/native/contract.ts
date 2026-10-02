/**
 * TypeScript mirror of the Rust command contract (docs/NATIVE_API.md).
 * Keep both in sync; Rust serializes with `rename_all = "camelCase"`.
 */

export interface NativeError {
  code: string;
  message: string;
}

/** `NativeError.code` values produced by the Rust side (docs/NATIVE_API.md). */
export type NativeErrorCode =
  | "invalid_argument"
  | "not_found"
  | "forbidden"
  | "claude_not_found"
  | "invalid_executable"
  | "spawn_failed"
  | "timeout"
  | "cli_failed"
  | "too_many_turns"
  | "io"
  | "internal";

/** Where the Claude Code that runs was found; `custom` = chosen by the user (`claude_pick_executable`). */
export type ClaudeInstallSource = "custom" | "path" | "local" | "package" | "desktop";

export interface ClaudeInstall {
  path: string;
  version: string | null;
  source: ClaudeInstallSource;
}

/** Why a candidate was not accepted (`summarized` marks a line counting several missing locations). */
export type LocateRejection = "not_executable" | "timeout" | "bad_output" | "spawn_failed";

export interface CheckedLocation {
  /** Path checked (wildcards as `*`); the home directory is shown as `~`. */
  path: string;
  source: ClaudeInstallSource;
  result: "ok" | "missing" | "rejected";
  /** A `LocateRejection` for `rejected`, `"summarized"` for a summary line; typed as string for future codes. */
  reason?: string;
}

/** `claude_locate_report`: every location checked, highest priority first (at most 60 entries). */
export interface LocateReport {
  chosen: ClaudeInstall | null;
  checked: CheckedLocation[];
}

export interface ClaudeStatus {
  install: ClaudeInstall | null;
  loggedIn: boolean;
  authMethod: string | null;
  subscription: boolean;
  subscriptionType: string | null;
  email: string | null;
  orgName: string | null;
}

export type InstallChannel = "stable" | "latest";

export interface InstallPlan {
  version: string;
  channel: InstallChannel;
  platform: string;
  sizeBytes: number;
  sourceHost: "downloads.claude.ai";
  installDir: string;
  autoUpdates: true;
  alreadyInstalled: ClaudeInstall | null;
}

export type InstallPhase =
  "resolving" | "verifying_manifest" | "downloading" | "verifying_binary" | "installing" | "checking";

export type InstallErrorCode =
  | "unsupported_platform"
  | "network"
  | "unexpected_response"
  | "signature_invalid"
  | "checksum_mismatch"
  | "publisher_untrusted"
  | "install_failed"
  | "disk_full"
  | "busy";

/** Exactly one of `done` | `error` | `cancelled` is the last event of an install. */
export type InstallEvent =
  | { type: "phase"; phase: InstallPhase }
  | { type: "progress"; receivedBytes: number; totalBytes: number }
  | { type: "done"; install: ClaudeInstall }
  // `code` is an InstallErrorCode; typed as string so unknown future codes still type-check.
  | { type: "error"; code: string; message: string }
  | { type: "cancelled" };

export interface ProjectInfo {
  id: string;
  name: string;
  path: string | null;
  sessionCount: number;
  lastActivity: string | null;
  source: "history" | "opened";
}

export interface SessionInfo {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  gitBranch: string | null;
  model: string | null;
  subagentCount: number;
}

export interface SubagentInfo {
  id: string;
  agentType: string | null;
  description: string | null;
  toolUseId: string | null;
  messageCount: number;
  updatedAt: string;
}

export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: string }
  | { type: "tool_result"; toolUseId: string; isError: boolean; text: string };

export interface TranscriptMessage {
  id: string;
  role: "user" | "assistant";
  timestamp: string | null;
  model: string | null;
  blocks: Block[];
}

export interface Transcript {
  session: SessionInfo;
  messages: TranscriptMessage[];
  subagents: SubagentInfo[];
  truncated: boolean;
}

export interface SubagentTranscript {
  subagent: SubagentInfo;
  messages: TranscriptMessage[];
  truncated: boolean;
}

export type PermissionModeArg = "default" | "acceptEdits" | "plan";

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

/**
 * Events of one turn (docs/NATIVE_API.md, "Event semantics"). A message gets
 * `message_end` (`usage: null`) when the next one starts; the last one gets
 * `message_end` with usage at the result. `exit` is always the last event.
 */
export type TurnEvent =
  | { type: "session_started"; sessionId: string; model: string | null }
  | { type: "message_start"; messageId: string }
  | { type: "text_delta"; messageId: string; text: string }
  | { type: "tool_call_start"; id: string; messageId: string; name: string; input: string }
  | { type: "tool_call_end"; id: string; status: "success" | "error"; output: string }
  | { type: "subagent_started"; toolUseId: string; agentType: string | null; description: string | null }
  | { type: "message_end"; messageId: string; stopReason: "end_turn" | "interrupted"; usage: TurnUsage | null }
  | { type: "permission_denied"; toolName: string; toolUseId: string }
  | { type: "error"; message: string }
  | { type: "exit"; code: number | null };

export interface DirEntry {
  name: string;
  relPath: string;
  kind: "file" | "dir";
}

export interface FileContent {
  content: string;
  truncated: boolean;
  binary: boolean;
}

export interface AgentInfo {
  name: string;
  description: string;
  tools: string[];
  model: string | null;
  scope: "user" | "project";
}

export interface SkillInfo {
  name: string;
  description: string;
  scope: "user" | "project";
}

export interface McpServerInfo {
  name: string;
  target: string;
  status: "connected" | "failed" | "needs_auth" | "unknown";
}

/** Command names — must match `APP_COMMANDS` in src-tauri/build.rs and the capability file. */
export const NATIVE_COMMANDS = [
  "claude_status",
  "claude_auth_login",
  "claude_auth_logout",
  "claude_pick_executable",
  "claude_clear_executable",
  "claude_locate_report",
  "claude_install_plan",
  "claude_install_start",
  "claude_install_cancel",
  "projects_list",
  "projects_open_folder",
  "sessions_list",
  "session_read",
  "subagent_read",
  "turn_start",
  "turn_cancel",
  "fs_list_dir",
  "fs_read_file",
  "agents_list",
  "skills_list",
  "mcp_list",
] as const;
export type NativeCommand = (typeof NATIVE_COMMANDS)[number];
