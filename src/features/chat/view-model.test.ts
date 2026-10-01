import { describe, expect, it } from "vitest";
import type { AIEvent } from "@/features/ai/types";
import { fixtures } from "@/test/fakes";
import {
  applyEvent,
  settleTurn,
  summarizeToolInput,
  toolUsage,
  transcriptToView,
  type MessageView,
  type ToolView,
} from "./view-model";

const tools = (messages: MessageView[]) =>
  messages.flatMap((m) => m.blocks.filter((b): b is ToolView => b.kind === "tool"));

describe("transcriptToView", () => {
  it("pairs tool results with their tool_use and merges assistant records", () => {
    const view = transcriptToView(fixtures.authTranscriptMessages());

    expect(view.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(tools(view).map((t) => [t.name, t.status, t.output])).toEqual([
      ["Read", "success", "export function login() {}"],
      ["Bash", "error", "1 test failed"],
      ["Task", "success", "Looks good."],
    ]);
    const assistant = view[1];
    expect(assistant?.blocks.at(0)).toMatchObject({ kind: "text", text: "I'll look at the login handler first." });
    expect(assistant?.blocks.at(-1)).toMatchObject({ kind: "text", text: "Fixed: empty passwords are now rejected." });
  });

  it("marks tool calls without a result as pending", () => {
    const view = transcriptToView([
      {
        id: "a",
        role: "assistant",
        timestamp: null,
        model: null,
        blocks: [{ type: "tool_use", id: "t", name: "Bash", input: "{}" }],
      },
    ]);
    expect(tools(view)[0]?.status).toBe("pending");
  });
});

describe("toolUsage", () => {
  it("counts tool calls by name", () => {
    expect(toolUsage(fixtures.authTranscriptMessages())).toEqual([
      { name: "Bash", count: 1 },
      { name: "Read", count: 1 },
      { name: "Task", count: 1 },
    ]);
  });
});

describe("summarizeToolInput", () => {
  it.each([
    ['{"command":"npm test","description":"Run the tests"}', "Run the tests"],
    ['{"file_path":"src/a.ts"}', "src/a.ts"],
    ['{"other":"value"}', "value"],
    ['{"command":"a"', '{"command":"a"'],
    ["", ""],
  ])("%s → %s", (input, expected) => {
    expect(summarizeToolInput(input)).toBe(expected);
  });

  it("shortens long values to one line", () => {
    const summary = summarizeToolInput(JSON.stringify({ command: `echo ${"x".repeat(200)}\nnext` }));
    expect(summary).toHaveLength(100);
    expect(summary.endsWith("…")).toBe(true);
  });
});

describe("applyEvent", () => {
  const user: MessageView = { id: "u", role: "user", blocks: [{ kind: "text", id: "u0", text: "Go" }] };
  const run = (...events: AIEvent[]) => events.reduce(applyEvent, [user]);

  it("streams text and tool calls into the assistant message", () => {
    const messages = run(
      { type: "message_start", messageId: "m1" },
      { type: "text_delta", messageId: "m1", text: "Hel" },
      { type: "text_delta", messageId: "m1", text: "lo" },
      { type: "tool_call_start", id: "t1", messageId: "m1", name: "Bash", input: '{"command":"ls"}' },
      { type: "text_delta", messageId: "m1", text: "Done" },
      { type: "tool_call_end", id: "t1", status: "success", output: "a.ts" },
      { type: "message_end", messageId: "m1", stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 2 } },
    );

    const reply = messages[1];
    expect(reply?.status).toBe("done");
    expect(reply?.usage).toEqual({ inputTokens: 1, outputTokens: 2 });
    expect(reply?.blocks).toEqual([
      { kind: "text", id: "m1-0", text: "Hello" },
      { kind: "tool", id: "t1", name: "Bash", input: '{"command":"ls"}', status: "success", output: "a.ts" },
      { kind: "text", id: "m1-2", text: "Done" },
    ]);
  });

  it("creates an assistant message for events that arrive before message_start", () => {
    const messages = run({ type: "tool_call_start", id: "t1", name: "Read", input: "{}" });
    expect(messages[1]).toMatchObject({ role: "assistant", status: "streaming" });
    expect(tools(messages)).toHaveLength(1);
  });

  it("records subagents and permission denials on the tool card", () => {
    const messages = run(
      { type: "message_start", messageId: "m1" },
      { type: "tool_call_start", id: "t1", messageId: "m1", name: "Task", input: "{}" },
      { type: "subagent_started", toolUseId: "t1", agentType: "reviewer", description: "Review" },
      { type: "tool_call_start", id: "t2", messageId: "m1", name: "Write", input: "{}" },
      { type: "permission_denied", toolName: "Write", toolUseId: "t2" },
      { type: "tool_call_end", id: "t2", status: "error", output: "denied" },
    );
    expect(tools(messages).map((t) => [t.id, t.status, t.agentType])).toEqual([
      ["t1", "running", "reviewer"],
      ["t2", "denied", undefined],
    ]);
  });

  it("ignores duplicate message_start and tool_call_start events", () => {
    const once = run(
      { type: "message_start", messageId: "m1" },
      { type: "tool_call_start", id: "t1", messageId: "m1", name: "Read", input: "{}" },
    );
    const twice = [
      { type: "message_start", messageId: "m1" } as const,
      { type: "tool_call_start", id: "t1", messageId: "m1", name: "Read", input: "{}" } as const,
    ].reduce(applyEvent, once);
    expect(twice).toBe(once);
  });

  it("settles a stopped turn: streaming → interrupted, running tools → pending", () => {
    const messages = settleTurn(
      run(
        { type: "message_start", messageId: "m1" },
        { type: "tool_call_start", id: "t1", messageId: "m1", name: "Bash", input: "{}" },
      ),
      "interrupted",
    );
    expect(messages[1]?.status).toBe("interrupted");
    expect(tools(messages)[0]?.status).toBe("pending");
  });

  it("marks the streaming reply as failed on error", () => {
    const messages = run({ type: "message_start", messageId: "m1" }, { type: "error", message: "boom" });
    expect(messages[1]?.status).toBe("error");
  });
});
