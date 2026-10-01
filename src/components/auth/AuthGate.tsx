import { CircleAlert, KeyRound, LoaderCircle, MonitorSmartphone, PackageSearch, ShieldX } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { CommandSnippet } from "@/components/common/CommandSnippet";
import { usePageTitle } from "@/components/common/use-page-title";
import { Logo } from "@/components/layout/Logo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { hasAccess, planLabel, type AuthStatus } from "@/features/ai/auth";
import { cn } from "@/lib/utils";
import { authTiming, useAuthStore } from "@/stores/authStore";

export const INSTALL_COMMAND = "winget install Anthropic.ClaudeCode";
export const DOCS_URL = "https://code.claude.com/docs";

/**
 * Mandatory sign-in gate: the app shell (sidebar, pages) only renders with a
 * Claude subscription sign-in. The status is re-checked when the window regains
 * focus and periodically, so signing out elsewhere returns the user here.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const error = useAuthStore((s) => s.error);
  const refresh = useAuthStore((s) => s.refresh);
  const polling = useAuthStore((s) => s.signIn.phase === "waiting" || s.signIn.phase === "launching");

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (polling) return;
    const recheck = () => void refresh({ silent: true });
    window.addEventListener("focus", recheck);
    const timer = setInterval(recheck, authTiming.recheckIntervalMs);
    return () => {
      window.removeEventListener("focus", recheck);
      clearInterval(timer);
    };
  }, [refresh, polling]);

  if (hasAccess(status)) return <>{children}</>;
  if (!status) return error ? <CheckFailedScreen message={error} /> : <CheckingScreen />;
  return <GateScreen status={status} />;
}

function GateScreen({ status }: { status: Exclude<AuthStatus, { state: "signed_in"; subscription: true }> }) {
  switch (status.state) {
    case "unavailable":
      return <DesktopRequiredScreen />;
    case "cli_not_found":
      return <InstallScreen />;
    case "signed_out":
      return <SignInScreen />;
    case "signed_in":
      return <NoSubscriptionScreen status={status} />;
  }
}

// --- Layout -------------------------------------------------------------------------

function GateLayout({
  title,
  icon: Icon,
  tone = "default",
  children,
}: {
  title: string;
  icon: typeof KeyRound;
  tone?: "default" | "danger";
  children: ReactNode;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  usePageTitle(title);

  // Each new gate screen moves focus to its heading so the change is announced.
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

function Lead({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function InlineError({ message }: { message: string | undefined }) {
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

/** "Check again" that keeps focus while busy (aria-disabled instead of disabled). */
function CheckAgainButton({ variant = "outline" }: { variant?: "outline" | "default" }) {
  const checking = useAuthStore((s) => s.checking);
  const refresh = useAuthStore((s) => s.refresh);
  return (
    <Button
      variant={variant}
      size="sm"
      aria-disabled={checking || undefined}
      className="aria-disabled:opacity-50"
      onClick={() => {
        if (!checking) void refresh();
      }}
    >
      {checking ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
      {checking ? "Checking…" : "Check again"}
    </Button>
  );
}

// --- Screens --------------------------------------------------------------------------

function CheckingScreen() {
  usePageTitle("Checking Claude Code");
  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-6">
      <div className="w-full max-w-md space-y-4 rounded-xl border bg-card p-6" role="status" aria-live="polite">
        <div className="flex items-center gap-3">
          <LoaderCircle className="size-5 animate-spin text-primary" aria-hidden="true" />
          <span className="text-sm font-medium">Checking Claude Code…</span>
        </div>
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}

function CheckFailedScreen({ message }: { message: string }) {
  return (
    <GateLayout title="Could not check Claude Code" icon={CircleAlert} tone="danger">
      <Lead>Crowe Harness could not read the Claude Code sign-in status.</Lead>
      <InlineError message={message} />
      <CheckAgainButton variant="default" />
    </GateLayout>
  );
}

function DesktopRequiredScreen() {
  return (
    <GateLayout title="Open Crowe Harness desktop app" icon={MonitorSmartphone}>
      <Lead>
        Crowe Harness runs Claude Code on your computer, which only works inside the desktop app. This page is the
        app&apos;s interface opened in a regular browser, so it cannot sign in or read your projects.
      </Lead>
      <Lead>Start Crowe Harness from the Start menu, or run it during development with “pnpm tauri dev”.</Lead>
    </GateLayout>
  );
}

function InstallScreen() {
  const error = useAuthStore((s) => s.error);
  return (
    <GateLayout title="Install Claude Code" icon={PackageSearch}>
      <Lead>
        Crowe Harness uses Claude Code as its AI runtime, but it was not found on this computer. Install it, then check
        again.
      </Lead>
      <div className="space-y-2">
        <p className="text-sm font-medium">Install with winget</p>
        <CommandSnippet value={INSTALL_COMMAND} label="install command" />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Other installation options</p>
        <CommandSnippet value={DOCS_URL} label="documentation link" />
      </div>
      <Lead>The Claude desktop app also includes Claude Code — if it is installed, Crowe Harness can use it.</Lead>
      <InlineError message={error} />
      <CheckAgainButton variant="default" />
    </GateLayout>
  );
}

function SignInScreen() {
  const signIn = useAuthStore((s) => s.signIn);
  const error = useAuthStore((s) => s.error);
  const startSignIn = useAuthStore((s) => s.startSignIn);
  const cancelSignIn = useAuthStore((s) => s.cancelSignIn);
  const busy = signIn.phase === "launching" || signIn.phase === "waiting";

  return (
    <GateLayout title="Sign in with your Claude subscription" icon={KeyRound}>
      <Lead>
        Crowe Harness works with your own Claude plan (Pro, Max, Team or Enterprise). Sign-in goes through Claude Code:
        a console window opens and Claude Code continues in your browser.
      </Lead>
      {signIn.phase === "waiting" ? (
        <div role="status" aria-live="polite" className="space-y-1 rounded-md border bg-surface px-3 py-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <LoaderCircle className="size-4 animate-spin text-primary" aria-hidden="true" />
            Waiting for sign-in…
          </p>
          <p className="text-muted-foreground">
            Complete sign-in in the browser window that opened. If no browser opened, follow the link shown in the
            Claude Code console window. This screen continues automatically.
          </p>
        </div>
      ) : (
        <p role="status" aria-live="polite" className="sr-only">
          {signIn.phase === "launching" ? "Opening Claude Code sign-in…" : ""}
        </p>
      )}
      {signIn.phase === "timed_out" ? (
        <InlineError message="Sign-in was not completed in time. Start it again when you are ready." />
      ) : null}
      {signIn.phase === "failed" ? <InlineError message={signIn.message} /> : null}
      <InlineError message={error} />
      <div className="flex flex-wrap gap-2">
        {busy ? (
          <Button variant="outline" size="sm" onClick={cancelSignIn}>
            Cancel
          </Button>
        ) : (
          <Button size="sm" onClick={() => void startSignIn()}>
            <KeyRound data-icon="inline-start" />
            {signIn.phase === "idle" ? "Sign in with Claude" : "Try again"}
          </Button>
        )}
        {busy ? null : <CheckAgainButton />}
      </div>
    </GateLayout>
  );
}

function NoSubscriptionScreen({ status }: { status: Extract<AuthStatus, { state: "signed_in" }> }) {
  const signingOut = useAuthStore((s) => s.signingOut);
  const signOut = useAuthStore((s) => s.signOut);
  const error = useAuthStore((s) => s.error);
  const account = [status.email, status.orgName].filter(Boolean).join(" · ");
  const plan = planLabel(status.subscriptionType);

  return (
    <GateLayout title="A Claude subscription is required" icon={ShieldX} tone="danger">
      <Lead>
        Claude Code is signed in{account ? ` as ${account}` : ""}
        {status.method ? ` (${status.method})` : ""}, but not with a Claude subscription. Crowe Harness only works with
        a Claude Pro, Max, Team or Enterprise plan — Console accounts and API keys are not supported.
        {plan ? ` Reported plan: ${plan}.` : ""}
      </Lead>
      <Lead>Sign out, then sign in again with the Claude account that has your subscription.</Lead>
      <InlineError message={error} />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          aria-disabled={signingOut || undefined}
          className="aria-disabled:opacity-50"
          onClick={() => {
            if (!signingOut) void signOut();
          }}
        >
          {signingOut ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
          {signingOut ? "Signing out…" : "Sign out"}
        </Button>
        <CheckAgainButton />
      </div>
    </GateLayout>
  );
}
