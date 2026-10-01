import { SendHorizontal, Square } from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent, type Ref } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { isPermissionMode, PERMISSION_MODE_LABELS, PERMISSION_MODES, type PermissionMode } from "@/features/ai/types";

export function Composer({
  running,
  onSend,
  onStop,
  mode,
  onModeChange,
  placeholder = "Ask Claude…",
  inputRef,
}: {
  running: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  mode: PermissionMode;
  onModeChange: (mode: PermissionMode) => void;
  placeholder?: string;
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
        placeholder={placeholder}
        rows={3}
        className="max-h-60 min-h-20 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <div className="flex flex-wrap items-center gap-2 px-2 pb-2">
        <label htmlFor="permission-mode" className="sr-only">
          Permission mode
        </label>
        <select
          id="permission-mode"
          value={mode}
          disabled={running}
          onChange={(e) => {
            if (isPermissionMode(e.target.value)) onModeChange(e.target.value);
          }}
          className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring disabled:opacity-50"
        >
          {PERMISSION_MODES.map((value) => (
            <option key={value} value={value}>
              {PERMISSION_MODE_LABELS[value]}
            </option>
          ))}
        </select>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          <Kbd>Enter</Kbd> to send · <Kbd>Shift+Enter</Kbd> new line
        </span>
        <div className="ml-auto flex items-center gap-1">
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
