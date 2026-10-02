/**
 * Claude sign-in contract. Sign-in always happens through Claude Code's own
 * flow (`claude auth login`); Crowe Harness never reads, stores or forwards
 * Claude credentials or tokens. See docs/SPEC.md §B1.
 */

import type { CheckedLocation, ClaudeInstall, LocateReport } from "@/features/native/contract";

/** Where the Claude Code that Crowe Harness runs was found (docs/NATIVE_API.md, "Locating `claude`"). */
export type ClaudeCodeInstall = ClaudeInstall;
export type ClaudeCodeInstallSource = ClaudeInstall["source"];

/** Short labels for `ClaudeCodeInstall.source`. */
export const INSTALL_SOURCE_LABELS = {
  custom: "Custom",
  path: "PATH",
  local: "Native install",
  package: "Package manager",
  desktop: "Claude desktop app",
} as const satisfies Record<ClaudeCodeInstallSource, string>;

export type AuthStatus =
  /** Running in a plain browser: there is no desktop runtime to talk to. */
  | { state: "unavailable" }
  | { state: "cli_not_found" }
  | { state: "signed_out"; install: ClaudeCodeInstall }
  | {
      state: "signed_in";
      install: ClaudeCodeInstall;
      /** True only for a Claude subscription sign-in (claude.ai); false for Console / API key sign-in. */
      subscription: boolean;
      method?: string;
      email?: string;
      orgName?: string;
      subscriptionType?: string;
    };

/** Readable text for `CheckedLocation.reason` (docs/NATIVE_API.md, `claude_locate_report`). */
const REJECTION_LABELS: Record<string, string> = {
  not_executable: "Not a program that can be run",
  timeout: "Did not answer within 10 seconds",
  bad_output: "Did not report a Claude Code version",
  spawn_failed: "Could not be started",
};

/** One line of the "what was checked" list: result plus reason. */
export function describeCheck(check: CheckedLocation): string {
  switch (check.result) {
    case "ok":
      return "Works";
    case "missing":
      return check.reason === "summarized" ? "Not found (summarized)" : "Not found";
    case "rejected":
      return check.reason ? (REJECTION_LABELS[check.reason] ?? `Rejected (${check.reason})`) : "Rejected";
  }
}

/** Result of choosing the Claude Code executable by hand. */
export type PickResult =
  | { kind: "picked"; status: AuthStatus }
  /** The user closed the file picker. */
  | { kind: "cancelled" }
  /** Not usable (`invalid_executable`: not a working Claude Code) or another error; `message` says why. */
  | { kind: "failed"; message: string };

export interface AuthService {
  /** `force`: re-discover Claude Code instead of using the cached location ("Check again"). */
  getStatus(options?: { force?: boolean }): Promise<AuthStatus>;
  /** Native file picker to choose the Claude Code executable; `null` when cancelled. Rejects with `invalid_executable`. */
  pickExecutable(): Promise<AuthStatus | null>;
  /** Back to automatic detection. */
  clearExecutable(): Promise<AuthStatus>;
  /** Every location checked for Claude Code. */
  locateReport(): Promise<LocateReport>;
  /** Opens Claude Code's own sign-in in a visible console; resolves once it was launched (not when it finishes). */
  startLogin(): Promise<void>;
  logout(): Promise<void>;
}

/** The app shell is only reachable with a Claude subscription sign-in. */
export function hasAccess(status: AuthStatus | undefined): boolean {
  return status?.state === "signed_in" && status.subscription;
}

export function planLabel(subscriptionType: string | undefined): string | undefined {
  if (!subscriptionType) return undefined;
  return subscriptionType.charAt(0).toUpperCase() + subscriptionType.slice(1);
}

export function describeAuthStatus(status: AuthStatus | undefined): string {
  if (!status) return "Checking…";
  switch (status.state) {
    case "unavailable":
      return "Desktop app required";
    case "cli_not_found":
      return "Claude Code not found";
    case "signed_out":
      return "Not signed in";
    case "signed_in": {
      if (!status.subscription) return "No Claude subscription";
      const plan = planLabel(status.subscriptionType);
      return plan ? `Signed in · ${plan}` : "Signed in";
    }
  }
}
