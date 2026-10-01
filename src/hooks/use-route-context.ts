import { useMatch } from "react-router";
import { useProjectStore } from "@/stores/projectStore";
import { useSessionStore } from "@/stores/sessionStore";

/** Project/session addressed by the current URL (works from layout components too). */
export function useRouteContext() {
  const projectMatch = useMatch("/projects/:projectId/*");
  const sessionMatch = useMatch("/projects/:projectId/sessions/:sessionId");
  const projectId = projectMatch?.params.projectId;
  const sessionId = sessionMatch?.params.sessionId;

  const project = useProjectStore((s) => (projectId ? s.projects.find((p) => p.id === projectId) : undefined));
  const session = useSessionStore((s) => (sessionId ? s.sessions.find((x) => x.id === sessionId) : undefined));

  return { projectId, sessionId, project, session };
}
