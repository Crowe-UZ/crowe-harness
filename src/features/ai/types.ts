/**
 * Runtime-agnostic AI contract. The UI depends only on these types;
 * implementations: MockAIProvider (now), ClaudeCodeProvider (M3).
 */

import { isOneOf } from "@/lib/guards";

export interface Attachment {
  kind: "file" | "image";
  path: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

export type StopReason = "end_turn" | "interrupted";

/**
 * Tool and permission events carry the id of the assistant message they belong
 * to. When a runtime cannot tell (`messageId` omitted or unknown), consumers
 * attribute the event to the current turn.
 */
export type AIEvent =
  | { type: "session_started"; sessionId: string; model?: string }
  | { type: "message_start"; messageId: string }
  | { type: "text_delta"; messageId: string; text: string }
  | { type: "tool_call_start"; id: string; messageId: string; name: string; input?: unknown }
  | { type: "tool_call_end"; id: string; messageId?: string; status: "success" | "error"; output?: string }
  | { type: "permission_request"; id: string; messageId?: string; tool: string; input: unknown }
  | { type: "message_end"; messageId: string; stopReason: StopReason; usage?: Usage }
  | { type: "error"; message: string };

export const PERMISSION_MODES = ["default", "acceptEdits", "plan"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const PERMISSION_DECISIONS = ["allow", "allow_session", "deny"] as const;
export type PermissionDecision = (typeof PERMISSION_DECISIONS)[number];

export function isPermissionMode(value: unknown): value is PermissionMode {
  return isOneOf(PERMISSION_MODES, value);
}

export interface StartSessionOptions {
  projectPath: string;
  resumeSessionId?: string;
  permissionMode?: PermissionMode;
  model?: string;
}

export interface AIProvider {
  readonly id: "mock" | "claude-code";
  /** Starts (or resumes) a runtime session and returns its runtime session id. */
  startSession(options: StartSessionOptions): Promise<string>;
  sendMessage(sessionId: string, text: string, attachments?: Attachment[]): AsyncIterable<AIEvent>;
  interrupt(sessionId: string): Promise<void>;
  respondToPermission(requestId: string, decision: PermissionDecision): Promise<void>;
  stopSession(sessionId: string): Promise<void>;
}
