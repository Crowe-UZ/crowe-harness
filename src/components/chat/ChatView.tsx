import { MessageSquareDashed } from "lucide-react";
import { useEffect, useRef } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import type { ChatMessage } from "@/data/types";
import { isBusy, useChatStore } from "@/stores/chatStore";
import { useProjectStore } from "@/stores/projectStore";
import { useSessionStore } from "@/stores/sessionStore";
import { Composer } from "./Composer";
import { MessageItem } from "./MessageItem";
import { PermissionPrompt } from "./PermissionPrompt";

const NO_MESSAGES: ChatMessage[] = [];
/** Distance from the bottom (px) within which the view keeps following new output. */
const PIN_THRESHOLD = 48;

export function ChatView({ sessionId, projectId }: { sessionId: string; projectId: string }) {
  const messages = useChatStore((s) => s.conversations[sessionId] ?? NO_MESSAGES);
  const busy = useChatStore((s) => isBusy(s.status[sessionId]));
  const error = useChatStore((s) => s.errors[sessionId]);
  const pendingPermission = useChatStore((s) => s.pendingPermission[sessionId]);
  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const respondToPermission = useChatStore((s) => s.respondToPermission);
  const touchSession = useSessionStore((s) => s.touchSession);
  const touchProject = useProjectStore((s) => s.touchProject);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  // `messages` changes identity on every streamed update (text, activity, status).
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, error, pendingPermission]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= PIN_THRESHOLD;
  };

  const onSend = (text: string) => {
    pinnedRef.current = true;
    touchSession(sessionId);
    touchProject(projectId);
    void send(sessionId, text);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto"
        role="log"
        aria-live="polite"
        aria-label="Conversation"
      >
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
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl space-y-3 px-6 pb-4">
        {pendingPermission ? (
          <PermissionPrompt
            request={pendingPermission}
            onDecide={(decision) => void respondToPermission(sessionId, decision)}
          />
        ) : null}
        <Composer running={busy} onSend={onSend} onStop={() => void stop(sessionId)} />
      </div>
    </div>
  );
}
