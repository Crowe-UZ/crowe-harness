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
export interface NativeClient {
  claudeStatus(): Promise<ClaudeStatus>;
  claudeAuthLogin(): Promise<void>;
  claudeAuthLogout(): Promise<void>;
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
  claudeStatus: () => call<ClaudeStatus>("claude_status"),
  claudeAuthLogin: () => call<null>("claude_auth_login").then(() => undefined),
  claudeAuthLogout: () => call<null>("claude_auth_logout").then(() => undefined),
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
