/**
 * Runtime-agnostic AI contract. The UI depends only on these types;
 * implementations: MockAIProvider (now), ClaudeCodeProvider (M3).
 */

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

export type AIEvent =
  | { type: "session_started"; sessionId: string; model?: string }
  | { type: "message_start"; messageId: string }
  | { type: "text_delta"; messageId: string; text: string }
  | { type: "tool_call_start"; id: string; name: string; input?: unknown }
  | { type: "tool_call_end"; id: string; status: "success" | "error"; output?: string }
  | { type: "permission_request"; id: string; tool: string; input: unknown }
  | { type: "message_end"; messageId: string; stopReason: StopReason; usage?: Usage }
  | { type: "error"; message: string };

export type PermissionMode = "default" | "acceptEdits" | "plan";
export type PermissionDecision = "allow" | "allow_session" | "deny";

export interface StartSessionOptions {
  projectPath: string;
  resumeSessionId?: string;
  permissionMode?: PermissionMode;
  model?: string;
}

export interface AIProvider {
  readonly id: "mock" | "claude-code";
  startSession(options: StartSessionOptions): Promise<string>;
  sendMessage(sessionId: string, text: string, attachments?: Attachment[]): AsyncIterable<AIEvent>;
  interrupt(sessionId: string): Promise<void>;
  respondToPermission(requestId: string, decision: PermissionDecision): Promise<void>;
  stopSession(sessionId: string): Promise<void>;
}
