/**
 * Typed wrappers over the Tauri commands described in docs/NATIVE_API.md
 * (TypeScript mirror: ./contract.ts). This is the only module that talks to
 * `invoke`; services in src/features/** depend on the `NativeClient` interface,
 * so tests can substitute an in-memory fake.
 */

import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { isRecord, isString } from "@/lib/guards";
import type {
  AgentInfo,
  ClaudeStatus,
  DirEntry,
  FileContent,
  InstallChannel,
  InstallEvent,
  InstallPlan,
  LocateReport,
  McpServerInfo,
  NativeCommand,
  NativeError,
  PermissionModeArg,
  ProjectInfo,
  SessionInfo,
  SkillInfo,
  SubagentTranscript,
  Transcript,
  TurnEvent,
} from "./contract";

/** True inside the Crowe Harness desktop app (Tauri webview), false in a plain browser or jsdom. */
export function isDesktopRuntime(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

/** Error code used when a command is called outside the desktop runtime. */
export const NOT_DESKTOP = "not_desktop";

/** A failed native call. `code` comes from the Rust `NativeError` (or a frontend fallback code). */
export class NativeCallError extends Error implements NativeError {
  readonly code: string;

  constructor(error: NativeError) {
    super(error.message);
    this.name = "NativeCallError";
    this.code = error.code;
  }
}

/** Normalizes whatever `invoke` rejected with into a `NativeError`. Never includes stack traces. */
export function toNativeError(error: unknown): NativeError {
  if (error instanceof NativeCallError) return { code: error.code, message: error.message };
  if (isRecord(error) && isString(error.code) && isString(error.message)) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) return { code: "unknown", message: error.message };
  if (isString(error) && error.trim()) return { code: "unknown", message: error };
  return { code: "unknown", message: "The desktop runtime returned an unexpected error." };
}

/** True when `error` is a native error with the given code. */
export function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof NativeCallError && error.code === code;
}

export interface TurnStartArgs {
  projectId: string;
  sessionId: string | null;
  prompt: string;
  permissionMode: PermissionModeArg;
}

/** One method per command in NATIVE_COMMANDS. Arguments are camelCase, exactly as in the contract. */
export interface ClaudeStatusOptions {
  /** Re-discover Claude Code instead of using the cached location ("Check again"). */
  forceRefresh?: boolean;
}

export interface NativeClient {
  claudeStatus(options?: ClaudeStatusOptions): Promise<ClaudeStatus>;
  claudeAuthLogin(): Promise<void>;
  claudeAuthLogout(): Promise<void>;
  /**
   * Opens a native file picker (Rust side) to choose the Claude Code executable. Resolves with the
   * new status, or `null` when the picker was cancelled; rejects with `invalid_executable`.
   */
  claudePickExecutable(): Promise<ClaudeStatus | null>;
  /** Forgets the chosen executable and detects Claude Code automatically again. */
  claudeClearExecutable(): Promise<ClaudeStatus>;
  /** Every location checked for Claude Code and why candidates were rejected. */
  claudeLocateReport(): Promise<LocateReport>;
  /** Resolves the version to install and verifies the signed release manifest (no binary download). */
  claudeInstallPlan(channel: InstallChannel): Promise<InstallPlan>;
  /**
   * Starts the native installer; `onEvent` receives every `InstallEvent` (the last one is always
   * `done`, `error` or `cancelled`). Resolves with the install id.
   */
  claudeInstallStart(channel: InstallChannel, onEvent: (event: InstallEvent) => void): Promise<string>;
  /** No-op for unknown or finished ids; a running install ends with a `cancelled` event. */
  claudeInstallCancel(installId: string): Promise<void>;
  projectsList(): Promise<ProjectInfo[]>;
  projectsOpenFolder(): Promise<ProjectInfo | null>;
  sessionsList(projectId: string): Promise<SessionInfo[]>;
  sessionRead(projectId: string, sessionId: string): Promise<Transcript>;
  subagentRead(projectId: string, sessionId: string, agentId: string): Promise<SubagentTranscript>;
  /** Starts a headless turn; `onEvent` receives every `TurnEvent` (the last one is always `exit`). Resolves with the turn id. */
  turnStart(args: TurnStartArgs, onEvent: (event: TurnEvent) => void): Promise<string>;
  turnCancel(turnId: string): Promise<void>;
  fsListDir(projectId: string, relPath: string): Promise<DirEntry[]>;
  fsReadFile(projectId: string, relPath: string): Promise<FileContent>;
  agentsList(projectId: string | null): Promise<AgentInfo[]>;
  skillsList(projectId: string | null): Promise<SkillInfo[]>;
  mcpList(): Promise<McpServerInfo[]>;
}

async function call<T>(command: NativeCommand, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktopRuntime()) {
    throw new NativeCallError({ code: NOT_DESKTOP, message: "This action is only available in the desktop app." });
  }
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new NativeCallError(toNativeError(error));
  }
}

/** The real client, backed by Tauri IPC. */
export const tauriClient: NativeClient = {
  claudeStatus: (options) => call<ClaudeStatus>("claude_status", { forceRefresh: options?.forceRefresh ?? false }),
  claudeAuthLogin: () => call<null>("claude_auth_login").then(() => undefined),
  claudeAuthLogout: () => call<null>("claude_auth_logout").then(() => undefined),
  claudePickExecutable: () => call<ClaudeStatus | null>("claude_pick_executable"),
  claudeClearExecutable: () => call<ClaudeStatus>("claude_clear_executable"),
  claudeLocateReport: () => call<LocateReport>("claude_locate_report"),
  claudeInstallPlan: (channel) => call<InstallPlan>("claude_install_plan", { channel }),
  claudeInstallStart: (channel, onEvent) => {
    const events = new Channel<InstallEvent>(onEvent);
    return call<string>("claude_install_start", { channel, onEvent: events });
  },
  claudeInstallCancel: (installId) => call<null>("claude_install_cancel", { installId }).then(() => undefined),
  projectsList: () => call<ProjectInfo[]>("projects_list"),
  projectsOpenFolder: () => call<ProjectInfo | null>("projects_open_folder"),
  sessionsList: (projectId) => call<SessionInfo[]>("sessions_list", { projectId }),
  sessionRead: (projectId, sessionId) => call<Transcript>("session_read", { projectId, sessionId }),
  subagentRead: (projectId, sessionId, agentId) =>
    call<SubagentTranscript>("subagent_read", { projectId, sessionId, agentId }),
  turnStart: (args, onEvent) => {
    const channel = new Channel<TurnEvent>(onEvent);
    return call<string>("turn_start", { ...args, onEvent: channel });
  },
  turnCancel: (turnId) => call<null>("turn_cancel", { turnId }).then(() => undefined),
  fsListDir: (projectId, relPath) => call<DirEntry[]>("fs_list_dir", { projectId, relPath }),
  fsReadFile: (projectId, relPath) => call<FileContent>("fs_read_file", { projectId, relPath }),
  agentsList: (projectId) => call<AgentInfo[]>("agents_list", { projectId }),
  skillsList: (projectId) => call<SkillInfo[]>("skills_list", { projectId }),
  mcpList: () => call<McpServerInfo[]>("mcp_list"),
};
