import { Plug, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Page, PageHeader } from "@/components/common/PageHeader";
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
import type { McpServer } from "@/data/types";
import { useSettingsStore } from "@/stores/settingsStore";

export function McpPage() {
  const servers = useSettingsStore((s) => s.mcpServers);
  const [open, setOpen] = useState(false);

  return (
    <Page>
      <PageHeader
        title="MCP Servers"
        description="Model Context Protocol servers extend Claude with external tools. Connections are not active in this version."
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus data-icon="inline-start" /> Add MCP Server
          </Button>
        }
      />
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
      <AddServerDialog open={open} onOpenChange={setOpen} />
    </Page>
  );
}

function AddServerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const addMcpServer = useSettingsStore((s) => s.addMcpServer);
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<McpServer["transport"]>("http");
  const [target, setTarget] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const invalid = submitted && (!name.trim() || !target.trim());

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (!name.trim() || !target.trim()) return;
    addMcpServer({ name, transport, target });
    toast.success(`${name.trim()} added`, { description: "Saved as not connected. Connections arrive in milestone M8." });
    setName("");
    setTarget("");
    setSubmitted(false);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add MCP server</DialogTitle>
            <DialogDescription>
              Only the server address is stored. Credentials are never entered here — they will live in the OS keychain.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="mcp-name">Name</Label>
            <Input id="mcp-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="GitHub" />
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">Transport</legend>
            <RadioGroup value={transport} onValueChange={(v) => setTransport(v as McpServer["transport"])} className="flex gap-4">
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
            <Label htmlFor="mcp-target">{transport === "http" ? "URL" : "Command"}</Label>
            <Input
              id="mcp-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={transport === "http" ? "https://mcp.example.com" : "npx -y @example/mcp-server"}
              className="font-mono text-xs"
            />
          </div>
          {invalid ? <p className="text-xs text-destructive">Name and {transport === "http" ? "URL" : "command"} are required.</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Add server</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
