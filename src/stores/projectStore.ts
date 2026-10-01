import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createMockProjects } from "@/data/mock";
import type { Project, ProjectLanguage } from "@/data/types";
import { createId } from "@/lib/id";

export interface NewProjectInput {
  name: string;
  path: string;
  language: ProjectLanguage;
}

interface ProjectState {
  projects: Project[];
  addProject: (input: NewProjectInput) => Project;
  touchProject: (id: string) => void;
  reset: () => void;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set) => ({
      projects: createMockProjects(),
      addProject: (input) => {
        const project: Project = {
          id: createId("project"),
          name: input.name.trim(),
          path: input.path.trim(),
          language: input.language,
          branch: "main",
          lastOpened: new Date().toISOString(),
        };
        set((state) => ({ projects: [project, ...state.projects] }));
        return project;
      },
      touchProject: (id) =>
        set((state) => ({
          projects: state.projects.map((p) => (p.id === id ? { ...p, lastOpened: new Date().toISOString() } : p)),
        })),
      reset: () => set({ projects: createMockProjects() }),
    }),
    { name: "crowe-harness.projects", version: 1, storage: createJSONStorage(() => localStorage) },
  ),
);

export function sortByLastOpened(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => b.lastOpened.localeCompare(a.lastOpened));
}
