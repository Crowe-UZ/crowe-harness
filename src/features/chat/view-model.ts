/**
 * Chat view model shared by stored transcripts (Claude Code history) and live
 * turns (streamed `AIEvent`s). Pure functions, unit-tested.
 */

import type { TranscriptMessage } from "@/data/types";
import type { AIEvent, Usage } from "@/features/ai/types";

/** `pending`: the tool never reported a result (interrupted turn or truncated history). */
export type ToolStatus = "running" | "success" | "error" | "denied" | "pending";

export interface TextView {
  kind: "text";
  id: string;
  text: string;
}

export interface ToolView {
  kind: "tool";
  /** The tool_use id; tool results and subagents are paired by it. */
  id: string;
  name: string;
  /** Raw JSON input (may be truncated by the runtime). */
  input: string;
  status: ToolStatus;
  output?: string;
  agentType?: string;
  agentDescription?: string;
}

export type BlockView = TextView | ToolView;

export type MessageStatus = "streaming" | "done" | "interrupted" | "error";

export interface MessageView {
  id: string;
  role: "user" | "assistant";
  blocks: BlockView[];
  timestamp?: string;
  status?: MessageStatus;
  usage?: Usage;
}

/** Tools whose calls start a subagent ("agent chat"). */
export const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(["Task", "Agent"]);

/**
 * Converts a stored transcript into view messages: tool results are paired
 * with their tool_use (by id) instead of being shown as user messages, and
 * consecutive assistant records are merged into one message.
 */
export function transcriptToView(messages: TranscriptMessage[]): MessageView[] {
  const results = new Map<string, { isError: boolean; text: string }>();
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type === "tool_result") results.set(block.toolUseId, { isError: block.isError, text: block.text });
    }
  }

  const views: MessageView[] = [];
  for (const message of messages) {
    const blocks: BlockView[] = [];
    message.blocks.forEach((block, index) => {
      if (block.type === "text") {
        if (block.text.trim()) blocks.push({ kind: "text", id: `${message.id}-${index}`, text: block.text });
      } else if (block.type === "tool_use") {
        const result = results.get(block.id);
        blocks.push({
          kind: "tool",
          id: block.id,
          name: block.name,
          input: block.input,
          status: result ? (result.isError ? "error" : "success") : "pending",
          output: result?.text,
        });
      }
    });
    if (blocks.length === 0) continue;
    views.push({ id: message.id, role: message.role, blocks, timestamp: message.timestamp ?? undefined });
  }
  return mergeAssistantRuns(views);
}

/** Merges consecutive assistant messages (one model turn is often stored as several records). */
export function mergeAssistantRuns(messages: MessageView[]): MessageView[] {
  const merged: MessageView[] = [];
  for (const message of messages) {
    const previous = merged.at(-1);
    if (previous && previous.role === "assistant" && message.role === "assistant") {
      merged[merged.length - 1] = {
        ...previous,
        blocks: [...previous.blocks, ...message.blocks],
        status: message.status ?? previous.status,
        usage: message.usage ?? previous.usage,
      };
    } else {
      merged.push(message);
    }
  }
  return merged;
}

/** Tool name counts over a transcript, most used first. */
export function toolUsage(messages: TranscriptMessage[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type === "tool_use") counts.set(block.name, (counts.get(block.name) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// --- Tool input summaries ---------------------------------------------------------

const SUMMARY_KEYS = ["description", "command", "file_path", "path", "pattern", "url", "query", "prompt", "skill"];
const MAX_SUMMARY = 100;

export function parseToolInput(input: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(input);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** One-line description of a tool input, e.g. the command of a Bash call or the path of a Read. */
export function summarizeToolInput(input: string): string {
  const parsed = parseToolInput(input);
  let summary: string | undefined;
  if (parsed) {
    for (const key of SUMMARY_KEYS) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim()) {
        summary = value;
        break;
      }
    }
    summary ??= Object.values(parsed).find((v): v is string => typeof v === "string" && v.trim() !== "");
  } else {
    summary = input;
  }
  const oneLine = (summary ?? "").replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_SUMMARY ? `${oneLine.slice(0, MAX_SUMMARY - 1)}…` : oneLine;
}

/** Pretty-printed input for the expanded tool card. */
export function formatToolInput(input: string): string {
  const parsed = parseToolInput(input);
  return parsed ? JSON.stringify(parsed, null, 2) : input;
}

// --- Live turns -------------------------------------------------------------------

/** The current turn is everything after the last user message. */
function currentTurnStart(messages: MessageView[]): number {
  return messages.findLastIndex((m) => m.role === "user") + 1;
}

function mapMessage(
  messages: MessageView[],
  messageId: string | undefined,
  fn: (m: MessageView) => MessageView,
): MessageView[] {
  let index = messageId === undefined ? -1 : messages.findIndex((m) => m.id === messageId);
  if (index === -1) {
    const start = currentTurnStart(messages);
    index = messages.findLastIndex((m, i) => i >= start && m.role === "assistant");
  }
  if (index === -1) return messages;
  return messages.map((m, i) => (i === index ? fn(m) : m));
}

function mapTool(messages: MessageView[], toolId: string, fn: (t: ToolView) => ToolView): MessageView[] {
  const start = currentTurnStart(messages);
  const index = messages.findLastIndex(
    (m, i) => i >= start && m.blocks.some((b) => b.kind === "tool" && b.id === toolId),
  );
  if (index === -1) return messages;
  return messages.map((m, i) =>
    i === index ? { ...m, blocks: m.blocks.map((b) => (b.kind === "tool" && b.id === toolId ? fn(b) : b)) } : m,
  );
}

function newAssistant(id: string): MessageView {
  return { id, role: "assistant", blocks: [], status: "streaming", timestamp: new Date().toISOString() };
}

/** Pure reducer from runtime events to live view messages. */
export function applyEvent(messages: MessageView[], event: AIEvent): MessageView[] {
  switch (event.type) {
    case "message_start":
      if (messages.some((m) => m.id === event.messageId)) return messages;
      return [...messages, newAssistant(event.messageId)];
    case "text_delta": {
      const withMessage = ensureAssistant(messages, event.messageId);
      return mapMessage(withMessage, event.messageId, (m) => {
        const last = m.blocks.at(-1);
        if (last?.kind === "text") {
          return { ...m, blocks: [...m.blocks.slice(0, -1), { ...last, text: last.text + event.text }] };
        }
        return { ...m, blocks: [...m.blocks, { kind: "text", id: `${m.id}-${m.blocks.length}`, text: event.text }] };
      });
    }
    case "tool_call_start": {
      if (messages.some((m) => m.blocks.some((b) => b.kind === "tool" && b.id === event.id))) return messages;
      const withMessage = ensureAssistant(messages, event.messageId ?? `assistant-${event.id}`);
      return mapMessage(withMessage, event.messageId, (m) => ({
        ...m,
        blocks: [...m.blocks, { kind: "tool", id: event.id, name: event.name, input: event.input, status: "running" }],
      }));
    }
    case "tool_call_end":
      return mapTool(messages, event.id, (t) => ({
        ...t,
        status: t.status === "denied" ? "denied" : event.status,
        output: event.output ?? t.output,
      }));
    case "subagent_started":
      return mapTool(messages, event.toolUseId, (t) => ({
        ...t,
        agentType: event.agentType ?? t.agentType,
        agentDescription: event.description ?? t.agentDescription,
      }));
    case "permission_denied":
      return mapTool(messages, event.toolUseId, (t) => ({ ...t, status: "denied" }));
    case "message_end":
      return mapMessage(messages, event.messageId, (m) => ({
        ...m,
        status: event.stopReason === "interrupted" ? "interrupted" : "done",
        usage: event.usage ?? m.usage,
      }));
    case "error":
      return settleTurn(messages, "error");
    case "session_started":
    case "permission_request":
      return messages;
  }
}

/** Adds an assistant message for `messageId` when the current turn has none yet. */
function ensureAssistant(messages: MessageView[], messageId: string): MessageView[] {
  if (messages.some((m) => m.id === messageId)) return messages;
  const start = currentTurnStart(messages);
  if (messages.some((m, i) => i >= start && m.role === "assistant")) return messages;
  return [...messages, newAssistant(messageId)];
}

/**
 * Ends the current turn: streaming messages get `status`, tools still running
 * become `pending` (no result was reported).
 */
export function settleTurn(messages: MessageView[], status: MessageStatus): MessageView[] {
  const start = currentTurnStart(messages);
  let changed = false;
  const next = messages.map((m, i) => {
    if (i < start) return m;
    const streaming = m.status === "streaming";
    const running = m.blocks.some((b) => b.kind === "tool" && b.status === "running");
    if (!streaming && !running) return m;
    changed = true;
    return {
      ...m,
      status: streaming ? status : m.status,
      blocks: m.blocks.map((b) =>
        b.kind === "tool" && b.status === "running" ? { ...b, status: "pending" as const } : b,
      ),
    };
  });
  return changed ? next : messages;
}
