import { History } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { MessageView } from "@/features/chat/view-model";
import { MessageItem } from "./MessageItem";

/** Messages rendered at first; older ones are added on request so long chats open quickly. */
export const INITIAL_WINDOW = 120;
const WINDOW_STEP = 200;

/**
 * Message list of a chat. Items are memoized; for long transcripts only the
 * most recent messages are mounted until the user asks for earlier ones.
 */
export function Conversation({
  messages,
  truncated = false,
  assistantLabel,
  userLabel,
  footer,
}: {
  messages: MessageView[];
  /** The runtime returned only the most recent part of the history. */
  truncated?: boolean;
  assistantLabel?: string;
  userLabel?: string;
  footer?: ReactNode;
}) {
  const [windowSize, setWindowSize] = useState(INITIAL_WINDOW);
  const hidden = Math.max(0, messages.length - windowSize);
  const visible = hidden > 0 ? messages.slice(hidden) : messages;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-6">
      {truncated && hidden === 0 ? (
        <p className="flex items-center gap-2 rounded-md border bg-surface px-3 py-2 text-xs text-muted-foreground">
          <History className="size-3.5 shrink-0" aria-hidden="true" />
          Earlier messages truncated — only the most recent part of this chat is shown.
        </p>
      ) : null}
      {hidden > 0 ? (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setWindowSize((n) => n + WINDOW_STEP)}>
            <History data-icon="inline-start" />
            Show earlier messages ({hidden})
          </Button>
        </div>
      ) : null}
      {visible.map((message) => (
        <MessageItem key={message.id} message={message} assistantLabel={assistantLabel} userLabel={userLabel} />
      ))}
      {footer}
    </div>
  );
}
