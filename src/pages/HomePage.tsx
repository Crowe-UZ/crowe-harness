import { ArrowRight, FolderOpen, FolderPlus, MessageSquare, MessagesSquare } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Link } from "react-router";
import { EmptyState } from "@/components/common/EmptyState";
import { Page } from "@/components/common/PageHeader";
import { ListSkeleton, LoadError } from "@/components/common/ResourceStates";
import { usePageTitle } from "@/components/common/use-page-title";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Session } from "@/data/types";
import { useOpenFolder } from "@/hooks/use-open-folder";
import { formatRelativeTime, greeting } from "@/lib/time";
import { useAuthStore } from "@/stores/authStore";
import { useProjectStore } from "@/stores/projectStore";
import { sortSessionsByUpdated, useSessionStore } from "@/stores/sessionStore";

const RECENT_PROJECTS = 6;
/** Recent chats are collected from the most active projects only. */
const PROJECTS_FOR_RECENT_CHATS = 5;
const RECENT_CHATS = 8;

export function HomePage() {
  const projects = useProjectStore((s) => s.projects);
  const loaded = useProjectStore((s) => s.loaded);
  const status = useProjectStore((s) => s.status);
  const error = useProjectStore((s) => s.error);
  const loadProjects = useProjectStore((s) => s.load);
  const lists = useSessionStore((s) => s.lists);
  const loadSessions = useSessionStore((s) => s.loadSessions);
  const email = useAuthStore((s) => (s.status?.state === "signed_in" ? s.status.email : undefined));
  const { openFolder } = useOpenFolder();
  usePageTitle("Home");

  const active = useMemo(() => projects.slice(0, PROJECTS_FOR_RECENT_CHATS), [projects]);

  useEffect(() => {
    for (const project of active) {
      if (!useSessionStore.getState().lists[project.id]) void loadSessions(project.id);
    }
  }, [active, loadSessions]);

  const names = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const recentChats = useMemo(() => {
    const all: Session[] = active.flatMap((p) => lists[p.id]?.data ?? []);
    return sortSessionsByUpdated(all).slice(0, RECENT_CHATS);
  }, [active, lists]);
  const chatsLoading = active.some((p) => !lists[p.id]?.data && lists[p.id]?.status !== "error");

  const openFolderButton = (variant: "default" | "outline") => (
    <Button size="sm" variant={variant} onClick={() => void openFolder()}>
      <FolderOpen data-icon="inline-start" /> Open folder
    </Button>
  );

  return (
    <Page>
      <section className="space-y-2 pt-4">
        <h1 className="text-2xl font-semibold tracking-tight">{greeting()}</h1>
        <p className="text-muted-foreground">Welcome to Crowe Harness{email ? `, signed in as ${email}` : ""}.</p>
        <p className="text-sm text-muted-foreground">
          Pick up a recent chat, or open a folder to start working with Claude Code.
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="recent-projects">
        <div className="flex items-center justify-between">
          <h2 id="recent-projects" className="text-sm font-medium">
            Recent projects
          </h2>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/projects">
                View all <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
            {openFolderButton("default")}
          </div>
        </div>
        {!loaded && status === "error" ? (
          <LoadError
            title="Could not load projects"
            message={error ?? "Unknown error"}
            onRetry={() => void loadProjects()}
          />
        ) : !loaded ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" role="status">
            <span className="sr-only">Loading projects…</span>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-28 rounded-lg" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            icon={FolderPlus}
            title="No projects yet"
            description="Projects appear here once you use Claude Code in a folder, or when you open one in Crowe Harness."
            action={openFolderButton("outline")}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {projects.slice(0, RECENT_PROJECTS).map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="recent-chats">
        <h2 id="recent-chats" className="text-sm font-medium">
          Recent chats
        </h2>
        {loaded && projects.length > 0 && chatsLoading && recentChats.length === 0 ? (
          <ListSkeleton label="Loading recent chats…" rows={2} />
        ) : recentChats.length === 0 ? (
          <EmptyState
            icon={MessagesSquare}
            title="No chats yet"
            description="Chats with Claude Code appear here. Open a project and start a new chat."
          />
        ) : (
          <ul className="divide-y rounded-lg border">
            {recentChats.map((session) => (
              <li key={session.id}>
                <Link
                  to={`/projects/${session.projectId}/sessions/${session.id}`}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm outline-none hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  <MessageSquare className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{session.title}</span>
                  <span className="truncate text-xs text-muted-foreground">{names.get(session.projectId)}</span>
                  <span className="w-28 shrink-0 text-right text-xs text-muted-foreground">
                    {formatRelativeTime(session.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Page>
  );
}
