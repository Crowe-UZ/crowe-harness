import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mockAgents, mockMcpServers, mockSkills } from "@/data/mock";
import type { Agent, McpServer, Skill } from "@/data/types";
import { isAgent, isMcpServer } from "@/data/validate";
import { isPermissionMode, type PermissionMode } from "@/features/ai/types";
import { filterValid, isRecord, isString } from "@/lib/guards";
import { createId } from "@/lib/id";

interface Preferences {
  inspectorOpen: boolean;
  openLastProjectOnStartup: boolean;
  defaultProjectsFolder: string;
  defaultPermissionMode: PermissionMode;
}

/** What is written to storage (v2): user-created entries and overrides only, never the built-in catalogs. */
interface PersistedSettings extends Preferences {
  customAgents: Agent[];
  customMcpServers: McpServer[];
  skillEnabled: Record<string, boolean>;
}

interface SettingsState extends Preferences {
  /** Built-in agents followed by user-created ones. */
  agents: Agent[];
  /** Built-in skill catalog with the user's enable/disable overrides applied. */
  skills: Skill[];
  /** Built-in presets followed by user-added servers. */
  mcpServers: McpServer[];
  skillEnabled: Record<string, boolean>;
  setInspectorOpen: (open: boolean) => void;
  setOpenLastProjectOnStartup: (value: boolean) => void;
  setDefaultProjectsFolder: (value: string) => void;
  setDefaultPermissionMode: (mode: PermissionMode) => void;
  addAgent: (input: Pick<Agent, "name" | "description">) => void;
  toggleSkill: (id: string, enabled: boolean) => void;
  addMcpServer: (input: Pick<McpServer, "name" | "transport" | "target">) => void;
  reset: () => void;
}

const BUILT_IN_AGENT_IDS = new Set(mockAgents.map((a) => a.id));
const BUILT_IN_MCP_IDS = new Set(mockMcpServers.map((s) => s.id));

const defaultPreferences = (): Preferences => ({
  inspectorOpen: true,
  openLastProjectOnStartup: false,
  defaultProjectsFolder: "C:\\dev",
  defaultPermissionMode: "default",
});

function catalogState(customAgents: Agent[], customMcpServers: McpServer[], skillEnabled: Record<string, boolean>) {
  return {
    agents: [...mockAgents, ...customAgents.filter((a) => !BUILT_IN_AGENT_IDS.has(a.id))],
    mcpServers: [...mockMcpServers, ...customMcpServers.filter((s) => !BUILT_IN_MCP_IDS.has(s.id))],
    skills: mockSkills.map((s) => ({ ...s, enabled: skillEnabled[s.id] ?? s.enabled })),
    skillEnabled,
  };
}

const defaults = () => ({ ...defaultPreferences(), ...catalogState([], [], {}) });

function parseSkillEnabled(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"),
  );
}

/** Valid fields of a v2 snapshot; anything malformed falls back to the defaults. */
function parsePersisted(value: unknown): Partial<PersistedSettings> {
  if (!isRecord(value)) return {};
  const result: Partial<PersistedSettings> = {};
  if (typeof value.inspectorOpen === "boolean") result.inspectorOpen = value.inspectorOpen;
  if (typeof value.openLastProjectOnStartup === "boolean")
    result.openLastProjectOnStartup = value.openLastProjectOnStartup;
  if (isString(value.defaultProjectsFolder)) result.defaultProjectsFolder = value.defaultProjectsFolder;
  if (isPermissionMode(value.defaultPermissionMode)) result.defaultPermissionMode = value.defaultPermissionMode;
  const customAgents = filterValid(value.customAgents, isAgent);
  if (customAgents) result.customAgents = customAgents.filter((a) => !a.builtIn);
  const customMcpServers = filterValid(value.customMcpServers, isMcpServer);
  if (customMcpServers) result.customMcpServers = customMcpServers;
  if (value.skillEnabled !== undefined) result.skillEnabled = parseSkillEnabled(value.skillEnabled);
  return result;
}

/** v1 stored the full catalogs (`agents`, `skills`, `mcpServers`); keep only what the user created or changed. */
function migrateFromV1(value: Record<string, unknown>): Record<string, unknown> {
  const { agents, skills, mcpServers, ...rest } = value;
  const skillEnabled: Record<string, boolean> = {};
  if (Array.isArray(skills)) {
    for (const skill of skills) {
      if (isRecord(skill) && isString(skill.id) && typeof skill.enabled === "boolean")
        skillEnabled[skill.id] = skill.enabled;
    }
  }
  return {
    ...rest,
    customAgents: (filterValid(agents, isAgent) ?? []).filter((a) => !a.builtIn),
    customMcpServers: (filterValid(mcpServers, isMcpServer) ?? []).filter((s) => !BUILT_IN_MCP_IDS.has(s.id)),
    skillEnabled,
  };
}

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
            {
              id: createId("agent"),
              name: name.trim(),
              description: description.trim(),
              tools: ["Read"],
              builtIn: false,
            },
          ],
        })),
      toggleSkill: (id, enabled) =>
        set((state) => {
          const skillEnabled = { ...state.skillEnabled, [id]: enabled };
          return { skillEnabled, skills: state.skills.map((s) => (s.id === id ? { ...s, enabled } : s)) };
        }),
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
    {
      name: "crowe-harness.settings",
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): Partial<PersistedSettings> => ({
        inspectorOpen: state.inspectorOpen,
        openLastProjectOnStartup: state.openLastProjectOnStartup,
        defaultProjectsFolder: state.defaultProjectsFolder,
        defaultPermissionMode: state.defaultPermissionMode,
        customAgents: state.agents.filter((a) => !a.builtIn),
        customMcpServers: state.mcpServers.filter((s) => !BUILT_IN_MCP_IDS.has(s.id)),
        skillEnabled: state.skillEnabled,
      }),
      migrate: (persisted, version) => {
        if (!isRecord(persisted)) return {};
        return parsePersisted(version < 2 ? migrateFromV1(persisted) : persisted);
      },
      // Built-in catalogs always come from code, so new built-ins appear after an update.
      merge: (persisted, current) => {
        const {
          customAgents = [],
          customMcpServers = [],
          skillEnabled = {},
          ...preferences
        } = parsePersisted(persisted);
        return { ...current, ...preferences, ...catalogState(customAgents, customMcpServers, skillEnabled) };
      },
    },
  ),
);
