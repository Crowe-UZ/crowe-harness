import {
  Bot,
  FolderGit2,
  FolderOpen,
  FolderTree,
  Home,
  MessageSquare,
  Plug,
  Plus,
  Settings,
  Sparkles,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useMatch } from "react-router";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { subagentLabel, useRouteContext } from "@/hooks/use-route-context";
import { useOpenFolder } from "@/hooks/use-open-folder";
import { useProjectStore } from "@/stores/projectStore";
import { selectSessions, transcriptKey, useSessionStore } from "@/stores/sessionStore";

const TOP_PROJECTS = 8;
const CHATS_STEP = 15;

const TOOLS = [
  { to: "/agents", label: "Agents", icon: Bot },
  { to: "/skills", label: "Skills", icon: Sparkles },
  { to: "/mcp", label: "MCP servers", icon: Plug },
] as const;

export function AppSidebar() {
  const { projectId, sessionId, agentId, isNewChat, project } = useRouteContext();
  const projects = useProjectStore((s) => s.projects);
  const projectsLoaded = useProjectStore((s) => s.loaded);
  const { openFolder, opening } = useOpenFolder();

  return (
    <Sidebar
      collapsible="icon"
      role="navigation"
      aria-label="Main"
      className="top-(--topbar-h) bottom-(--statusbar-h) h-auto"
    >
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Open folder"
                  aria-disabled={opening || undefined}
                  onClick={() => void openFolder()}
                >
                  <FolderOpen />
                  <span>Open folder</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <NavMenuButton to="/" label="Home" end>
                  <Home />
                </NavMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {!projectsLoaded && projects.length === 0 ? (
                <SidebarMenuItem>
                  <SidebarMenuSkeleton showIcon />
                </SidebarMenuItem>
              ) : null}
              {projects.slice(0, TOP_PROJECTS).map((p) => {
                const isCurrent = p.id === projectId && !sessionId && !isNewChat;
                return (
                  <SidebarMenuItem key={p.id}>
                    <SidebarMenuButton asChild tooltip={p.name} isActive={p.id === projectId}>
                      <Link to={`/projects/${p.id}`} aria-current={isCurrent ? "page" : undefined}>
                        <FolderGit2 />
                        <span>{p.name}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
              <SidebarMenuItem>
                <NavMenuButton to="/projects" label="All projects" end>
                  <FolderTree />
                </NavMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {project ? (
          <ChatsGroup
            projectId={project.id}
            projectName={project.name}
            sessionId={sessionId}
            agentId={agentId}
            isNewChat={isNewChat}
          />
        ) : null}

        <SidebarGroup>
          <SidebarGroupLabel>Claude Code</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {TOOLS.map(({ to, label, icon: Icon }) => (
                <SidebarMenuItem key={to}>
                  <NavMenuButton to={to} label={label}>
                    <Icon />
                  </NavMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <NavMenuButton to="/settings" label="Settings">
              <Settings />
            </NavMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/** Chats of the current project, with the agent chats of the open chat nested under it. */
function ChatsGroup({
  projectId,
  projectName,
  sessionId,
  agentId,
  isNewChat,
}: {
  projectId: string;
  projectName: string;
  sessionId: string | undefined;
  agentId: string | undefined;
  isNewChat: boolean;
}) {
  const sessions = useSessionStore(selectSessions(projectId));
  const listStatus = useSessionStore((s) => s.lists[projectId]?.status);
  const subagents = useSessionStore((s) =>
    sessionId ? s.transcripts[transcriptKey(projectId, sessionId)]?.data?.subagents : undefined,
  );
  const [limit, setLimit] = useState(CHATS_STEP);
  const newChatPath = `/projects/${projectId}/sessions/new`;

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Chats · {projectName}</SidebarGroupLabel>
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarGroupAction asChild>
            <Link to={newChatPath} aria-label="New chat">
              <Plus />
            </Link>
          </SidebarGroupAction>
        </TooltipTrigger>
        <TooltipContent side="right">New chat</TooltipContent>
      </Tooltip>
      <SidebarGroupContent>
        <SidebarMenu aria-label={`Chats in ${projectName}`}>
          {isNewChat ? (
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="New chat" isActive>
                <Link to={newChatPath} aria-current="page">
                  <Plus />
                  <span>New chat</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
          {listStatus === "loading" && sessions.length === 0 ? (
            <SidebarMenuItem>
              <SidebarMenuSkeleton showIcon />
            </SidebarMenuItem>
          ) : null}
          {listStatus === "ready" && sessions.length === 0 && !isNewChat ? (
            <li className="px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
              No chats yet
            </li>
          ) : null}
          {listStatus === "error" && sessions.length === 0 ? (
            <li className="px-2 py-1 text-xs text-destructive group-data-[collapsible=icon]:hidden">
              Could not load chats
            </li>
          ) : null}
          {sessions.slice(0, limit).map((session) => {
            const isActive = session.id === sessionId;
            return (
              <SidebarMenuItem key={session.id}>
                <SidebarMenuButton asChild tooltip={session.title} isActive={isActive}>
                  <Link
                    to={`/projects/${projectId}/sessions/${session.id}`}
                    aria-current={isActive && !agentId ? "page" : undefined}
                  >
                    <MessageSquare />
                    <span>{session.title}</span>
                  </Link>
                </SidebarMenuButton>
                {isActive && subagents && subagents.length > 0 ? (
                  <SidebarMenuSub aria-label="Agent chats">
                    {subagents.map((agent) => (
                      <SidebarMenuSubItem key={agent.id}>
                        <SidebarMenuSubButton asChild isActive={agent.id === agentId}>
                          <Link
                            to={`/projects/${projectId}/sessions/${session.id}/agents/${agent.id}`}
                            aria-current={agent.id === agentId ? "page" : undefined}
                            title={agent.description ?? undefined}
                          >
                            <Bot />
                            <span>{subagentLabel(agent)}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                ) : null}
              </SidebarMenuItem>
            );
          })}
          {sessions.length > limit ? (
            <SidebarMenuItem>
              <SidebarMenuButton
                className="text-muted-foreground"
                onClick={() => setLimit((n) => n + CHATS_STEP)}
                tooltip="Show more chats"
              >
                <MessageSquare />
                <span>Show more ({sessions.length - limit})</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function NavMenuButton({
  to,
  label,
  end = false,
  children,
}: {
  to: string;
  label: string;
  end?: boolean;
  children: ReactNode;
}) {
  const isActive = useMatch({ path: to, end }) !== null;
  return (
    <SidebarMenuButton asChild tooltip={label} isActive={isActive}>
      <Link to={to} aria-current={isActive ? "page" : undefined}>
        {children}
        <span>{label}</span>
      </Link>
    </SidebarMenuButton>
  );
}
