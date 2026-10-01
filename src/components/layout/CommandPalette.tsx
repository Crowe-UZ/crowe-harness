import { Bot, FolderGit2, Home, MessageSquare, Moon, Plug, Plus, Settings, Sparkles, Sun } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useShallow } from "zustand/shallow";
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
import { sortByLastOpened, useProjectStore } from "@/stores/projectStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useUiStore } from "@/stores/uiStore";

export function CommandPalette() {
  const navigate = useNavigate();
  const open = useUiStore((s) => s.commandOpen);
  const setOpen = useUiStore((s) => s.setCommandOpen);
  const setNewProjectOpen = useUiStore((s) => s.setNewProjectOpen);
  const projects = useProjectStore(useShallow((s) => sortByLastOpened(s.projects)));
  const sessions = useSessionStore((s) => s.sessions);
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
    <CommandDialog open={open} onOpenChange={setOpen} title="Command palette" description="Jump to a page, project or session">
      <Command>
        <CommandInput placeholder="Type a command or search…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Navigation">
            <CommandItem onSelect={() => run(() => navigate("/"))}>
              <Home /> Home
            </CommandItem>
            <CommandItem onSelect={() => run(() => navigate("/projects"))}>
              <FolderGit2 /> All projects
            </CommandItem>
            <CommandItem onSelect={() => run(() => navigate("/agents"))}>
              <Bot /> Agents
            </CommandItem>
            <CommandItem onSelect={() => run(() => navigate("/skills"))}>
              <Sparkles /> Skills
            </CommandItem>
            <CommandItem onSelect={() => run(() => navigate("/mcp"))}>
              <Plug /> MCP servers
            </CommandItem>
            <CommandItem onSelect={() => run(() => navigate("/settings"))}>
              <Settings /> Settings
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Actions">
            <CommandItem onSelect={() => run(() => setNewProjectOpen(true))}>
              <Plus /> New project
            </CommandItem>
            <CommandItem onSelect={() => run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}>
              {resolvedTheme === "dark" ? <Sun /> : <Moon />} Toggle theme
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Projects">
            {projects.map((p) => (
              <CommandItem key={p.id} value={`project ${p.name}`} onSelect={() => run(() => navigate(`/projects/${p.id}`))}>
                <FolderGit2 /> {p.name}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Sessions">
            {sessions.map((s) => (
              <CommandItem
                key={s.id}
                value={`session ${s.title} ${s.id}`}
                onSelect={() => run(() => navigate(`/projects/${s.projectId}/sessions/${s.id}`))}
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
