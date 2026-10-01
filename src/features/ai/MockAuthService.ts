import { wait } from "@/lib/async";
import type { AuthService, AuthStatus } from "./auth";

/**
 * Demo implementation of AuthService. Real sign-in arrives in M2 via the
 * Claude Code CLI; this mock only simulates the states for the UI.
 */
export class MockAuthService implements AuthService {
  readonly id = "mock" as const;
  private status: AuthStatus;
  private readonly delayMs: number;

  constructor(initial: AuthStatus = { state: "signed_out" }, delayMs = 250) {
    this.status = initial;
    this.delayMs = delayMs;
  }

  async getStatus(): Promise<AuthStatus> {
    await wait(this.delayMs);
    return this.status;
  }

  /** Demo only: lets Settings → Advanced preview every auth state. */
  debugSetStatus(status: AuthStatus): void {
    this.status = status;
  }

  async startLogin(): Promise<void> {
    await wait(this.delayMs);
    throw new Error("Sign-in with Claude becomes available in milestone M2.");
  }

  async logout(): Promise<void> {
    await wait(this.delayMs);
    this.status = { state: "signed_out" };
  }
}
