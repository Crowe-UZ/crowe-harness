/**
 * Test data for the fake native client. Shapes follow src/features/native/contract.ts exactly.
 * Never imported by application code.
 */
import type {
  AgentInfo,
  ClaudeStatus,
  DirEntry,
  FileContent,
  InstallChannel,
  InstallPlan,
  LocateReport,
  McpServerInfo,
  ProjectInfo,
  SessionInfo,
  SkillInfo,
  SubagentTranscript,
  Transcript,
  TranscriptMessage,
} from "@/features/native/contract";

export const INSTALL = { path: "C:\\Users\\dev\\.local\\bin\\claude.exe", version: "2.3.0", source: "local" } as const;

/** A Claude Code the user chose by hand (`claude_pick_executable`). */
export const CUSTOM_INSTALL = { path: "D:\\Tools\\claude\\claude.exe", version: "2.1.284", source: "custom" } as const;

/** `claude_locate_report` on a machine where nothing usable was found. */
export function locateReport(overrides: Partial<LocateReport> = {}): LocateReport {
  return {
    chosen: null,
    checked: [
      { path: "D:\\Old\\claude.exe", source: "custom", result: "missing" },
      { path: "C:\\Windows\\system32\\claude.exe", source: "path", result: "missing" },
      { path: "~\\.local\\bin\\claude.exe", source: "local", result: "rejected", reason: "bad_output" },
      {
        path: "~\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Anthropic.ClaudeCode_*\\claude.exe",
        source: "package",
        result: "missing",
      },
      { path: "~\\scoop\\shims\\claude.exe", source: "package", result: "rejected", reason: "timeout" },
      { path: "12 more locations", source: "path", result: "missing", reason: "summarized" },
    ],
    ...overrides,
  };
}

export function subscriptionStatus(overrides: Partial<ClaudeStatus> = {}): ClaudeStatus {
  return {
    install: { ...INSTALL },
    loggedIn: true,
    authMethod: "claude.ai",
    subscription: true,
    subscriptionType: "max",
    email: "dev@example.com",
    orgName: "Example Org",
    ...overrides,
  };
}

export function signedOutStatus(): ClaudeStatus {
  return {
    install: { ...INSTALL },
    loggedIn: false,
    authMethod: null,
    subscription: false,
    subscriptionType: null,
    email: null,
    orgName: null,
  };
}

export function notInstalledStatus(): ClaudeStatus {
  return { ...signedOutStatus(), install: null };
}

/** Install plans per channel: what `claude_install_plan` returns on a Windows x64 machine without Claude Code. */
export function installPlan(channel: InstallChannel = "stable", overrides: Partial<InstallPlan> = {}): InstallPlan {
  return {
    version: channel === "stable" ? "2.1.285" : "2.2.0",
    channel,
    platform: "win32-x64",
    sizeBytes: channel === "stable" ? 104_857_600 : 110_100_480,
    sourceHost: "downloads.claude.ai",
    installDir: "C:\\Users\\dev\\.local\\bin",
    autoUpdates: true,
    alreadyInstalled: null,
    ...overrides,
  };
}

export function apiKeyStatus(): ClaudeStatus {
  return subscriptionStatus({
    authMethod: "console",
    subscription: false,
    subscriptionType: null,
    email: "api@example.com",
    orgName: null,
  });
}

export function projects(): ProjectInfo[] {
  return [
    {
      id: "atlas",
      name: "atlas",
      path: "C:\\dev\\atlas",
      sessionCount: 2,
      lastActivity: "2026-10-01T12:00:00Z",
      source: "history",
    },
    {
      id: "mercury",
      name: "mercury",
      path: "C:\\dev\\mercury",
      sessionCount: 1,
      lastActivity: "2026-09-30T10:00:00Z",
      source: "history",
    },
    { id: "orion", name: "orion", path: "D:\\work\\orion", sessionCount: 0, lastActivity: null, source: "opened" },
  ];
}

function session(overrides: Partial<SessionInfo> & Pick<SessionInfo, "id" | "projectId" | "title">): SessionInfo {
  return {
    createdAt: "2026-09-28T09:00:00Z",
    updatedAt: "2026-09-28T10:00:00Z",
    messageCount: 2,
    gitBranch: "main",
    model: "claude-opus-4-5",
    subagentCount: 0,
    ...overrides,
  };
}

export function sessions(): Record<string, SessionInfo[]> {
  return {
    atlas: [
      session({
        id: "s-auth",
        projectId: "atlas",
        title: "Fix the login bug",
        updatedAt: "2026-10-01T12:00:00Z",
        messageCount: 8,
        subagentCount: 1,
      }),
      session({ id: "s-docs", projectId: "atlas", title: "Write the README", updatedAt: "2026-09-29T08:00:00Z" }),
    ],
    mercury: [
      session({
        id: "s-pipeline",
        projectId: "mercury",
        title: "Speed up the pipeline",
        updatedAt: "2026-09-30T10:00:00Z",
      }),
    ],
    orion: [],
  };
}

const text = (id: string, role: "user" | "assistant", value: string): TranscriptMessage => ({
  id,
  role,
  timestamp: "2026-10-01T11:00:00Z",
  model: role === "assistant" ? "claude-opus-4-5" : null,
  blocks: [{ type: "text", text: value }],
});

export function authTranscriptMessages(): TranscriptMessage[] {
  return [
    text("m1", "user", "The login form accepts empty passwords. Fix it."),
    {
      id: "m2",
      role: "assistant",
      timestamp: null,
      model: "claude-opus-4-5",
      blocks: [
        { type: "text", text: "I'll look at the login handler first." },
        { type: "tool_use", id: "tu-read", name: "Read", input: '{"file_path":"src/auth/login.ts"}' },
      ],
    },
    {
      id: "m3",
      role: "user",
      timestamp: null,
      model: null,
      blocks: [{ type: "tool_result", toolUseId: "tu-read", isError: false, text: "export function login() {}" }],
    },
    {
      id: "m4",
      role: "assistant",
      timestamp: null,
      model: "claude-opus-4-5",
      blocks: [
        {
          type: "tool_use",
          id: "tu-bash",
          name: "Bash",
          input: '{"command":"npm test","description":"Run the tests"}',
        },
      ],
    },
    {
      id: "m5",
      role: "user",
      timestamp: null,
      model: null,
      blocks: [{ type: "tool_result", toolUseId: "tu-bash", isError: true, text: "1 test failed" }],
    },
    {
      id: "m6",
      role: "assistant",
      timestamp: null,
      model: "claude-opus-4-5",
      blocks: [
        {
          type: "tool_use",
          id: "tu-task",
          name: "Task",
          input: '{"description":"Review the fix","subagent_type":"code-reviewer","prompt":"Review the login fix"}',
        },
      ],
    },
    {
      id: "m7",
      role: "user",
      timestamp: null,
      model: null,
      blocks: [{ type: "tool_result", toolUseId: "tu-task", isError: false, text: "Looks good." }],
    },
    text("m8", "assistant", "Fixed: empty passwords are now rejected."),
  ];
}

export function transcripts(): Record<string, Transcript> {
  const all = sessions();
  const find = (projectId: string, id: string) => {
    const found = all[projectId]?.find((s) => s.id === id);
    if (!found) throw new Error(`fixture session ${projectId}/${id} missing`);
    return found;
  };
  return {
    "atlas/s-auth": {
      session: find("atlas", "s-auth"),
      messages: authTranscriptMessages(),
      subagents: [
        {
          id: "agent-1",
          agentType: "code-reviewer",
          description: "Review the fix",
          toolUseId: "tu-task",
          messageCount: 2,
          updatedAt: "2026-10-01T11:30:00Z",
        },
      ],
      truncated: false,
    },
    "atlas/s-docs": {
      session: find("atlas", "s-docs"),
      messages: [text("d1", "user", "Write a README."), text("d2", "assistant", "Here is a first draft.")],
      subagents: [],
      truncated: false,
    },
    "mercury/s-pipeline": {
      session: find("mercury", "s-pipeline"),
      messages: [text("p1", "user", "Why is the pipeline slow?"), text("p2", "assistant", "The parser runs twice.")],
      subagents: [],
      truncated: true,
    },
  };
}

export function subagentTranscripts(): Record<string, SubagentTranscript> {
  return {
    "atlas/s-auth/agent-1": {
      subagent: {
        id: "agent-1",
        agentType: "code-reviewer",
        description: "Review the fix",
        toolUseId: "tu-task",
        messageCount: 2,
        updatedAt: "2026-10-01T11:30:00Z",
      },
      messages: [
        text("a1", "user", "Review the login fix"),
        text("a2", "assistant", "The fix looks correct and is covered by a test."),
      ],
      truncated: false,
    },
  };
}

export function dirs(): Record<string, DirEntry[]> {
  return {
    "atlas:": [
      { name: "src", relPath: "src", kind: "dir" },
      { name: "README.md", relPath: "README.md", kind: "file" },
      { name: "logo.png", relPath: "logo.png", kind: "file" },
      { name: "build.log", relPath: "build.log", kind: "file" },
    ],
    "atlas:src": [
      { name: "auth", relPath: "src/auth", kind: "dir" },
      { name: "app.ts", relPath: "src/app.ts", kind: "file" },
    ],
    "atlas:src/auth": [{ name: "login.ts", relPath: "src/auth/login.ts", kind: "file" }],
  };
}

export function files(): Record<string, FileContent> {
  return {
    "atlas:README.md": { content: "# Atlas\n\nA sample project.\n", truncated: false, binary: false },
    "atlas:src/app.ts": {
      content: "import { login } from './auth/login';\n\nlogin();\n",
      truncated: false,
      binary: false,
    },
    "atlas:src/auth/login.ts": { content: "export function login() {}\n", truncated: false, binary: false },
    "atlas:logo.png": { content: "", truncated: false, binary: true },
    "atlas:build.log": { content: "step 1\nstep 2\n", truncated: true, binary: false },
  };
}

export function agents(): AgentInfo[] {
  return [
    {
      name: "code-reviewer",
      description: "Reviews changes for bugs.",
      tools: ["Read", "Grep"],
      model: "sonnet",
      scope: "user",
    },
  ];
}

export function projectAgents(): AgentInfo[] {
  return [{ name: "atlas-helper", description: "Knows the atlas codebase.", tools: [], model: null, scope: "project" }];
}

export function skills(): SkillInfo[] {
  return [{ name: "release-notes", description: "Drafts release notes from git history.", scope: "user" }];
}

export function projectSkills(): SkillInfo[] {
  return [{ name: "atlas-style", description: "Atlas coding conventions.", scope: "project" }];
}

export function mcpServers(): McpServerInfo[] {
  return [
    { name: "github", target: "https://api.githubcopilot.com/mcp/", status: "connected" },
    { name: "jira", target: "npx -y jira-mcp", status: "needs_auth" },
  ];
}
