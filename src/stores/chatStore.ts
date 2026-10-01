import { create } from "zustand";
import { createMockConversation } from "@/data/mock";
import type { ChatMessage } from "@/data/types";
import { services } from "@/features/ai/services";
import type { AIEvent, AIProvider } from "@/features/ai/types";
import { createId } from "@/lib/id";

interface ChatState {
  conversations: Record<string, ChatMessage[]>;
  running: Record<string, boolean>;
  errors: Record<string, string | undefined>;
  send: (sessionId: string, text: string, provider?: AIProvider) => Promise<void>;
  stop: (sessionId: string, provider?: AIProvider) => Promise<void>;
  reset: () => void;
}

const initialConversations = (): Record<string, ChatMessage[]> => ({ "fix-auth": createMockConversation() });

export const useChatStore = create<ChatState>()((set, get) => {
  const update = (sessionId: string, fn: (messages: ChatMessage[]) => ChatMessage[]) =>
    set((state) => ({
      conversations: { ...state.conversations, [sessionId]: fn(state.conversations[sessionId] ?? []) },
    }));

  return {
    conversations: initialConversations(),
    running: {},
    errors: {},

    send: async (sessionId, text, provider = services.ai) => {
      const trimmed = text.trim();
      if (!trimmed || get().running[sessionId]) return;

      const userMessage: ChatMessage = {
        id: createId("user"),
        role: "user",
        text: trimmed,
        createdAt: new Date().toISOString(),
        status: "done",
      };
      update(sessionId, (messages) => [...messages, userMessage]);
      set((state) => ({
        running: { ...state.running, [sessionId]: true },
        errors: { ...state.errors, [sessionId]: undefined },
      }));

      try {
        for await (const event of provider.sendMessage(sessionId, trimmed)) {
          update(sessionId, (messages) => applyEvent(messages, event));
          if (event.type === "error") {
            set((state) => ({ errors: { ...state.errors, [sessionId]: event.message } }));
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        set((state) => ({ errors: { ...state.errors, [sessionId]: message } }));
        update(sessionId, (messages) => applyEvent(messages, { type: "error", message }));
      } finally {
        set((state) => ({ running: { ...state.running, [sessionId]: false } }));
      }
    },

    stop: async (sessionId, provider = services.ai) => {
      await provider.interrupt(sessionId);
    },

    reset: () => set({ conversations: initialConversations(), running: {}, errors: {} }),
  };
});

/** Pure reducer from runtime events to chat messages (unit-tested). */
export function applyEvent(messages: ChatMessage[], event: AIEvent): ChatMessage[] {
  switch (event.type) {
    case "message_start":
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
      return mapMessage(messages, event.messageId, (m) => ({ ...m, text: m.text + event.text }));
    case "tool_call_start":
      return mapLastAssistant(messages, (m) => ({
        ...m,
        activity: [
          ...(m.activity ?? []),
          { id: event.id, label: describeTool(event.name, event.input), tool: event.name, status: "running" },
        ],
      }));
    case "tool_call_end":
      return mapLastAssistant(messages, (m) => ({
        ...m,
        activity: (m.activity ?? []).map((a) =>
          a.id === event.id ? { ...a, status: event.status === "success" ? "done" : "error" } : a,
        ),
      }));
    case "message_end":
      return mapMessage(messages, event.messageId, (m) => ({
        ...m,
        status: event.stopReason === "interrupted" ? "interrupted" : "done",
        activity: (m.activity ?? []).map((a) => (a.status === "running" ? { ...a, status: "pending" } : a)),
      }));
    case "error":
      return mapLastAssistant(messages, (m) => (m.status === "streaming" ? { ...m, status: "error" } : m));
    case "session_started":
    case "permission_request":
      return messages;
  }
}

function describeTool(name: string, input: unknown): string {
  if (input && typeof input === "object" && "description" in input && typeof input.description === "string") {
    return input.description;
  }
  return name;
}

function mapMessage(messages: ChatMessage[], id: string, fn: (m: ChatMessage) => ChatMessage): ChatMessage[] {
  return messages.map((m) => (m.id === id ? fn(m) : m));
}

function mapLastAssistant(messages: ChatMessage[], fn: (m: ChatMessage) => ChatMessage): ChatMessage[] {
  const index = messages.findLastIndex((m) => m.role === "assistant");
  if (index === -1) return messages;
  return messages.map((m, i) => (i === index ? fn(m) : m));
}
