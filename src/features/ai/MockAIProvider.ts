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
}

/**
 * Simulates a streaming agent runtime with the same event model the real
 * Claude Code adapter will emit. No network, no processes, no file access.
 */
export class MockAIProvider implements AIProvider {
  readonly id = "mock" as const;
  private readonly chunkDelayMs: number;
  private readonly stepDelayMs: number;
  private readonly interrupted = new Set<string>();
  private counter = 0;

  constructor(options: MockAIProviderOptions = {}) {
    this.chunkDelayMs = options.chunkDelayMs ?? 30;
    this.stepDelayMs = options.stepDelayMs ?? 500;
  }

  async startSession(_options: StartSessionOptions): Promise<string> {
    return this.nextId("mock-session");
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
      yield { type: "tool_call_start", id, name: step.name, input: { description: step.label } };
      await wait(this.stepDelayMs);
      yield { type: "tool_call_end", id, status: "success" };
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
  }

  async respondToPermission(_requestId: string, _decision: PermissionDecision): Promise<void> {
    // The mock runtime never requests permissions.
  }

  async stopSession(sessionId: string): Promise<void> {
    this.interrupted.add(sessionId);
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
    "Once Claude Code is connected, this is where it would inspect the project, propose changes and report test results. Right now the conversation only exercises the interface: streaming, activity steps and interruption.",
  ].join("\n");
}

function splitIntoChunks(text: string): string[] {
  return text.match(/\S+[ \t]*|\n/g) ?? [text];
}

function wait(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
