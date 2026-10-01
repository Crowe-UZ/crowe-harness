import type { NativeClient } from "@/features/native/client";
import type { TurnEvent } from "@/features/native/contract";
import { AsyncQueue } from "@/lib/async-queue";
import { errorMessage } from "@/lib/errors";
import type { AIEvent, AIProvider, TurnHandle, TurnRequest } from "./types";

/** Maps one native `TurnEvent` to UI `AIEvent`s (`exit` is handled by the provider and maps to nothing). */
export function mapTurnEvent(event: TurnEvent): AIEvent[] {
  switch (event.type) {
    case "session_started":
      return [{ type: "session_started", sessionId: event.sessionId, model: event.model ?? undefined }];
    case "message_start":
      return [{ type: "message_start", messageId: event.messageId }];
    case "text_delta":
      return [{ type: "text_delta", messageId: event.messageId, text: event.text }];
    case "tool_call_start":
      return [
        { type: "tool_call_start", id: event.id, messageId: event.messageId, name: event.name, input: event.input },
      ];
    case "tool_call_end":
      return [{ type: "tool_call_end", id: event.id, status: event.status, output: event.output }];
    case "subagent_started":
      return [
        {
          type: "subagent_started",
          toolUseId: event.toolUseId,
          agentType: event.agentType ?? undefined,
          description: event.description ?? undefined,
        },
      ];
    case "message_end":
      return [
        {
          type: "message_end",
          messageId: event.messageId,
          stopReason: event.stopReason,
          usage: event.usage
            ? {
                inputTokens: event.usage.inputTokens,
                outputTokens: event.usage.outputTokens,
                costUsd: event.usage.costUsd ?? undefined,
              }
            : undefined,
        },
      ];
    case "permission_denied":
      return [{ type: "permission_denied", toolName: event.toolName, toolUseId: event.toolUseId }];
    case "error":
      return [{ type: "error", message: event.message }];
    case "exit":
      return [];
  }
}

/**
 * Claude Code runtime: every turn is one headless `claude -p` process started by Rust
 * (`turn_start`), resumed with `--resume <sessionId>` when continuing a chat.
 * Headless Claude Code cannot ask for permission interactively; it reports `permission_denied` instead.
 */
export class ClaudeCodeProvider implements AIProvider {
  readonly id = "claude-code";

  constructor(private readonly client: NativeClient) {}

  startTurn(request: TurnRequest): TurnHandle {
    const queue = new AsyncQueue<AIEvent>();
    let turnId: string | undefined;
    let cancelRequested = false;
    let cancelSent = false;
    let sawError = false;

    const sendCancel = async () => {
      if (cancelSent || turnId === undefined || queue.isClosed) return;
      cancelSent = true;
      await this.client.turnCancel(turnId);
    };

    const onEvent = (event: TurnEvent) => {
      if (event.type === "exit") {
        if (event.code !== 0 && !cancelRequested && !sawError) {
          queue.push({
            type: "error",
            message:
              event.code === null ? "Claude Code stopped unexpectedly." : `Claude Code exited with code ${event.code}.`,
          });
        }
        queue.close();
        return;
      }
      if (event.type === "error") sawError = true;
      for (const mapped of mapTurnEvent(event)) queue.push(mapped);
    };

    this.client
      .turnStart(
        {
          projectId: request.projectId,
          sessionId: request.sessionId,
          prompt: request.prompt,
          permissionMode: request.permissionMode,
        },
        onEvent,
      )
      .then(
        (id) => {
          turnId = id;
          if (cancelRequested) void sendCancel().catch(() => undefined);
        },
        (error: unknown) => {
          queue.push({ type: "error", message: errorMessage(error) });
          queue.close();
        },
      );

    return {
      events: queue,
      cancel: async () => {
        cancelRequested = true;
        await sendCancel();
      },
    };
  }
}
