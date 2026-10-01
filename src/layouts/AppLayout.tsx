import { useEffect, useRef, type CSSProperties } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { StatusBar } from "@/components/layout/StatusBar";
import { TopBar } from "@/components/layout/TopBar";
import { AppSidebar } from "@/components/sidebar/AppSidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { isRecord } from "@/lib/guards";
import { useProjectStore } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";

const layoutVars = {
  "--topbar-h": "2.75rem",
  "--statusbar-h": "1.75rem",
} as CSSProperties;

const MAIN_ID = "main-content";

function focusMain() {
  document.getElementById(MAIN_ID)?.focus({ preventScroll: true });
}

/**
 * Moves focus to the main region when the route (path) changes — not on first load, not for ?query
 * changes, and not when the navigation asks to keep focus (a new chat continuing under its real route).
 */
function useFocusMainOnNavigation() {
  const location = useLocation();
  const { pathname } = location;
  const state: unknown = location.state;
  const previous = useRef(pathname);
  const keepFocus = isRecord(state) && state.keepFocus === true;

  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    if (!keepFocus) focusMain();
  }, [pathname, keepFocus]);
}

/** Loads the project list once and applies "Open last project on startup" after the first load. */
function useStartup() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const loaded = useProjectStore((s) => s.loaded);
  const status = useProjectStore((s) => s.status);
  const load = useProjectStore((s) => s.load);

  useEffect(() => {
    if (!loaded && status === "idle") void load();
  }, [loaded, status, load]);

  useEffect(() => {
    if (!loaded || useUiStore.getState().startupHandled) return;
    useUiStore.getState().markStartupHandled();
    const latest = useProjectStore.getState().projects[0];
    if (pathname === "/" && latest && useSettingsStore.getState().openLastProjectOnStartup) {
      void navigate(`/projects/${latest.id}`, { replace: true });
    }
  }, [loaded, pathname, navigate]);
}

export function AppLayout() {
  useFocusMainOnNavigation();
  useStartup();

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
      <CommandPalette />
    </SidebarProvider>
  );
}
