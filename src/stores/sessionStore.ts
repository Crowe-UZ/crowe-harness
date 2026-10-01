import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createMockSessions } from "@/data/mock";
import type { Session } from "@/data/types";
import { createId } from "@/lib/id";

interface SessionState {
  sessions: Session[];
  createSession: (projectId: string, title?: string) => Session;
  renameSession: (id: string, title: string) => void;
  touchSession: (id: string) => void;
  reset: () => void;
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
        set((state) => ({
          sessions: state.sessions.map((s) => (s.id === id ? { ...s, title: title.trim() || s.title } : s)),
        })),
      touchSession: (id) =>
        set((state) => ({
          sessions: state.sessions.map((s) => (s.id === id ? { ...s, updatedAt: new Date().toISOString() } : s)),
        })),
      reset: () => set({ sessions: createMockSessions() }),
    }),
    { name: "crowe-harness.sessions", version: 1, storage: createJSONStorage(() => localStorage) },
  ),
);

/** Sessions of one project, most recently updated first. Use with useShallow. */
export function sessionsForProject(sessions: Session[], projectId: string | undefined): Session[] {
  if (!projectId) return [];
  return sessions
    .filter((s) => s.projectId === projectId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
