import {
  Bot,
  FolderGit2,
  FolderOpen,
  Home,
  MessageSquare,
  MessageSquarePlus,
  Moon,
  Plug,
  Settings,
  Sparkles,
  Sun,
} from "lucide-react";
import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useTheme } from "@/lib/theme";
import { useOpenFolder } from "@/hooks/use-open-folder";
import { useRouteContext } from "@/hooks/use-route-context";
import type { Session } from "@/data/types";
import { useProjectStore } from "@/stores/projectStore";
import { sortSessionsByUpdated, useSessionStore } from "@/stores/sessionStore";
import { useUiStore } from "@/stores/uiStore";

export function CommandPalette() {
  const navigate = useNavigate();
  const open = useUiStore((s) => s.commandOpen);
  const setOpen = useUiStore((s) => s.setCommandOpen);
  const projects = useProjectStore((s) => s.projects);
  const lists = useSessionStore((s) => s.lists);
  const { project } = useRouteContext();
  const { openFolder } = useOpenFolder();
  /** Chats of every project whose chat list is loaded, newest first. */
  const sessions = useMemo(
    () => sortSessionsByUpdated(Object.values(lists).flatMap((list): Session[] => list?.data ?? [])).slice(0, 50),
    [lists],
  );
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setOpen(!useUiStore.getState().commandOpen);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setOpen]);

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command palette"
      description="Jump to a page, project or chat"
    >
      <Command>
        <CommandInput placeholder="Type a command or search…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Navigation">
            <CommandItem onSelect={() => run(() => void navigate("/"))}>
              <Home /> Home
            </CommandItem>
            <CommandItem onSelect={() => run(() => void navigate("/projects"))}>
              <FolderGit2 /> All projects
            </CommandItem>
            <CommandItem onSelect={() => run(() => void navigate("/agents"))}>
              <Bot /> Agents
            </CommandItem>
            <CommandItem onSelect={() => run(() => void navigate("/skills"))}>
              <Sparkles /> Skills
            </CommandItem>
            <CommandItem onSelect={() => run(() => void navigate("/mcp"))}>
              <Plug /> MCP servers
            </CommandItem>
            <CommandItem onSelect={() => run(() => void navigate("/settings"))}>
              <Settings /> Settings
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Actions">
            <CommandItem onSelect={() => run(() => void openFolder())}>
              <FolderOpen /> Open folder
            </CommandItem>
            {project ? (
              <CommandItem onSelect={() => run(() => void navigate(`/projects/${project.id}/sessions/new`))}>
                <MessageSquarePlus /> New chat in {project.name}
              </CommandItem>
            ) : null}
            <CommandItem onSelect={() => run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}>
              {resolvedTheme === "dark" ? <Sun /> : <Moon />} Toggle theme
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Projects">
            {projects.map((p) => (
              <CommandItem
                key={p.id}
                value={`project ${p.name} ${p.id}`}
                onSelect={() => run(() => void navigate(`/projects/${p.id}`))}
              >
                <FolderGit2 /> {p.name}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Chats">
            {sessions.map((s) => (
              <CommandItem
                key={s.id}
                value={`chat ${s.title} ${s.id}`}
                onSelect={() => run(() => void navigate(`/projects/${s.projectId}/sessions/${s.id}`))}
              >
                <MessageSquare /> {s.title}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
