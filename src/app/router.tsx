import { createHashRouter } from "react-router";
import { AppLayout } from "@/layouts/AppLayout";
import { AgentsPage } from "@/pages/AgentsPage";
import { HomePage } from "@/pages/HomePage";
import { McpPage } from "@/pages/McpPage";
import { NotFoundPage, RouteErrorPage } from "@/pages/NotFoundPage";
import { ProjectPage } from "@/pages/ProjectPage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { SkillsPage } from "@/pages/SkillsPage";
import { mostRecentProject, useProjectStore } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";

/**
 * Hash routing: works identically under the Vite dev server and Tauri's
 * custom protocol (http://tauri.localhost) without server-side fallbacks.
 */
export const router = createHashRouter([
  {
    path: "/",
    element: <AppLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        errorElement: <RouteErrorPage />,
        children: [
          { index: true, element: <HomePage /> },
          { path: "projects", element: <ProjectsPage /> },
          { path: "projects/:projectId", element: <ProjectPage /> },
          { path: "projects/:projectId/sessions/:sessionId", element: <ProjectPage /> },
          { path: "agents", element: <AgentsPage /> },
          { path: "skills", element: <SkillsPage /> },
          { path: "mcp", element: <McpPage /> },
          { path: "settings", element: <SettingsPage /> },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);

/** "Open last project on startup": runs once, on initial load, only when the app starts at "/". */
function openLastProjectOnStartup() {
  if (router.state.location.pathname !== "/" || !useSettingsStore.getState().openLastProjectOnStartup) return;
  const project = mostRecentProject(useProjectStore.getState().projects);
  if (project) void router.navigate(`/projects/${project.id}`, { replace: true });
}

openLastProjectOnStartup();
