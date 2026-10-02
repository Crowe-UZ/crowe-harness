import type { NativeClient } from "@/features/native/client";
import type { ClaudeStatus, LocateReport } from "@/features/native/contract";
import type { AuthService, AuthStatus } from "./auth";

/** Converts the raw `claude_status` result into the UI auth state. */
export function toAuthStatus(status: ClaudeStatus): AuthStatus {
  if (!status.install) return { state: "cli_not_found" };
  const install = { ...status.install };
  if (!status.loggedIn) return { state: "signed_out", install };
  return {
    state: "signed_in",
    install,
    subscription: status.subscription,
    method: status.authMethod ?? undefined,
    email: status.email ?? undefined,
    orgName: status.orgName ?? undefined,
    subscriptionType: status.subscriptionType ?? undefined,
  };
}

/**
 * Sign-in through the installed Claude Code (`claude auth status|login|logout`, run by Rust).
 * The frontend only ever sees the status fields above — never tokens.
 */
export class ClaudeCodeAuthService implements AuthService {
  constructor(
    private readonly client: NativeClient,
    private readonly isDesktop: () => boolean,
  ) {}

  async getStatus({ force = false }: { force?: boolean } = {}): Promise<AuthStatus> {
    if (!this.isDesktop()) return { state: "unavailable" };
    return toAuthStatus(await this.client.claudeStatus({ forceRefresh: force }));
  }

  async pickExecutable(): Promise<AuthStatus | null> {
    const status = await this.client.claudePickExecutable();
    return status ? toAuthStatus(status) : null;
  }

  async clearExecutable(): Promise<AuthStatus> {
    return toAuthStatus(await this.client.claudeClearExecutable());
  }

  locateReport(): Promise<LocateReport> {
    return this.client.claudeLocateReport();
  }

  startLogin(): Promise<void> {
    return this.client.claudeAuthLogin();
  }

  logout(): Promise<void> {
    return this.client.claudeAuthLogout();
  }
}
