import { useEffect, type CSSProperties } from "react";
import { Outlet } from "react-router";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { StatusBar } from "@/components/layout/StatusBar";
import { TopBar } from "@/components/layout/TopBar";
import { NewProjectDialog } from "@/components/projects/NewProjectDialog";
import { AppSidebar } from "@/components/sidebar/AppSidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useAuthStore } from "@/stores/authStore";

const layoutVars = {
  "--topbar-h": "2.75rem",
  "--statusbar-h": "1.75rem",
} as CSSProperties;

export function AppLayout() {
  const refreshAuth = useAuthStore((s) => s.refresh);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  return (
    <SidebarProvider style={layoutVars} className="h-svh min-h-0 flex-col overflow-hidden">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:ring-3 focus:ring-ring/50"
      >
        Skip to content
      </a>
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <AppSidebar />
        <SidebarInset id="main-content" className="min-h-0 min-w-0 overflow-hidden">
          <Outlet />
        </SidebarInset>
      </div>
      <StatusBar />
      <NewProjectDialog />
      <CommandPalette />
    </SidebarProvider>
  );
}
