import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FakeNativeClient } from "@/test/fakes";
import { ClaudeCodeProvider } from "./ClaudeCodeProvider";
import type { AIEvent, TurnRequest } from "./types";

const request: TurnRequest = { projectId: "atlas", sessionId: null, prompt: "Hello", permissionMode: "default" };

async function collect(events: AsyncIterable<AIEvent>): Promise<AIEvent[]> {
  const out: AIEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

async function start(client = new FakeNativeClient(), req: TurnRequest = request) {
  const provider = new ClaudeCodeProvider(client);
  const handle = provider.startTurn(req);
  const collected = collect(handle.events);
  await waitFor(() => expect(client.turns).toHaveLength(1));
  const turn = client.turns[0];
  if (!turn) throw new Error("no turn");
  return { client, handle, collected, turn };
}

describe("ClaudeCodeProvider", () => {
  it("passes the turn request to turn_start", async () => {
    const { turn } = await start(undefined, { ...request, sessionId: "s-1", permissionMode: "plan" });
    expect(turn.args).toEqual({ projectId: "atlas", sessionId: "s-1", prompt: "Hello", permissionMode: "plan" });
  });

  it("maps TurnEvents to AIEvents and ends the stream on exit", async () => {
    const { turn, collected } = await start();

    turn.emit(
      { type: "session_started", sessionId: "s-new", model: null },
      { type: "message_start", messageId: "m1" },
      { type: "text_delta", messageId: "m1", text: "Hi" },
      { type: "tool_call_start", id: "t1", messageId: "m1", name: "Task", input: '{"description":"x"}' },
      { type: "subagent_started", toolUseId: "t1", agentType: "reviewer", description: null },
      { type: "tool_call_end", id: "t1", status: "success", output: "done" },
      { type: "permission_denied", toolName: "Write", toolUseId: "t2" },
      {
        type: "message_end",
        messageId: "m1",
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5, costUsd: null },
      },
    );
    turn.exit(0);

    expect(await collected).toEqual([
      { type: "session_started", sessionId: "s-new", model: undefined },
      { type: "message_start", messageId: "m1" },
      { type: "text_delta", messageId: "m1", text: "Hi" },
      { type: "tool_call_start", id: "t1", messageId: "m1", name: "Task", input: '{"description":"x"}' },
      { type: "subagent_started", toolUseId: "t1", agentType: "reviewer", description: undefined },
      { type: "tool_call_end", id: "t1", status: "success", output: "done" },
      { type: "permission_denied", toolName: "Write", toolUseId: "t2" },
      {
        type: "message_end",
        messageId: "m1",
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5, costUsd: undefined },
      },
    ]);
  });

  it("reports an unexpected non-zero exit as an error", async () => {
    const { turn, collected } = await start();
    turn.exit(2);
    expect(await collected).toEqual([{ type: "error", message: "Claude Code exited with code 2." }]);
  });

  it("does not add an exit error after the runtime reported its own error", async () => {
    const { turn, collected } = await start();
    turn.emit({ type: "error", message: "Not logged in" });
    turn.exit(1);
    expect(await collected).toEqual([{ type: "error", message: "Not logged in" }]);
  });

  it("cancel() calls turn_cancel and ends quietly", async () => {
    const { client, handle, turn, collected } = await start();

    await handle.cancel();

    expect(client.turnCancel).toHaveBeenCalledWith(turn.id);
    expect(await collected).toEqual([]);
  });

  it("cancels as soon as the turn id is known when cancel() came first", async () => {
    const client = new FakeNativeClient();
    const provider = new ClaudeCodeProvider(client);
    const handle = provider.startTurn(request);
    const collected = collect(handle.events);

    await handle.cancel();

    await waitFor(() => expect(client.turnCancel).toHaveBeenCalledWith("turn-1"));
    expect(await collected).toEqual([]);
  });

  it("turns a failed turn_start into an error event", async () => {
    const client = new FakeNativeClient();
    client.fail("turnStart", "Claude Code is not installed", "not_installed");
    const handle = new ClaudeCodeProvider(client).startTurn(request);

    expect(await collect(handle.events)).toEqual([{ type: "error", message: "Claude Code is not installed" }]);
  });
});
