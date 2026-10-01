import type { Agent, McpServer, Skill } from "@/data/types";

/** Claude Code configuration as Claude Code itself sees it (read-only). */
export interface ConfigService {
  /** User agents (`~/.claude/agents`) plus project agents (`.claude/agents`) when `projectId` is given. */
  listAgents(projectId: string | null): Promise<Agent[]>;
  /** User skills (`~/.claude/skills`) plus project skills (`.claude/skills`) when `projectId` is given. */
  listSkills(projectId: string | null): Promise<Skill[]>;
  /** MCP servers and their status, from `claude mcp list`. */
  listMcpServers(): Promise<McpServer[]>;
}
