import { Ban, OctagonX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PERMISSION_MODE_LABELS } from "@/features/ai/types";
import type { ChatNotice } from "@/stores/chatStore";

/** Turn notices: tools Claude Code was not allowed to use (headless mode cannot ask), and stopped replies. */
export function ChatNotices({ notices, onDismiss }: { notices: ChatNotice[]; onDismiss: (id: string) => void }) {
  return (
    <div aria-live="polite" className="space-y-2 empty:hidden">
      {notices.map((notice) =>
        notice.kind === "permission_denied" ? (
          <div
            key={notice.id}
            className="flex items-start gap-3 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-sm"
          >
            <Ban className="mt-0.5 size-4 shrink-0 text-warning-foreground dark:text-warning" aria-hidden="true" />
            <p className="min-w-0 flex-1">
              <span className="font-medium">
                Claude Code was not allowed to use <span className="font-mono">{notice.toolName}</span>.
              </span>{" "}
              <span className="text-muted-foreground">
                Chats run without interactive approval. To let Claude change files, switch the permission mode to “
                {PERMISSION_MODE_LABELS.acceptEdits}” in the composer and send your message again.
              </span>
            </p>
            <DismissButton onClick={() => onDismiss(notice.id)} />
          </div>
        ) : (
          <div key={notice.id} className="flex items-center gap-3 rounded-lg border bg-surface px-3 py-2 text-sm">
            <OctagonX className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="flex-1">You stopped the response.</p>
            <DismissButton onClick={() => onDismiss(notice.id)} />
          </div>
        ),
      )}
    </div>
  );
}

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="icon-xs" aria-label="Dismiss notice" onClick={onClick}>
      <X />
    </Button>
  );
}
