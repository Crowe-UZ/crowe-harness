import { RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { Page, PageHeader } from "@/components/common/PageHeader";
import { ProjectScopeSelect } from "@/components/common/ProjectScopeSelect";
import { ListSkeleton, LoadError } from "@/components/common/ResourceStates";
import { ScopeBadge } from "@/components/common/ScopeBadge";
import { usePageTitle } from "@/components/common/use-page-title";
import { Button } from "@/components/ui/button";
import { services } from "@/features/ai/services";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { useUiStore } from "@/stores/uiStore";

export function SkillsPage() {
  const [projectId, setProjectId] = useState<string | null>(() => useUiStore.getState().lastProjectId ?? null);
  const skills = useAsyncResource(`skills:${projectId ?? ""}`, () => services.config.listSkills(projectId));
  usePageTitle("Skills");

  return (
    <Page>
      <PageHeader
        title="Skills"
        description="Packaged instructions Claude Code loads on demand, read from your user and project configuration."
        actions={
          <Button variant="outline" size="sm" onClick={skills.reload}>
            <RefreshCw data-icon="inline-start" /> Refresh
          </Button>
        }
      />
      <ProjectScopeSelect value={projectId} onChange={setProjectId} />
      {skills.status === "error" && !skills.data ? (
        <LoadError title="Could not load skills" message={skills.error} onRetry={skills.reload} />
      ) : !skills.data ? (
        <ListSkeleton label="Loading skills…" />
      ) : skills.data.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No skills found"
          description={
            <>
              Claude Code reads skills from{" "}
              <code className="font-mono text-xs">~/.claude/skills/&lt;name&gt;/SKILL.md</code> (user) and{" "}
              <code className="font-mono text-xs">.claude/skills/&lt;name&gt;/SKILL.md</code> in a project.
            </>
          }
        />
      ) : (
        <ul className="divide-y rounded-lg border" aria-label="Skills">
          {skills.data.map((skill) => (
            <li key={`${skill.scope}:${skill.name}`} className="flex items-center gap-4 px-4 py-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
                <Sparkles className="size-4" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{skill.name}</p>
                <p className="text-sm text-muted-foreground">{skill.description || "No description"}</p>
              </div>
              <ScopeBadge scope={skill.scope} />
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
