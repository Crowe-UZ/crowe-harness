import { vi } from "vitest";
import { NativeCallError, type NativeClient, type TurnStartArgs } from "@/features/native/client";
import type {
  AgentInfo,
  ClaudeStatus,
  DirEntry,
  FileContent,
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
  /** Result of the next `projects_open_folder` (null = user cancelled the picker). */
  openFolderResult: ProjectInfo | null = null;
  /** Turns started so far, oldest first. */
  readonly turns: FakeTurn[] = [];
  /** Emit `exit` when a turn is cancelled (the process is killed). */
  exitOnCancel = true;
  private readonly failures = new Map<Method, NativeCallError>();

  /** Makes `method` reject with a NativeError until `recover(method)`. */
  fail(method: Method, message = "Something went wrong", code = "internal"): void {
    this.failures.set(method, new NativeCallError({ code, message }));
  }

  recover(method: Method): void {
    this.failures.delete(method);
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
    settle((): ClaudeStatus => {
      this.guard("claudeStatus");
      return clone(this.status);
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
