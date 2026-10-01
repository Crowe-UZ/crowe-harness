import { create } from "zustand";

interface UiState {
  newProjectOpen: boolean;
  commandOpen: boolean;
  setNewProjectOpen: (open: boolean) => void;
  setCommandOpen: (open: boolean) => void;
}

/** Transient UI state (not persisted). */
export const useUiStore = create<UiState>()((set) => ({
  newProjectOpen: false,
  commandOpen: false,
  setNewProjectOpen: (newProjectOpen) => set({ newProjectOpen }),
  setCommandOpen: (commandOpen) => set({ commandOpen }),
}));
