import { FolderX, MessageSquarePlus, PanelRight, TriangleAlert } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router";
import { AgentChatView } from "@/components/chat/AgentChatView";
import { ChatView, type ChatNavigationState } from "@/components/chat/ChatView";
import { EmptyState } from "@/components/common/EmptyState";
import { usePageTitle } from "@/components/common/use-page-title";
import { FilesView } from "@/components/files/FilesView";
import { SessionInspector } from "@/components/sessions/SessionInspector";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Project } from "@/data/types";
import { subagentLabel, useRouteContext } from "@/hooks/use-route-context";
import { isRecord, isString } from "@/lib/guards";
import { draftKey, useChatStore } from "@/stores/chatStore";
import { useProjectStore } from "@/stores/projectStore";
import { transcriptKey, useSessionStore } from "@/stores/sessionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";
import { isWorkspaceTab, useWorkspaceStore } from "@/stores/workspaceStore";

export type ProjectView = "project" | "new" | "session" | "agent";

/**
 * Project workspace: Chat (new chat, chat, agent chat) and Files tabs plus the inspector.
 * `/projects/:projectId` redirects to the newest chat, or offers to start one.
 */
export function ProjectPage({ view }: { view: ProjectView }) {
  const { projectId = "" } = useParams();
  const projectsLoaded = useProjectStore((s) => s.loaded);
  const projectsError = useProjectStore((s) => (s.status === "error" ? s.error : undefined));
  const loadProjects = useProjectStore((s) => s.load);
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId));
  const setLastProjectId = useUiStore((s) => s.setLastProjectId);

  useEffect(() => {
    if (project) setLastProjectId(project.id);
  }, [project, setLastProjectId]);

  if (!project) {
    if (!projectsLoaded && projectsError) {
      return (
        <Centered>
          <EmptyState
            icon={TriangleAlert}
            tone="danger"
            title="Could not load projects"
            description={projectsError}
            action={
              <Button variant="outline" size="sm" onClick={() => void loadProjects()}>
                Retry
              </Button>
            }
          />
        </Centered>
      );
    }
    if (!projectsLoaded) return <PageSkeleton label="Loading project…" />;
    return <ProjectNotFound />;
  }

  return <ProjectWorkspace project={project} view={view} />;
}

function ProjectNotFound() {
  usePageTitle("Project not found");
  return (
    <Centered>
      <EmptyState
        icon={FolderX}
        tone="danger"
        title="Project not found"
        description="Claude Code has no history for this project and it was not opened in Crowe Harness."
        action={
          <Button variant="outline" size="sm" asChild>
            <Link to="/projects">Back to projects</Link>
          </Button>
        }
      />
    </Centered>
  );
}

function ProjectWorkspace({ project, view }: { project: Project; view: ProjectView }) {
  const { sessionId, agentId, session, subagent } = useRouteContext();
  const location = useLocation();
  const sessions = useSessionStore((s) => s.lists[project.id]);
  const loadSessions = useSessionStore((s) => s.loadSessions);
  const transcript = useSessionStore((s) =>
    sessionId ? s.transcripts[transcriptKey(project.id, sessionId)]?.data : undefined,
  );
  const chatKey = sessionId ?? draftKey(project.id);
  const chat = useChatStore((s) => (view === "agent" ? undefined : s.chats[chatKey]));
  const inspectorOpen = useSettingsStore((s) => s.inspectorOpen);
  const setInspectorOpen = useSettingsStore((s) => s.setInspectorOpen);
  const tab = useWorkspaceStore((s) => s.workspaces[project.id]?.tab ?? "chat");
  const setTab = useWorkspaceStore((s) => s.setTab);
  const inspectorToggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void loadSessions(project.id);
  }, [loadSessions, project.id]);

  // An agent chat opened directly still needs its parent chat (sidebar, breadcrumb, inspector).
  useEffect(() => {
    if (view !== "agent" || !sessionId) return;
    if (!useSessionStore.getState().transcripts[transcriptKey(project.id, sessionId)]) {
      void useSessionStore.getState().loadTranscript(project.id, sessionId);
    }
  }, [view, project.id, sessionId]);

  const chatTitle =
    view === "new"
      ? "New chat"
      : view === "agent"
        ? subagentLabel(subagent)
        : view === "session"
          ? (session?.title ?? "Chat")
          : undefined;
  usePageTitle(chatTitle, project.name);

  if (view === "project") {
    const newest = sessions?.data?.[0];
    if (newest) return <Navigate replace to={`/projects/${project.id}/sessions/${newest.id}`} />;
    if (!sessions || (sessions.status === "loading" && !sessions.data)) return <PageSkeleton label="Loading chats…" />;
  }

  // Keeps the chat view mounted when a new chat continues under its real session route.
  const navigationState: unknown = location.state;
  const continued: unknown = isRecord(navigationState)
    ? navigationState["chatInstance" satisfies keyof ChatNavigationState]
    : undefined;
  const chatInstance = isString(continued) ? continued : chatKey;

  const closeInspector = () => {
    setInspectorOpen(false);
    // The close button disappears with the panel; continue from the control that opens it again.
    inspectorToggleRef.current?.focus();
  };

  let chatContent: ReactNode;
  if (view === "agent" && sessionId && agentId) {
    chatContent = <AgentChatView projectId={project.id} sessionId={sessionId} agentId={agentId} />;
  } else if (view === "new" || (view === "session" && sessionId)) {
    chatContent = (
      <ChatView key={chatInstance} project={project} sessionId={sessionId ?? null} instanceKey={chatInstance} />
    );
  } else if (sessions?.status === "error" && !sessions.data) {
    chatContent = (
      <Centered>
        <EmptyState
          icon={TriangleAlert}
          tone="danger"
          title="Could not load chats"
          description={sessions.error}
          action={
            <Button variant="outline" size="sm" onClick={() => void loadSessions(project.id)}>
              Retry
            </Button>
          }
        />
      </Centered>
    );
  } else {
    chatContent = (
      <Centered>
        <EmptyState
          icon={MessageSquarePlus}
          title="No chats yet"
          description="Start a new chat to work on a task in this project with Claude Code."
          action={
            <Button size="sm" asChild>
              <Link to={`/projects/${project.id}/sessions/new`}>Start a new chat</Link>
            </Button>
          }
        />
      </Centered>
    );
  }

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        if (isWorkspaceTab(value)) setTab(project.id, value);
      }}
      className="flex h-full min-h-0 flex-col gap-0"
    >
      <div className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-base leading-tight font-semibold">{project.name}</h1>
          {project.path ? (
            <p className="truncate font-mono text-[11px] leading-tight text-muted-foreground" title={project.path}>
              {project.path}
            </p>
          ) : null}
        </div>
        <TabsList className="ml-4">
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
        </TabsList>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="sm" asChild>
            <Link to={`/projects/${project.id}/sessions/new`}>
              <MessageSquarePlus data-icon="inline-start" /> New chat
            </Link>
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                ref={inspectorToggleRef}
                variant={inspectorOpen ? "secondary" : "ghost"}
                size="icon-sm"
                aria-label="Inspector"
                aria-pressed={inspectorOpen}
                onClick={() => setInspectorOpen(!inspectorOpen)}
              >
                <PanelRight />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Inspector</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <TabsContent value="chat" className="h-full">
            {chatContent}
          </TabsContent>
          <TabsContent value="files" className="h-full">
            <FilesView key={project.id} projectId={project.id} projectName={project.name} />
          </TabsContent>
        </div>
        {inspectorOpen ? (
          <SessionInspector
            projectId={project.id}
            session={session}
            transcript={transcript}
            chat={chat}
            isNewChat={view === "new"}
            onClose={closeInspector}
          />
        ) : null}
      </div>
    </Tabs>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center justify-center p-8">{children}</div>;
}

function PageSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-4 p-6" role="status">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-6 w-56" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}
