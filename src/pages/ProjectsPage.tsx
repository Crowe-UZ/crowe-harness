import { FolderPlus, FolderSearch, Plus, Search } from "lucide-react";
import { useState } from "react";
import { useShallow } from "zustand/shallow";
import { EmptyState } from "@/components/common/EmptyState";
import { Page, PageHeader } from "@/components/common/PageHeader";
import { usePageTitle } from "@/components/common/use-page-title";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sortByLastOpened, useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";

export function ProjectsPage() {
  const projects = useProjectStore(useShallow((s) => sortByLastOpened(s.projects)));
  const setNewProjectOpen = useUiStore((s) => s.setNewProjectOpen);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q
    ? projects.filter((p) => `${p.name} ${p.language} ${p.path}`.toLowerCase().includes(q))
    : projects;
  usePageTitle("Projects");

  return (
    <Page>
      <PageHeader
        title="Projects"
        description={`${projects.length} project${projects.length === 1 ? "" : "s"} in your workspace`}
        actions={
          <Button size="sm" onClick={() => setNewProjectOpen(true)}>
            <Plus data-icon="inline-start" /> New project
          </Button>
        }
      />
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name, language or path"
          aria-label="Filter projects"
          className="pl-8"
        />
      </div>
      {projects.length === 0 ? (
        <EmptyState
          icon={FolderPlus}
          title="No projects yet"
          description="Create a project to start a session with Claude."
          action={
            <Button variant="outline" size="sm" onClick={() => setNewProjectOpen(true)}>
              <Plus data-icon="inline-start" /> New project
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FolderSearch}
          title="No matching projects"
          description={`Nothing matches “${query}”. Try another name or create a new project.`}
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
