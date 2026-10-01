import { Plug, Plus } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/EmptyState";
import { Page, PageHeader } from "@/components/common/PageHeader";
import { RequiredMark } from "@/components/common/RequiredMark";
import { useFocusFirstInvalid } from "@/components/common/use-focus-first-invalid";
import { usePageTitle } from "@/components/common/use-page-title";
import { Badge } from "@/components/ui/badge";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { MCP_TRANSPORTS, type McpTransport } from "@/data/types";
import { isOneOf } from "@/lib/guards";
import { useSettingsStore } from "@/stores/settingsStore";

export function McpPage() {
  const servers = useSettingsStore((s) => s.mcpServers);
  const [open, setOpen] = useState(false);
  usePageTitle("MCP servers");

  return (
    <Page>
      <PageHeader
        title="MCP servers"
        description="Model Context Protocol servers extend Claude with external tools. Connections are not active in this version."
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus data-icon="inline-start" /> Add MCP server
          </Button>
        }
      />
      {servers.length === 0 ? (
        <EmptyState
          icon={Plug}
          title="No MCP servers yet"
          description="Add a server to give Claude access to external tools."
          action={
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              <Plus data-icon="inline-start" /> Add MCP server
            </Button>
          }
        />
      ) : (
        <ul className="divide-y rounded-lg border">
          {servers.map((server) => (
            <li key={server.id} className="flex items-center gap-4 px-4 py-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
                <Plug className="size-4" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{server.name}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {server.description} · <span className="font-mono text-xs">{server.target}</span>
                </p>
              </div>
              <Badge variant="outline" className="font-mono uppercase">
                {server.transport}
              </Badge>
              <span className="flex w-28 items-center justify-end gap-1.5 text-xs text-muted-foreground">
                <span className="size-2 rounded-full bg-muted-foreground/50" aria-hidden="true" />
                Not connected
              </span>
            </li>
          ))}
        </ul>
      )}
      <AddServerDialog open={open} onOpenChange={setOpen} />
    </Page>
  );
}

function AddServerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Mounted only while open so every opening starts with a clean form. */}
        {open ? <AddServerForm onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function AddServerForm({ onDone }: { onDone: () => void }) {
  const addMcpServer = useSettingsStore((s) => s.addMcpServer);
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<McpTransport>("http");
  const [target, setTarget] = useState("");
  const [attempt, setAttempt] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstInvalid(formRef, attempt);
  const targetLabel = transport === "http" ? "URL" : "Command";
  const nameError = attempt > 0 && !name.trim() ? "Enter a server name." : undefined;
  const targetError =
    attempt > 0 && !target.trim() ? (transport === "http" ? "Enter a URL." : "Enter a command.") : undefined;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !target.trim()) {
      setAttempt((n) => n + 1);
      return;
    }
    addMcpServer({ name, transport, target });
    toast.success(`${name.trim()} added`, {
      description: "Saved as not connected. Connections are coming in a future update.",
    });
    onDone();
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Add MCP server</DialogTitle>
        <DialogDescription>
          Only the server address is stored. Credentials are never entered here — they will live in the OS keychain.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="mcp-name">
          Name <RequiredMark />
        </Label>
        <Input
          id="mcp-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="GitHub"
          aria-required="true"
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? "mcp-name-error" : undefined}
        />
        {nameError ? (
          <p id="mcp-name-error" className="text-xs text-destructive">
            {nameError}
          </p>
        ) : null}
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Transport</legend>
        <RadioGroup
          value={transport}
          onValueChange={(value) => {
            if (isOneOf(MCP_TRANSPORTS, value)) setTransport(value);
          }}
          className="flex gap-4"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="http" id="mcp-http" />
            <Label htmlFor="mcp-http">HTTP</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="stdio" id="mcp-stdio" />
            <Label htmlFor="mcp-stdio">Local process (stdio)</Label>
          </div>
        </RadioGroup>
      </fieldset>
      <div className="grid gap-2">
        <Label htmlFor="mcp-target">
          {targetLabel} <RequiredMark />
        </Label>
        <Input
          id="mcp-target"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder={transport === "http" ? "https://mcp.example.com" : "npx -y @example/mcp-server"}
          aria-required="true"
          aria-invalid={targetError ? true : undefined}
          aria-describedby={targetError ? "mcp-target-error" : undefined}
          className="font-mono text-xs"
        />
        {targetError ? (
          <p id="mcp-target-error" className="text-xs text-destructive">
            {targetError}
          </p>
        ) : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit">Add server</Button>
      </DialogFooter>
    </form>
  );
}
