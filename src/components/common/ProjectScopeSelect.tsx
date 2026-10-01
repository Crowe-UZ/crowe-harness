import { useProjectStore } from "@/stores/projectStore";

/** Chooses which project's `.claude/` folder is listed next to the user-level entries. */
export function ProjectScopeSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (projectId: string | null) => void;
}) {
  const projects = useProjectStore((s) => s.projects);
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="scope-project" className="text-sm text-muted-foreground">
        Project
      </label>
      <select
        id="scope-project"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="h-8 max-w-56 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring"
      >
        <option value="">None (user level only)</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}
