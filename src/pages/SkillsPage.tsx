import { Sparkles } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { Page, PageHeader } from "@/components/common/PageHeader";
import { usePageTitle } from "@/components/common/use-page-title";
import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/stores/settingsStore";

export function SkillsPage() {
  const skills = useSettingsStore((s) => s.skills);
  const toggleSkill = useSettingsStore((s) => s.toggleSkill);
  const enabledCount = skills.filter((s) => s.enabled).length;
  usePageTitle("Skills");

  return (
    <Page>
      <PageHeader
        title="Skills"
        description={`${enabledCount} of ${skills.length} skills enabled. Skills package reusable instructions Claude can load on demand.`}
      />
      {skills.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No skills available"
          description="Skills you add to Claude Code will appear here so you can turn them on or off."
        />
      ) : (
        <ul className="divide-y rounded-lg border">
          {skills.map((skill) => {
            const id = `skill-${skill.id}`;
            return (
              <li key={skill.id} className="flex items-center gap-4 px-4 py-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
                  <Sparkles className="size-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <label htmlFor={id} className="text-sm font-medium">
                    {skill.name}
                  </label>
                  <p className="text-sm text-muted-foreground" id={`${id}-desc`}>
                    {skill.description}
                  </p>
                </div>
                <span className="w-16 text-right text-xs text-muted-foreground">{skill.enabled ? "Enabled" : "Disabled"}</span>
                <Switch
                  id={id}
                  checked={skill.enabled}
                  onCheckedChange={(checked) => toggleSkill(skill.id, checked)}
                  aria-describedby={`${id}-desc`}
                />
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}
