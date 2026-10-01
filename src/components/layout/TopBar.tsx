import { ChevronRight, CircleUser, KeyRound, Search, Settings } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { describeAuthStatus } from "@/features/ai/auth";
import { useRouteContext } from "@/hooks/use-route-context";
import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";
import { Logo } from "./Logo";

export function TopBar() {
  const navigate = useNavigate();
  const { project, session } = useRouteContext();
  const setCommandOpen = useUiStore((s) => s.setCommandOpen);
  const authStatus = useAuthStore((s) => s.status);
  const account = authStatus?.state === "signed_in" ? authStatus.email : undefined;

  return (
    <header className="flex h-(--topbar-h) shrink-0 items-center gap-2 border-b bg-sidebar px-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarTrigger aria-label="Toggle sidebar" />
        </TooltipTrigger>
        <TooltipContent>
          Toggle sidebar <Kbd>Ctrl+B</Kbd>
        </TooltipContent>
      </Tooltip>

      <Link
        to="/"
        className="flex items-center gap-2 rounded-md px-1 py-0.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Logo className="size-5" />
        <span className="text-sm font-semibold tracking-tight">Crowe Harness</span>
      </Link>

      {project ? (
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
          <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
          <Link to={`/projects/${project.id}`} className="truncate rounded px-1 hover:text-foreground">
            {project.name}
          </Link>
          {session ? (
            <>
              <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate px-1 text-foreground" aria-current="page">
                {session.title}
              </span>
            </>
          ) : null}
        </nav>
      ) : null}

      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="w-56 justify-start gap-2 text-muted-foreground"
          onClick={() => setCommandOpen(true)}
        >
          <Search aria-hidden="true" />
          <span className="flex-1 text-left">Search…</span>
          <Kbd>Ctrl+K</Kbd>
        </Button>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Account">
                  <CircleUser />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Account</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="space-y-0.5">
              <div className="text-sm font-medium text-foreground">{account ?? "Local user"}</div>
              <div className="text-xs font-normal text-muted-foreground">Claude: {describeAuthStatus(authStatus)}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate("/settings?tab=account")}>
              <KeyRound /> Claude account
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate("/settings")}>
              <Settings /> Settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Settings" asChild>
              <Link to="/settings">
                <Settings />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
