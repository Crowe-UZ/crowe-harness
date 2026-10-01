export type ProjectLanguage = "TypeScript" | "JavaScript" | "Python" | "Go" | "Rust" | "Java" | "Other";

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

export interface McpServer {
  id: string;
  name: string;
  description: string;
  transport: "stdio" | "http";
  target: string;
  status: "not_connected";
}
