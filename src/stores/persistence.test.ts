import { describe, expect, it } from "vitest";
import { mockAgents, mockMcpServers, mockSkills } from "@/data/mock";
import { useProjectStore } from "./projectStore";
import { useSessionStore } from "./sessionStore";
import { useSettingsStore } from "./settingsStore";

const SETTINGS_KEY = "crowe-harness.settings";
const PROJECTS_KEY = "crowe-harness.projects";
const SESSIONS_KEY = "crowe-harness.sessions";

function store(key: string, state: unknown, version: number) {
  localStorage.setItem(key, JSON.stringify({ state, version }));
}

function stored(key: string): { state: Record<string, unknown>; version: number } {
  const raw = localStorage.getItem(key);
  if (raw === null) throw new Error(`Nothing stored under ${key}`);
  return JSON.parse(raw) as { state: Record<string, unknown>; version: number };
}

const customAgent = {
  id: "agent-custom",
  name: "Release Manager",
  description: "Prepares releases.",
  tools: ["Read"],
  builtIn: false,
};
const customServer = {
  id: "mcp-custom",
  name: "Internal docs",
  description: "Remote server",
  transport: "http",
  target: "https://docs.example.test/mcp",
  status: "not_connected",
};

describe("settings persistence", () => {
  it("migrates a v1 snapshot (full catalogs) to v2 (custom entries and overrides only)", async () => {
    store(
      SETTINGS_KEY,
      {
        inspectorOpen: false,
        defaultPermissionMode: "plan",
        agents: [...mockAgents, customAgent],
        skills: mockSkills.map((s) => (s.id === "documentation" ? { ...s, enabled: true } : s)),
        mcpServers: [...mockMcpServers, customServer],
      },
      1,
    );

    await useSettingsStore.persist.rehydrate();

    const state = useSettingsStore.getState();
    expect(state.inspectorOpen).toBe(false);
    expect(state.defaultPermissionMode).toBe("plan");
    expect(state.agents.map((a) => a.id)).toEqual([...mockAgents.map((a) => a.id), "agent-custom"]);
    expect(state.mcpServers.map((s) => s.id)).toEqual([...mockMcpServers.map((s) => s.id), "mcp-custom"]);
    expect(state.skills.find((s) => s.id === "documentation")?.enabled).toBe(true);

    const snapshot = stored(SETTINGS_KEY);
    expect(snapshot.version).toBe(2);
    expect(snapshot.state).not.toHaveProperty("agents");
    expect(snapshot.state).not.toHaveProperty("skills");
    expect(snapshot.state.customAgents).toEqual([customAgent]);
    expect(snapshot.state.customMcpServers).toEqual([customServer]);
    expect(snapshot.state.skillEnabled).toMatchObject({ documentation: true });
  });

  it("drops malformed records and invalid values instead of failing", async () => {
    store(
      SETTINGS_KEY,
      {
        inspectorOpen: "yes",
        defaultPermissionMode: "bypassEverything",
        defaultProjectsFolder: "D:\\work",
        customAgents: [customAgent, { id: 42, name: "Broken" }, { ...customAgent, id: "agent-builtin", builtIn: true }],
        customMcpServers: [customServer, { ...customServer, id: "mcp-bad", transport: "carrier-pigeon" }],
        skillEnabled: { testing: false, security: "on" },
      },
      2,
    );

    await useSettingsStore.persist.rehydrate();

    const state = useSettingsStore.getState();
    expect(state.inspectorOpen).toBe(true);
    expect(state.defaultPermissionMode).toBe("default");
    expect(state.defaultProjectsFolder).toBe("D:\\work");
    expect(state.agents.filter((a) => !a.builtIn).map((a) => a.id)).toEqual(["agent-custom"]);
    expect(state.mcpServers.map((s) => s.id)).toContain("mcp-custom");
    expect(state.mcpServers.map((s) => s.id)).not.toContain("mcp-bad");
    expect(state.skillEnabled).toEqual({ testing: false });
    expect(state.skills.find((s) => s.id === "security")?.enabled).toBe(false);
  });

  it("ignores a snapshot that is not an object", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ state: "garbage", version: 2 }));
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().agents).toEqual(mockAgents);
  });

  it("persists a skill toggle and restores it on the next start", async () => {
    useSettingsStore.getState().toggleSkill("documentation", true);
    expect(stored(SETTINGS_KEY).state.skillEnabled).toEqual({ documentation: true });

    // Simulate a restart: fresh in-memory state (persist writes it back, so restore the snapshot), then hydrate.
    const snapshot = localStorage.getItem(SETTINGS_KEY) ?? "";
    useSettingsStore.setState(useSettingsStore.getInitialState(), true);
    expect(useSettingsStore.getState().skills.find((s) => s.id === "documentation")?.enabled).toBe(false);
    localStorage.setItem(SETTINGS_KEY, snapshot);
    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState().skills.find((s) => s.id === "documentation")?.enabled).toBe(true);
  });

  it("never writes the built-in catalogs to storage", () => {
    useSettingsStore.getState().addAgent({ name: "  Docs Writer ", description: " Writes docs " });
    const { state } = stored(SETTINGS_KEY);
    expect(state.customAgents).toEqual([expect.objectContaining({ name: "Docs Writer", description: "Writes docs" })]);
    expect(state.customMcpServers).toEqual([]);
  });
});

describe("project and session persistence", () => {
  const validProject = {
    id: "orion",
    name: "Project Orion",
    path: "C:\\dev\\orion",
    language: "Rust",
    branch: "main",
    lastOpened: "2026-09-30T10:00:00.000Z",
  };

  it("keeps valid projects and drops malformed ones", async () => {
    store(
      PROJECTS_KEY,
      { projects: [validProject, { id: "broken", name: 3 }, { ...validProject, language: "COBOL" }] },
      1,
    );
    await useProjectStore.persist.rehydrate();
    expect(useProjectStore.getState().projects).toEqual([validProject]);
  });

  it("keeps the defaults when the stored project list is missing", async () => {
    store(PROJECTS_KEY, { somethingElse: true }, 1);
    await useProjectStore.persist.rehydrate();
    expect(useProjectStore.getState().projects.map((p) => p.id)).toEqual(["atlas", "mercury", "phoenix"]);
  });

  it("keeps valid sessions (with or without a runtime id) and drops malformed ones", async () => {
    const session = {
      id: "s1",
      projectId: "orion",
      title: "Investigate",
      createdAt: "2026-09-30T10:00:00.000Z",
      updatedAt: "2026-09-30T11:00:00.000Z",
    };
    const resumed = { ...session, id: "s2", runtimeSessionId: "runtime-7" };
    store(SESSIONS_KEY, { sessions: [session, resumed, { ...session, id: "s3", runtimeSessionId: 7 }, null] }, 1);

    await useSessionStore.persist.rehydrate();

    expect(useSessionStore.getState().sessions).toEqual([session, resumed]);
  });

  it("persists the runtime session id of a session", () => {
    useSessionStore.getState().setRuntimeSessionId("fix-auth", "runtime-42");
    const sessions = stored(SESSIONS_KEY).state.sessions as { id: string; runtimeSessionId?: string }[];
    expect(sessions.find((s) => s.id === "fix-auth")?.runtimeSessionId).toBe("runtime-42");
  });
});
