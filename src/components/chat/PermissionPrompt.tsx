import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PermissionDecision } from "@/features/ai/types";
import type { PendingPermission } from "@/stores/chatStore";

function describeInput(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input === "object" && "description" in input && typeof input.description === "string") {
    return input.description;
  }
  try {
    return JSON.stringify(input);
  } catch {
    return undefined;
  }
}

/** Asks the user to allow or deny a tool call requested by the runtime. */
export function PermissionPrompt({
  request,
  onDecide,
}: {
  request: PendingPermission;
  onDecide: (decision: PermissionDecision) => void;
}) {
  const detail = describeInput(request.input);
  const titleId = `permission-${request.id}-title`;
  const detailId = `permission-${request.id}-detail`;

  return (
    <section
      aria-labelledby={titleId}
      aria-describedby={detail ? detailId : undefined}
      className="rounded-lg border border-warning/50 bg-warning/10 px-4 py-3"
    >
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          <p id={titleId} className="text-sm font-medium">
            Allow Claude to use <span className="font-mono">{request.tool}</span>?
          </p>
          {detail ? (
            <p id={detailId} className="truncate font-mono text-xs text-muted-foreground">
              {detail}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onDecide("deny")}>
          Deny
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => onDecide("allow_session")}>
          Allow for session
        </Button>
        <Button type="button" size="sm" onClick={() => onDecide("allow")}>
          Allow once
        </Button>
      </div>
    </section>
  );
}
