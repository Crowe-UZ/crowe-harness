import { create } from "zustand";
import { createMockConversation } from "@/data/mock";
import type { ChatMessage, MessageStatus } from "@/data/types";
import { services } from "@/features/ai/services";
import type { AIEvent, AIProvider, PermissionDecision } from "@/features/ai/types";
import { errorMessage } from "@/lib/errors";
import { createId } from "@/lib/id";
import { useProjectStore } from "./projectStore";
import { useSessionStore } from "./sessionStore";
import { useSettingsStore } from "./settingsStore";

export type ChatStatus = "idle" | "running" | "awaiting_permission" | "error";

export interface PendingPermission {
  id: string;
  tool: string;
  input: unknown;
}

interface ChatState {
  conversations: Record<string, ChatMessage[]>;
  status: Record<string, ChatStatus>;
  errors: Record<string, string | undefined>;
  pendingPermission: Record<string, PendingPermission | undefined>;
  /** `provider` is injectable for tests; the app uses `services.ai`. */
  send: (sessionId: string, text: string, provider?: AIProvider) => Promise<void>;
  stop: (sessionId: string) => Promise<void>;
  respondToPermission: (sessionId: string, decision: PermissionDecision) => Promise<void>;
  reset: () => void;
}

/** A send() in flight. Only the turn registered for a session may mutate that session's state. */
interface Turn {
  generation: number;
  provider: AIProvider;
  runtimeId?: string;
  stopRequested: boolean;
}

/** Runtime sessions started during this app run, so later turns reuse them instead of resuming again. */
interface LiveRuntime {
  provider: AIProvider;
  runtimeId: string;
}

export function isBusy(status: ChatStatus | undefined): boolean {
  return status === "running" || status === "awaiting_permission";
}

const initialConversations = (): Record<string, ChatMessage[]> => ({ "fix-auth": createMockConversation() });

export const useChatStore = create<ChatState>()((set, get) => {
  const turns = new Map<string, Turn>();
  const runtimes = new Map<string, LiveRuntime>();
  let generation = 0;

  const update = (sessionId: string, fn: (messages: ChatMessage[]) => ChatMessage[]) =>
    set((state) => ({
      conversations: { ...state.conversations, [sessionId]: fn(state.conversations[sessionId] ?? []) },
    }));

  const patchSession = (
    sessionId: string,
    patch: { status?: ChatStatus; error?: string | null; pending?: PendingPermission | null },
  ) =>
    set((state) => ({
      status: patch.status ? { ...state.status, [sessionId]: patch.status } : state.status,
      errors: patch.error !== undefined ? { ...state.errors, [sessionId]: patch.error ?? undefined } : state.errors,
      pendingPermission:
        patch.pending !== undefined
          ? { ...state.pendingPermission, [sessionId]: patch.pending ?? undefined }
          : state.pendingPermission,
    }));

  const fail = (sessionId: string, message: string) => patchSession(sessionId, { status: "error", error: message });

  return {
    conversations: initialConversations(),
    status: {},
    errors: {},
    pendingPermission: {},

    send: async (sessionId, text, provider = services.ai) => {
      const trimmed = text.trim();
      if (!trimmed || isBusy(get().status[sessionId])) return;

      const session = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
      const project = session && useProjectStore.getState().projects.find((p) => p.id === session.projectId);
      if (!session || !project) {
        fail(sessionId, session ? "The project of this session no longer exists." : "This session no longer exists.");
        return;
      }

      generation += 1;
      const turn: Turn = { generation, provider, stopRequested: false };
      turns.set(sessionId, turn);
      const isCurrent = () => turns.get(sessionId)?.generation === turn.generation;

      const userMessage: ChatMessage = {
        id: createId("user"),
        role: "user",
        text: trimmed,
        createdAt: new Date().toISOString(),
        status: "done",
      };
      update(sessionId, (messages) => [...messages, userMessage]);
      patchSession(sessionId, { status: "running", error: null, pending: null });

      const bindRuntime = (runtimeId: string) => {
        turn.runtimeId = runtimeId;
        runtimes.set(sessionId, { provider, runtimeId });
        useSessionStore.getState().setRuntimeSessionId(sessionId, runtimeId);
      };

      let failure: string | undefined;
      try {
        const live = runtimes.get(sessionId);
        if (live?.provider === provider) {
          turn.runtimeId = live.runtimeId;
        } else {
          const runtimeId = await provider.startSession({
            projectPath: project.path,
            permissionMode: useSettingsStore.getState().defaultPermissionMode,
            resumeSessionId: session.runtimeSessionId,
          });
          if (!isCurrent()) {
            void provider.stopSession(runtimeId).catch(() => undefined);
            return;
          }
          bindRuntime(runtimeId);
        }
        if (turn.stopRequested || !turn.runtimeId) return;

        for await (const event of provider.sendMessage(turn.runtimeId, trimmed)) {
          // Orphaned stream (reset() or a newer send): stop consuming, never touch state.
          if (!isCurrent()) break;
          switch (event.type) {
            case "session_started":
              bindRuntime(event.sessionId);
              break;
            case "permission_request":
              patchSession(sessionId, {
                status: "awaiting_permission",
                pending: { id: event.id, tool: event.tool, input: event.input },
              });
              break;
            case "error":
              failure = event.message;
              patchSession(sessionId, { error: event.message });
              break;
            default:
              break;
          }
          update(sessionId, (messages) => applyEvent(messages, event));
        }
      } catch (error) {
        failure = errorMessage(error);
      } finally {
        if (isCurrent()) {
          turns.delete(sessionId);
          const leftover: MessageStatus = failure === undefined ? "interrupted" : "error";
          update(sessionId, (messages) => finalizeTurn(messages, userMessage.id, leftover));
          if (failure === undefined) patchSession(sessionId, { status: "idle", pending: null });
          else patchSession(sessionId, { status: "error", error: failure, pending: null });
        }
      }
    },

    stop: async (sessionId) => {
      const turn = turns.get(sessionId);
      if (!turn) return;
      turn.stopRequested = true;
      if (!turn.runtimeId) return;
      try {
        await turn.provider.interrupt(turn.runtimeId);
      } catch (error) {
        if (turns.get(sessionId) === turn) patchSession(sessionId, { error: errorMessage(error) });
      }
    },

    respondToPermission: async (sessionId, decision) => {
      const pending = get().pendingPermission[sessionId];
      const turn = turns.get(sessionId);
      if (!pending || !turn) return;
      patchSession(sessionId, { status: "running", pending: null });
      try {
        await turn.provider.respondToPermission(pending.id, decision);
      } catch (error) {
        if (turns.get(sessionId) === turn) patchSession(sessionId, { error: errorMessage(error) });
      }
    },

    reset: () => {
      for (const turn of turns.values()) {
        if (turn.runtimeId) void turn.provider.interrupt(turn.runtimeId).catch(() => undefined);
      }
      for (const live of runtimes.values()) {
        void live.provider.stopSession(live.runtimeId).catch(() => undefined);
      }
      turns.clear();
      runtimes.clear();
      set({ conversations: initialConversations(), status: {}, errors: {}, pendingPermission: {} });
    },
  };
});

/** Pure reducer from runtime events to chat messages (unit-tested). */
export function applyEvent(messages: ChatMessage[], event: AIEvent): ChatMessage[] {
  switch (event.type) {
    case "message_start":
      if (messages.some((m) => m.id === event.messageId)) return messages;
      return [
        ...messages,
        {
          id: event.messageId,
          role: "assistant",
          text: "",
          createdAt: new Date().toISOString(),
          status: "streaming",
          activity: [],
        },
      ];
    case "text_delta":
      return mapTurnMessage(messages, event.messageId, (m) => ({ ...m, text: m.text + event.text }));
    case "tool_call_start":
      return mapTurnMessage(messages, event.messageId, (m) => ({
        ...m,
        activity: [
          ...(m.activity ?? []),
          { id: event.id, label: describeTool(event.name, event.input), tool: event.name, status: "running" },
        ],
      }));
    case "tool_call_end":
      return mapTurnMessage(messages, event.messageId ?? findToolMessageId(messages, event.id), (m) => ({
        ...m,
        activity: (m.activity ?? []).map((a) =>
          a.id === event.id ? { ...a, status: event.status === "success" ? "done" : "error" } : a,
        ),
      }));
    case "message_end":
      return mapTurnMessage(messages, event.messageId, (m) => ({
        ...settle(m, event.stopReason === "interrupted" ? "interrupted" : "done"),
        usage: event.usage ?? m.usage,
      }));
    case "error":
      return settleStreaming(messages, currentTurnStart(messages), "error");
    case "session_started":
    case "permission_request":
      return messages;
  }
}

/**
 * Settles every assistant message of the turn started by `userMessageId` that
 * is still streaming (the stream ended without message_end, or threw).
 */
export function finalizeTurn(messages: ChatMessage[], userMessageId: string, status: MessageStatus): ChatMessage[] {
  const index = messages.findIndex((m) => m.id === userMessageId);
  return index === -1 ? messages : settleStreaming(messages, index + 1, status);
}

function settle(message: ChatMessage, status: MessageStatus): ChatMessage {
  return {
    ...message,
    status,
    activity: message.activity?.map((a) => (a.status === "running" ? { ...a, status: "pending" } : a)),
  };
}

function settleStreaming(messages: ChatMessage[], from: number, status: MessageStatus): ChatMessage[] {
  if (!messages.some((m, i) => i >= from && m.status === "streaming")) return messages;
  return messages.map((m, i) => (i >= from && m.status === "streaming" ? settle(m, status) : m));
}

function describeTool(name: string, input: unknown): string {
  if (input && typeof input === "object" && "description" in input && typeof input.description === "string") {
    return input.description;
  }
  return name;
}

/** The current turn is everything after the last user message. */
function currentTurnStart(messages: ChatMessage[]): number {
  return messages.findLastIndex((m) => m.role === "user") + 1;
}

function findToolMessageId(messages: ChatMessage[], toolId: string): string | undefined {
  const start = currentTurnStart(messages);
  return messages.findLast((m, i) => i >= start && m.activity?.some((a) => a.id === toolId))?.id;
}

/** Maps the message with `messageId`; falls back to the last assistant message of the current turn. */
function mapTurnMessage(
  messages: ChatMessage[],
  messageId: string | undefined,
  fn: (m: ChatMessage) => ChatMessage,
): ChatMessage[] {
  let index = messageId === undefined ? -1 : messages.findIndex((m) => m.id === messageId);
  if (index === -1) {
    const start = currentTurnStart(messages);
    index = messages.findLastIndex((m, i) => i >= start && m.role === "assistant");
  }
  if (index === -1) return messages;
  return messages.map((m, i) => (i === index ? fn(m) : m));
}
