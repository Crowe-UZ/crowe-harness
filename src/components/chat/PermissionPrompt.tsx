import { ShieldAlert } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { PermissionDecision } from "@/features/ai/types";
import { summarizeToolInput } from "@/features/chat/view-model";
import type { PendingPermission } from "@/stores/chatStore";

/**
 * Asks the user to allow or deny a tool call requested by the runtime. Only shown for runtimes that
 * emit `permission_request`; headless Claude Code reports denials instead (see ChatNotices).
 * Non-modal alert dialog: it is announced when it appears and takes focus (first decision),
 * the parent returns focus to the composer once a decision is made.
 */
export function PermissionPrompt({
  request,
  onDecide,
}: {
  request: PendingPermission;
  onDecide: (decision: PermissionDecision) => void;
}) {
  const detail = summarizeToolInput(request.input) || undefined;
  const titleId = `permission-${request.id}-title`;
  const detailId = `permission-${request.id}-detail`;
  const firstActionRef = useRef<HTMLButtonElement>(null);

  // Each new request (new id) moves focus to its first decision button.
  useEffect(() => {
    firstActionRef.current?.focus();
  }, [request.id]);

  return (
    <section
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={detail ? detailId : undefined}
      className="rounded-lg border border-warning/50 bg-warning/10 px-4 py-3"
    >
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning-foreground dark:text-warning" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          <h2 id={titleId} className="text-sm font-medium">
            Allow Claude to use <span className="font-mono">{request.tool}</span>?
          </h2>
          {detail ? (
            <p id={detailId} className="line-clamp-3 font-mono text-xs break-all text-muted-foreground">
              {detail}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button ref={firstActionRef} type="button" variant="outline" size="sm" onClick={() => onDecide("deny")}>
          Deny
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => onDecide("allow_session")}>
          Allow for this session
        </Button>
        <Button type="button" size="sm" onClick={() => onDecide("allow")}>
          Allow once
        </Button>
      </div>
    </section>
  );
}
