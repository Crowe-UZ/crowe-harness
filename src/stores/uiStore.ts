import { create } from "zustand";

interface UiState {
  commandOpen: boolean;
  /** Last project shown in the workspace; scopes the Agents and Skills pages. */
  lastProjectId: string | undefined;
  /** "Open last project on startup" already ran in this app session. */
  startupHandled: boolean;
  setCommandOpen: (open: boolean) => void;
  setLastProjectId: (projectId: string) => void;
  markStartupHandled: () => void;
}

/** Transient UI state (not persisted). */
export const useUiStore = create<UiState>()((set) => ({
  commandOpen: false,
  lastProjectId: undefined,
  startupHandled: false,
  setCommandOpen: (commandOpen) => set({ commandOpen }),
  setLastProjectId: (lastProjectId) => set({ lastProjectId }),
  markStartupHandled: () => set({ startupHandled: true }),
}));
