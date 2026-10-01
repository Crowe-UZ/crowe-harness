import { ArrowRight, KeyRound, MessageSquare, Plus } from "lucide-react";
import { Link } from "react-router";
import { useShallow } from "zustand/shallow";
import { Page } from "@/components/common/PageHeader";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { Button } from "@/components/ui/button";
import { formatRelativeTime, greeting } from "@/lib/time";
import { useAuthStore } from "@/stores/authStore";
import { sortByLastOpened, useProjectStore } from "@/stores/projectStore";
import { sortSessionsByUpdated, useSessionStore } from "@/stores/sessionStore";
import { useUiStore } from "@/stores/uiStore";

export function HomePage() {
  const projects = useProjectStore(useShallow((s) => sortByLastOpened(s.projects).slice(0, 6)));
  const projectNames = useProjectStore(useShallow((s) => Object.fromEntries(s.projects.map((p) => [p.id, p.name]))));
  const sessions = useSessionStore(useShallow((s) => sortSessionsByUpdated(s.sessions).slice(0, 5)));
  const setNewProjectOpen = useUiStore((s) => s.setNewProjectOpen);
  const authState = useAuthStore((s) => s.status?.state);

  return (
    <Page>
      <section className="space-y-2 pt-4">
        <h1 className="text-2xl font-semibold tracking-tight">{greeting()}</h1>
        <p className="text-muted-foreground">Welcome to Crowe Harness.</p>
        <p className="text-sm text-muted-foreground">
          Choose a project to start working with your AI development environment.
        </p>
      </section>

      {authState === "signed_out" || authState === "cli_not_found" ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-surface px-4 py-3">
          <KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />
          <p className="flex-1 text-sm">
            Sign in with your Claude subscription to enable AI sessions.{" "}
            <span className="text-muted-foreground">Sign-in goes through Claude Code; Crowe Harness never stores credentials.</span>
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link to="/settings?tab=account">Open account settings</Link>
          </Button>
        </div>
      ) : null}

      <section className="space-y-3" aria-labelledby="recent-projects">
        <div className="flex items-center justify-between">
          <h2 id="recent-projects" className="text-sm font-medium">
            Recent Projects
          </h2>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/projects">
                View all <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
            <Button size="sm" onClick={() => setNewProjectOpen(true)}>
              <Plus data-icon="inline-start" /> New Project
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="recent-sessions">
        <h2 id="recent-sessions" className="text-sm font-medium">
          Recent Sessions
        </h2>
        <ul className="divide-y rounded-lg border">
          {sessions.map((session) => (
            <li key={session.id}>
              <Link
                to={`/projects/${session.projectId}/sessions/${session.id}`}
                className="flex items-center gap-3 px-4 py-2.5 text-sm outline-none hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
              >
                <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
                <span className="flex-1 truncate">{session.title}</span>
                <span className="text-xs text-muted-foreground">{projectNames[session.projectId]}</span>
                <span className="w-28 text-right text-xs text-muted-foreground">
                  {formatRelativeTime(session.updatedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </Page>
  );
}
