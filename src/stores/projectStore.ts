import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createMockProjects } from "@/data/mock";
import type { Project, ProjectLanguage } from "@/data/types";
import { isProject } from "@/data/validate";
import { filterValid, isRecord } from "@/lib/guards";
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

type PersistedProjects = Pick<ProjectState, "projects">;

/** Valid fields of a persisted snapshot; malformed projects are dropped. */
function parsePersisted(value: unknown): Partial<PersistedProjects> {
  if (!isRecord(value)) return {};
  const projects = filterValid(value.projects, isProject);
  return projects ? { projects } : {};
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
        set((state) =>
          state.projects.some((p) => p.id === id)
            ? { projects: state.projects.map((p) => (p.id === id ? { ...p, lastOpened: new Date().toISOString() } : p)) }
            : state,
        ),
      reset: () => set({ projects: createMockProjects() }),
    }),
    {
      name: "crowe-harness.projects",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): Partial<PersistedProjects> => ({ projects: state.projects }),
      // v1 is the only shape so far: identity, minus malformed records.
      migrate: (persisted) => parsePersisted(persisted),
      merge: (persisted, current) => ({ ...current, ...parsePersisted(persisted) }),
    },
  ),
);

export function sortByLastOpened(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => b.lastOpened.localeCompare(a.lastOpened));
}

/** Most recently opened project, if any. */
export function mostRecentProject(projects: Project[]): Project | undefined {
  return sortByLastOpened(projects)[0];
}
