import { wait } from "@/lib/async";
import type {
  AIEvent,
  AIProvider,
  Attachment,
  PermissionDecision,
  StartSessionOptions,
  StopReason,
} from "./types";

const STEPS = [
  { name: "Read", label: "Reading project files" },
  { name: "Grep", label: "Searching related code" },
  { name: "Bash", label: "Running tests" },
] as const;

export interface MockAIProviderOptions {
  /** Delay between streamed chunks in ms (0 in tests). */
  chunkDelayMs?: number;
  /** Duration of each simulated tool call in ms (0 in tests). */
  stepDelayMs?: number;
  /** Tool names that ask for permission before running (demonstrates the permission prompt). */
  askPermissionFor?: readonly string[];
}

interface PendingPermission {
  sessionId: string;
  resolve: (decision: PermissionDecision) => void;
}

/**
 * Simulates a streaming agent runtime with the same event model the real
 * Claude Code adapter will emit. No network, no processes, no file access.
 */
export class MockAIProvider implements AIProvider {
  readonly id = "mock" as const;
  private readonly chunkDelayMs: number;
  private readonly stepDelayMs: number;
  private readonly askPermissionFor: ReadonlySet<string>;
  private readonly interrupted = new Set<string>();
  private readonly allowedForSession = new Map<string, Set<string>>();
  private readonly pendingPermissions = new Map<string, PendingPermission>();
  private counter = 0;

  constructor(options: MockAIProviderOptions = {}) {
    this.chunkDelayMs = options.chunkDelayMs ?? 30;
    this.stepDelayMs = options.stepDelayMs ?? 500;
    this.askPermissionFor = new Set(options.askPermissionFor ?? []);
  }

  async startSession(options: StartSessionOptions): Promise<string> {
    // Like `claude --resume`, resuming keeps the runtime session id.
    return options.resumeSessionId ?? this.nextId("mock-session");
  }

  async *sendMessage(sessionId: string, text: string, _attachments?: Attachment[]): AsyncIterable<AIEvent> {
    this.interrupted.delete(sessionId);
    const messageId = this.nextId("msg");
    yield { type: "message_start", messageId };

    for (const [index, step] of STEPS.entries()) {
      if (this.interrupted.has(sessionId)) {
        yield this.end(messageId, "interrupted");
        return;
      }
      const id = `${messageId}-tool-${index}`;
      const input = { description: step.label };
      yield { type: "tool_call_start", id, messageId, name: step.name, input };

      if (this.needsPermission(sessionId, step.name)) {
        const requestId = `${id}-permission`;
        const decision = this.waitForDecision(sessionId, requestId);
        yield { type: "permission_request", id: requestId, messageId, tool: step.name, input };
        const answer = await decision;
        if (this.interrupted.has(sessionId)) {
          yield this.end(messageId, "interrupted");
          return;
        }
        if (answer === "deny") {
          yield { type: "tool_call_end", id, messageId, status: "error", output: "Permission denied" };
          continue;
        }
        if (answer === "allow_session") this.allowTool(sessionId, step.name);
      }

      await wait(this.stepDelayMs);
      yield { type: "tool_call_end", id, messageId, status: "success" };
    }

    for (const piece of splitIntoChunks(buildMockReply(text))) {
      if (this.interrupted.has(sessionId)) {
        yield this.end(messageId, "interrupted");
        return;
      }
      yield { type: "text_delta", messageId, text: piece };
      await wait(this.chunkDelayMs);
    }

    yield this.end(messageId, "end_turn");
  }

  async interrupt(sessionId: string): Promise<void> {
    this.interrupted.add(sessionId);
    this.cancelPermissions(sessionId);
  }

  async respondToPermission(requestId: string, decision: PermissionDecision): Promise<void> {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) return;
    this.pendingPermissions.delete(requestId);
    pending.resolve(decision);
  }

  async stopSession(sessionId: string): Promise<void> {
    this.interrupted.add(sessionId);
    this.cancelPermissions(sessionId);
    this.allowedForSession.delete(sessionId);
  }

  private needsPermission(sessionId: string, tool: string): boolean {
    return this.askPermissionFor.has(tool) && !this.allowedForSession.get(sessionId)?.has(tool);
  }

  private allowTool(sessionId: string, tool: string): void {
    const allowed = this.allowedForSession.get(sessionId) ?? new Set<string>();
    allowed.add(tool);
    this.allowedForSession.set(sessionId, allowed);
  }

  private waitForDecision(sessionId: string, requestId: string): Promise<PermissionDecision> {
    return new Promise((resolve) => this.pendingPermissions.set(requestId, { sessionId, resolve }));
  }

  private cancelPermissions(sessionId: string): void {
    for (const [requestId, pending] of this.pendingPermissions) {
      if (pending.sessionId !== sessionId) continue;
      this.pendingPermissions.delete(requestId);
      pending.resolve("deny");
    }
  }

  private end(messageId: string, stopReason: StopReason): AIEvent {
    return { type: "message_end", messageId, stopReason, usage: { inputTokens: 1240, outputTokens: 186 } };
  }

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${Date.now().toString(36)}-${this.counter}`;
  }
}

export function buildMockReply(prompt: string): string {
  const topic = prompt.trim().replace(/\s+/g, " ").slice(0, 80);
  return [
    `Demo response from the mock runtime for "${topic}".`,
    "",
    "Once Claude Code is connected, this is where it would inspect the project, propose changes and report test results. Right now the conversation only exercises the interface: streaming, activity steps, permissions and interruption.",
  ].join("\n");
}

function splitIntoChunks(text: string): string[] {
  return text.match(/\S+[ \t]*|\n/g) ?? [text];
}
