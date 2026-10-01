import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mockAgents, mockMcpServers, mockSkills } from "@/data/mock";
import type { Agent, McpServer, Skill } from "@/data/types";
import type { PermissionMode } from "@/features/ai/types";
import { createId } from "@/lib/id";

interface SettingsState {
  inspectorOpen: boolean;
  openLastProjectOnStartup: boolean;
  defaultProjectsFolder: string;
  defaultPermissionMode: PermissionMode;
  agents: Agent[];
  skills: Skill[];
  mcpServers: McpServer[];
  setInspectorOpen: (open: boolean) => void;
  setOpenLastProjectOnStartup: (value: boolean) => void;
  setDefaultProjectsFolder: (value: string) => void;
  setDefaultPermissionMode: (mode: PermissionMode) => void;
  addAgent: (input: Pick<Agent, "name" | "description">) => void;
  toggleSkill: (id: string, enabled: boolean) => void;
  addMcpServer: (input: Pick<McpServer, "name" | "transport" | "target">) => void;
  reset: () => void;
}

const defaults = () => ({
  inspectorOpen: true,
  openLastProjectOnStartup: false,
  defaultProjectsFolder: "C:\\dev",
  defaultPermissionMode: "default" as PermissionMode,
  agents: mockAgents,
  skills: mockSkills,
  mcpServers: mockMcpServers,
});

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaults(),
      setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
      setOpenLastProjectOnStartup: (openLastProjectOnStartup) => set({ openLastProjectOnStartup }),
      setDefaultProjectsFolder: (defaultProjectsFolder) => set({ defaultProjectsFolder }),
      setDefaultPermissionMode: (defaultPermissionMode) => set({ defaultPermissionMode }),
      addAgent: ({ name, description }) =>
        set((state) => ({
          agents: [
            ...state.agents,
            { id: createId("agent"), name: name.trim(), description: description.trim(), tools: ["Read"], builtIn: false },
          ],
        })),
      toggleSkill: (id, enabled) =>
        set((state) => ({ skills: state.skills.map((s) => (s.id === id ? { ...s, enabled } : s)) })),
      addMcpServer: ({ name, transport, target }) =>
        set((state) => ({
          mcpServers: [
            ...state.mcpServers,
            {
              id: createId("mcp"),
              name: name.trim(),
              description: transport === "stdio" ? "Local process" : "Remote server",
              transport,
              target: target.trim(),
              status: "not_connected",
            },
          ],
        })),
      reset: () => set(defaults()),
    }),
    { name: "crowe-harness.settings", version: 1, storage: createJSONStorage(() => localStorage) },
  ),
);
