import { FolderOpen, FolderPlus, FolderSearch, RefreshCw, Search } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { Page, PageHeader } from "@/components/common/PageHeader";
import { LoadError } from "@/components/common/ResourceStates";
import { usePageTitle } from "@/components/common/use-page-title";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useOpenFolder } from "@/hooks/use-open-folder";
import { useProjectStore } from "@/stores/projectStore";

export function ProjectsPage() {
  const projects = useProjectStore((s) => s.projects);
  const loaded = useProjectStore((s) => s.loaded);
  const status = useProjectStore((s) => s.status);
  const error = useProjectStore((s) => s.error);
  const load = useProjectStore((s) => s.load);
  const { openFolder } = useOpenFolder();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q ? projects.filter((p) => `${p.name} ${p.path ?? ""}`.toLowerCase().includes(q)) : projects;
  usePageTitle("Projects");

  return (
    <Page>
      <PageHeader
        title="Projects"
        description={
          loaded
            ? `${projects.length} project${projects.length === 1 ? "" : "s"} from Claude Code history and opened folders`
            : "Projects from Claude Code history and opened folders"
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              aria-disabled={status === "loading" || undefined}
              className="aria-disabled:opacity-50"
              onClick={() => {
                if (status !== "loading") void load();
              }}
            >
              <RefreshCw data-icon="inline-start" /> Refresh
            </Button>
            <Button size="sm" onClick={() => void openFolder()}>
              <FolderOpen data-icon="inline-start" /> Open folder
            </Button>
          </>
        }
      />
      <div className="relative max-w-sm">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name or path"
          aria-label="Filter projects"
          className="pl-8"
        />
      </div>
      {!loaded && status === "error" ? (
        <LoadError title="Could not load projects" message={error ?? "Unknown error"} onRetry={() => void load()} />
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
          action={
            <Button variant="outline" size="sm" onClick={() => void openFolder()}>
              <FolderOpen data-icon="inline-start" /> Open folder
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FolderSearch}
          title="No matching projects"
          description={`Nothing matches “${query}”. Try another name or path.`}
          action={
            <Button variant="outline" size="sm" onClick={() => setQuery("")}>
              Clear filter
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </Page>
  );
}
