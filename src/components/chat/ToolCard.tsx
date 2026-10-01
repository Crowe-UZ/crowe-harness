import { Ban, Bot, Check, ChevronRight, Circle, CircleX, LoaderCircle, Wrench } from "lucide-react";
import { useContext, useState } from "react";
import { Link } from "react-router";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  formatToolInput,
  SUBAGENT_TOOLS,
  summarizeToolInput,
  type ToolStatus,
  type ToolView,
} from "@/features/chat/view-model";
import { cn } from "@/lib/utils";
import { AgentLinkContext } from "./agent-link";

const STATUS_LABEL = {
  running: "Running",
  success: "Done",
  error: "Failed",
  denied: "Permission denied",
  pending: "No result",
} satisfies Record<ToolStatus, string>;

/** Compact, collapsible card for one tool call; the result is paired by tool_use id. */
export function ToolCard({ tool }: { tool: ToolView }) {
  const [open, setOpen] = useState(false);
  const agentLink = useContext(AgentLinkContext)(tool.id);
  const summary = summarizeToolInput(tool.input);
  const isAgent = SUBAGENT_TOOLS.has(tool.name);
  const failed = tool.status === "error" || tool.status === "denied";

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn("rounded-lg border bg-surface text-sm", failed && "border-destructive/40 bg-destructive/5")}
      data-status={tool.status}
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring">
        <ChevronRight
          className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
          aria-hidden="true"
        />
        {isAgent ? (
          <Bot className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <Wrench className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <span className="shrink-0 font-mono text-xs font-medium">{tool.name}</span>
        {summary ? (
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{summary}</span>
        ) : (
          <span className="flex-1" />
        )}
        <StatusIcon status={tool.status} />
        <span className={cn("shrink-0 text-xs", failed ? "text-destructive" : "text-muted-foreground")}>
          {STATUS_LABEL[tool.status]}
        </span>
      </CollapsibleTrigger>
      {isAgent && (tool.agentType || tool.agentDescription || agentLink) ? (
        <div className="flex flex-wrap items-center gap-2 border-t px-3 py-1.5 text-xs">
          {tool.agentType ? <span className="font-medium">{tool.agentType}</span> : null}
          {tool.agentDescription ? (
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{tool.agentDescription}</span>
          ) : null}
          {agentLink ? (
            <Link
              to={agentLink}
              className="ml-auto rounded font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring"
            >
              Open agent chat
            </Link>
          ) : null}
        </div>
      ) : null}
      <CollapsibleContent className="space-y-2 border-t px-3 py-2">
        <ToolSection title="Input" text={formatToolInput(tool.input) || "(none)"} />
        {tool.output !== undefined ? (
          <ToolSection
            title={tool.status === "error" ? "Error" : "Result"}
            text={tool.output || "(empty)"}
            danger={tool.status === "error"}
          />
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ToolSection({ title, text, danger = false }: { title: string; text: string; danger?: boolean }) {
  return (
    <div className="space-y-1">
      <p className={cn("text-xs font-medium text-muted-foreground", danger && "text-destructive")}>{title}</p>
      <pre
        className={cn(
          "max-h-64 overflow-auto rounded-md border bg-background px-2 py-1.5 font-mono text-xs whitespace-pre-wrap break-words",
          danger && "border-destructive/40 text-destructive",
        )}
      >
        {text}
      </pre>
    </div>
  );
}

function StatusIcon({ status }: { status: ToolStatus }) {
  const common = "size-3.5 shrink-0";
  switch (status) {
    case "success":
      return <Check className={cn(common, "text-success")} aria-hidden="true" />;
    case "running":
      return <LoaderCircle className={cn(common, "animate-spin text-primary")} aria-hidden="true" />;
    case "error":
      return <CircleX className={cn(common, "text-destructive")} aria-hidden="true" />;
    case "denied":
      return <Ban className={cn(common, "text-destructive")} aria-hidden="true" />;
    case "pending":
      return <Circle className={cn(common, "text-muted-foreground")} aria-hidden="true" />;
  }
}
