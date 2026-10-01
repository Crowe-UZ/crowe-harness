import { Eraser, TerminalSquare } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { mockTerminalOutput } from "@/data/mock";
import { cn } from "@/lib/utils";

interface Line {
  id: number;
  text: string;
  tone?: "command" | "muted";
}

let nextId = 0;
const toLines = (texts: string[]): Line[] =>
  texts.map((text) => ({ id: nextId++, text, tone: text.startsWith("$ ") ? "command" : undefined }));

/**
 * Demo terminal. Commands are echoed but never executed — real PTY
 * support arrives in milestone M6.
 */
export function MockTerminal({ cwd }: { cwd: string }) {
  const [lines, setLines] = useState<Line[]>(() => toLines(mockTerminalOutput));
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const command = input.trim();
    setInput("");
    if (!command) return;
    if (command === "clear" || command === "cls") {
      setLines([]);
      return;
    }
    setLines((prev) => [
      ...prev,
      { id: nextId++, text: `$ ${command}`, tone: "command" },
      { id: nextId++, text: "Command execution is disabled in this version (demo terminal).", tone: "muted" },
      { id: nextId++, text: "" },
    ]);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-xs text-muted-foreground">
        <TerminalSquare className="size-3.5" aria-hidden="true" />
        <span className="font-mono">{cwd}</span>
        <span className="rounded border px-1.5 leading-4">Demo · commands are not executed</span>
        <Button variant="ghost" size="xs" className="ml-auto" onClick={() => setLines([])} disabled={lines.length === 0}>
          <Eraser data-icon="inline-start" /> Clear
        </Button>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto bg-surface px-4 py-3 font-mono text-[13px] leading-6"
        onClick={() => inputRef.current?.focus()}
        role="log"
        aria-label="Terminal output"
      >
        {lines.map((line) => (
          <div
            key={line.id}
            className={cn(
              "whitespace-pre-wrap",
              line.tone === "command" && "text-foreground",
              line.tone === "muted" && "text-muted-foreground",
              !line.tone && "text-foreground/85",
              line.text.startsWith("✓") && "text-success",
            )}
          >
            {line.text || " "}
          </div>
        ))}
        <form onSubmit={onSubmit} className="flex items-center gap-2">
          <span className="text-primary" aria-hidden="true">
            $
          </span>
          <label htmlFor="terminal-input" className="sr-only">
            Terminal command
          </label>
          <input
            id="terminal-input"
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="flex-1 bg-transparent outline-none"
          />
        </form>
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
