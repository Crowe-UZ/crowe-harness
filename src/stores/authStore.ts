import { create } from "zustand";
import type { AuthStatus } from "@/features/ai/auth";
import { services } from "@/features/ai/services";

interface AuthState {
  status: AuthStatus | undefined;
  loading: boolean;
  error: string | undefined;
  refresh: () => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  status: undefined,
  loading: false,
  error: undefined,
  refresh: async () => {
    set({ loading: true, error: undefined });
    try {
      set({ status: await services.auth.getStatus() });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ loading: false });
    }
  },
  signIn: async () => {
    set({ loading: true, error: undefined });
    try {
      await services.auth.startLogin();
      await get().refresh();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ loading: false });
    }
  },
  signOut: async () => {
    set({ loading: true, error: undefined });
    try {
      await services.auth.logout();
      await get().refresh();
    } finally {
      set({ loading: false });
    }
  },
}));
