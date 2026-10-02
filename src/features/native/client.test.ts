import type { Channel } from "@tauri-apps/api/core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NATIVE_COMMANDS, type InstallEvent, type TurnEvent } from "./contract";

type Core = typeof import("@tauri-apps/api/core");
type Client = typeof import("./client");

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
  Channel: class<T> {
    onmessage: (event: T) => void;
    constructor(onmessage: (event: T) => void) {
      this.onmessage = onmessage;
    }
  },
}));

// src/test/setup.ts already imported the real modules (through `services`); load fresh copies that see the mock.
let core: Core;
let client: Client;
beforeAll(async () => {
  vi.resetModules();
  core = await import("@tauri-apps/api/core");
  client = await import("./client");
});

const invokeMock = () => vi.mocked(core.invoke);
/** The client's commands as plain functions (they never use `this`). */
const commands = () => client.tauriClient as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
const isTauri = () => vi.mocked(core.isTauri);

beforeEach(() => {
  isTauri().mockReturnValue(true);
  invokeMock().mockResolvedValue(null);
});

describe("isDesktopRuntime", () => {
  it("reflects isTauri() and never throws", () => {
    expect(client.isDesktopRuntime()).toBe(true);
    isTauri().mockReturnValue(false);
    expect(client.isDesktopRuntime()).toBe(false);
    isTauri().mockImplementation(() => {
      throw new Error("no window");
    });
    expect(client.isDesktopRuntime()).toBe(false);
  });
});

describe("tauriClient", () => {
  it.each([
    ["claudeStatus", [], "claude_status", undefined],
    ["claudeAuthLogin", [], "claude_auth_login", undefined],
    ["claudeAuthLogout", [], "claude_auth_logout", undefined],
    ["claudeInstallPlan", ["latest"], "claude_install_plan", { channel: "latest" }],
    ["claudeInstallCancel", ["install-1"], "claude_install_cancel", { installId: "install-1" }],
    ["projectsList", [], "projects_list", undefined],
    ["projectsOpenFolder", [], "projects_open_folder", undefined],
    ["sessionsList", ["p1"], "sessions_list", { projectId: "p1" }],
    ["sessionRead", ["p1", "s1"], "session_read", { projectId: "p1", sessionId: "s1" }],
    ["subagentRead", ["p1", "s1", "a1"], "subagent_read", { projectId: "p1", sessionId: "s1", agentId: "a1" }],
    ["turnCancel", ["t1"], "turn_cancel", { turnId: "t1" }],
    ["fsListDir", ["p1", "src"], "fs_list_dir", { projectId: "p1", relPath: "src" }],
    ["fsReadFile", ["p1", "a.ts"], "fs_read_file", { projectId: "p1", relPath: "a.ts" }],
    ["agentsList", [null], "agents_list", { projectId: null }],
    ["skillsList", ["p1"], "skills_list", { projectId: "p1" }],
    ["mcpList", [], "mcp_list", undefined],
  ] as const)("%s invokes %s with camelCase arguments", async (method, args, command, expected) => {
    await commands()[method]?.(...args);
    expect(invokeMock()).toHaveBeenCalledWith(command, expected);
  });

  it("covers every command of the contract", async () => {
    for (const fn of Object.values(commands())) await fn("p", "s", "a").catch(() => undefined);
    const called = new Set(invokeMock().mock.calls.map(([command]) => command));
    expect([...called].sort()).toEqual([...NATIVE_COMMANDS].sort());
  });

  it("starts a turn with a Channel that forwards TurnEvents", async () => {
    invokeMock().mockResolvedValue("turn-7");
    const events: TurnEvent[] = [];

    const turnId = await client.tauriClient.turnStart(
      { projectId: "p1", sessionId: null, prompt: "Hi", permissionMode: "acceptEdits" },
      (event) => events.push(event),
    );

    expect(turnId).toBe("turn-7");
    const [command, payload] = invokeMock().mock.calls[0] ?? [];
    expect(command).toBe("turn_start");
    expect(payload).toMatchObject({ projectId: "p1", sessionId: null, prompt: "Hi", permissionMode: "acceptEdits" });
    const channel = (payload as { onEvent: Channel<TurnEvent> }).onEvent;
    channel.onmessage({ type: "exit", code: 0 });
    expect(events).toEqual([{ type: "exit", code: 0 }]);
  });

  it("starts an install with a Channel that forwards InstallEvents", async () => {
    invokeMock().mockResolvedValue("install-3");
    const events: InstallEvent[] = [];
    const installId = await client.tauriClient.claudeInstallStart("stable", (event) => events.push(event));

    expect(installId).toBe("install-3");
    const [command, payload] = invokeMock().mock.calls[0] ?? [];
    expect(command).toBe("claude_install_start");
    expect(payload).toMatchObject({ channel: "stable" });
    const channel = (payload as { onEvent: Channel<InstallEvent> }).onEvent;
    channel.onmessage({ type: "phase", phase: "downloading" });
    expect(events).toEqual([{ type: "phase", phase: "downloading" }]);
  });

  it("normalizes rejected NativeErrors", async () => {
    invokeMock().mockRejectedValue({ code: "not_found", message: "Session not found" });

    const error: unknown = await client.tauriClient.sessionRead("p", "s").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(client.NativeCallError);
    expect(error).toMatchObject({ code: "not_found", message: "Session not found" });
    expect(client.hasErrorCode(error, "not_found")).toBe(true);
  });

  it("refuses to call commands outside the desktop runtime", async () => {
    isTauri().mockReturnValue(false);

    await expect(client.tauriClient.projectsList()).rejects.toMatchObject({ code: client.NOT_DESKTOP });
    expect(invokeMock()).not.toHaveBeenCalled();
  });
});

describe("toNativeError", () => {
  it.each([
    [
      { code: "x", message: "m" },
      { code: "x", message: "m" },
    ],
    [new Error("boom"), { code: "unknown", message: "boom" }],
    ["plain text", { code: "unknown", message: "plain text" }],
    [42, { code: "unknown", message: "The desktop runtime returned an unexpected error." }],
  ])("normalizes %o", (input, expected) => {
    expect(client.toNativeError(input)).toEqual(expected);
  });
});
