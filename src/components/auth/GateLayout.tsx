import { CircleAlert, LoaderCircle, type LucideIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { usePageTitle } from "@/components/common/use-page-title";
import { Logo } from "@/components/layout/Logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";

/** Full-screen card shared by every gate screen. Focus moves to the heading whenever the title changes. */
export function GateLayout({
  title,
  icon: Icon,
  tone = "default",
  children,
}: {
  title: string;
  icon: LucideIcon;
  tone?: "default" | "danger" | "success";
  children: ReactNode;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  usePageTitle(title);

  // Each new gate screen (or step) moves focus to its heading so the change is announced.
  useEffect(() => {
    headingRef.current?.focus();
  }, [title]);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background px-6 py-10 text-foreground">
      <main className="w-full max-w-md space-y-6" aria-labelledby="gate-title">
        <div className="flex items-center gap-2">
          <Logo className="size-6" />
          <span className="text-sm font-semibold tracking-tight">Crowe Harness</span>
        </div>
        <section className="space-y-5 rounded-xl border bg-card p-6 text-card-foreground shadow-xs">
          <div className="space-y-3">
            <div
              className={cn(
                "flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground",
                tone === "danger" && "bg-destructive/10 text-destructive",
                tone === "success" && "bg-success/10 text-success",
              )}
            >
              <Icon className="size-5" aria-hidden="true" />
            </div>
            <h1
              id="gate-title"
              ref={headingRef}
              tabIndex={-1}
              className="text-lg font-semibold tracking-tight outline-none"
            >
              {title}
            </h1>
          </div>
          {children}
        </section>
        <p className="text-center text-xs text-muted-foreground">
          Powered by Claude Code. Crowe Harness never sees or stores your Claude credentials.
        </p>
      </main>
    </div>
  );
}

export function Lead({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-sm text-muted-foreground", className)}>{children}</p>;
}

export function InlineError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}

/** "Check again": re-discovers Claude Code; keeps focus while busy (aria-disabled instead of disabled). */
export function CheckAgainButton({ variant = "outline" }: { variant?: "outline" | "default" }) {
  const checking = useAuthStore((s) => s.checking);
  const refresh = useAuthStore((s) => s.refresh);
  return (
    <Button
      variant={variant}
      size="sm"
      aria-disabled={checking || undefined}
      className="aria-disabled:opacity-50"
      onClick={() => {
        if (!checking) void refresh({ force: true });
      }}
    >
      {checking ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
      {checking ? "Checking…" : "Check again"}
    </Button>
  );
}
