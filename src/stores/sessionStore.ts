import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createMockSessions } from "@/data/mock";
import type { Session } from "@/data/types";
import { isSession } from "@/data/validate";
import { filterValid, isRecord } from "@/lib/guards";
import { createId } from "@/lib/id";

interface SessionState {
  sessions: Session[];
  createSession: (projectId: string, title?: string) => Session;
  renameSession: (id: string, title: string) => void;
  touchSession: (id: string) => void;
  setRuntimeSessionId: (id: string, runtimeSessionId: string) => void;
  reset: () => void;
}

type PersistedSessions = Pick<SessionState, "sessions">;

function parsePersisted(value: unknown): Partial<PersistedSessions> {
  if (!isRecord(value)) return {};
  const sessions = filterValid(value.sessions, isSession);
  return sessions ? { sessions } : {};
}

/** Applies `fn` to the session with `id`; returns the same state for unknown ids (no re-render). */
function updateSession(
  state: SessionState,
  id: string,
  fn: (s: Session) => Session,
): SessionState | Partial<SessionState> {
  if (!state.sessions.some((s) => s.id === id)) return state;
  return { sessions: state.sessions.map((s) => (s.id === id ? fn(s) : s)) };
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      sessions: createMockSessions(),
      createSession: (projectId, title = "New session") => {
        const now = new Date().toISOString();
        const session: Session = { id: createId("session"), projectId, title, createdAt: now, updatedAt: now };
        set((state) => ({ sessions: [session, ...state.sessions] }));
        return session;
      },
      renameSession: (id, title) =>
        set((state) => updateSession(state, id, (s) => ({ ...s, title: title.trim() || s.title }))),
      touchSession: (id) =>
        set((state) => updateSession(state, id, (s) => ({ ...s, updatedAt: new Date().toISOString() }))),
      setRuntimeSessionId: (id, runtimeSessionId) =>
        set((state) =>
          state.sessions.some((s) => s.id === id && s.runtimeSessionId !== runtimeSessionId)
            ? updateSession(state, id, (s) => ({ ...s, runtimeSessionId }))
            : state,
        ),
      reset: () => set({ sessions: createMockSessions() }),
    }),
    {
      name: "crowe-harness.sessions",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): Partial<PersistedSessions> => ({ sessions: state.sessions }),
      // v1 is the only shape so far: identity, minus malformed records.
      migrate: (persisted) => parsePersisted(persisted),
      merge: (persisted, current) => ({ ...current, ...parsePersisted(persisted) }),
    },
  ),
);

/** Most recently updated first. */
export function sortSessionsByUpdated(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Sessions of one project, most recently updated first. Use with useShallow. */
export function sessionsForProject(sessions: Session[], projectId: string | undefined): Session[] {
  if (!projectId) return [];
  return sortSessionsByUpdated(sessions.filter((s) => s.projectId === projectId));
}
