import { create } from "zustand";
import type { Project } from "@/data/types";
import { services } from "@/features/ai/services";
import { errorMessage } from "@/lib/errors";

export type LoadStatus = "idle" | "loading" | "ready" | "error";

interface ProjectState {
  /** Sorted by last activity, newest first (as returned by the history service). */
  projects: Project[];
  status: LoadStatus;
  /** True once the list was loaded successfully at least once. */
  loaded: boolean;
  error: string | undefined;
  load: () => Promise<void>;
  /** Native folder picker; adds the folder to the list. Returns null when cancelled. Throws on failure. */
  openFolder: () => Promise<Project | null>;
}

let latestLoad = 0;

/**
 * Non-persisted cache of the projects known to Claude Code (history) and the
 * folders opened in Crowe Harness. The source of truth lives in Rust.
 */
export const useProjectStore = create<ProjectState>()((set, get) => ({
  projects: [],
  status: "idle",
  loaded: false,
  error: undefined,

  load: async () => {
    const request = ++latestLoad;
    set({ status: "loading", error: undefined });
    try {
      const projects = await services.history.listProjects();
      if (request === latestLoad) set({ projects, status: "ready", loaded: true });
    } catch (error) {
      if (request === latestLoad) set({ status: "error", error: errorMessage(error) });
    }
  },

  openFolder: async () => {
    const project = await services.history.openFolder();
    if (!project) return null;
    set((state) => ({ projects: [project, ...state.projects.filter((p) => p.id !== project.id)] }));
    void get().load();
    return project;
  },
}));

/** Ensures the project list is loaded (no-op when already loaded or loading). */
export function ensureProjectsLoaded(): void {
  const { status, loaded, load } = useProjectStore.getState();
  if (!loaded && status !== "loading" && status !== "error") void load();
}

export function findProject(projects: Project[], id: string | undefined): Project | undefined {
  return id === undefined ? undefined : projects.find((p) => p.id === id);
}
