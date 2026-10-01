import { FileQuestion, FileWarning, Lock } from "lucide-react";
import { useRef, useState } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { mockFileTree, readMockFile } from "@/features/workspace/mockFs";
import { FileTree } from "./FileTree";

type PreviewState =
  | { kind: "idle" }
  | { kind: "loading"; path: string }
  | { kind: "ready"; path: string; content: string }
  | { kind: "error"; path: string; message: string };

export function FilesView({ projectName }: { projectName: string }) {
  const [selected, setSelected] = useState<string>();
  const [preview, setPreview] = useState<PreviewState>({ kind: "idle" });
  const latest = useRef<string | undefined>(undefined);

  function select(path: string) {
    setSelected(path);
    setPreview({ kind: "loading", path });
    latest.current = path;
    readMockFile(path)
      .then((content) => {
        if (latest.current === path) setPreview({ kind: "ready", path, content });
      })
      .catch((error: unknown) => {
        if (latest.current === path) {
          setPreview({ kind: "error", path, message: error instanceof Error ? error.message : String(error) });
        }
      });
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-64 shrink-0 overflow-y-auto border-r bg-surface px-1.5 py-2">
        <p className="px-2 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{projectName}</p>
        <FileTree nodes={mockFileTree} selected={selected} onSelect={select} label={`${projectName} files`} />
      </aside>
      <section className="flex min-w-0 flex-1 flex-col" aria-label="File preview">
        {preview.kind === "idle" ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <EmptyState icon={FileQuestion} title="Select a file" description="Choose a file in the tree to preview it. Use the arrow keys to navigate." />
          </div>
        ) : (
          <>
            <div className="flex h-9 shrink-0 items-center gap-2 border-b px-4 font-mono text-xs">
              <span className="truncate">{preview.path}</span>
              <span className="ml-auto flex items-center gap-1 font-sans text-muted-foreground">
                <Lock className="size-3" aria-hidden="true" /> Read-only
              </span>
            </div>
            {preview.kind === "loading" ? (
              <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading file">
                {[70, 45, 85, 60, 30].map((w) => (
                  <Skeleton key={w} className="h-4" style={{ width: `${w}%` }} />
                ))}
              </div>
            ) : preview.kind === "error" ? (
              <div className="p-8">
                <EmptyState icon={FileWarning} tone="danger" title="Could not open file" description={preview.message} />
              </div>
            ) : (
              <CodeView content={preview.content} />
            )}
          </>
        )}
      </section>
    </div>
  );
}

function CodeView({ content }: { content: string }) {
  const lines = content.replace(/\n$/, "").split("\n");
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-surface">
      <pre className="py-3 font-mono text-[13px] leading-6">
        <code>
          {lines.map((line, i) => (
            <div key={i} className="flex hover:bg-muted/60">
              <span className="w-12 shrink-0 pr-4 text-right text-muted-foreground/70 select-none" aria-hidden="true">
                {i + 1}
              </span>
              <span className="pr-6 whitespace-pre">{line || " "}</span>
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}
