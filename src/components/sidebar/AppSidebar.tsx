import {
  Bot,
  FolderGit2,
  Home,
  MessageSquare,
  Plus,
  Plug,
  Settings,
  Sparkles,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, useMatch } from "react-router";
import { useShallow } from "zustand/shallow";
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
  SidebarRail,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useRouteContext } from "@/hooks/use-route-context";
import { useStartSession } from "@/hooks/use-start-session";
import { sortByLastOpened, useProjectStore } from "@/stores/projectStore";
import { sessionsForProject, useSessionStore } from "@/stores/sessionStore";
import { useUiStore } from "@/stores/uiStore";

const TOOLS = [
  { to: "/agents", label: "Agents", icon: Bot },
  { to: "/skills", label: "Skills", icon: Sparkles },
  { to: "/mcp", label: "MCP servers", icon: Plug },
] as const;

export function AppSidebar() {
  const { projectId, sessionId } = useRouteContext();
  const projects = useProjectStore(useShallow((s) => sortByLastOpened(s.projects)));
  const activeProjectId = projectId ?? projects[0]?.id;
  const sessions = useSessionStore(useShallow((s) => sessionsForProject(s.sessions, activeProjectId).slice(0, 8)));
  const setNewProjectOpen = useUiStore((s) => s.setNewProjectOpen);
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const startSession = useStartSession(activeProject?.id);

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
                <SidebarMenuButton tooltip="New project" onClick={() => setNewProjectOpen(true)}>
                  <Plus />
                  <span>New project</span>
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
              {projects.slice(0, 6).map((project) => {
                const isActive = project.id === projectId && !sessionId;
                return (
                  <SidebarMenuItem key={project.id}>
                    <SidebarMenuButton asChild tooltip={project.name} isActive={isActive}>
                      <Link to={`/projects/${project.id}`} aria-current={isActive ? "page" : undefined}>
                        <FolderGit2 />
                        <span>{project.name}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
              {projects.length > 6 ? (
                <SidebarMenuItem>
                  <NavMenuButton to="/projects" label="All projects" end>
                    <FolderGit2 />
                  </NavMenuButton>
                </SidebarMenuItem>
              ) : null}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {activeProject ? (
          <SidebarGroup>
            <SidebarGroupLabel>Sessions · {activeProject.name.replace(/^Project /, "")}</SidebarGroupLabel>
            <Tooltip>
              <TooltipTrigger asChild>
                <SidebarGroupAction aria-label="New session" onClick={startSession}>
                  <Plus />
                </SidebarGroupAction>
              </TooltipTrigger>
              <TooltipContent side="right">New session</TooltipContent>
            </Tooltip>
            <SidebarGroupContent>
              <SidebarMenu>
                {sessions.length === 0 ? (
                  <li className="px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                    No sessions yet
                  </li>
                ) : null}
                {sessions.map((session) => (
                  <SidebarMenuItem key={session.id}>
                    <SidebarMenuButton asChild tooltip={session.title} isActive={session.id === sessionId}>
                      <Link
                        to={`/projects/${session.projectId}/sessions/${session.id}`}
                        aria-current={session.id === sessionId ? "page" : undefined}
                      >
                        <MessageSquare />
                        <span>{session.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}

        <SidebarGroup>
          <SidebarGroupLabel>Tools</SidebarGroupLabel>
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
