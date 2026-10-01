import { Link } from "react-router";
import { describeAuthStatus } from "@/features/ai/auth";
import { services } from "@/features/ai/services";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";

export function StatusBar() {
  const status = useAuthStore((s) => s.status);
  const signedIn = status?.state === "signed_in";

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
          className={cn("size-2 rounded-full", signedIn ? "bg-success" : "bg-muted-foreground/50")}
          aria-hidden="true"
        />
        Claude: {describeAuthStatus(status)}
      </Link>
      {services.ai.id === "mock" ? <span className="rounded border px-1.5 leading-4">Demo runtime</span> : null}
      <span className="ml-auto tabular-nums">v{__APP_VERSION__}</span>
    </footer>
  );
}
