/**
 * Domain types used by the UI. They are the plain data shapes of the native
 * contract (src/features/native/contract.ts), re-exported under UI names so
 * components do not import from the IPC layer.
 */

export type {
  AgentInfo as Agent,
  Block,
  DirEntry,
  FileContent,
  McpServerInfo as McpServer,
  ProjectInfo as Project,
  SessionInfo as Session,
  SkillInfo as Skill,
  SubagentInfo as Subagent,
  SubagentTranscript,
  Transcript,
  TranscriptMessage,
} from "@/features/native/contract";
