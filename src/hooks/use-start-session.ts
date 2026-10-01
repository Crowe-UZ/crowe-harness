import { useCallback } from "react";
import { useNavigate } from "react-router";
import { useSessionStore } from "@/stores/sessionStore";

/** Returns a callback that creates a session in `projectId` and opens it. */
export function useStartSession(projectId: string | undefined): () => void {
  const navigate = useNavigate();
  const createSession = useSessionStore((s) => s.createSession);

  return useCallback(() => {
    if (!projectId) return;
    const session = createSession(projectId);
    void navigate(`/projects/${projectId}/sessions/${session.id}`);
  }, [projectId, createSession, navigate]);
}
