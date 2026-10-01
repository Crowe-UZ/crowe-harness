import { Paperclip, SendHorizontal, Square } from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent, type Ref } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const ATTACH_HINT_ID = "composer-attach-hint";

export function Composer({
  running,
  onSend,
  onStop,
  inputRef,
}: {
  running: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  /** Lets the parent return focus to the message field (e.g. after a permission decision). */
  inputRef?: Ref<HTMLTextAreaElement>;
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
      className="rounded-xl border bg-card shadow-xs transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring"
    >
      <label htmlFor="composer" className="sr-only">
        Message
      </label>
      <Textarea
        id="composer"
        ref={inputRef}
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
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-disabled="true"
                aria-describedby={ATTACH_HINT_ID}
                className="cursor-not-allowed opacity-50 hover:bg-transparent! hover:text-inherit! active:translate-y-0!"
                onClick={(e) => e.preventDefault()}
              >
                <Paperclip data-icon="inline-start" /> Attach
              </Button>
            </TooltipTrigger>
            <TooltipContent>Attachments are coming in a future update</TooltipContent>
          </Tooltip>
          <span id={ATTACH_HINT_ID} className="sr-only">
            Unavailable. Attachments are coming in a future update.
          </span>
          {/*
            One persistent button that switches between Send and Stop, so keyboard focus is never
            dropped when a response starts or ends. aria-disabled (not disabled) keeps it focusable.
          */}
          <Button
            type={running ? "button" : "submit"}
            variant={running ? "secondary" : "default"}
            size="sm"
            aria-disabled={!running && !canSend ? true : undefined}
            onClick={
              running
                ? (e) => {
                    // Never let a Stop click fall through to a form submit if the button re-renders first.
                    e.preventDefault();
                    onStop();
                  }
                : undefined
            }
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-primary! aria-disabled:active:translate-y-0!"
          >
            {running ? (
              <>
                <Square data-icon="inline-start" /> Stop
              </>
            ) : (
              <>
                Send <SendHorizontal data-icon="inline-end" />
              </>
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}
