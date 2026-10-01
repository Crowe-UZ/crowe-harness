import { beforeEach, describe, expect, it } from "vitest";
import type { ChatMessage } from "@/data/types";
import { MockAIProvider } from "@/features/ai/MockAIProvider";
import { applyEvent, useChatStore } from "./chatStore";
import { useSessionStore } from "./sessionStore";

const fastProvider = () => new MockAIProvider({ chunkDelayMs: 0, stepDelayMs: 0 });

describe("applyEvent", () => {
  it("builds an assistant message from runtime events", () => {
    let messages: ChatMessage[] = [];
    messages = applyEvent(messages, { type: "message_start", messageId: "m1" });
    messages = applyEvent(messages, {
      type: "tool_call_start",
      id: "t1",
      messageId: "m1",
      name: "Read",
      input: { description: "Reading files" },
    });
    messages = applyEvent(messages, { type: "tool_call_end", id: "t1", messageId: "m1", status: "success" });
    messages = applyEvent(messages, { type: "text_delta", messageId: "m1", text: "Hello " });
    messages = applyEvent(messages, { type: "text_delta", messageId: "m1", text: "world" });
    messages = applyEvent(messages, { type: "message_end", messageId: "m1", stopReason: "end_turn" });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: "assistant", text: "Hello world", status: "done" });
    expect(messages[0]?.activity).toEqual([{ id: "t1", label: "Reading files", tool: "Read", status: "done" }]);
  });

  it("marks interrupted messages and leaves running steps pending", () => {
    let messages = applyEvent([], { type: "message_start", messageId: "m1" });
    messages = applyEvent(messages, { type: "tool_call_start", id: "t1", messageId: "m1", name: "Bash" });
    messages = applyEvent(messages, { type: "message_end", messageId: "m1", stopReason: "interrupted" });
    expect(messages[0]?.status).toBe("interrupted");
    expect(messages[0]?.activity?.[0]?.status).toBe("pending");
  });
});

describe("useChatStore.send", () => {
  beforeEach(() => {
    useChatStore.getState().reset();
    useSessionStore.getState().reset();
  });

  it("appends the user message and the streamed assistant reply", async () => {
    const session = useSessionStore.getState().createSession("atlas");
    await useChatStore.getState().send(session.id, "  Add tests  ", fastProvider());

    const state = useChatStore.getState();
    const messages = state.conversations[session.id] ?? [];
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages[0]?.text).toBe("Add tests");
    expect(messages[1]?.status).toBe("done");
    expect(state.status[session.id]).toBe("idle");
    expect(useSessionStore.getState().sessions.find((s) => s.id === session.id)?.runtimeSessionId).toBeDefined();
  });

  it("ignores empty messages", async () => {
    const session = useSessionStore.getState().createSession("atlas");
    await useChatStore.getState().send(session.id, "   ", fastProvider());
    expect(useChatStore.getState().conversations[session.id]).toBeUndefined();
  });
});
