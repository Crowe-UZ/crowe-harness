import { useMatch } from "react-router";
import type { Session, Subagent } from "@/data/types";
import { useProjectStore } from "@/stores/projectStore";
import { subagentKey, transcriptKey, useSessionStore } from "@/stores/sessionStore";

export const NEW_SESSION = "new";

/** Project / chat / agent chat addressed by the current URL (works from layout components too). */
export function useRouteContext() {
  const projectMatch = useMatch("/projects/:projectId/*");
  const sessionMatch = useMatch("/projects/:projectId/sessions/:sessionId/*");
  const agentMatch = useMatch("/projects/:projectId/sessions/:sessionId/agents/:agentId");
  const projectId = projectMatch?.params.projectId;
  const rawSessionId = sessionMatch?.params.sessionId;
  const isNewChat = rawSessionId === NEW_SESSION;
  const sessionId = isNewChat ? undefined : rawSessionId;
  const agentId = agentMatch?.params.agentId;

  const project = useProjectStore((s) => (projectId ? s.projects.find((p) => p.id === projectId) : undefined));
  const session = useSessionStore((s) => findSession(s, projectId, sessionId));
  const subagent = useSessionStore((s) =>
    projectId && sessionId && agentId
      ? (s.transcripts[transcriptKey(projectId, sessionId)]?.data?.subagents.find((a) => a.id === agentId) ??
        s.subagents[subagentKey(projectId, sessionId, agentId)]?.data?.subagent)
      : undefined,
  );

  return { projectId, sessionId, agentId, isNewChat, project, session, subagent };
}

/** A chat from the project's chat list, or from its loaded transcript. */
function findSession(
  state: ReturnType<typeof useSessionStore.getState>,
  projectId: string | undefined,
  sessionId: string | undefined,
): Session | undefined {
  if (!projectId || !sessionId) return undefined;
  return (
    state.lists[projectId]?.data?.find((s) => s.id === sessionId) ??
    state.transcripts[transcriptKey(projectId, sessionId)]?.data?.session
  );
}

/** Label of an agent chat: its type, or "Agent". */
export function subagentLabel(subagent: Pick<Subagent, "agentType"> | undefined): string {
  return subagent?.agentType ?? "Agent";
}
