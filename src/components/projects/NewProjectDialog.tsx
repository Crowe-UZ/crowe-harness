import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProjectLanguage } from "@/data/types";
import { useProjectStore } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";

const LANGUAGES: ProjectLanguage[] = ["TypeScript", "JavaScript", "Python", "Go", "Rust", "Java", "Other"];

export function NewProjectDialog() {
  const open = useUiStore((s) => s.newProjectOpen);
  const setOpen = useUiStore((s) => s.setNewProjectOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        {open ? <NewProjectForm onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function NewProjectForm({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const addProject = useProjectStore((s) => s.addProject);
  const baseFolder = useSettingsStore((s) => s.defaultProjectsFolder);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [language, setLanguage] = useState<ProjectLanguage>("TypeScript");
  const [submitted, setSubmitted] = useState(false);

  const nameError = submitted && !name.trim() ? "Enter a project name." : undefined;
  const effectivePath = path.trim() || `${baseFolder}\\${slug(name) || "new-project"}`;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (!name.trim()) return;
    const project = addProject({ name, path: effectivePath, language });
    toast.success(`${project.name} added`, { description: "Demo project — no files were created on disk." });
    onDone();
    navigate(`/projects/${project.id}`);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>New project</DialogTitle>
        <DialogDescription>
          Register a project in the workspace. In this version projects are demo entries; opening real folders arrives
          with the file system milestone.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-2">
        <Label htmlFor="project-name">Name</Label>
        <Input
          id="project-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Project Orion"
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? "project-name-error" : undefined}
        />
        {nameError ? (
          <p id="project-name-error" className="text-xs text-destructive">
            {nameError}
          </p>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="project-path">Folder</Label>
        <Input
          id="project-path"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder={effectivePath}
          className="font-mono text-xs"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="project-language">Language</Label>
        <select
          id="project-language"
          value={language}
          onChange={(e) => setLanguage(e.target.value as ProjectLanguage)}
          className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        >
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit">Create project</Button>
      </DialogFooter>
    </form>
  );
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
