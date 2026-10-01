import { create } from "zustand";
import type { DirEntry } from "@/data/types";
import { services } from "@/features/ai/services";
import { errorMessage } from "@/lib/errors";
import { isOneOf } from "@/lib/guards";

/** The Terminal tab returns with the PTY milestone (M6). */
export const WORKSPACE_TABS = ["chat", "files"] as const;
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

export function isWorkspaceTab(value: unknown): value is WorkspaceTab {
  return isOneOf(WORKSPACE_TABS, value);
}

export type DirState =
  | { status: "loading"; entries?: DirEntry[] }
  | { status: "ready"; entries: DirEntry[] }
  | { status: "error"; error: string; entries?: DirEntry[] };

/** Per-project workspace UI state. Fields are absent until used. */
export interface ProjectWorkspace {
  tab?: WorkspaceTab;
  selectedFile?: string;
  /** Expanded directories (relative paths). */
  expandedDirs?: string[];
  /** Lazily loaded directory listings by relative path ("" = project root). */
  dirs?: Record<string, DirState | undefined>;
}

interface WorkspaceState {
  workspaces: Record<string, ProjectWorkspace | undefined>;
  setTab: (projectId: string, tab: WorkspaceTab) => void;
  setSelectedFile: (projectId: string, path: string) => void;
  setExpandedDirs: (projectId: string, dirs: string[]) => void;
  /** Loads (or reloads) one directory listing. */
  loadDir: (projectId: string, relPath: string) => Promise<void>;
}

/**
 * Transient, per-project workspace state (not persisted): active tab, Files
 * selection, expanded folders and the lazily loaded tree survive tab and project switches.
 */
export const useWorkspaceStore = create<WorkspaceState>()((set, get) => {
  const patch = (projectId: string, fn: (w: ProjectWorkspace) => ProjectWorkspace) =>
    set((state) => ({ workspaces: { ...state.workspaces, [projectId]: fn(state.workspaces[projectId] ?? {}) } }));
  const patchDir = (projectId: string, relPath: string, dir: DirState) =>
    patch(projectId, (w) => ({ ...w, dirs: { ...w.dirs, [relPath]: dir } }));

  return {
    workspaces: {},
    setTab: (projectId, tab) => patch(projectId, (w) => ({ ...w, tab })),
    setSelectedFile: (projectId, selectedFile) => patch(projectId, (w) => ({ ...w, selectedFile })),
    setExpandedDirs: (projectId, expandedDirs) => patch(projectId, (w) => ({ ...w, expandedDirs })),
    loadDir: async (projectId, relPath) => {
      const previous = get().workspaces[projectId]?.dirs?.[relPath];
      if (previous?.status === "loading") return;
      patchDir(projectId, relPath, { status: "loading", entries: previous?.entries });
      try {
        const entries = await services.fs.listDir(projectId, relPath);
        patchDir(projectId, relPath, { status: "ready", entries });
      } catch (error) {
        patchDir(projectId, relPath, { status: "error", error: errorMessage(error), entries: previous?.entries });
      }
    },
  };
});
