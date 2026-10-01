import type { Agent, ChatMessage, McpServer, Project, Session, Skill } from "./types";

/** Demo data only — fictional projects, no real Crowe or client data. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function ago(ms: number, now: number): string {
  return new Date(now - ms).toISOString();
}

export function createMockProjects(now = Date.now()): Project[] {
  return [
    {
      id: "atlas",
      name: "Project Atlas",
      path: "C:\\dev\\atlas",
      language: "TypeScript",
      branch: "main",
      lastOpened: ago(10 * MINUTE, now),
    },
    {
      id: "mercury",
      name: "Project Mercury",
      path: "C:\\dev\\mercury",
      language: "Python",
      branch: "develop",
      lastOpened: ago(DAY + 2 * HOUR, now),
    },
    {
      id: "phoenix",
      name: "Project Phoenix",
      path: "C:\\dev\\phoenix",
      language: "Go",
      branch: "main",
      lastOpened: ago(4 * DAY, now),
    },
  ];
}

export function createMockSessions(now = Date.now()): Session[] {
  return [
    {
      id: "fix-auth",
      projectId: "atlas",
      title: "Fix authentication",
      createdAt: ago(2 * HOUR, now),
      updatedAt: ago(10 * MINUTE, now),
    },
    {
      id: "refactor-api",
      projectId: "atlas",
      title: "Refactor API",
      createdAt: ago(DAY, now),
      updatedAt: ago(20 * HOUR, now),
    },
    {
      id: "add-tests",
      projectId: "atlas",
      title: "Add tests",
      createdAt: ago(3 * DAY, now),
      updatedAt: ago(2 * DAY, now),
    },
    {
      id: "data-pipeline",
      projectId: "mercury",
      title: "Speed up data pipeline",
      createdAt: ago(2 * DAY, now),
      updatedAt: ago(DAY + 2 * HOUR, now),
    },
    {
      id: "grpc-health",
      projectId: "phoenix",
      title: "Add gRPC health checks",
      createdAt: ago(5 * DAY, now),
      updatedAt: ago(4 * DAY, now),
    },
  ];
}

export function createMockConversation(now = Date.now()): ChatMessage[] {
  return [
    {
      id: "seed-user-1",
      role: "user",
      text: "Fix the authentication bug",
      createdAt: ago(11 * MINUTE, now),
      status: "done",
    },
    {
      id: "seed-assistant-1",
      role: "assistant",
      text: "I'll inspect the authentication flow and identify the issue.",
      createdAt: ago(10 * MINUTE, now),
      status: "done",
      activity: [
        { id: "seed-a1", label: "Reading project files", tool: "Read", status: "done" },
        { id: "seed-a2", label: "Inspecting auth module", tool: "Grep", status: "done" },
        { id: "seed-a3", label: "Analyzing dependencies", tool: "Read", status: "running" },
        { id: "seed-a4", label: "Running tests", tool: "Bash", status: "pending" },
      ],
    },
  ];
}

export const mockAgents: Agent[] = [
  {
    id: "code-reviewer",
    name: "Code Reviewer",
    description: "Reviews code changes.",
    tools: ["Read", "Grep", "Glob"],
    builtIn: true,
  },
  {
    id: "test-engineer",
    name: "Test Engineer",
    description: "Creates and runs tests.",
    tools: ["Read", "Write", "Edit", "Bash"],
    builtIn: true,
  },
  {
    id: "security-reviewer",
    name: "Security Reviewer",
    description: "Checks security-sensitive changes.",
    tools: ["Read", "Grep", "Glob"],
    builtIn: true,
  },
];

export const mockSkills: Skill[] = [
  { id: "code-review", name: "Code Review", description: "Structured review of diffs for correctness and style.", enabled: true },
  { id: "testing", name: "Testing", description: "Plans, writes and runs unit and integration tests.", enabled: true },
  { id: "documentation", name: "Documentation", description: "Drafts READMEs, ADRs and inline docs.", enabled: false },
  { id: "refactoring", name: "Refactoring", description: "Safe, incremental refactors with test coverage.", enabled: true },
  { id: "security", name: "Security", description: "Flags injection, secrets and unsafe dependencies.", enabled: false },
];

export const mockMcpServers: McpServer[] = [
  {
    id: "gitlab",
    name: "GitLab",
    description: "Merge requests, pipelines and issues.",
    transport: "http",
    target: "https://gitlab.example.com/mcp",
    status: "not_connected",
  },
  {
    id: "jira",
    name: "Jira",
    description: "Tickets, sprints and workflows.",
    transport: "http",
    target: "https://jira.example.com/mcp",
    status: "not_connected",
  },
  {
    id: "confluence",
    name: "Confluence",
    description: "Team documentation and specs.",
    transport: "http",
    target: "https://confluence.example.com/mcp",
    status: "not_connected",
  },
];

export const mockTerminalOutput: string[] = [
  "$ pnpm test",
  "",
  "✓ auth.test.ts",
  "✓ session.test.ts",
  "✓ api.test.ts",
  "",
  "3 tests passed",
  "",
  "$ git status",
  "",
  "On branch main",
  "",
  "Changes not staged:",
  "  modified: src/auth/login.ts",
];

export const mockSessionStats = {
  model: "Claude",
  tools: ["Files", "Bash", "Git", "MCP"],
  changes: { files: 4, additions: 124, deletions: 38 },
  actions: 12,
};
