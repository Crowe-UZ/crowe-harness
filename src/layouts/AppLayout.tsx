import { useEffect, useRef, type CSSProperties } from "react";
import { Outlet, useLocation } from "react-router";
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

const MAIN_ID = "main-content";

function focusMain() {
  document.getElementById(MAIN_ID)?.focus({ preventScroll: true });
}

/** Moves focus to the main region when the route (path) changes — not on first load, not for ?query changes. */
function useFocusMainOnNavigation() {
  const { pathname } = useLocation();
  const previous = useRef(pathname);

  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    focusMain();
  }, [pathname]);
}

export function AppLayout() {
  const refreshAuth = useAuthStore((s) => s.refresh);
  useFocusMainOnNavigation();

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  return (
    <SidebarProvider style={layoutVars} className="h-svh min-h-0 flex-col overflow-hidden">
      {/* A button, not href="#main-content": with hash routing that href would navigate to a route. */}
      <button
        type="button"
        onClick={focusMain}
        className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:ring-3 focus:ring-ring focus:outline-none"
      >
        Skip to content
      </button>
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <AppSidebar />
        <SidebarInset id={MAIN_ID} tabIndex={-1} className="min-h-0 min-w-0 overflow-hidden outline-none">
          <Outlet />
        </SidebarInset>
      </div>
      <StatusBar />
      <NewProjectDialog />
      <CommandPalette />
    </SidebarProvider>
  );
}
