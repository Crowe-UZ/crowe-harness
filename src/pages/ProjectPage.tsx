import { FolderX, GitBranch, MessageSquarePlus, PanelRight, SearchX } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Link, Navigate, useParams } from "react-router";
import { useShallow } from "zustand/shallow";
import { ChatView } from "@/components/chat/ChatView";
import { EmptyState } from "@/components/common/EmptyState";
import { usePageTitle } from "@/components/common/use-page-title";
import { FilesView } from "@/components/files/FilesView";
import { SessionInspector } from "@/components/sessions/SessionInspector";
import { MockTerminal } from "@/components/terminal/MockTerminal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useStartSession } from "@/hooks/use-start-session";
import { useProjectStore } from "@/stores/projectStore";
import { sessionsForProject, useSessionStore } from "@/stores/sessionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { isWorkspaceTab, useWorkspaceStore } from "@/stores/workspaceStore";

export function ProjectPage() {
  const { projectId, sessionId } = useParams();
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId));
  const touchProject = useProjectStore((s) => s.touchProject);
  const sessions = useSessionStore(useShallow((s) => sessionsForProject(s.sessions, projectId)));
  const inspectorOpen = useSettingsStore((s) => s.inspectorOpen);
  const setInspectorOpen = useSettingsStore((s) => s.setInspectorOpen);
  const tab = useWorkspaceStore((s) => (projectId ? s.workspaces[projectId]?.tab : undefined) ?? "chat");
  const setTab = useWorkspaceStore((s) => s.setTab);
  const startSession = useStartSession(project?.id);
  const inspectorToggleRef = useRef<HTMLButtonElement>(null);
  const session = project && sessionId ? sessions.find((s) => s.id === sessionId) : undefined;
  const sessionTitle = sessionId ? (session?.title ?? "Session not found") : undefined;
  usePageTitle(...(project ? [sessionTitle, project.name] : ["Project not found"]));

  useEffect(() => {
    if (projectId) touchProject(projectId);
  }, [projectId, touchProject]);

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState
          icon={FolderX}
          tone="danger"
          title="Project not found"
          description="It may have been removed from the workspace."
          action={
            <Button variant="outline" size="sm" asChild>
              <Link to="/projects">Back to projects</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const latest = sessions[0];
  if (!sessionId && latest) {
    return <Navigate replace to={`/projects/${project.id}/sessions/${latest.id}`} />;
  }

  const closeInspector = () => {
    setInspectorOpen(false);
    // The close button disappears with the panel; continue from the control that opens it again.
    inspectorToggleRef.current?.focus();
  };

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        if (isWorkspaceTab(value)) setTab(project.id, value);
      }}
      className="flex h-full min-h-0 flex-col gap-0"
    >
      <div className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-base font-semibold">{project.name}</h1>
          <Badge variant="outline" className="gap-1 font-mono">
            <GitBranch aria-hidden="true" />
            {project.branch}
          </Badge>
        </div>
        <TabsList className="ml-4">
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="terminal">Terminal</TabsTrigger>
        </TabsList>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={startSession}>
            <MessageSquarePlus data-icon="inline-start" /> New session
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
            {session ? (
              <ChatView key={session.id} sessionId={session.id} projectId={project.id} />
            ) : sessionId ? (
              <CenteredState>
                <EmptyState
                  icon={SearchX}
                  tone="danger"
                  title="Session not found"
                  description="This session does not exist in this project."
                  action={
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`/projects/${project.id}`}>Open project</Link>
                    </Button>
                  }
                />
              </CenteredState>
            ) : (
              <CenteredState>
                <EmptyState
                  icon={MessageSquarePlus}
                  title="No sessions yet"
                  description="Start a session to work on a task in this project."
                  action={
                    <Button size="sm" onClick={startSession}>
                      Start a session
                    </Button>
                  }
                />
              </CenteredState>
            )}
          </TabsContent>
          <TabsContent value="files" className="h-full">
            <FilesView key={project.id} projectId={project.id} projectName={project.name} projectPath={project.path} />
          </TabsContent>
          <TabsContent value="terminal" className="h-full">
            <MockTerminal key={project.id} projectId={project.id} cwd={project.path} />
          </TabsContent>
        </div>
        {inspectorOpen ? <SessionInspector session={session} onClose={closeInspector} /> : null}
      </div>
    </Tabs>
  );
}

function CenteredState({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center justify-center p-8">{children}</div>;
}
