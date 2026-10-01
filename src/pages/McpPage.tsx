import { Plug, RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { Page, PageHeader } from "@/components/common/PageHeader";
import { ListSkeleton, LoadError } from "@/components/common/ResourceStates";
import { usePageTitle } from "@/components/common/use-page-title";
import { Button } from "@/components/ui/button";
import type { McpServer } from "@/data/types";
import { services } from "@/features/ai/services";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { cn } from "@/lib/utils";

const STATUS = {
  connected: { label: "Connected", dot: "bg-success" },
  failed: { label: "Failed", dot: "bg-destructive" },
  needs_auth: { label: "Needs authentication", dot: "bg-warning" },
  unknown: { label: "Unknown", dot: "bg-muted-foreground/50" },
} satisfies Record<McpServer["status"], { label: string; dot: string }>;

export function McpPage() {
  const servers = useAsyncResource("mcp", () => services.config.listMcpServers());
  usePageTitle("MCP servers");

  return (
    <Page>
      <PageHeader
        title="MCP servers"
        description="Model Context Protocol servers configured in Claude Code, with their status from “claude mcp list”."
        actions={
          <Button variant="outline" size="sm" onClick={servers.reload}>
            <RefreshCw data-icon="inline-start" /> Refresh
          </Button>
        }
      />
      {servers.status === "error" && !servers.data ? (
        <LoadError title="Could not load MCP servers" message={servers.error} onRetry={servers.reload} />
      ) : !servers.data ? (
        <ListSkeleton label="Checking MCP servers…" />
      ) : servers.data.length === 0 ? (
        <EmptyState
          icon={Plug}
          title="No MCP servers configured"
          description={
            <>
              Add one with Claude Code, for example{" "}
              <code className="font-mono text-xs">claude mcp add &lt;name&gt; -- &lt;command&gt;</code> or{" "}
              <code className="font-mono text-xs">claude mcp add --transport http &lt;name&gt; &lt;url&gt;</code>, then
              refresh this page.
            </>
          }
        />
      ) : (
        <ul className="divide-y rounded-lg border" aria-label="MCP servers">
          {servers.data.map((server) => (
            <li key={server.name} className="flex items-center gap-4 px-4 py-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
                <Plug className="size-4" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{server.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground" title={server.target}>
                  {server.target}
                </p>
              </div>
              <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn("size-2 rounded-full", STATUS[server.status].dot)} aria-hidden="true" />
                {STATUS[server.status].label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
