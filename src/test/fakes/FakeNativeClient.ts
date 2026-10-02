import { vi } from "vitest";
import {
  NativeCallError,
  type ClaudeStatusOptions,
  type NativeClient,
  type TurnStartArgs,
} from "@/features/native/client";
import type {
  AgentInfo,
  ClaudeInstall,
  ClaudeStatus,
  DirEntry,
  FileContent,
  InstallChannel,
  InstallEvent,
  InstallPhase,
  InstallPlan,
  LocateReport,
  McpServerInfo,
  ProjectInfo,
  SessionInfo,
  SkillInfo,
  SubagentTranscript,
  Transcript,
  TurnEvent,
} from "@/features/native/contract";
import * as fixtures from "./fixtures";

/** One `turn_start` call; the test pushes `TurnEvent`s into it like the Rust channel would. */
export class FakeTurn {
  cancelled = false;
  exited = false;

  constructor(
    readonly id: string,
    readonly args: TurnStartArgs,
    private readonly onEvent: (event: TurnEvent) => void,
  ) {}

  emit(...events: TurnEvent[]): void {
    for (const event of events) {
      if (this.exited) throw new Error(`FakeTurn ${this.id}: event after exit`);
      if (event.type === "exit") this.exited = true;
      this.onEvent(event);
    }
  }

  /** Ends the turn the way Rust does: `exit` is always the last event. */
  exit(code: number | null = 0): void {
    this.emit({ type: "exit", code });
  }
}

/**
 * One `claude_install_start` call. The test pushes `InstallEvent`s into it like the Rust channel
 * would, or sets `FakeNativeClient.installScript` to have them emitted automatically.
 */
export class FakeInstall {
  cancelled = false;
  finished = false;

  constructor(
    readonly id: string,
    readonly channel: InstallChannel,
    private readonly onEvent: (event: InstallEvent) => void,
    private readonly onDone: (install: ClaudeInstall) => void,
  ) {}

  emit(...events: InstallEvent[]): void {
    for (const event of events) {
      if (this.finished) throw new Error(`FakeInstall ${this.id}: event after the install ended`);
      if (event.type === "done" || event.type === "error" || event.type === "cancelled") this.finished = true;
      if (event.type === "done") this.onDone(event.install);
      this.onEvent(event);
    }
  }

  phase(phase: InstallPhase): void {
    this.emit({ type: "phase", phase });
  }

  progress(receivedBytes: number, totalBytes: number): void {
    this.emit({ type: "progress", receivedBytes, totalBytes });
  }

  /** Ends the install successfully; Claude Code is then found (signed out) by `claude_status`. */
  done(install: ClaudeInstall = { ...fixtures.INSTALL }): void {
    this.emit({ type: "done", install });
  }

  fail(code: string, message = "Install failed"): void {
    this.emit({ type: "error", code, message });
  }
}

/** A full successful install: every phase, download progress, then `done`. */
export function successfulInstallScript(totalBytes = 104_857_600): InstallEvent[] {
  return [
    { type: "phase", phase: "resolving" },
    { type: "phase", phase: "verifying_manifest" },
    { type: "phase", phase: "downloading" },
    { type: "progress", receivedBytes: 0, totalBytes },
    { type: "progress", receivedBytes: totalBytes / 2, totalBytes },
    { type: "progress", receivedBytes: totalBytes, totalBytes },
    { type: "phase", phase: "verifying_binary" },
    { type: "phase", phase: "installing" },
    { type: "phase", phase: "checking" },
    { type: "done", install: { ...fixtures.INSTALL } },
  ];
}

type Method = keyof NativeClient;

const clone = <T>(value: T): T => structuredClone(value);

/** Runs `fn` asynchronously like an IPC call: its result resolves, anything it throws rejects. */
function settle<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => Promise<R> {
  return (...args) => new Promise<R>((resolve) => resolve(fn(...args)));
}

/**
 * In-memory stand-in for the Rust core. Every command is a `vi.fn`, data is
 * mutable per test, and `fail()` makes a command reject with a `NativeError`.
 */
export class FakeNativeClient implements NativeClient {
  desktop = true;
  status: ClaudeStatus = fixtures.subscriptionStatus();
  projects: ProjectInfo[] = fixtures.projects();
  sessions: Record<string, SessionInfo[]> = fixtures.sessions();
  transcripts: Record<string, Transcript> = fixtures.transcripts();
  subagents: Record<string, SubagentTranscript> = fixtures.subagentTranscripts();
  dirs: Record<string, DirEntry[]> = fixtures.dirs();
  files: Record<string, FileContent> = fixtures.files();
  agents: AgentInfo[] = fixtures.agents();
  projectAgents: Record<string, AgentInfo[]> = { atlas: fixtures.projectAgents() };
  skills: SkillInfo[] = fixtures.skills();
  projectSkills: Record<string, SkillInfo[]> = { atlas: fixtures.projectSkills() };
  mcp: McpServerInfo[] = fixtures.mcpServers();
  /** File chosen in the next `claude_pick_executable` (null = user cancelled the picker). Invalid: `fail(...)`. */
  pickedExecutable: ClaudeInstall | null = null;
  /** What automatic detection finds after `claude_clear_executable` (null = nothing). */
  detectedInstall: ClaudeInstall | null = { ...fixtures.INSTALL };
  /** What `claude_locate_report` returns. */
  report: LocateReport = fixtures.locateReport();
  /** Result of the next `projects_open_folder` (null = user cancelled the picker). */
  openFolderResult: ProjectInfo | null = null;
  /** Turns started so far, oldest first. */
  readonly turns: FakeTurn[] = [];
  /** Emit `exit` when a turn is cancelled (the process is killed). */
  exitOnCancel = true;
  /** What `claude_install_plan` returns per channel. */
  installPlans: Record<InstallChannel, InstallPlan> = {
    stable: fixtures.installPlan("stable"),
    latest: fixtures.installPlan("latest"),
  };
  /** Installs started so far, oldest first. */
  readonly installs: FakeInstall[] = [];
  /** When set, every started install emits these events on its own (after `claude_install_start` resolved). */
  installScript: InstallEvent[] | null = null;
  /** Emit `cancelled` when a running install is cancelled. */
  cancelInstallOnRequest = true;
  private readonly failures = new Map<Method, NativeCallError>();

  /** Makes `method` reject with a NativeError until `recover(method)`. */
  fail(method: Method, message = "Something went wrong", code = "internal"): void {
    this.failures.set(method, new NativeCallError({ code, message }));
  }

  recover(method: Method): void {
    this.failures.delete(method);
  }

  get lastInstall(): FakeInstall | undefined {
    return this.installs.at(-1);
  }

  get lastTurn(): FakeTurn | undefined {
    return this.turns.at(-1);
  }

  private guard(method: Method): void {
    const failure = this.failures.get(method);
    if (failure) throw failure;
  }

  private notFound(what: string): never {
    throw new NativeCallError({ code: "not_found", message: `${what} not found` });
  }

  readonly claudeStatus = vi.fn(
    settle((_options?: ClaudeStatusOptions): ClaudeStatus => {
      this.guard("claudeStatus");
      return clone(this.status);
    }),
  );

  readonly claudePickExecutable = vi.fn(
    settle((): ClaudeStatus | null => {
      this.guard("claudePickExecutable");
      if (!this.pickedExecutable) return null;
      this.status = { ...this.status, install: clone(this.pickedExecutable) };
      return clone(this.status);
    }),
  );

  readonly claudeClearExecutable = vi.fn(
    settle((): ClaudeStatus => {
      this.guard("claudeClearExecutable");
      this.status = this.detectedInstall
        ? { ...this.status, install: clone(this.detectedInstall) }
        : fixtures.notInstalledStatus();
      return clone(this.status);
    }),
  );

  readonly claudeLocateReport = vi.fn(
    settle((): LocateReport => {
      this.guard("claudeLocateReport");
      return clone(this.report);
    }),
  );

  readonly claudeAuthLogin = vi.fn(
    settle((): void => {
      this.guard("claudeAuthLogin");
    }),
  );

  readonly claudeAuthLogout = vi.fn(
    settle((): void => {
      this.guard("claudeAuthLogout");
      this.status = fixtures.signedOutStatus();
    }),
  );

  readonly claudeInstallPlan = vi.fn(
    settle((channel: InstallChannel): InstallPlan => {
      this.guard("claudeInstallPlan");
      return clone(this.installPlans[channel]);
    }),
  );

  readonly claudeInstallStart = vi.fn(
    settle((channel: InstallChannel, onEvent: (event: InstallEvent) => void): string => {
      this.guard("claudeInstallStart");
      const install = new FakeInstall(`install-${this.installs.length + 1}`, channel, onEvent, (installed) => {
        this.status = { ...fixtures.signedOutStatus(), install: clone(installed) };
      });
      this.installs.push(install);
      const script = this.installScript;
      if (script) {
        setTimeout(() => {
          for (const event of script) if (!install.finished) install.emit(clone(event));
        }, 0);
      }
      return install.id;
    }),
  );

  readonly claudeInstallCancel = vi.fn(
    settle((installId: string): void => {
      this.guard("claudeInstallCancel");
      const install = this.installs.find((i) => i.id === installId);
      if (!install || install.finished) return; // no-op for unknown or finished ids, like Rust
      install.cancelled = true;
      if (this.cancelInstallOnRequest) install.emit({ type: "cancelled" });
    }),
  );

  readonly projectsList = vi.fn(
    settle((): ProjectInfo[] => {
      this.guard("projectsList");
      return clone(this.projects);
    }),
  );

  readonly projectsOpenFolder = vi.fn(
    settle((): ProjectInfo | null => {
      this.guard("projectsOpenFolder");
      const project = this.openFolderResult;
      if (project && !this.projects.some((p) => p.id === project.id)) {
        this.projects = [...this.projects, project];
        this.sessions[project.id] ??= [];
      }
      return clone(project);
    }),
  );

  readonly sessionsList = vi.fn(
    settle((projectId: string): SessionInfo[] => {
      this.guard("sessionsList");
      const list = this.sessions[projectId];
      if (!list) this.notFound("Project");
      return clone(list);
    }),
  );

  readonly sessionRead = vi.fn(
    settle((projectId: string, sessionId: string): Transcript => {
      this.guard("sessionRead");
      const transcript = this.transcripts[`${projectId}/${sessionId}`];
      if (!transcript) this.notFound("Session");
      return clone(transcript);
    }),
  );

  readonly subagentRead = vi.fn(
    settle((projectId: string, sessionId: string, agentId: string): SubagentTranscript => {
      this.guard("subagentRead");
      const transcript = this.subagents[`${projectId}/${sessionId}/${agentId}`];
      if (!transcript) this.notFound("Agent");
      return clone(transcript);
    }),
  );

  readonly turnStart = vi.fn(
    settle((args: TurnStartArgs, onEvent: (event: TurnEvent) => void): string => {
      this.guard("turnStart");
      const turn = new FakeTurn(`turn-${this.turns.length + 1}`, { ...args }, onEvent);
      this.turns.push(turn);
      return turn.id;
    }),
  );

  readonly turnCancel = vi.fn(
    settle((turnId: string): void => {
      this.guard("turnCancel");
      const turn = this.turns.find((t) => t.id === turnId);
      if (!turn) this.notFound("Turn");
      turn.cancelled = true;
      if (this.exitOnCancel && !turn.exited) turn.exit(1);
    }),
  );

  readonly fsListDir = vi.fn(
    settle((projectId: string, relPath: string): DirEntry[] => {
      this.guard("fsListDir");
      const entries = this.dirs[`${projectId}:${relPath}`];
      if (!entries) this.notFound("Folder");
      return clone(entries);
    }),
  );

  readonly fsReadFile = vi.fn(
    settle((projectId: string, relPath: string): FileContent => {
      this.guard("fsReadFile");
      const file = this.files[`${projectId}:${relPath}`];
      if (!file) this.notFound("File");
      return clone(file);
    }),
  );

  readonly agentsList = vi.fn(
    settle((projectId: string | null): AgentInfo[] => {
      this.guard("agentsList");
      return clone([...this.agents, ...(projectId ? (this.projectAgents[projectId] ?? []) : [])]);
    }),
  );

  readonly skillsList = vi.fn(
    settle((projectId: string | null): SkillInfo[] => {
      this.guard("skillsList");
      return clone([...this.skills, ...(projectId ? (this.projectSkills[projectId] ?? []) : [])]);
    }),
  );

  readonly mcpList = vi.fn(
    settle((): McpServerInfo[] => {
      this.guard("mcpList");
      return clone(this.mcp);
    }),
  );
}
