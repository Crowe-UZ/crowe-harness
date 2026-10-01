import { CircleCheck, KeyRound, LoaderCircle, RefreshCw, ShieldCheck, TerminalSquare } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { Page, PageHeader } from "@/components/common/PageHeader";
import { usePageTitle } from "@/components/common/use-page-title";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { describeAuthStatus, type AuthStatus } from "@/features/ai/auth";
import { services } from "@/features/ai/services";
import { isPermissionMode, type PermissionMode } from "@/features/ai/types";
import { isOneOf } from "@/lib/guards";
import { isTheme, useTheme, type Theme } from "@/lib/theme";
import { useAuthStore } from "@/stores/authStore";
import { useChatStore } from "@/stores/chatStore";
import { useProjectStore } from "@/stores/projectStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const SECTIONS = ["general", "appearance", "account", "security", "advanced"] as const;
type Section = (typeof SECTIONS)[number];

const LABELS = {
  general: "General",
  appearance: "Appearance",
  account: "Account",
  security: "Security",
  advanced: "Advanced",
} satisfies Record<Section, string>;

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab");
  const section: Section = isOneOf(SECTIONS, requested) ? requested : "general";
  usePageTitle(LABELS[section], "Settings");

  return (
    <Page>
      <PageHeader title="Settings" />
      <Tabs
        value={section}
        onValueChange={(value) => setParams({ tab: value }, { replace: true })}
        orientation="vertical"
        className="flex gap-8"
      >
        <TabsList variant="line" className="w-44 shrink-0 flex-col items-stretch">
          {SECTIONS.map((s) => (
            <TabsTrigger key={s} value={s} className="h-8 flex-none justify-start">
              {LABELS[s]}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="min-w-0 flex-1">
          <TabsContent value="general">
            <GeneralSettings />
          </TabsContent>
          <TabsContent value="appearance">
            <AppearanceSettings />
          </TabsContent>
          <TabsContent value="account">
            <AccountSettings />
          </TabsContent>
          <TabsContent value="security">
            <SecuritySettings />
          </TabsContent>
          <TabsContent value="advanced">
            <AdvancedSettings />
          </TabsContent>
        </div>
      </Tabs>
    </Page>
  );
}

function SettingsSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="divide-y rounded-lg border">{children}</div>
    </section>
  );
}

/** Pass `aria-describedby={hintId(htmlFor)}` on the control to associate the hint with it. */
function Row({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={htmlFor}>{label}</Label>
        {hint ? (
          <p id={htmlFor ? hintId(htmlFor) : undefined} className="text-xs text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const hintId = (id: string) => `${id}-hint`;

function GeneralSettings() {
  const openLast = useSettingsStore((s) => s.openLastProjectOnStartup);
  const setOpenLast = useSettingsStore((s) => s.setOpenLastProjectOnStartup);
  const folder = useSettingsStore((s) => s.defaultProjectsFolder);
  const setFolder = useSettingsStore((s) => s.setDefaultProjectsFolder);

  return (
    <SettingsSection title="General" description="Workspace defaults.">
      <Row label="Default projects folder" hint="Suggested location for new projects." htmlFor="projects-folder">
        <Input
          id="projects-folder"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          aria-describedby={hintId("projects-folder")}
          className="w-64 font-mono text-xs"
        />
      </Row>
      <Row label="Open last project on startup" htmlFor="open-last">
        <Switch id="open-last" checked={openLast} onCheckedChange={setOpenLast} />
      </Row>
    </SettingsSection>
  );
}

const THEMES: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  return (
    <SettingsSection title="Appearance" description="Choose how Crowe Harness looks.">
      <div className="px-4 py-3">
        <fieldset>
          <legend className="mb-3 text-sm font-medium">Theme</legend>
          <RadioGroup value={theme} onValueChange={(value) => {
              if (isTheme(value)) setTheme(value);
            }} className="grid gap-2">
            {THEMES.map(({ value, label }) => (
              <div key={value} className="flex items-center gap-2">
                <RadioGroupItem value={value} id={`theme-${value}`} />
                <Label htmlFor={`theme-${value}`}>{label}</Label>
              </div>
            ))}
          </RadioGroup>
        </fieldset>
      </div>
    </SettingsSection>
  );
}

function AccountSettings() {
  const status = useAuthStore((s) => s.status);
  const loading = useAuthStore((s) => s.loading);
  const error = useAuthStore((s) => s.error);
  const refresh = useAuthStore((s) => s.refresh);
  const signOut = useAuthStore((s) => s.signOut);
  const [guideOpen, setGuideOpen] = useState(false);
  // aria-disabled instead of disabled: a focused button that became disabled while loading would drop focus.
  const busyProps = {
    "aria-disabled": loading || undefined,
    className: "aria-disabled:pointer-events-none aria-disabled:opacity-50",
  } as const;
  const whenIdle = (action: () => void) => () => {
    if (!loading) action();
  };

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Claude subscription"
        description="Crowe Harness uses Claude Code as its AI runtime. You sign in with your own Claude plan (Pro, Max, Team or Enterprise) through Claude Code's sign-in — Crowe Harness never sees or stores your credentials."
      >
        <div className="flex items-center gap-4 px-4 py-4">
          <div className="flex size-9 items-center justify-center rounded-md bg-accent text-accent-foreground">
            {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <KeyRound className="size-4" aria-hidden="true" />}
          </div>
          <div className="min-w-0 flex-1" aria-live="polite">
            <p className="text-sm font-medium">{describeAuthStatus(status)}</p>
            <p className="text-xs text-muted-foreground">{statusDetail(status)}</p>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Refresh status"
                onClick={whenIdle(() => void refresh())}
                {...busyProps}
              >
                <RefreshCw />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh status</TooltipContent>
          </Tooltip>
          {status?.state === "signed_in" ? (
            <Button variant="outline" size="sm" onClick={whenIdle(() => void signOut())} {...busyProps}>
              Sign out
            </Button>
          ) : (
            <Button size="sm" onClick={whenIdle(() => setGuideOpen(true))} {...busyProps}>
              Sign in with Claude
            </Button>
          )}
        </div>
        {error ? (
          <p role="alert" className="px-4 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <p className="px-4 py-2 text-xs text-muted-foreground">Powered by Claude Code.</p>
      </SettingsSection>
      <SignInGuideDialog open={guideOpen} onOpenChange={setGuideOpen} />
    </div>
  );
}

function statusDetail(status: AuthStatus | undefined): string {
  if (!status) return "Checking Claude Code…";
  switch (status.state) {
    case "cli_not_found":
      return "Install Claude Code to connect your Claude plan.";
    case "signed_out":
      return "Claude Code is available but no account is signed in.";
    case "signed_in":
      return [status.email, status.orgName].filter(Boolean).join(" · ") || "Account connected";
  }
}

function SignInGuideDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const steps = [
    { icon: TerminalSquare, text: "Crowe Harness checks that Claude Code is installed on this computer." },
    { icon: KeyRound, text: "It opens Claude Code's own sign-in (claude auth login) — you sign in with your Claude account in the browser." },
    { icon: ShieldCheck, text: "Your session stays inside Claude Code. Crowe Harness only reads the sign-in status and plan name." },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sign in with Claude</DialogTitle>
          <DialogDescription>How sign-in will work once the Claude runtime is connected in a future update.</DialogDescription>
        </DialogHeader>
        <ol className="space-y-3">
          {steps.map(({ icon: Icon, text }, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground">
                {i + 1}
              </span>
              <span className="flex-1">{text}</span>
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </li>
          ))}
        </ol>
        <p className="rounded-md border bg-surface px-3 py-2 text-xs text-muted-foreground">
          Not available in this version: this build runs a demo runtime only.
        </p>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SecuritySettings() {
  const mode = useSettingsStore((s) => s.defaultPermissionMode);
  const setMode = useSettingsStore((s) => s.setDefaultPermissionMode);
  const modes: { value: PermissionMode; label: string; hint: string }[] = [
    { value: "default", label: "Ask before changes", hint: "Claude asks before editing files or running commands." },
    { value: "acceptEdits", label: "Auto-accept edits", hint: "File edits are applied; commands still require approval." },
    { value: "plan", label: "Plan only", hint: "Claude analyses and proposes a plan without changing anything." },
  ];

  return (
    <div className="space-y-6">
      <SettingsSection title="Permissions" description="Default permission mode for new sessions.">
        <fieldset className="px-4 py-3">
          <legend className="sr-only">Default permission mode</legend>
          <RadioGroup
            value={mode}
            onValueChange={(value) => {
              if (isPermissionMode(value)) setMode(value);
            }}
            className="grid gap-3"
          >
            {modes.map((m) => (
              <div key={m.value} className="flex items-start gap-2">
                <RadioGroupItem
                  value={m.value}
                  id={`mode-${m.value}`}
                  aria-describedby={hintId(`mode-${m.value}`)}
                  className="mt-0.5"
                />
                <div>
                  <Label htmlFor={`mode-${m.value}`}>{m.label}</Label>
                  <p id={hintId(`mode-${m.value}`)} className="text-xs text-muted-foreground">
                    {m.hint}
                  </p>
                </div>
              </div>
            ))}
          </RadioGroup>
        </fieldset>
      </SettingsSection>
      <SettingsSection title="Privacy">
        {[
          "No telemetry — Crowe Harness sends no usage data.",
          "No credentials are stored by Crowe Harness. Claude sign-in stays inside Claude Code.",
          "Secrets for MCP servers will be stored in the OS keychain, never in files or git.",
        ].map((text) => (
          <p key={text} className="flex items-center gap-2 px-4 py-3 text-sm">
            <CircleCheck className="size-4 shrink-0 text-success" aria-hidden="true" />
            {text}
          </p>
        ))}
      </SettingsSection>
    </div>
  );
}

function AdvancedSettings() {
  const refresh = useAuthStore((s) => s.refresh);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const canPreviewAuth = services.auth.debugSetStatus !== undefined;

  const previewAuth = (status: AuthStatus) => {
    services.auth.debugSetStatus?.(status);
    void refresh();
  };

  const resetData = () => {
    useProjectStore.getState().reset();
    useSessionStore.getState().reset();
    useSettingsStore.getState().reset();
    useChatStore.getState().reset();
    useWorkspaceStore.getState().reset();
    setConfirmOpen(false);
    toast.success("Local demo data reset");
  };

  return (
    <div className="space-y-6">
      <SettingsSection title="Claude Code" description="Runtime location. This becomes configurable in a future update.">
        <Row label="Claude Code path" hint="Auto-detected from PATH." htmlFor="claude-path">
          <Input
            id="claude-path"
            disabled
            placeholder="claude"
            aria-describedby={hintId("claude-path")}
            className="w-64 font-mono text-xs"
          />
        </Row>
      </SettingsSection>

      {canPreviewAuth ? (
        <SettingsSection title="Demo: account state" description="Preview how the interface reacts to each Claude sign-in state.">
          <div className="flex flex-wrap gap-2 px-4 py-3">
            <Button variant="outline" size="sm" onClick={() => previewAuth({ state: "cli_not_found" })}>
              Claude Code missing
            </Button>
            <Button variant="outline" size="sm" onClick={() => previewAuth({ state: "signed_out" })}>
              Signed out
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                previewAuth({ state: "signed_in", method: "claude.ai", email: "dev@example.com", orgName: "Example Org", subscriptionType: "team" })
              }
            >
              Signed in (Team)
            </Button>
          </div>
        </SettingsSection>
      ) : null}

      <SettingsSection title="Local data" description="Projects, sessions and settings are stored on this device only.">
        <Row label="Reset demo data" hint="Restores the sample projects and sessions. Files on disk are not touched.">
          <Button variant="destructive" size="sm" onClick={() => setConfirmOpen(true)}>
            Reset…
          </Button>
        </Row>
      </SettingsSection>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset local data?</DialogTitle>
            <DialogDescription>
              Projects, sessions, agents, skills and MCP entries return to the sample data. Your theme is kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={resetData}>
              Reset data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
