import { Check, Circle, CircleX, LoaderCircle } from "lucide-react";
import type { ActivityItem, ActivityStatus } from "@/data/types";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<ActivityStatus, string> = {
  done: "Done",
  running: "In progress",
  pending: "Pending",
  error: "Failed",
};

export function ActivityList({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border bg-surface px-3 py-2">
      <p className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">Activity</p>
      <ul className="space-y-1" aria-label="Activity">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-2 text-sm">
            <StatusIcon status={item.status} />
            <span className={cn(item.status === "pending" && "text-muted-foreground")}>{item.label}</span>
            {item.tool ? (
              <span className="ml-auto rounded border px-1.5 font-mono text-[11px] leading-4 text-muted-foreground">
                {item.tool}
              </span>
            ) : null}
            <span className="sr-only">{STATUS_LABEL[item.status]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusIcon({ status }: { status: ActivityStatus }) {
  const common = "size-3.5 shrink-0";
  switch (status) {
    case "done":
      return <Check className={cn(common, "text-success")} aria-hidden="true" />;
    case "running":
      return <LoaderCircle className={cn(common, "animate-spin text-primary")} aria-hidden="true" />;
    case "error":
      return <CircleX className={cn(common, "text-destructive")} aria-hidden="true" />;
    case "pending":
      return <Circle className={cn(common, "text-muted-foreground")} aria-hidden="true" />;
  }
}
