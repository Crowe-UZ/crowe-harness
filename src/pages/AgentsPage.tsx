import { Bot, Plus } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/EmptyState";
import { Page, PageHeader } from "@/components/common/PageHeader";
import { RequiredMark } from "@/components/common/RequiredMark";
import { useFocusFirstInvalid } from "@/components/common/use-focus-first-invalid";
import { usePageTitle } from "@/components/common/use-page-title";
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
  usePageTitle("Agents");

  return (
    <Page>
      <PageHeader
        title="Agents"
        description="Specialised subagents Claude can delegate to. They will be stored as Claude Code subagent files."
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus data-icon="inline-start" /> Create agent
          </Button>
        }
      />
      {agents.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="No agents yet"
          description="Create an agent to give Claude a specialised helper for a recurring task."
          action={
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              <Plus data-icon="inline-start" /> Create agent
            </Button>
          }
        />
      ) : (
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
      )}
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
  const [attempt, setAttempt] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstInvalid(formRef, attempt);
  const nameError = attempt > 0 && !name.trim();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setAttempt((n) => n + 1);
      return;
    }
    addAgent({ name, description });
    toast.success(`Agent “${name.trim()}” created`, {
      description: "Saved locally. Runtime support arrives with Claude Code integration.",
    });
    onDone();
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Create agent</DialogTitle>
        <DialogDescription>
          The agent is saved in Crowe Harness. Running agents requires the Claude runtime.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="agent-name">
          Name <RequiredMark />
        </Label>
        <Input
          id="agent-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Docs Writer"
          aria-required="true"
          aria-invalid={nameError || undefined}
          aria-describedby={nameError ? "agent-name-error" : undefined}
        />
        {nameError ? (
          <p id="agent-name-error" className="text-xs text-destructive">
            Enter an agent name.
          </p>
        ) : null}
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
