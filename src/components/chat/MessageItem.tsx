import { Bot, User } from "lucide-react";
import { memo } from "react";
import type { ChatMessage } from "@/data/types";
import { cn } from "@/lib/utils";
import { ActivityList } from "./ActivityList";

/** Memoized: during streaming only the message being updated re-renders. */
export const MessageItem = memo(function MessageItem({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const streaming = message.status === "streaming";

  return (
    <article
      className="flex gap-3"
      aria-label={isUser ? "Your message" : "Assistant message"}
      aria-busy={streaming || undefined}
    >
      <div
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border",
          isUser ? "bg-secondary text-secondary-foreground" : "bg-primary text-primary-foreground",
        )}
        aria-hidden="true"
      >
        {isUser ? <User className="size-4" /> : <Bot className="size-4" />}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-xs font-medium text-muted-foreground">{isUser ? "You" : "Assistant"}</p>
        {message.activity && message.activity.length > 0 ? <ActivityList items={message.activity} /> : null}
        {message.text ? (
          <div className="text-sm leading-relaxed whitespace-pre-wrap">
            {message.text}
            {streaming ? <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-foreground/60 align-text-bottom" /> : null}
          </div>
        ) : streaming ? (
          <p className="text-sm text-muted-foreground">Working…</p>
        ) : null}
        {message.status === "interrupted" ? (
          <p className="text-xs text-warning-foreground">
            <span className="rounded bg-warning px-1.5 py-0.5">Stopped</span>
          </p>
        ) : null}
        {message.status === "error" ? (
          <p className="text-xs text-destructive">The response failed.</p>
        ) : null}
      </div>
    </article>
  );
});
