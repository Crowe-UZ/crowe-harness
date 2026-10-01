import { describe, expect, it } from "vitest";
import { dropLegacyStorage, LEGACY_STORAGE_KEYS } from "./legacyStorage";
import { SETTINGS_STORAGE_KEY, SETTINGS_VERSION, useSettingsStore } from "./settingsStore";

function store(state: unknown, version: number) {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ state, version }));
}

function stored(): { state: Record<string, unknown>; version: number } {
  const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (raw === null) throw new Error("Nothing stored");
  return JSON.parse(raw) as { state: Record<string, unknown>; version: number };
}

describe("settings persistence", () => {
  it("migrates a mock-era v2 snapshot: keeps preferences, drops catalogs and the projects folder", async () => {
    store(
      {
        inspectorOpen: false,
        openLastProjectOnStartup: true,
        defaultPermissionMode: "plan",
        defaultProjectsFolder: "D:\\work",
        customAgents: [{ id: "agent-custom", name: "Release Manager" }],
        customMcpServers: [{ id: "mcp-custom", name: "Docs" }],
        skillEnabled: { testing: false },
      },
      2,
    );

    await useSettingsStore.persist.rehydrate();

    const state = useSettingsStore.getState();
    expect(state.inspectorOpen).toBe(false);
    expect(state.openLastProjectOnStartup).toBe(true);
    expect(state.defaultPermissionMode).toBe("plan");
    const snapshot = stored();
    expect(snapshot.version).toBe(SETTINGS_VERSION);
    expect(snapshot.state).toEqual({
      inspectorOpen: false,
      openLastProjectOnStartup: true,
      defaultPermissionMode: "plan",
    });
  });

  it("migrates a v1 snapshot with full catalogs", async () => {
    store({ inspectorOpen: false, agents: [{ id: "a" }], skills: [{ id: "s", enabled: true }], mcpServers: [] }, 1);

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState().inspectorOpen).toBe(false);
    expect(Object.keys(stored().state).sort()).toEqual([
      "defaultPermissionMode",
      "inspectorOpen",
      "openLastProjectOnStartup",
    ]);
  });

  it("falls back to defaults for invalid values instead of failing", async () => {
    store({ inspectorOpen: "yes", defaultPermissionMode: "bypassPermissions", openLastProjectOnStartup: 1 }, 3);

    await useSettingsStore.persist.rehydrate();

    const state = useSettingsStore.getState();
    expect(state.inspectorOpen).toBe(true);
    expect(state.defaultPermissionMode).toBe("default");
    expect(state.openLastProjectOnStartup).toBe(false);
  });

  it("ignores a corrupt snapshot", async () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, "{not json");
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().defaultPermissionMode).toBe("default");
  });

  it("persists only preferences", () => {
    useSettingsStore.getState().setDefaultPermissionMode("acceptEdits");
    expect(stored().state).toEqual({
      inspectorOpen: true,
      openLastProjectOnStartup: false,
      defaultPermissionMode: "acceptEdits",
    });
  });
});

describe("dropLegacyStorage", () => {
  it("removes the mock-era project and session snapshots and keeps everything else", () => {
    for (const key of LEGACY_STORAGE_KEYS) localStorage.setItem(key, JSON.stringify({ state: {}, version: 1 }));
    localStorage.setItem("crowe-harness.theme", "light");

    dropLegacyStorage();

    for (const key of LEGACY_STORAGE_KEYS) expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem("crowe-harness.theme")).toBe("light");
  });

  it("never throws when storage is unavailable", () => {
    const broken = {
      removeItem: () => {
        throw new Error("SecurityError");
      },
    } as unknown as Storage;
    expect(() => dropLegacyStorage(broken)).not.toThrow();
  });
});
