import { create } from "zustand";
import type { Session, SubagentTranscript, Transcript } from "@/data/types";
import { services } from "@/features/ai/services";
import { hasErrorCode } from "@/features/native/client";
import { errorMessage } from "@/lib/errors";
import type { LoadStatus } from "./projectStore";

export interface Resource<T> {
  status: Exclude<LoadStatus, "idle">;
  data?: T;
  error?: string;
  /** The runtime reported that the item does not exist. */
  notFound?: boolean;
}

interface SessionState {
  /** Chats per project id, newest first. */
  lists: Record<string, Resource<Session[]> | undefined>;
  /** Transcripts by `transcriptKey(projectId, sessionId)`. */
  transcripts: Record<string, Resource<Transcript> | undefined>;
  /** Subagent transcripts by `subagentKey(projectId, sessionId, agentId)`. */
  subagents: Record<string, Resource<SubagentTranscript> | undefined>;
  loadSessions: (projectId: string) => Promise<void>;
  loadTranscript: (projectId: string, sessionId: string) => Promise<void>;
  loadSubagent: (projectId: string, sessionId: string, agentId: string) => Promise<void>;
}

export const transcriptKey = (projectId: string, sessionId: string) => `${projectId}/${sessionId}`;
export const subagentKey = (projectId: string, sessionId: string, agentId: string) =>
  `${projectId}/${sessionId}/${agentId}`;

/** Error code returned by the native layer for a missing project, session or agent. */
export const NOT_FOUND = "not_found";

type Bucket = "lists" | "transcripts" | "subagents";

/**
 * Non-persisted cache of Claude Code history (chats, transcripts, agent chats).
 * Reloading keeps the previous data visible; only the latest request per key may write.
 */
export const useSessionStore = create<SessionState>()((set) => {
  const latest = new Map<string, number>();
  let counter = 0;

  async function load<T>(bucket: Bucket, key: string, fetch: () => Promise<T>): Promise<void> {
    const request = ++counter;
    const id = `${bucket}:${key}`;
    latest.set(id, request);
    const isLatest = () => latest.get(id) === request;
    const patch = (fn: (previous: Resource<T> | undefined) => Resource<T>) =>
      set((state) => {
        const map = state[bucket] as Record<string, Resource<T> | undefined>;
        return { [bucket]: { ...map, [key]: fn(map[key]) } };
      });

    patch((previous) => ({ status: "loading", data: previous?.data }));
    try {
      const data = await fetch();
      if (isLatest()) patch(() => ({ status: "ready", data }));
    } catch (error) {
      if (isLatest())
        patch((previous) => ({
          status: "error",
          data: previous?.data,
          error: errorMessage(error),
          notFound: hasErrorCode(error, NOT_FOUND),
        }));
    }
  }

  return {
    lists: {},
    transcripts: {},
    subagents: {},
    loadSessions: (projectId) => load("lists", projectId, () => services.history.listSessions(projectId)),
    loadTranscript: (projectId, sessionId) =>
      load("transcripts", transcriptKey(projectId, sessionId), () =>
        services.history.readSession(projectId, sessionId),
      ),
    loadSubagent: (projectId, sessionId, agentId) =>
      load("subagents", subagentKey(projectId, sessionId, agentId), () =>
        services.history.readSubagent(projectId, sessionId, agentId),
      ),
  };
});

const NO_SESSIONS: Session[] = [];

/** Selector: loaded chats of a project (empty until loaded). */
export const selectSessions = (projectId: string | undefined) => (state: SessionState) =>
  (projectId ? state.lists[projectId]?.data : undefined) ?? NO_SESSIONS;

/** Most recently updated first. */
export function sortSessionsByUpdated(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
