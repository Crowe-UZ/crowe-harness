/**
 * Claude sign-in contract. Sign-in always happens through Claude Code's own
 * flow (`claude auth login`); Crowe Harness never reads, stores or forwards
 * Claude credentials or tokens. See docs/SPEC.md §B1.
 */

export interface ClaudeCodeInstall {
  path: string;
  version: string | null;
  source: "path" | "desktop" | "local";
}

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

export interface AuthService {
  getStatus(): Promise<AuthStatus>;
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
