import { Bot, User } from "lucide-react";
import { memo } from "react";
import type { MessageView } from "@/features/chat/view-model";
import { cn } from "@/lib/utils";
import { ToolCard } from "./ToolCard";

/** Memoized: while a reply streams only the message being updated re-renders. */
export const MessageItem = memo(function MessageItem({
  message,
  assistantLabel = "Claude",
  userLabel = "You",
}: {
  message: MessageView;
  assistantLabel?: string;
  /** Who wrote the user-role messages ("You", or the main chat for an agent chat). */
  userLabel?: string;
}) {
  const isUser = message.role === "user";
  const streaming = message.status === "streaming";
  const lastBlock = message.blocks.at(-1);

  return (
    <article
      className="flex gap-3"
      aria-label={
        isUser ? (userLabel === "You" ? "Your message" : `${userLabel} message`) : `${assistantLabel} message`
      }
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
        <p className="text-xs font-medium text-muted-foreground">{isUser ? userLabel : assistantLabel}</p>
        {message.blocks.map((block) =>
          block.kind === "text" ? (
            <div key={block.id} className="text-sm leading-relaxed break-words whitespace-pre-wrap">
              {block.text}
              {streaming && block === lastBlock ? (
                <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-foreground/60 align-text-bottom" />
              ) : null}
            </div>
          ) : (
            <ToolCard key={block.id} tool={block} />
          ),
        )}
        {streaming && message.blocks.length === 0 ? <p className="text-sm text-muted-foreground">Working…</p> : null}
        {message.status === "interrupted" ? (
          <p className="text-xs text-warning-foreground">
            <span className="rounded bg-warning px-1.5 py-0.5">Stopped</span>
          </p>
        ) : null}
        {message.status === "error" ? <p className="text-xs text-destructive">The response failed.</p> : null}
      </div>
    </article>
  );
});
