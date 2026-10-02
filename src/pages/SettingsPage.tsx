import { CircleCheck, KeyRound, LoaderCircle, RefreshCw } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { describeAuthStatus, INSTALL_SOURCE_LABELS, planLabel } from "@/features/ai/auth";
import { isPermissionMode, PERMISSION_MODE_LABELS, type PermissionMode } from "@/features/ai/types";
import { isOneOf } from "@/lib/guards";
import { isTheme, useTheme, type Theme } from "@/lib/theme";
import { useAuthStore } from "@/stores/authStore";
import { useSettingsStore } from "@/stores/settingsStore";

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

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
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
function Row({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
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

  return (
    <SettingsSection title="General" description="Workspace defaults.">
      <Row
        label="Open last project on startup"
        hint="Opens the most recently active project instead of Home."
        htmlFor="open-last"
      >
        <Switch
          id="open-last"
          checked={openLast}
          onCheckedChange={setOpenLast}
          aria-describedby={hintId("open-last")}
        />
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
          <RadioGroup
            value={theme}
            onValueChange={(value) => {
              if (isTheme(value)) setTheme(value);
            }}
            className="grid gap-2"
          >
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
  const checking = useAuthStore((s) => s.checking);
  const signingOut = useAuthStore((s) => s.signingOut);
  const error = useAuthStore((s) => s.error);
  const refresh = useAuthStore((s) => s.refresh);
  const signOut = useAuthStore((s) => s.signOut);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const signedIn = status?.state === "signed_in" ? status : undefined;
  const busy = checking || signingOut;

  const confirmSignOut = async () => {
    const ok = await signOut();
    setConfirmOpen(false);
    if (ok) toast.success("Signed out of Claude Code");
  };

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Claude subscription"
        description="Crowe Harness uses Claude Code as its AI runtime, signed in with your own Claude plan. Sign-in happens in Claude Code — Crowe Harness never sees or stores your credentials."
      >
        <div className="flex items-center gap-4 px-4 py-4">
          <div className="flex size-9 items-center justify-center rounded-md bg-accent text-accent-foreground">
            {busy ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <KeyRound className="size-4" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0 flex-1" aria-live="polite">
            <p className="text-sm font-medium">{describeAuthStatus(status)}</p>
            {signedIn?.email ? <p className="truncate text-xs text-muted-foreground">{signedIn.email}</p> : null}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Refresh status"
                aria-disabled={busy || undefined}
                className="aria-disabled:opacity-50"
                onClick={() => {
                  if (!busy) void refresh();
                }}
              >
                <RefreshCw />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh status</TooltipContent>
          </Tooltip>
          {signedIn ? (
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
              Sign out
            </Button>
          ) : null}
        </div>
        {signedIn ? (
          <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2 px-4 py-3 text-sm">
            <dt className="text-muted-foreground">Email</dt>
            <dd>{signedIn.email ?? "Not reported"}</dd>
            <dt className="text-muted-foreground">Organization</dt>
            <dd>{signedIn.orgName ?? "Not reported"}</dd>
            <dt className="text-muted-foreground">Plan</dt>
            <dd>{planLabel(signedIn.subscriptionType) ?? "Not reported"}</dd>
            <dt className="text-muted-foreground">Sign-in method</dt>
            <dd className="font-mono text-xs leading-5">{signedIn.method ?? "Not reported"}</dd>
          </dl>
        ) : null}
        {error ? (
          <p role="alert" className="px-4 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <p className="px-4 py-2 text-xs text-muted-foreground">Powered by Claude Code.</p>
      </SettingsSection>

      <Dialog open={confirmOpen} onOpenChange={(open) => !signingOut && setConfirmOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sign out of Claude Code?</DialogTitle>
            <DialogDescription>
              This runs “claude auth logout”, which also signs out Claude Code in your terminal on this computer. Crowe
              Harness stays locked until you sign in again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              aria-disabled={signingOut || undefined}
              className="aria-disabled:opacity-50"
              onClick={() => {
                if (!signingOut) void confirmSignOut();
              }}
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SecuritySettings() {
  const mode = useSettingsStore((s) => s.defaultPermissionMode);
  const setMode = useSettingsStore((s) => s.setDefaultPermissionMode);
  const modes: { value: PermissionMode; hint: string }[] = [
    {
      value: "default",
      hint: "Tools that change files or run commands need approval. Chats run without interactive prompts, so such calls are denied and reported in the chat.",
    },
    { value: "acceptEdits", hint: "File edits are applied automatically; other risky tools are still denied." },
    { value: "plan", hint: "Claude analyses and proposes a plan without changing anything." },
  ];

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Permissions"
        description="Default permission mode for new chats. You can change it per chat in the composer."
      >
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
                  <Label htmlFor={`mode-${m.value}`}>{PERMISSION_MODE_LABELS[m.value]}</Label>
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
          "Claude Code runs on this computer; your prompts go from Claude Code to Anthropic only.",
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
  const status = useAuthStore((s) => s.status);
  const install = status?.state === "signed_in" || status?.state === "signed_out" ? status.install : undefined;

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Claude Code"
        description="The Claude Code installation Crowe Harness runs. It is detected automatically."
      >
        {install ? (
          <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2 px-4 py-3 text-sm">
            <dt className="text-muted-foreground">Version</dt>
            <dd className="font-mono text-xs leading-5">{install.version ?? "Unknown"}</dd>
            <dt className="text-muted-foreground">Location</dt>
            <dd className="font-mono text-xs leading-5 break-all">{install.path}</dd>
            <dt className="text-muted-foreground">Source</dt>
            <dd>{INSTALL_SOURCE_LABELS[install.source]}</dd>
          </dl>
        ) : (
          <p className="px-4 py-3 text-sm text-muted-foreground">Claude Code was not detected.</p>
        )}
      </SettingsSection>
      <SettingsSection title="Local data" description="What Crowe Harness keeps on this device.">
        <p className="px-4 py-3 text-sm text-muted-foreground">
          Projects and chats are read from Claude Code&apos;s own history; Crowe Harness only stores your preferences
          (theme, inspector, default permission mode, startup behavior) and the list of folders you opened.
        </p>
      </SettingsSection>
    </div>
  );
}
