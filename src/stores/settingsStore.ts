import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { isPermissionMode, type PermissionMode } from "@/features/ai/types";
import { isRecord } from "@/lib/guards";

/** User preferences — the only app state that is persisted (the theme lives in its own key, see lib/theme). */
export interface Preferences {
  inspectorOpen: boolean;
  openLastProjectOnStartup: boolean;
  defaultPermissionMode: PermissionMode;
}

interface SettingsState extends Preferences {
  setInspectorOpen: (open: boolean) => void;
  setOpenLastProjectOnStartup: (value: boolean) => void;
  setDefaultPermissionMode: (mode: PermissionMode) => void;
}

export const SETTINGS_STORAGE_KEY = "crowe-harness.settings";
export const SETTINGS_VERSION = 3;

const defaultPreferences = (): Preferences => ({
  inspectorOpen: true,
  openLastProjectOnStartup: false,
  defaultPermissionMode: "default",
});

/**
 * Valid preference fields of any persisted snapshot (v1–v3). Everything else —
 * including the mock-era catalogs (`agents`, `skills`, `mcpServers`, `customAgents`,
 * `customMcpServers`, `skillEnabled`) and `defaultProjectsFolder` — is dropped.
 */
export function parsePreferences(value: unknown): Partial<Preferences> {
  if (!isRecord(value)) return {};
  const result: Partial<Preferences> = {};
  if (typeof value.inspectorOpen === "boolean") result.inspectorOpen = value.inspectorOpen;
  if (typeof value.openLastProjectOnStartup === "boolean")
    result.openLastProjectOnStartup = value.openLastProjectOnStartup;
  if (isPermissionMode(value.defaultPermissionMode)) result.defaultPermissionMode = value.defaultPermissionMode;
  return result;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultPreferences(),
      setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
      setOpenLastProjectOnStartup: (openLastProjectOnStartup) => set({ openLastProjectOnStartup }),
      setDefaultPermissionMode: (defaultPermissionMode) => set({ defaultPermissionMode }),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: SETTINGS_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): Preferences => ({
        inspectorOpen: state.inspectorOpen,
        openLastProjectOnStartup: state.openLastProjectOnStartup,
        defaultPermissionMode: state.defaultPermissionMode,
      }),
      // v1/v2 (mock era) and v3 share the preference fields; only those survive.
      migrate: (persisted) => parsePreferences(persisted),
      merge: (persisted, current) => ({ ...current, ...parsePreferences(persisted) }),
    },
  ),
);
