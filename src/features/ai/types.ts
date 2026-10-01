/**
 * Runtime-agnostic AI contract. The UI depends only on these types;
 * the implementation is ClaudeCodeProvider (headless Claude Code through Rust).
 */

import { isOneOf } from "@/lib/guards";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

export type StopReason = "end_turn" | "interrupted";

/**
 * Events of one turn. Tool events carry the id of the assistant message they
 * belong to when the runtime knows it; consumers otherwise attribute them to
 * the current turn.
 */
export type AIEvent =
  | { type: "session_started"; sessionId: string; model?: string }
  | { type: "message_start"; messageId: string }
  | { type: "text_delta"; messageId: string; text: string }
  /** `input` is the raw JSON of the tool input (possibly truncated, so not always parseable). */
  | { type: "tool_call_start"; id: string; messageId?: string; name: string; input: string }
  | { type: "tool_call_end"; id: string; status: "success" | "error"; output?: string }
  | { type: "subagent_started"; toolUseId: string; agentType?: string; description?: string }
  /** Interactive approval (only emitted by runtimes that support it; headless Claude Code reports denials instead). */
  | { type: "permission_request"; id: string; tool: string; input: string }
  | { type: "permission_denied"; toolName: string; toolUseId: string }
  | { type: "message_end"; messageId: string; stopReason: StopReason; usage?: Usage }
  | { type: "error"; message: string };

export const PERMISSION_MODES = ["default", "acceptEdits", "plan"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const PERMISSION_MODE_LABELS = {
  default: "Ask before changes",
  acceptEdits: "Accept edits",
  plan: "Plan only",
} satisfies Record<PermissionMode, string>;

export const PERMISSION_DECISIONS = ["allow", "allow_session", "deny"] as const;
export type PermissionDecision = (typeof PERMISSION_DECISIONS)[number];

export function isPermissionMode(value: unknown): value is PermissionMode {
  return isOneOf(PERMISSION_MODES, value);
}

export interface TurnRequest {
  projectId: string;
  /** `null` starts a new session; the runtime reports its id with `session_started`. */
  sessionId: string | null;
  prompt: string;
  permissionMode: PermissionMode;
}

/** A running turn. `events` ends when the runtime process exits. */
export interface TurnHandle {
  readonly events: AsyncIterable<AIEvent>;
  /** Interrupts the turn (kills the runtime process). Safe to call more than once. */
  cancel(): Promise<void>;
}

export interface AIProvider {
  readonly id: string;
  startTurn(request: TurnRequest): TurnHandle;
  /** Present only for runtimes that emit `permission_request`. */
  respondToPermission?(requestId: string, decision: PermissionDecision): Promise<void>;
}
