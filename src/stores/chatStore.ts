import { create } from "zustand";
import { services } from "@/features/ai/services";
import type { PermissionDecision, PermissionMode, TurnHandle, Usage } from "@/features/ai/types";
import { applyEvent, settleTurn, type MessageView } from "@/features/chat/view-model";
import { errorMessage } from "@/lib/errors";
import { createId } from "@/lib/id";
import { useProjectStore } from "./projectStore";
import { transcriptKey, useSessionStore } from "./sessionStore";

export type ChatStatus = "idle" | "running" | "awaiting_permission" | "error";

export interface PendingPermission {
  id: string;
  tool: string;
  input: string;
}

export type ChatNotice = { id: string; kind: "permission_denied"; toolName: string } | { id: string; kind: "stopped" };

/** Live state of one chat. Keyed by session id, or by `draftKey(projectId)` before the session exists. */
export interface LiveChat {
  projectId: string;
  /** Claude Code session id once known (`session_started`). */
  sessionId: string | null;
  status: ChatStatus;
  /** Optimistic user message + streamed reply. Cleared once the stored transcript has been reloaded. */
  messages: MessageView[];
  error?: string;
  notices: ChatNotice[];
  pendingPermission?: PendingPermission;
  /** Usage reported for the last turn. */
  usage?: Usage;
  model?: string;
}

interface ChatState {
  chats: Record<string, LiveChat | undefined>;
  /** Chat key → session id the chat now lives under (a new chat got its id, or a resume forked). */
  redirects: Record<string, string | undefined>;
  /** Permission mode chosen in the composer, per chat key. */
  modes: Record<string, PermissionMode | undefined>;
  send: (
    key: string,
    target: { projectId: string; sessionId: string | null },
    text: string,
    mode: PermissionMode,
  ) => Promise<void>;
  stop: (key: string) => Promise<void>;
  respondToPermission: (key: string, decision: PermissionDecision) => Promise<void>;
  dismissNotice: (key: string, noticeId: string) => void;
  consumeRedirect: (key: string) => void;
  setMode: (key: string, mode: PermissionMode) => void;
  /** Cancels running turns and forgets all live state. */
  reset: () => void;
}

export const draftKey = (projectId: string) => `draft:${projectId}`;

export function isBusy(status: ChatStatus | undefined): boolean {
  return status === "running" || status === "awaiting_permission";
}

/** A turn in flight. Only the turn registered for a chat key may mutate that chat. */
interface Turn {
  generation: number;
  key: string;
  handle?: TurnHandle;
  stopRequested: boolean;
}

export const useChatStore = create<ChatState>()((set, get) => {
  const turns = new Map<string, Turn>();
  let generation = 0;

  const patchChat = (key: string, fn: (chat: LiveChat) => LiveChat) =>
    set((state) => {
      const chat = state.chats[key];
      return chat ? { chats: { ...state.chats, [key]: fn(chat) } } : state;
    });

  /** Moves a chat (and its turn and mode) to a new key; leaves a redirect behind. */
  const moveChat = (from: string, to: string) => {
    if (from === to) return;
    const turn = turns.get(from);
    if (turn) {
      turns.delete(from);
      turn.key = to;
      turns.set(to, turn);
    }
    set((state) => {
      const { [from]: chat, ...chats } = state.chats;
      const { [from]: mode, ...modes } = state.modes;
      return {
        chats: chat ? { ...chats, [to]: chat } : chats,
        modes: mode ? { ...modes, [to]: mode } : modes,
        redirects: { ...state.redirects, [from]: to },
      };
    });
  };

  /** After a turn: refresh lists, reload the transcript, then drop the live copy of the messages. */
  const syncHistory = async (key: string, projectId: string, sessionId: string) => {
    const sessions = useSessionStore.getState();
    await Promise.all([
      sessions.loadSessions(projectId),
      useProjectStore.getState().load(),
      sessions.loadTranscript(projectId, sessionId),
    ]);
    if (turns.has(key)) return; // a new turn started meanwhile
    const transcript = useSessionStore.getState().transcripts[transcriptKey(projectId, sessionId)];
    if (transcript?.status === "ready") patchChat(key, (chat) => ({ ...chat, messages: [] }));
  };

  return {
    chats: {},
    redirects: {},
    modes: {},

    send: async (key, target, text, mode) => {
      const prompt = text.trim();
      if (!prompt || isBusy(get().chats[key]?.status)) return;

      generation += 1;
      const turn: Turn = { generation, key, stopRequested: false };
      turns.set(key, turn);
      const isCurrent = () => turns.get(turn.key) === turn;

      const userMessage: MessageView = {
        id: createId("user"),
        role: "user",
        blocks: [{ kind: "text", id: createId("text"), text: prompt }],
        timestamp: new Date().toISOString(),
        status: "done",
      };
      set((state) => {
        const previous = state.chats[key];
        return {
          chats: {
            ...state.chats,
            [key]: {
              projectId: target.projectId,
              sessionId: target.sessionId ?? previous?.sessionId ?? null,
              status: "running",
              messages: [...(previous?.messages ?? []), userMessage],
              notices: [],
              usage: previous?.usage,
              model: previous?.model,
            },
          },
        };
      });

      let failure: string | undefined;
      try {
        const handle = services.ai.startTurn({
          projectId: target.projectId,
          sessionId: get().chats[key]?.sessionId ?? null,
          prompt,
          permissionMode: mode,
        });
        turn.handle = handle;
        if (turn.stopRequested) void handle.cancel().catch(() => undefined);

        for await (const event of handle.events) {
          if (!isCurrent()) break; // orphaned by reset(): stop consuming, never touch state
          switch (event.type) {
            case "session_started":
              if (event.sessionId !== turn.key) {
                moveChat(turn.key, event.sessionId);
                // A new chat: show it in the chat list as soon as Claude Code has created it.
                void useSessionStore.getState().loadSessions(target.projectId);
              }
              patchChat(turn.key, (chat) => ({
                ...chat,
                sessionId: event.sessionId,
                model: event.model ?? chat.model,
              }));
              break;
            case "permission_request":
              patchChat(turn.key, (chat) => ({
                ...chat,
                status: "awaiting_permission",
                pendingPermission: { id: event.id, tool: event.tool, input: event.input },
              }));
              break;
            case "permission_denied":
              patchChat(turn.key, (chat) => ({
                ...chat,
                notices: [
                  ...chat.notices,
                  { id: createId("notice"), kind: "permission_denied", toolName: event.toolName },
                ],
              }));
              break;
            case "message_end":
              if (event.usage) patchChat(turn.key, (chat) => ({ ...chat, usage: event.usage }));
              break;
            case "error":
              failure = event.message;
              patchChat(turn.key, (chat) => ({ ...chat, error: event.message }));
              break;
            default:
              break;
          }
          patchChat(turn.key, (chat) => ({ ...chat, messages: applyEvent(chat.messages, event) }));
        }
      } catch (error) {
        failure = errorMessage(error);
      }

      if (!isCurrent()) return;
      turns.delete(turn.key);
      const stopped = turn.stopRequested && failure === undefined;
      patchChat(turn.key, (chat) => ({
        ...chat,
        status: failure === undefined ? "idle" : "error",
        error: failure ?? chat.error,
        pendingPermission: undefined,
        messages: settleTurn(chat.messages, failure === undefined ? "interrupted" : "error"),
        notices: stopped ? [...chat.notices, { id: createId("notice"), kind: "stopped" }] : chat.notices,
      }));

      const chat = get().chats[turn.key];
      if (chat?.sessionId) await syncHistory(turn.key, chat.projectId, chat.sessionId);
    },

    stop: async (key) => {
      const turn = turns.get(key);
      if (!turn) return;
      turn.stopRequested = true;
      if (!turn.handle) return;
      try {
        await turn.handle.cancel();
      } catch (error) {
        if (turns.get(turn.key) === turn) patchChat(turn.key, (chat) => ({ ...chat, error: errorMessage(error) }));
      }
    },

    respondToPermission: async (key, decision) => {
      const chat = get().chats[key];
      const pending = chat?.pendingPermission;
      const turn = turns.get(key);
      const respond = services.ai.respondToPermission?.bind(services.ai);
      if (!pending || !turn || !respond) return;
      patchChat(key, (c) => ({ ...c, status: "running", pendingPermission: undefined }));
      try {
        await respond(pending.id, decision);
      } catch (error) {
        if (turns.get(turn.key) === turn) patchChat(turn.key, (c) => ({ ...c, error: errorMessage(error) }));
      }
    },

    dismissNotice: (key, noticeId) =>
      patchChat(key, (chat) => ({ ...chat, notices: chat.notices.filter((n) => n.id !== noticeId) })),

    consumeRedirect: (key) =>
      set((state) => {
        if (!(key in state.redirects)) return state;
        const { [key]: _removed, ...redirects } = state.redirects;
        return { redirects };
      }),

    setMode: (key, mode) => set((state) => ({ modes: { ...state.modes, [key]: mode } })),

    reset: () => {
      for (const turn of turns.values()) void turn.handle?.cancel().catch(() => undefined);
      turns.clear();
      set({ chats: {}, redirects: {}, modes: {} });
    },
  };
});
