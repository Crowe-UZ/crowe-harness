import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A command or URL the user is expected to copy (the webview cannot open external links or run commands). */
export function CommandSnippet({ value, label, className }: { value: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      toast.error("Could not copy to the clipboard", { description: "Select the text and copy it manually." });
    }
  };

  return (
    <div className={cn("flex items-center gap-2 rounded-md border bg-surface py-1 pr-1 pl-3", className)}>
      <code className="min-w-0 flex-1 truncate font-mono text-xs select-all">{value}</code>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        onClick={() => void copy()}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}
