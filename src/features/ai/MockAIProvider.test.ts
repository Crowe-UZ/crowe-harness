import { describe, expect, it } from "vitest";
import { MockAIProvider } from "./MockAIProvider";
import type { AIEvent } from "./types";

async function collect(iterable: AsyncIterable<AIEvent>, onEvent?: (e: AIEvent) => void): Promise<AIEvent[]> {
  const events: AIEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
    onEvent?.(event);
  }
  return events;
}

describe("MockAIProvider", () => {
  it("streams tool calls, text and a final message_end", async () => {
    const provider = new MockAIProvider({ chunkDelayMs: 0, stepDelayMs: 0 });
    const sessionId = await provider.startSession({ projectPath: "C:\\dev\\atlas" });
    const events = await collect(provider.sendMessage(sessionId, "Fix the login bug"));

    expect(events[0]).toMatchObject({ type: "message_start" });
    expect(events.filter((e) => e.type === "tool_call_start")).toHaveLength(3);
    expect(events.filter((e) => e.type === "tool_call_end")).toHaveLength(3);
    const text = events.flatMap((e) => (e.type === "text_delta" ? [e.text] : [])).join("");
    expect(text).toContain("Fix the login bug");
    expect(events.at(-1)).toMatchObject({ type: "message_end", stopReason: "end_turn" });
  });

  it("stops with stopReason=interrupted after interrupt()", async () => {
    const provider = new MockAIProvider({ chunkDelayMs: 0, stepDelayMs: 0 });
    const events = await collect(provider.sendMessage("s1", "Refactor"), (event) => {
      if (event.type === "tool_call_end") void provider.interrupt("s1");
    });
    expect(events.at(-1)).toMatchObject({ type: "message_end", stopReason: "interrupted" });
    expect(events.some((e) => e.type === "text_delta")).toBe(false);
  });
});
