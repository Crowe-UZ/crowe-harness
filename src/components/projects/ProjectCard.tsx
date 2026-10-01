import { FolderGit2, GitBranch } from "lucide-react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import type { Project } from "@/data/types";
import { formatRelativeTime } from "@/lib/time";

export function ProjectCard({ project }: { project: Project }) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className="group flex flex-col gap-3 rounded-lg border bg-card p-4 text-card-foreground shadow-xs transition-colors outline-none hover:border-primary/40 hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <FolderGit2 className="size-4 shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden="true" />
          <span className="truncate text-sm font-medium">{project.name}</span>
        </div>
        <Badge variant="secondary">{project.language}</Badge>
      </div>
      <p className="truncate font-mono text-xs text-muted-foreground">{project.path}</p>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Last opened {formatRelativeTime(project.lastOpened)}</span>
        <span className="flex items-center gap-1">
          <GitBranch className="size-3" aria-hidden="true" />
          {project.branch}
        </span>
      </div>
    </Link>
  );
}
