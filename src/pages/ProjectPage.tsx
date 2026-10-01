import { FolderX, GitBranch, MessageSquarePlus, PanelRight, SearchX } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useShallow } from "zustand/shallow";
import { ChatView } from "@/components/chat/ChatView";
import { EmptyState } from "@/components/common/EmptyState";
import { FilesView } from "@/components/files/FilesView";
import { SessionInspector } from "@/components/sessions/SessionInspector";
import { MockTerminal } from "@/components/terminal/MockTerminal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useProjectStore } from "@/stores/projectStore";
import { sessionsForProject, useSessionStore } from "@/stores/sessionStore";
import { useSettingsStore } from "@/stores/settingsStore";

type WorkspaceTab = "chat" | "files" | "terminal";

export function ProjectPage() {
  const { projectId, sessionId } = useParams();
  const navigate = useNavigate();
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId));
  const touchProject = useProjectStore((s) => s.touchProject);
  const sessions = useSessionStore(useShallow((s) => sessionsForProject(s.sessions, projectId)));
  const createSession = useSessionStore((s) => s.createSession);
  const inspectorOpen = useSettingsStore((s) => s.inspectorOpen);
  const setInspectorOpen = useSettingsStore((s) => s.setInspectorOpen);
  const [tab, setTab] = useState<WorkspaceTab>("chat");

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

  const session = sessionId ? sessions.find((s) => s.id === sessionId) : sessions[0];
  const startSession = () => {
    const created = createSession(project.id);
    navigate(`/projects/${project.id}/sessions/${created.id}`);
  };

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as WorkspaceTab)} className="flex h-full min-h-0 flex-col gap-0">
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
                variant={inspectorOpen ? "secondary" : "ghost"}
                size="icon-sm"
                aria-label="Toggle inspector"
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
            <FilesView projectName={project.name} />
          </TabsContent>
          <TabsContent value="terminal" className="h-full">
            <MockTerminal cwd={project.path} />
          </TabsContent>
        </div>
        {inspectorOpen ? <SessionInspector session={session} onClose={() => setInspectorOpen(false)} /> : null}
      </div>
    </Tabs>
  );
}

function CenteredState({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center p-8">{children}</div>;
}
