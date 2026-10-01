import { Bot, RefreshCw } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { Page, PageHeader } from "@/components/common/PageHeader";
import { ProjectScopeSelect } from "@/components/common/ProjectScopeSelect";
import { ListSkeleton, LoadError } from "@/components/common/ResourceStates";
import { ScopeBadge } from "@/components/common/ScopeBadge";
import { usePageTitle } from "@/components/common/use-page-title";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { services } from "@/features/ai/services";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { useUiStore } from "@/stores/uiStore";

export function AgentsPage() {
  const [projectId, setProjectId] = useState<string | null>(() => useUiStore.getState().lastProjectId ?? null);
  const agents = useAsyncResource(`agents:${projectId ?? ""}`, () => services.config.listAgents(projectId));
  usePageTitle("Agents");

  return (
    <Page>
      <PageHeader
        title="Agents"
        description="Subagents Claude Code can delegate to, read from your user and project configuration."
        actions={
          <Button variant="outline" size="sm" onClick={agents.reload}>
            <RefreshCw data-icon="inline-start" /> Refresh
          </Button>
        }
      />
      <ProjectScopeSelect value={projectId} onChange={setProjectId} />
      {agents.status === "error" && !agents.data ? (
        <LoadError title="Could not load agents" message={agents.error} onRetry={agents.reload} />
      ) : !agents.data ? (
        <ListSkeleton label="Loading agents…" />
      ) : agents.data.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="No agents found"
          description={
            <>
              Claude Code reads agents from <code className="font-mono text-xs">~/.claude/agents</code> (user) and{" "}
              <code className="font-mono text-xs">.claude/agents</code> in a project. Create one with the{" "}
              <code className="font-mono text-xs">/agents</code> command in Claude Code.
            </>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Agents">
          {agents.data.map((agent) => (
            <li key={`${agent.scope}:${agent.name}`}>
              <Card size="sm" className="h-full">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <div className="flex size-8 items-center justify-center rounded-md bg-accent text-accent-foreground">
                      <Bot className="size-4" aria-hidden="true" />
                    </div>
                    <CardTitle className="min-w-0 flex-1 truncate">{agent.name}</CardTitle>
                    <ScopeBadge scope={agent.scope} />
                  </div>
                  <CardDescription>{agent.description || "No description"}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-1">
                  {agent.tools.length === 0 ? (
                    <span className="text-xs text-muted-foreground">All tools</span>
                  ) : (
                    agent.tools.map((tool) => (
                      <Badge key={tool} variant="outline" className="font-mono">
                        {tool}
                      </Badge>
                    ))
                  )}
                  {agent.model ? (
                    <span className="ml-auto font-mono text-xs text-muted-foreground">{agent.model}</span>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
