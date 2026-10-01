import { Bot, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Page, PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { useSettingsStore } from "@/stores/settingsStore";

export function AgentsPage() {
  const agents = useSettingsStore((s) => s.agents);
  const [open, setOpen] = useState(false);

  return (
    <Page>
      <PageHeader
        title="Agents"
        description="Specialised subagents Claude can delegate to. They will be stored as Claude Code subagent files."
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus data-icon="inline-start" /> Create Agent
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((agent) => (
          <Card key={agent.id} size="sm">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-md bg-accent text-accent-foreground">
                  <Bot className="size-4" aria-hidden="true" />
                </div>
                <CardTitle>{agent.name}</CardTitle>
              </div>
              <CardDescription>{agent.description || "No description"}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-1">
              {agent.tools.map((tool) => (
                <Badge key={tool} variant="outline" className="font-mono">
                  {tool}
                </Badge>
              ))}
              <Badge variant="secondary" className="ml-auto">
                {agent.builtIn ? "Template" : "Custom"}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>
      <CreateAgentDialog open={open} onOpenChange={setOpen} />
    </Page>
  );
}

function CreateAgentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Mounted only while open so every opening starts with a clean form. */}
        {open ? <CreateAgentForm onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CreateAgentForm({ onDone }: { onDone: () => void }) {
  const addAgent = useSettingsStore((s) => s.addAgent);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const nameError = submitted && !name.trim();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (!name.trim()) return;
    addAgent({ name, description });
    toast.success(`Agent “${name.trim()}” created`, { description: "Saved locally. Runtime support arrives with Claude Code integration." });
    onDone();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Create agent</DialogTitle>
        <DialogDescription>The agent is saved in Crowe Harness. Running agents requires the Claude runtime.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="agent-name">Name</Label>
        <Input
          id="agent-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Docs Writer"
          aria-invalid={nameError || undefined}
        />
        {nameError ? <p className="text-xs text-destructive">Enter a name.</p> : null}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="agent-description">Description</Label>
        <Textarea
          id="agent-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="When should Claude use this agent?"
          rows={3}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit">Create agent</Button>
      </DialogFooter>
    </form>
  );
}
