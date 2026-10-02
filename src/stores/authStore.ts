import { create } from "zustand";
import type { AuthStatus, PickResult } from "@/features/ai/auth";
import { services } from "@/features/ai/services";
import { errorMessage } from "@/lib/errors";

/** Timing of the sign-in flow. Mutable so tests can shorten it. */
export const authTiming = {
  /** How often the status is polled while the user completes sign-in in the browser. */
  pollIntervalMs: 2_000,
  /** Polling gives up after this long. */
  pollTimeoutMs: 10 * 60_000,
  /** Background re-check of the status while the app is open. */
  recheckIntervalMs: 5 * 60_000,
};

export type SignInPhase =
  | { phase: "idle" }
  /** Claude Code's sign-in console is being opened. */
  | { phase: "launching" }
  /** Sign-in console is open; polling `claude_status` until the user is signed in. */
  | { phase: "waiting" }
  | { phase: "timed_out" }
  | { phase: "failed"; message: string };

interface AuthState {
  /** Last known status; undefined until the first check finishes. */
  status: AuthStatus | undefined;
  /** A visible status check is in flight. */
  checking: boolean;
  /** Error of the last visible check or account action. */
  error: string | undefined;
  signIn: SignInPhase;
  signingOut: boolean;
  /**
   * `silent`: background re-check (focus, timer) — no busy state, failures keep the previous status.
   * `force`: re-discover Claude Code instead of using the cached location ("Check again").
   */
  refresh: (options?: { silent?: boolean; force?: boolean }) => Promise<void>;
  /** Native file picker to choose the Claude Code executable by hand; the status updates on success. */
  pickExecutable: () => Promise<PickResult>;
  /** Forgets the chosen executable and detects Claude Code automatically again. */
  clearExecutable: () => Promise<{ ok: true; status: AuthStatus } | { ok: false; message: string }>;
  startSignIn: () => Promise<void>;
  cancelSignIn: () => void;
  signOut: () => Promise<boolean>;
  /** Stops any polling loop (tests, teardown). */
  reset: () => void;
}

/** Always yields to the event loop (setTimeout), even for 0 ms, so a polling loop never starves the UI. */
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let latestCheck = 0;
let loginRun = 0;

export const useAuthStore = create<AuthState>()((set, get) => ({
  status: undefined,
  checking: false,
  error: undefined,
  signIn: { phase: "idle" },
  signingOut: false,

  refresh: async ({ silent = false, force = false } = {}) => {
    const request = ++latestCheck;
    if (!silent) set({ checking: true, error: undefined });
    try {
      const status = await services.auth.getStatus({ force });
      if (request === latestCheck) set({ status, error: undefined });
    } catch (error) {
      // A failed background check never signs the user out; a visible one reports the error.
      if (request === latestCheck && (!silent || get().status === undefined)) set({ error: errorMessage(error) });
    } finally {
      if (request === latestCheck) set({ checking: false });
    }
  },

  pickExecutable: async () => {
    let status: AuthStatus | null;
    try {
      status = await services.auth.pickExecutable();
    } catch (error) {
      return { kind: "failed", message: errorMessage(error) };
    }
    if (!status) return { kind: "cancelled" };
    latestCheck += 1; // supersede any older check still in flight
    set({ status, error: undefined, checking: false });
    return { kind: "picked", status };
  },

  clearExecutable: async () => {
    try {
      const status = await services.auth.clearExecutable();
      latestCheck += 1;
      set({ status, error: undefined, checking: false });
      return { ok: true, status };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  },

  startSignIn: async () => {
    const run = ++loginRun;
    const isCurrent = () => run === loginRun;
    set({ signIn: { phase: "launching" }, error: undefined });
    try {
      await services.auth.startLogin();
    } catch (error) {
      if (isCurrent()) set({ signIn: { phase: "failed", message: errorMessage(error) } });
      return;
    }
    if (!isCurrent()) return;
    set({ signIn: { phase: "waiting" } });

    const deadline = Date.now() + authTiming.pollTimeoutMs;
    while (isCurrent()) {
      await sleep(authTiming.pollIntervalMs);
      if (!isCurrent()) return;
      try {
        const status = await services.auth.getStatus();
        if (!isCurrent()) return;
        latestCheck += 1; // supersede any older check still in flight
        set({ status, checking: false });
        if (status.state === "signed_in" || status.state === "cli_not_found" || status.state === "unavailable") {
          set({ signIn: { phase: "idle" } });
          return;
        }
      } catch {
        // Transient failure while the console is open: keep polling until the deadline.
      }
      if (Date.now() >= deadline) {
        set({ signIn: { phase: "timed_out" } });
        return;
      }
    }
  },

  cancelSignIn: () => {
    loginRun += 1;
    set({ signIn: { phase: "idle" } });
  },

  signOut: async () => {
    loginRun += 1;
    set({ signingOut: true, error: undefined, signIn: { phase: "idle" } });
    try {
      await services.auth.logout();
    } catch (error) {
      set({ signingOut: false, error: errorMessage(error) });
      return false;
    }
    await get().refresh();
    set({ signingOut: false });
    return true;
  },

  reset: () => {
    loginRun += 1;
    latestCheck += 1;
  },
}));
