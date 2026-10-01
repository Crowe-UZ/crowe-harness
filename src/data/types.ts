import type { Usage } from "@/features/ai/types";

export const PROJECT_LANGUAGES = ["TypeScript", "JavaScript", "Python", "Go", "Rust", "Java", "Other"] as const;
export type ProjectLanguage = (typeof PROJECT_LANGUAGES)[number];

export interface Project {
  id: string;
  name: string;
  path: string;
  language: ProjectLanguage;
  branch: string;
  /** ISO timestamp */
  lastOpened: string;
}

export interface Session {
  id: string;
  projectId: string;
  title: string;
  /** ISO timestamp */
  createdAt: string;
  /** ISO timestamp */
  updatedAt: string;
  /** Runtime (Claude Code) session id, used to resume the conversation. */
  runtimeSessionId?: string;
}

export type ActivityStatus = "pending" | "running" | "done" | "error";

export interface ActivityItem {
  id: string;
  label: string;
  tool?: string;
  status: ActivityStatus;
}

export type MessageStatus = "streaming" | "done" | "interrupted" | "error";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** ISO timestamp */
  createdAt: string;
  status: MessageStatus;
  activity?: ActivityItem[];
  /** Token usage reported by the runtime when the message ended. */
  usage?: Usage;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  tools: string[];
  builtIn: boolean;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

export const MCP_TRANSPORTS = ["stdio", "http"] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

export interface McpServer {
  id: string;
  name: string;
  description: string;
  transport: McpTransport;
  target: string;
  status: "not_connected";
}
