import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleX,
  Download,
  LoaderCircle,
  PackageSearch,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { useEffect, useId, type ReactNode } from "react";
import { CommandSnippet } from "@/components/common/CommandSnippet";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { isOneOf } from "@/lib/guards";
import { formatMegabytes, formatSpeed, formatTimeLeft } from "@/lib/transfer";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { useInstallStore, type InstallStep } from "@/stores/installStore";
import { CheckAgainButton, GateLayout, InlineError, Lead } from "./GateLayout";
import {
  CHANNELS,
  describeInstallError,
  detectOs,
  OS_LABELS,
  osFromPlatform,
  OTHER_INSTALL_METHODS,
  PHASE_LABELS,
  PHASES,
  SETUP_DOCS_URL,
  type InstallOs,
} from "./install-text";

const CHANNEL_VALUES = ["stable", "latest"] as const;

/**
 * Gate screen shown when Claude Code is not found: installs it in-app (consent → progress →
 * done | error | cancelled) or lists the official ways to install it by hand.
 */
export function InstallScreen() {
  const install = useInstallStore((s) => s.install);

  // Leaving the screen (Claude Code was found) ends the flow; a running install keeps going.
  useEffect(() => () => useInstallStore.getState().dismiss(), []);

  switch (install.step) {
    case "idle":
      return <NotFoundStep />;
    case "confirming":
      return <ConsentStep />;
    case "running":
      return <RunningStep install={install} />;
    case "done":
      return <DoneStep install={install} />;
    case "error":
      return <ErrorStep install={install} />;
    case "cancelled":
      return <CancelledStep />;
  }
}

// --- Steps ------------------------------------------------------------------------------

function NotFoundStep() {
  const error = useAuthStore((s) => s.error);
  const openConsent = useInstallStore((s) => s.openConsent);
  return (
    <GateLayout title="Claude Code not found" icon={PackageSearch}>
      <Lead>
        Crowe Harness uses Claude Code as its AI runtime, but it was not found on this computer. Crowe Harness can
        download it from Anthropic and install it for you — no administrator rights needed.
      </Lead>
      <InlineError message={error} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={openConsent}>
          <Download data-icon="inline-start" />
          Install Claude Code
        </Button>
        <CheckAgainButton />
      </div>
      <Lead className="text-xs">
        The Claude desktop app also includes Claude Code — if it is installed, Crowe Harness can use it.
      </Lead>
      <OtherWaysToInstall />
    </GateLayout>
  );
}

function ConsentStep() {
  const channel = useInstallStore((s) => s.channel);
  const plan = useInstallStore((s) => s.plan);
  const setChannel = useInstallStore((s) => s.setChannel);
  const loadPlan = useInstallStore((s) => s.loadPlan);
  const start = useInstallStore((s) => s.start);
  const closeConsent = useInstallStore((s) => s.closeConsent);
  const channelHint = useId();

  // Esc closes the consent panel, like a dialog.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) closeConsent();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeConsent]);

  const ready = plan.status === "ready" ? plan.plan : undefined;

  if (ready?.alreadyInstalled) {
    const existing = ready.alreadyInstalled;
    return (
      <GateLayout title="Claude Code is already installed" icon={CircleCheck} tone="success">
        <Lead>
          Claude Code {existing.version ? `${existing.version} ` : ""}is already installed at{" "}
          <code className="font-mono text-xs break-all text-foreground">{existing.path}</code>. Check again to continue
          with it.
        </Lead>
        <div className="flex flex-wrap gap-2">
          <CheckAgainButton variant="default" />
          <Button variant="outline" size="sm" onClick={closeConsent}>
            Cancel
          </Button>
        </div>
      </GateLayout>
    );
  }

  return (
    <GateLayout title="Install Claude Code" icon={Download}>
      <Lead>Crowe Harness downloads Claude Code from Anthropic and installs it for your user account.</Lead>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Release channel</legend>
        <RadioGroup
          value={channel}
          onValueChange={(value) => {
            if (isOneOf(CHANNEL_VALUES, value)) setChannel(value);
          }}
          className="grid gap-2"
        >
          {CHANNELS.map((c) => (
            <div key={c.value} className="flex items-start gap-2">
              <RadioGroupItem
                value={c.value}
                id={`channel-${c.value}`}
                aria-describedby={`${channelHint}-${c.value}`}
                className="mt-0.5"
              />
              <div>
                <Label htmlFor={`channel-${c.value}`}>{c.label}</Label>
                <p id={`${channelHint}-${c.value}`} className="text-xs text-muted-foreground">
                  {c.hint}
                </p>
              </div>
            </div>
          ))}
        </RadioGroup>
      </fieldset>

      <div aria-busy={plan.status === "loading" || undefined}>
        {plan.status === "ready" ? (
          <dl className="grid grid-cols-[8.5rem_1fr] gap-x-3 gap-y-1.5 rounded-md border bg-surface px-3 py-3 text-sm">
            <dt className="text-muted-foreground">Version</dt>
            <dd className="font-mono text-xs leading-5">{plan.plan.version}</dd>
            <dt className="text-muted-foreground">Download size</dt>
            <dd>{formatMegabytes(plan.plan.sizeBytes)}</dd>
            <dt className="text-muted-foreground">Downloaded from</dt>
            <dd className="font-mono text-xs leading-5">{plan.plan.sourceHost}</dd>
            <dt className="text-muted-foreground">Install location</dt>
            <dd className="font-mono text-xs leading-5 break-all">{plan.plan.installDir}</dd>
          </dl>
        ) : plan.status === "error" ? (
          <div className="space-y-2">
            <InlineError message={planErrorMessage(plan.code, plan.message)} />
            <Button variant="outline" size="sm" onClick={() => void loadPlan()}>
              <RefreshCw data-icon="inline-start" />
              Try again
            </Button>
          </div>
        ) : (
          <div className="space-y-2 rounded-md border bg-surface px-3 py-3">
            <p role="status" className="sr-only">
              Loading install details…
            </p>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/5" />
          </div>
        )}
      </div>

      <ul className="space-y-2 text-sm">
        <Assurance icon={RefreshCw}>Updates automatically</Assurance>
        <Assurance icon={ShieldCheck}>Verified with Anthropic&apos;s release signature and checksum</Assurance>
        <Assurance icon={UserCheck}>No administrator rights required</Assurance>
      </ul>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          aria-disabled={!ready || undefined}
          className="aria-disabled:opacity-50"
          onClick={() => {
            if (ready) void start();
          }}
        >
          <Download data-icon="inline-start" />
          Install
        </Button>
        <Button variant="outline" size="sm" onClick={closeConsent}>
          Cancel
        </Button>
      </div>
    </GateLayout>
  );
}

function RunningStep({ install }: { install: Extract<InstallStep, { step: "running" }> }) {
  const cancel = useInstallStore((s) => s.cancel);
  const current = PHASES.indexOf(install.phase);
  const label = PHASE_LABELS[install.phase];
  const { receivedBytes, totalBytes } = install;
  const percent = totalBytes > 0 ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : undefined;
  const bytes = totalBytes > 0 ? `${formatMegabytes(receivedBytes)} of ${formatMegabytes(totalBytes)}` : undefined;
  const rate =
    install.phase === "downloading" && install.bytesPerSecond !== undefined
      ? [formatSpeed(install.bytesPerSecond), install.secondsLeft !== undefined && formatTimeLeft(install.secondsLeft)]
          .filter(Boolean)
          .join(" · ")
      : undefined;

  return (
    <GateLayout title="Installing Claude Code" icon={Download}>
      {/* Announces each phase once — not every progress tick. */}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {label}
      </p>

      <ol aria-label="Installation steps" className="space-y-1.5 text-sm">
        {PHASES.map((phase, index) => {
          const state = index < current ? "done" : index === current ? "current" : "pending";
          return (
            <li
              key={phase}
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "flex items-center gap-2",
                state === "pending" && "text-muted-foreground",
                state === "current" && "font-medium",
              )}
            >
              {state === "done" ? (
                <CircleCheck className="size-4 shrink-0 text-success" aria-hidden="true" />
              ) : state === "current" ? (
                <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
              ) : (
                <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
                  <span className="size-1.5 rounded-full bg-muted-foreground/50" />
                </span>
              )}
              <span>{PHASE_LABELS[phase]}</span>
              {state === "done" ? <span className="sr-only">(done)</span> : null}
            </li>
          );
        })}
      </ol>

      <div className="space-y-1.5">
        <div
          role="progressbar"
          aria-label="Download progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={bytes ? `${percent ?? 0}%, ${bytes}` : undefined}
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              "h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none",
              percent === undefined && "w-1/3 animate-pulse",
            )}
            style={percent === undefined ? undefined : { width: `${percent}%` }}
          />
        </div>
        <p className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground tabular-nums">
          <span>{bytes ?? label}</span>
          {rate ? <span>{rate}</span> : null}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-disabled={install.cancelling || undefined}
          className="aria-disabled:opacity-50"
          onClick={() => void cancel()}
        >
          {install.cancelling ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
          {install.cancelling ? "Cancelling…" : "Cancel"}
        </Button>
      </div>
    </GateLayout>
  );
}

function DoneStep({ install }: { install: Extract<InstallStep, { step: "done" }> }) {
  const { version, path } = install.install;
  return (
    <GateLayout
      title={version ? `Claude Code ${version} installed` : "Claude Code installed"}
      icon={CircleCheck}
      tone="success"
    >
      {install.rechecked ? (
        <>
          <Lead>
            Claude Code was installed at <code className="font-mono text-xs break-all text-foreground">{path}</code>,
            but Crowe Harness cannot find it yet. Check again in a moment.
          </Lead>
          <CheckAgainButton variant="default" />
        </>
      ) : (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin text-primary" aria-hidden="true" />
          Continuing to sign-in…
        </p>
      )}
    </GateLayout>
  );
}

function ErrorStep({ install }: { install: Extract<InstallStep, { step: "error" }> }) {
  const retry = useInstallStore((s) => s.retry);
  const copy = describeInstallError(install.code);
  return (
    <GateLayout title={copy.title} icon={copy.security ? ShieldAlert : CircleAlert} tone="danger">
      <InlineError message={copy.message} />
      {install.message ? <ErrorDetails code={install.code} message={install.message} /> : null}
      <div className="flex flex-wrap gap-2">
        {copy.retryable ? (
          <Button size="sm" onClick={() => void retry()}>
            <RefreshCw data-icon="inline-start" />
            Try again
          </Button>
        ) : null}
        <CheckAgainButton variant={copy.retryable ? "outline" : "default"} />
      </div>
      <OtherWaysToInstall defaultOpen={!copy.retryable} />
    </GateLayout>
  );
}

function CancelledStep() {
  const openConsent = useInstallStore((s) => s.openConsent);
  return (
    <GateLayout title="Installation cancelled" icon={CircleX}>
      <Lead>Claude Code was not installed. You can start again at any time.</Lead>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={openConsent}>
          <Download data-icon="inline-start" />
          Install Claude Code
        </Button>
        <CheckAgainButton />
      </div>
      <OtherWaysToInstall />
    </GateLayout>
  );
}

// --- Pieces -----------------------------------------------------------------------------

function Assurance({ icon: Icon, children }: { icon: typeof ShieldCheck; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <Icon className="size-4 shrink-0 text-success" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

function planErrorMessage(code: string, message: string): string {
  const copy = describeInstallError(code);
  return copy.known ? copy.message : `Could not load the install details: ${message}`;
}

function DisclosureTrigger({ children }: { children: ReactNode }) {
  return (
    <CollapsibleTrigger asChild>
      <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
        <ChevronRight
          data-icon="inline-start"
          className="transition-transform group-aria-expanded/button:rotate-90 motion-reduce:transition-none"
        />
        {children}
      </Button>
    </CollapsibleTrigger>
  );
}

function ErrorDetails({ code, message }: { code: string; message: string }) {
  return (
    <Collapsible>
      <DisclosureTrigger>Show details</DisclosureTrigger>
      <CollapsibleContent>
        <pre className="mt-1 max-h-40 overflow-auto rounded-md border bg-surface px-3 py-2 font-mono text-xs whitespace-pre-wrap">
          {`${code}: ${message}`}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function OtherWaysToInstall({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const platform = useInstallStore((s) => (s.plan.status === "ready" ? s.plan.plan.platform : undefined));
  const detected = osFromPlatform(platform) ?? detectOs();
  const systems: InstallOs[] = detected ? [detected] : ["windows", "macos", "linux"];

  return (
    <Collapsible defaultOpen={defaultOpen} className="border-t pt-3">
      <DisclosureTrigger>Other ways to install</DisclosureTrigger>
      <CollapsibleContent className="mt-2 space-y-4">
        {systems.map((os) => (
          <div key={os} className="space-y-2">
            <p className="text-sm font-medium">{detected ? `Install on ${OS_LABELS[os]}` : OS_LABELS[os]}</p>
            {OTHER_INSTALL_METHODS[os].map((method) => (
              <div key={method.label} className="space-y-1">
                <p className="text-xs text-muted-foreground">{method.label}</p>
                <CommandSnippet
                  value={method.command}
                  label={`${detected ? "" : `${OS_LABELS[os]} `}${method.label} install command`}
                />
              </div>
            ))}
          </div>
        ))}
        <Lead className="text-xs">Run a command in a terminal, then click Check again.</Lead>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Installation guide</p>
          <CommandSnippet value={SETUP_DOCS_URL} label="installation guide link" />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
