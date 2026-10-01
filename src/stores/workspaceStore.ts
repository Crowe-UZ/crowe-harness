import { create } from "zustand";
import { mockTerminalOutput } from "@/data/mock";
import { isOneOf } from "@/lib/guards";

export const WORKSPACE_TABS = ["chat", "files", "terminal"] as const;
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

export function isWorkspaceTab(value: unknown): value is WorkspaceTab {
  return isOneOf(WORKSPACE_TABS, value);
}

export interface TerminalLine {
  id: number;
  text: string;
  tone?: "command" | "muted";
}

/** Per-project workspace UI state. Fields are absent until the user changes them. */
export interface ProjectWorkspace {
  tab?: WorkspaceTab;
  /** Undefined until first used: the terminal then shows the demo seed output. */
  terminal?: TerminalLine[];
  selectedFile?: string;
  /** Undefined means "default" (all directories expanded). */
  expandedDirs?: string[];
}

interface WorkspaceState {
  workspaces: Record<string, ProjectWorkspace | undefined>;
  setTab: (projectId: string, tab: WorkspaceTab) => void;
  setSelectedFile: (projectId: string, path: string) => void;
  setExpandedDirs: (projectId: string, dirs: string[]) => void;
  appendTerminal: (projectId: string, lines: Omit<TerminalLine, "id">[]) => void;
  clearTerminal: (projectId: string) => void;
  reset: () => void;
}

let nextLineId = 0;
const toTerminalLines = (lines: Omit<TerminalLine, "id">[]): TerminalLine[] =>
  lines.map((line) => ({ ...line, id: nextLineId++ }));

/** Demo output shown in a project's terminal before it is used or cleared. */
export const TERMINAL_SEED: TerminalLine[] = toTerminalLines(
  mockTerminalOutput.map((text) => ({ text, tone: text.startsWith("$ ") ? "command" : undefined })),
);

/**
 * Transient, per-project workspace state (not persisted): active tab, terminal
 * history and Files selection survive tab and project switches.
 */
export const useWorkspaceStore = create<WorkspaceState>()((set) => {
  const patch = (projectId: string, fn: (w: ProjectWorkspace) => ProjectWorkspace) =>
    set((state) => ({ workspaces: { ...state.workspaces, [projectId]: fn(state.workspaces[projectId] ?? {}) } }));

  return {
    workspaces: {},
    setTab: (projectId, tab) => patch(projectId, (w) => ({ ...w, tab })),
    setSelectedFile: (projectId, selectedFile) => patch(projectId, (w) => ({ ...w, selectedFile })),
    setExpandedDirs: (projectId, expandedDirs) => patch(projectId, (w) => ({ ...w, expandedDirs })),
    appendTerminal: (projectId, lines) =>
      patch(projectId, (w) => ({ ...w, terminal: [...(w.terminal ?? TERMINAL_SEED), ...toTerminalLines(lines)] })),
    clearTerminal: (projectId) => patch(projectId, (w) => ({ ...w, terminal: [] })),
    reset: () => set({ workspaces: {} }),
  };
});
