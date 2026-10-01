import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/data/types";
import { MockAIProvider } from "@/features/ai/MockAIProvider";
import type { AIEvent } from "@/features/ai/types";
import { ScriptedProvider } from "@/test/scriptedProvider";
import { applyEvent, finalizeTurn, useChatStore } from "./chatStore";
import { useSessionStore } from "./sessionStore";

const fastProvider = (askPermissionFor?: string[]) =>
  new MockAIProvider({ chunkDelayMs: 0, stepDelayMs: 0, askPermissionFor });

const chat = () => useChatStore.getState();
const messagesOf = (sessionId: string) => chat().conversations[sessionId] ?? [];
const statusOf = (sessionId: string) => chat().status[sessionId];
const lastMessage = (sessionId: string) => messagesOf(sessionId).at(-1);
const runtimeIdOf = (sessionId: string) =>
  useSessionStore.getState().sessions.find((s) => s.id === sessionId)?.runtimeSessionId;

const start = (messageId = "m1"): AIEvent => ({ type: "message_start", messageId });
const end = (messageId = "m1", stopReason: "end_turn" | "interrupted" = "end_turn"): AIEvent => ({
  type: "message_end",
  messageId,
  stopReason,
});

let sessionId: string;

beforeEach(() => {
  sessionId = useSessionStore.getState().createSession("atlas").id;
});

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

  it("attributes a tool_call_end without messageId to the message that started the tool", () => {
    let messages = applyEvent([], start());
    messages = applyEvent(messages, { type: "tool_call_start", id: "t1", messageId: "m1", name: "Bash" });
    messages = applyEvent(messages, { type: "tool_call_end", id: "t1", status: "error" });
    expect(messages[0]?.activity?.[0]?.status).toBe("error");
  });

  it("ignores a duplicate message_start", () => {
    const once = applyEvent([], start());
    expect(applyEvent(once, start())).toBe(once);
  });
});

describe("finalizeTurn", () => {
  it("settles messages still streaming after the given user message only", () => {
    const messages: ChatMessage[] = [
      { id: "old", role: "assistant", text: "", createdAt: "", status: "streaming" },
      { id: "u1", role: "user", text: "Hi", createdAt: "", status: "done" },
      { id: "a1", role: "assistant", text: "", createdAt: "", status: "streaming" },
    ];
    const settled = finalizeTurn(messages, "u1", "interrupted");
    expect(settled.map((m) => m.status)).toEqual(["streaming", "done", "interrupted"]);
  });
});

describe("useChatStore.send", () => {
  it("appends the user message and the streamed assistant reply", async () => {
    await chat().send(sessionId, "  Add tests  ", fastProvider());

    const messages = messagesOf(sessionId);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages[0]?.text).toBe("Add tests");
    expect(messages[1]?.status).toBe("done");
    expect(messages[1]?.text).toContain("Add tests");
    expect(statusOf(sessionId)).toBe("idle");
  });

  it("ignores empty messages", async () => {
    await chat().send(sessionId, "   ", fastProvider());
    expect(chat().conversations[sessionId]).toBeUndefined();
    expect(statusOf(sessionId)).toBeUndefined();
  });

  it("uses the shared runtime service when no provider is passed", async () => {
    await chat().send(sessionId, "Hello");
    expect(lastMessage(sessionId)).toMatchObject({ role: "assistant", status: "done" });
  });

  it("reports an error for a session that does not exist", async () => {
    await chat().send("missing", "Hello", fastProvider());
    expect(statusOf("missing")).toBe("error");
    expect(chat().errors.missing).toBe("This session no longer exists.");
  });

  it("ignores a second send while a reply is still running", async () => {
    const provider = new ScriptedProvider();
    const first = chat().send(sessionId, "First", provider);
    await vi.waitFor(() => expect(provider.sendMessage).toHaveBeenCalledTimes(1));
    expect(statusOf(sessionId)).toBe("running");

    await chat().send(sessionId, "Second", provider);

    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    expect(
      messagesOf(sessionId)
        .filter((m) => m.role === "user")
        .map((m) => m.text),
    ).toEqual(["First"]);

    provider.emit(start(), end());
    provider.end();
    await first;
    expect(statusOf(sessionId)).toBe("idle");
  });

  it("settles the reply when the stream ends without message_end", async () => {
    const provider = new ScriptedProvider();
    const done = chat().send(sessionId, "Hello", provider);
    await vi.waitFor(() => expect(provider.sendMessage).toHaveBeenCalled());
    provider.emit(start(), { type: "tool_call_start", id: "t1", messageId: "m1", name: "Read" });
    await vi.waitFor(() => expect(lastMessage(sessionId)?.status).toBe("streaming"));

    provider.end();
    await done;

    expect(lastMessage(sessionId)?.status).toBe("interrupted");
    expect(lastMessage(sessionId)?.activity?.[0]?.status).toBe("pending");
    expect(statusOf(sessionId)).toBe("idle");
  });

  it("switches to the error state when the provider throws mid-stream", async () => {
    const provider = new ScriptedProvider();
    const done = chat().send(sessionId, "Hello", provider);
    await vi.waitFor(() => expect(provider.sendMessage).toHaveBeenCalled());
    provider.emit(start(), { type: "text_delta", messageId: "m1", text: "Partial" });
    provider.fail(new Error("Runtime crashed"));
    await done;

    expect(statusOf(sessionId)).toBe("error");
    expect(chat().errors[sessionId]).toBe("Runtime crashed");
    expect(lastMessage(sessionId)).toMatchObject({ text: "Partial", status: "error" });
    expect(chat().pendingPermission[sessionId]).toBeUndefined();
  });

  it("switches to the error state when the runtime session cannot start", async () => {
    const provider = new ScriptedProvider();
    provider.startSession.mockRejectedValueOnce(new Error("Claude Code not found"));
    await chat().send(sessionId, "Hello", provider);

    expect(statusOf(sessionId)).toBe("error");
    expect(chat().errors[sessionId]).toBe("Claude Code not found");
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  it("reports an error event from the runtime", async () => {
    const provider = new ScriptedProvider();
    const done = chat().send(sessionId, "Hello", provider);
    await vi.waitFor(() => expect(provider.sendMessage).toHaveBeenCalled());
    provider.emit(start(), { type: "error", message: "Rate limited" });
    provider.end();
    await done;

    expect(statusOf(sessionId)).toBe("error");
    expect(chat().errors[sessionId]).toBe("Rate limited");
    expect(lastMessage(sessionId)?.status).toBe("error");
  });

  it("clears the previous error when a new message is sent", async () => {
    const failing = new ScriptedProvider();
    failing.startSession.mockRejectedValueOnce(new Error("Boom"));
    await chat().send(sessionId, "Hello", failing);
    expect(chat().errors[sessionId]).toBe("Boom");

    await chat().send(sessionId, "Again", fastProvider());
    expect(chat().errors[sessionId]).toBeUndefined();
    expect(statusOf(sessionId)).toBe("idle");
  });
});

describe("runtime sessions", () => {
  it("persists the runtime session id on the session and reuses the live runtime", async () => {
    const provider = new ScriptedProvider();
    const first = chat().send(sessionId, "One", provider);
    await vi.waitFor(() => expect(provider.sendMessage).toHaveBeenCalled());
    provider.end();
    await first;
    expect(runtimeIdOf(sessionId)).toBe("runtime-1");

    const second = chat().send(sessionId, "Two", provider);
    await vi.waitFor(() => expect(provider.sendMessage).toHaveBeenCalledTimes(2));
    provider.end();
    await second;

    expect(provider.startSession).toHaveBeenCalledTimes(1);
    expect(provider.sendMessage).toHaveBeenLastCalledWith("runtime-1", "Two");
  });

  it("resumes the persisted runtime session with a new provider (app restart)", async () => {
    useSessionStore.getState().setRuntimeSessionId(sessionId, "runtime-from-last-run");
    const provider = new ScriptedProvider();
    const done = chat().send(sessionId, "Continue", provider);
    await vi.waitFor(() => expect(provider.sendMessage).toHaveBeenCalled());
    provider.end();
    await done;

    expect(provider.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ resumeSessionId: "runtime-from-last-run", projectPath: "C:\\dev\\atlas" }),
    );
    expect(provider.sendMessage).toHaveBeenCalledWith("runtime-from-last-run", "Continue");
  });

  it("adopts the id announced by a session_started event", async () => {
    const provider = new ScriptedProvider();
    const done = chat().send(sessionId, "Hello", provider);
    await vi.waitFor(() => expect(provider.sendMessage).toHaveBeenCalled());
    provider.emit({ type: "session_started", sessionId: "runtime-renamed" });
    provider.end();
    await done;
    expect(runtimeIdOf(sessionId)).toBe("runtime-renamed");
  });
});

describe("useChatStore.stop", () => {
  it("interrupts the runtime mid-stream and ends the turn as interrupted", async () => {
    const provider = new ScriptedProvider();
    provider.interrupt.mockImplementation(() => {
      provider.emit(end("m1", "interrupted"));
      provider.end();
      return Promise.resolve();
    });
    const done = chat().send(sessionId, "Long task", provider);
    await vi.waitFor(() => expect(provider.sendMessage).toHaveBeenCalled());
    provider.emit(start(), { type: "text_delta", messageId: "m1", text: "Working" });
    await vi.waitFor(() => expect(lastMessage(sessionId)?.text).toBe("Working"));

    await chat().stop(sessionId);
    await done;

    expect(provider.interrupt).toHaveBeenCalledWith("runtime-1");
    expect(lastMessage(sessionId)).toMatchObject({ text: "Working", status: "interrupted" });
    expect(statusOf(sessionId)).toBe("idle");
  });

  it("stops the real mock runtime between steps", async () => {
    const provider = fastProvider(["Bash"]);
    const done = chat().send(sessionId, "Run the tests", provider);
    await vi.waitFor(() => expect(statusOf(sessionId)).toBe("awaiting_permission"));

    await chat().stop(sessionId);
    await done;

    expect(lastMessage(sessionId)?.status).toBe("interrupted");
    expect(lastMessage(sessionId)?.text).toBe("");
    expect(statusOf(sessionId)).toBe("idle");
    expect(chat().pendingPermission[sessionId]).toBeUndefined();
  });

  it("surfaces a failing interrupt as an error without ending the turn", async () => {
    const provider = new ScriptedProvider();
    provider.interrupt.mockRejectedValueOnce(new Error("Interrupt failed"));
    const done = chat().send(sessionId, "Hello", provider);
    await vi.waitFor(() => expect(provider.sendMessage).toHaveBeenCalled());

    await chat().stop(sessionId);
    expect(chat().errors[sessionId]).toBe("Interrupt failed");
    expect(statusOf(sessionId)).toBe("running");

    provider.end();
    await done;
    expect(statusOf(sessionId)).toBe("idle");
  });

  it("does nothing when no reply is running", async () => {
    await chat().stop(sessionId);
    expect(statusOf(sessionId)).toBeUndefined();
  });
});

describe("permissions", () => {
  /** Resolves once the reply is paused on a permission request; `done` settles when the reply ends. */
  async function sendAndWaitForPermission(provider: MockAIProvider, text = "Run the tests") {
    const done = chat().send(sessionId, text, provider);
    await vi.waitFor(() => expect(statusOf(sessionId)).toBe("awaiting_permission"));
    return { done };
  }

  it("pauses on a permission request and continues after allow", async () => {
    const provider = fastProvider(["Bash"]);
    const { done } = await sendAndWaitForPermission(provider);
    expect(chat().pendingPermission[sessionId]).toMatchObject({
      tool: "Bash",
      input: { description: "Running tests" },
    });

    await chat().respondToPermission(sessionId, "allow");
    expect(chat().pendingPermission[sessionId]).toBeUndefined();
    await done;

    const reply = lastMessage(sessionId);
    expect(reply?.status).toBe("done");
    expect(reply?.activity?.find((a) => a.tool === "Bash")?.status).toBe("done");
    expect(statusOf(sessionId)).toBe("idle");
  });

  it("marks the tool call as failed after deny but finishes the reply", async () => {
    const provider = fastProvider(["Bash"]);
    const { done } = await sendAndWaitForPermission(provider);

    await chat().respondToPermission(sessionId, "deny");
    await done;

    const reply = lastMessage(sessionId);
    expect(reply?.activity?.find((a) => a.tool === "Bash")?.status).toBe("error");
    expect(reply?.status).toBe("done");
    expect(statusOf(sessionId)).toBe("idle");
  });

  it("does not ask again after allow for this session", async () => {
    const provider = fastProvider(["Bash"]);
    const { done: first } = await sendAndWaitForPermission(provider);
    await chat().respondToPermission(sessionId, "allow_session");
    await first;

    const states: (string | undefined)[] = [];
    const unsubscribe = useChatStore.subscribe((s) => states.push(s.status[sessionId]));
    await chat().send(sessionId, "Run them again", provider);
    unsubscribe();

    expect(states).not.toContain("awaiting_permission");
    expect(statusOf(sessionId)).toBe("idle");
  });

  it("ignores a decision when nothing is pending", async () => {
    const provider = new ScriptedProvider();
    await chat().respondToPermission(sessionId, "allow");
    expect(provider.respondToPermission).not.toHaveBeenCalled();
    expect(statusOf(sessionId)).toBeUndefined();
  });
});

describe("useChatStore.reset", () => {
  it("ignores events from a stream orphaned by reset()", async () => {
    const provider = new ScriptedProvider();
    const done = chat().send(sessionId, "Hello", provider);
    await vi.waitFor(() => expect(provider.sendMessage).toHaveBeenCalled());
    provider.emit(start());
    await vi.waitFor(() => expect(messagesOf(sessionId)).toHaveLength(2));

    chat().reset();
    expect(provider.interrupt).toHaveBeenCalledWith("runtime-1");
    expect(provider.stopSession).toHaveBeenCalledWith("runtime-1");

    provider.emit({ type: "text_delta", messageId: "m1", text: "late" }, end());
    provider.end();
    await done;

    expect(chat().conversations[sessionId]).toBeUndefined();
    expect(chat().status).toEqual({});
    expect(chat().conversations["fix-auth"]?.length).toBeGreaterThan(0);
  });

  it("starts a new runtime session after reset", async () => {
    const provider = new ScriptedProvider();
    const first = chat().send(sessionId, "One", provider);
    await vi.waitFor(() => expect(provider.sendMessage).toHaveBeenCalled());
    provider.end();
    await first;

    chat().reset();
    const second = chat().send(sessionId, "Two", provider);
    await vi.waitFor(() => expect(provider.sendMessage).toHaveBeenCalledTimes(2));
    provider.end();
    await second;

    // The persisted runtime id is resumed rather than silently reusing a stopped live runtime.
    expect(provider.startSession).toHaveBeenCalledTimes(2);
    expect(provider.startSession).toHaveBeenLastCalledWith(expect.objectContaining({ resumeSessionId: "runtime-1" }));
  });
});
