import { vi } from "vitest";
import type { AIEvent, AIProvider, PermissionDecision, StartSessionOptions } from "@/features/ai/types";

type Item = { kind: "event"; event: AIEvent } | { kind: "end" } | { kind: "error"; error: unknown };

/** One streamed reply whose events the test pushes by hand. */
class Stream {
  private readonly buffer: Item[] = [];
  private wake: (() => void) | undefined;

  push(item: Item): void {
    this.buffer.push(item);
    this.wake?.();
    this.wake = undefined;
  }

  async *iterate(): AsyncGenerator<AIEvent> {
    for (;;) {
      const item = this.buffer.shift();
      if (!item) {
        await new Promise<void>((resolve) => (this.wake = resolve));
        continue;
      }
      if (item.kind === "end") return;
      if (item.kind === "error") throw item.error;
      yield item.event;
    }
  }
}

/**
 * AIProvider driven step by step from a test: `emit()` events, then `end()` or `fail()` the stream.
 * Every method is a spy, so tests can assert how the store talks to the runtime.
 */
export class ScriptedProvider implements AIProvider {
  readonly id = "mock" as const;
  private stream: Stream | undefined;
  private sessions = 0;

  readonly startSession = vi.fn((options: StartSessionOptions): Promise<string> => {
    this.sessions += 1;
    return Promise.resolve(options.resumeSessionId ?? `runtime-${this.sessions}`);
  });

  readonly sendMessage = vi.fn((_sessionId: string, _text: string): AsyncIterable<AIEvent> => {
    const stream = new Stream();
    this.stream = stream;
    return stream.iterate();
  });

  readonly interrupt = vi.fn((_sessionId: string): Promise<void> => Promise.resolve());
  readonly respondToPermission = vi.fn((_requestId: string, _decision: PermissionDecision): Promise<void> =>
    Promise.resolve(),
  );
  readonly stopSession = vi.fn((_sessionId: string): Promise<void> => Promise.resolve());

  /** Pushes events into the reply that is currently streaming. */
  emit(...events: AIEvent[]): void {
    for (const event of events) this.current().push({ kind: "event", event });
  }

  /** Ends the current reply (the async iterator completes). */
  end(): void {
    this.current().push({ kind: "end" });
  }

  /** Makes the current reply throw `error`. */
  fail(error: unknown): void {
    this.current().push({ kind: "error", error });
  }

  private current(): Stream {
    if (!this.stream) throw new Error("ScriptedProvider: sendMessage() has not been called yet");
    return this.stream;
  }
}
