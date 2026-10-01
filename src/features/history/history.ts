import type { Project, Session, SubagentTranscript, Transcript } from "@/data/types";

/**
 * Projects and chats from Claude Code's own history (`~/.claude/projects`),
 * merged by Rust with folders opened in Crowe Harness. Read-only.
 */
export interface HistoryService {
  /** Sorted by last activity, newest first. */
  listProjects(): Promise<Project[]>;
  /** Shows the native folder picker and registers the folder; `null` when the user cancels. */
  openFolder(): Promise<Project | null>;
  /** Sorted by `updatedAt`, newest first. */
  listSessions(projectId: string): Promise<Session[]>;
  readSession(projectId: string, sessionId: string): Promise<Transcript>;
  readSubagent(projectId: string, sessionId: string, agentId: string): Promise<SubagentTranscript>;
}
