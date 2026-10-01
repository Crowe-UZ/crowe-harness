import { MessageSquareDashed } from "lucide-react";
import { useEffect, useRef } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import type { ChatMessage } from "@/data/types";
import { useChatStore } from "@/stores/chatStore";
import { useProjectStore } from "@/stores/projectStore";
import { useSessionStore } from "@/stores/sessionStore";
import { Composer } from "./Composer";
import { MessageItem } from "./MessageItem";

const NO_MESSAGES: ChatMessage[] = [];

export function ChatView({ sessionId, projectId }: { sessionId: string; projectId: string }) {
  const messages = useChatStore((s) => s.conversations[sessionId] ?? NO_MESSAGES);
  const running = useChatStore((s) => s.running[sessionId] ?? false);
  const error = useChatStore((s) => s.errors[sessionId]);
  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const touchSession = useSessionStore((s) => s.touchSession);
  const touchProject = useProjectStore((s) => s.touchProject);
  const bottomRef = useRef<HTMLDivElement>(null);

  const lastText = messages.at(-1)?.text;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, lastText]);

  const onSend = (text: string) => {
    touchSession(sessionId);
    touchProject(projectId);
    void send(sessionId, text);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto" role="log" aria-live="polite" aria-label="Conversation">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-6">
          {messages.length === 0 ? (
            <EmptyState
              icon={MessageSquareDashed}
              title="Start the conversation"
              description="Describe a task — for example “Add input validation to the login form”. The demo runtime will respond."
            />
          ) : (
            messages.map((message) => <MessageItem key={message.id} message={message} />)
          )}
          {error ? (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div ref={bottomRef} />
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl px-6 pb-4">
        <Composer running={running} onSend={onSend} onStop={() => void stop(sessionId)} />
      </div>
    </div>
  );
}
