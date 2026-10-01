import { Link } from "react-router";
import { describeAuthStatus, hasAccess } from "@/features/ai/auth";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";

export function StatusBar() {
  const status = useAuthStore((s) => s.status);
  const version = status?.state === "signed_in" || status?.state === "signed_out" ? status.install.version : undefined;

  return (
    <footer
      className="flex h-(--statusbar-h) shrink-0 items-center gap-4 border-t bg-sidebar px-3 text-xs text-muted-foreground"
      aria-label="Status bar"
    >
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-success" aria-hidden="true" />
        Local
      </span>
      <Link
        to="/settings?tab=account"
        className="flex items-center gap-1.5 rounded px-1 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span
          className={cn("size-2 rounded-full", hasAccess(status) ? "bg-success" : "bg-muted-foreground/50")}
          aria-hidden="true"
        />
        Claude: {describeAuthStatus(status)}
      </Link>
      {version ? <span>Claude Code {version}</span> : null}
      <span className="ml-auto tabular-nums">v{__APP_VERSION__}</span>
    </footer>
  );
}
