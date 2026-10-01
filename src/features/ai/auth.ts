/**
 * Claude sign-in contract. Sign-in always happens through Claude Code's own
 * flow (`claude auth login`); Crowe Harness never reads, stores or forwards
 * Claude credentials or tokens. See docs/SPEC.md §B1.
 */

export type AuthMethod = "claude.ai" | "console" | "api_key" | "cloud";

export type AuthStatus =
  | { state: "cli_not_found" }
  | { state: "signed_out" }
  | {
      state: "signed_in";
      method: AuthMethod;
      email?: string;
      orgName?: string;
      subscriptionType?: string;
    };

export interface AuthService {
  readonly id: "mock" | "claude-code";
  getStatus(): Promise<AuthStatus>;
  startLogin(): Promise<void>;
  logout(): Promise<void>;
}

export function describeAuthStatus(status: AuthStatus | undefined): string {
  if (!status) return "Checking…";
  switch (status.state) {
    case "cli_not_found":
      return "Claude Code not found";
    case "signed_out":
      return "Not signed in";
    case "signed_in":
      return status.subscriptionType ? `Signed in · ${capitalize(status.subscriptionType)}` : "Signed in";
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
