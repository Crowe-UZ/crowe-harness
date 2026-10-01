import { Check, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { mockSessionStats } from "@/data/mock";
import type { Session } from "@/data/types";
import { formatRelativeTime } from "@/lib/time";
import { useChatStore, type ChatStatus } from "@/stores/chatStore";

const STATUS_LABEL = {
  idle: "Idle",
  running: "Running",
  awaiting_permission: "Waiting for permission",
  error: "Error",
} satisfies Record<ChatStatus, string>;

export function SessionInspector({ session, onClose }: { session?: Session; onClose: () => void }) {
  const stats = mockSessionStats;
  const status = useChatStore((s) => (session ? s.status[session.id] : undefined) ?? "idle");
  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l bg-surface" aria-label="Session inspector">
      <div className="flex h-9 shrink-0 items-center justify-between border-b px-4">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Inspector</span>
        <Button variant="ghost" size="icon-xs" aria-label="Close inspector" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="space-y-4 p-4 text-sm">
        <Section title="Session">
          <p className="font-medium">{session?.title ?? "No session selected"}</p>
          {session ? (
            <>
              <p className="text-xs text-muted-foreground">Updated {formatRelativeTime(session.updatedAt)}</p>
              <p className="text-xs text-muted-foreground">Status: {STATUS_LABEL[status]}</p>
            </>
          ) : null}
        </Section>
        <Separator />
        <Section title="Model">
          <p>{stats.model}</p>
          <p className="text-xs text-muted-foreground">Runtime not connected (demo)</p>
        </Section>
        <Separator />
        <Section title="Tools">
          <ul className="space-y-1">
            {stats.tools.map((tool) => (
              <li key={tool} className="flex items-center gap-2">
                <Check className="size-3.5 text-success" aria-hidden="true" />
                {tool}
              </li>
            ))}
          </ul>
        </Section>
        <Separator />
        <Section title="Changes">
          <p>{stats.changes.files} files</p>
          <p className="font-mono text-xs">
            <span className="text-success">+{stats.changes.additions}</span>{" "}
            <span className="text-destructive">−{stats.changes.deletions}</span>
          </p>
        </Section>
        <Separator />
        <Section title="Activity">
          <p>{stats.actions} actions</p>
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
