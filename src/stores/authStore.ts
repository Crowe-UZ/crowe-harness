import { create } from "zustand";
import type { AuthStatus } from "@/features/ai/auth";
import { services } from "@/features/ai/services";
import { errorMessage } from "@/lib/errors";

interface AuthState {
  status: AuthStatus | undefined;
  loading: boolean;
  error: string | undefined;
  refresh: () => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

/** Only the latest auth request may write results or clear `loading`. */
let latestRequest = 0;

export const useAuthStore = create<AuthState>()((set, get) => {
  const begin = () => {
    latestRequest += 1;
    set({ loading: true, error: undefined });
    return latestRequest;
  };
  const isLatest = (request: number) => request === latestRequest;

  /** Runs a sign-in/out action, then refreshes the status (the refresh owns `loading` from then on). */
  const runThenRefresh = async (action: () => Promise<void>) => {
    const request = begin();
    try {
      await action();
    } catch (error) {
      if (isLatest(request)) set({ error: errorMessage(error), loading: false });
      return;
    }
    await get().refresh();
  };

  return {
    status: undefined,
    loading: false,
    error: undefined,
    refresh: async () => {
      const request = begin();
      try {
        const status = await services.auth.getStatus();
        if (isLatest(request)) set({ status });
      } catch (error) {
        if (isLatest(request)) set({ error: errorMessage(error) });
      } finally {
        if (isLatest(request)) set({ loading: false });
      }
    },
    signIn: () => runThenRefresh(() => services.auth.startLogin()),
    signOut: () => runThenRefresh(() => services.auth.logout()),
  };
});
