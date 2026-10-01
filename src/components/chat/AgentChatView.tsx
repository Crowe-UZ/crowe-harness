import { ArrowLeft, Bot, Lock, SearchX, TriangleAlert } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Link } from "react-router";
import { EmptyState } from "@/components/common/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { transcriptToView } from "@/features/chat/view-model";
import { subagentLabel } from "@/hooks/use-route-context";
import { formatRelativeTime } from "@/lib/time";
import { subagentKey, useSessionStore } from "@/stores/sessionStore";
import { Conversation } from "./Conversation";

/** Read-only transcript of a subagent ("agent chat") started by a Task/Agent tool call. */
export function AgentChatView({
  projectId,
  sessionId,
  agentId,
}: {
  projectId: string;
  sessionId: string;
  agentId: string;
}) {
  const resource = useSessionStore((s) => s.subagents[subagentKey(projectId, sessionId, agentId)]);
  const loadSubagent = useSessionStore((s) => s.loadSubagent);
  const data = resource?.data;
  const messages = useMemo(() => (data ? transcriptToView(data.messages) : []), [data]);
  const backTo = `/projects/${projectId}/sessions/${sessionId}`;

  useEffect(() => {
    void loadSubagent(projectId, sessionId, agentId);
  }, [loadSubagent, projectId, sessionId, agentId]);

  if (!data) {
    if (!resource || resource.status === "loading") {
      return (
        <div className="mx-auto max-w-3xl space-y-4 px-6 py-6" role="status">
          <span className="sr-only">Loading agent chat…</span>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      );
    }
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState
          icon={resource.notFound ? SearchX : TriangleAlert}
          tone="danger"
          title={resource.notFound ? "Agent chat not found" : "Could not load this agent chat"}
          description={resource.notFound ? "This chat has no agent with this id." : resource.error}
          action={
            <div className="flex gap-2">
              {resource.notFound ? null : (
                <Button variant="outline" size="sm" onClick={() => void loadSubagent(projectId, sessionId, agentId)}>
                  Retry
                </Button>
              )}
              <Button variant="outline" size="sm" asChild>
                <Link to={backTo}>Back to chat</Link>
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  const label = subagentLabel(data.subagent);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b px-6 py-3">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to={backTo}>
              <ArrowLeft data-icon="inline-start" /> Back to chat
            </Link>
          </Button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Bot className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <h2 className="truncate text-sm font-semibold">{label}</h2>
            {data.subagent.description ? (
              <span className="truncate text-sm text-muted-foreground">{data.subagent.description}</span>
            ) : null}
          </div>
          <Badge variant="outline" className="gap-1">
            <Lock aria-hidden="true" /> Read-only
          </Badge>
          <span className="text-xs text-muted-foreground">
            {data.subagent.messageCount} messages · updated {formatRelativeTime(data.subagent.updatedAt)}
          </span>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto" role="log" aria-label="Agent conversation">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-3xl px-6 py-6">
            <EmptyState icon={Bot} title="No messages" description="This agent chat has no stored messages." />
          </div>
        ) : (
          <Conversation messages={messages} truncated={data.truncated} assistantLabel={label} userLabel="Main chat" />
        )}
      </div>
    </div>
  );
}
