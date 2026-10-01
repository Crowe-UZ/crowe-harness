import { Paperclip, SendHorizontal, Square } from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function Composer({
  running,
  onSend,
  onStop,
}: {
  running: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const canSend = text.trim().length > 0 && !running;

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend) return;
    onSend(text);
    setText("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border bg-card shadow-xs transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30"
    >
      <label htmlFor="composer" className="sr-only">
        Message
      </label>
      <Textarea
        id="composer"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Ask Claude…"
        rows={3}
        className="max-h-60 min-h-20 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <div className="flex items-center gap-2 px-2 pb-2">
        <span className="text-xs text-muted-foreground">
          <Kbd>Enter</Kbd> to send · <Kbd>Shift+Enter</Kbd> new line
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              {/* aria-disabled keeps the button focusable so the tooltip is reachable by keyboard */}
              <Button type="button" variant="ghost" size="sm" aria-disabled="true" className="opacity-50" onClick={(e) => e.preventDefault()}>
                <Paperclip data-icon="inline-start" /> Attach
              </Button>
            </TooltipTrigger>
            <TooltipContent>Attachments arrive with the Claude runtime</TooltipContent>
          </Tooltip>
          {running ? (
            <Button type="button" variant="secondary" size="sm" onClick={onStop}>
              <Square data-icon="inline-start" /> Stop
            </Button>
          ) : (
            <Button type="submit" size="sm" disabled={!canSend}>
              Send <SendHorizontal data-icon="inline-end" />
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
