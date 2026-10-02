import { CircleAlert, KeyRound, LoaderCircle, MonitorSmartphone, ShieldX } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { usePageTitle } from "@/components/common/use-page-title";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { hasAccess, planLabel, type AuthStatus } from "@/features/ai/auth";
import { authTiming, useAuthStore } from "@/stores/authStore";
import { CheckAgainButton, GateLayout, InlineError, Lead } from "./GateLayout";
import { InstallScreen } from "./InstallScreen";

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
