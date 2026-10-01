import { Bot, X } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Session, Transcript } from "@/data/types";
import { toolUsage } from "@/features/chat/view-model";
import { subagentLabel } from "@/hooks/use-route-context";
import { formatRelativeTime } from "@/lib/time";
import type { ChatStatus, LiveChat } from "@/stores/chatStore";

const STATUS_LABEL = {
  idle: "Idle",
  running: "Running",
  awaiting_permission: "Waiting for permission",
  error: "Error",
} satisfies Record<ChatStatus, string>;

const numberFormat = new Intl.NumberFormat();
const costFormat = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 });

/** Details of the open chat, all from Claude Code history and the last live turn. */
export function SessionInspector({
  projectId,
  session,
  transcript,
  chat,
  isNewChat,
  onClose,
}: {
  projectId: string;
  session?: Session;
  transcript?: Transcript;
  chat?: LiveChat;
  isNewChat: boolean;
  onClose: () => void;
}) {
  const tools = useMemo(() => (transcript ? toolUsage(transcript.messages) : []), [transcript]);
  const status = chat?.status ?? "idle";
  const model = session?.model ?? chat?.model;

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l bg-surface" aria-label="Chat inspector">
      <div className="flex h-9 shrink-0 items-center justify-between border-b px-4">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Inspector</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label="Close inspector" onClick={onClose}>
              <X />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Close inspector</TooltipContent>
        </Tooltip>
      </div>
      <div className="space-y-4 p-4 text-sm">
        <Section title="Chat">
          <p className="font-medium break-words">{session?.title ?? (isNewChat ? "New chat" : "No chat selected")}</p>
          {session ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <Term label="Status">{STATUS_LABEL[status]}</Term>
              <Term label="Messages">{numberFormat.format(session.messageCount)}</Term>
              <Term label="Created">{formatRelativeTime(session.createdAt)}</Term>
              <Term label="Updated">{formatRelativeTime(session.updatedAt)}</Term>
              {session.gitBranch ? (
                <Term label="Branch">
                  <span className="font-mono">{session.gitBranch}</span>
                </Term>
              ) : null}
            </dl>
          ) : isNewChat ? (
            <p className="text-xs text-muted-foreground">The chat is created with your first message.</p>
          ) : null}
        </Section>
        <Separator />
        <Section title="Model">
          <p className={model ? "font-mono text-xs" : "text-xs text-muted-foreground"}>{model ?? "Not reported yet"}</p>
        </Section>
        <Separator />
        <Section title="Tool usage">
          {tools.length === 0 ? (
            <p className="text-xs text-muted-foreground">No tool calls{transcript ? "" : " loaded"}.</p>
          ) : (
            <ul className="space-y-1 text-xs" aria-label="Tool usage">
              {tools.map((tool) => (
                <li key={tool.name} className="flex items-center gap-2">
                  <span className="font-mono">{tool.name}</span>
                  <span className="ml-auto text-muted-foreground tabular-nums">{tool.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Separator />
        <Section title="Agent chats">
          {!transcript || transcript.subagents.length === 0 ? (
            <p className="text-xs text-muted-foreground">No agents in this chat.</p>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {transcript.subagents.map((agent) => (
                <li key={agent.id}>
                  <Link
                    to={`/projects/${projectId}/sessions/${transcript.session.id}/agents/${agent.id}`}
                    className="flex items-start gap-2 rounded px-1 py-0.5 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring"
                  >
                    <Bot className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block font-medium">{subagentLabel(agent)}</span>
                      {agent.description ? (
                        <span className="block truncate text-muted-foreground">{agent.description}</span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Separator />
        <Section title="Last turn">
          {chat?.usage ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <Term label="Input tokens">{numberFormat.format(chat.usage.inputTokens)}</Term>
              <Term label="Output tokens">{numberFormat.format(chat.usage.outputTokens)}</Term>
              {chat.usage.costUsd !== undefined ? (
                <Term label="Cost">{costFormat.format(chat.usage.costUsd)}</Term>
              ) : null}
            </dl>
          ) : (
            <p className="text-xs text-muted-foreground">Usage appears after a reply in this window.</p>
          )}
        </Section>
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Term({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </>
  );
}
