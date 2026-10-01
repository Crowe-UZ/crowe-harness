import { FileQuestion, FileWarning, FolderOpen, FolderX, Lock, Scissors } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { FileContent } from "@/data/types";
import { services } from "@/features/ai/services";
import { ROOT_DIR } from "@/features/workspace/fs";
import { errorMessage } from "@/lib/errors";
import { useWorkspaceStore, type DirState } from "@/stores/workspaceStore";
import { FileTree } from "./FileTree";

type FileResult = { path: string } & ({ kind: "ready"; file: FileContent } | { kind: "error"; message: string });

const NO_DIRS: Record<string, DirState | undefined> = {};
const NO_EXPANDED: string[] = [];

/** Read-only project browser with a lazily loaded tree. State lives in the per-project workspace store. */
export function FilesView({ projectId, projectName }: { projectId: string; projectName: string }) {
  const selected = useWorkspaceStore((s) => s.workspaces[projectId]?.selectedFile);
  const storedExpanded = useWorkspaceStore((s) => s.workspaces[projectId]?.expandedDirs ?? NO_EXPANDED);
  const dirs = useWorkspaceStore((s) => s.workspaces[projectId]?.dirs ?? NO_DIRS);
  const setSelectedFile = useWorkspaceStore((s) => s.setSelectedFile);
  const setExpandedDirs = useWorkspaceStore((s) => s.setExpandedDirs);
  const loadDir = useWorkspaceStore((s) => s.loadDir);
  const [file, setFile] = useState<FileResult>();
  const [fileAttempt, setFileAttempt] = useState(0);
  const root = dirs[ROOT_DIR];
  const expanded = useMemo(() => new Set(storedExpanded), [storedExpanded]);

  useEffect(() => {
    const current = useWorkspaceStore.getState().workspaces[projectId]?.dirs?.[ROOT_DIR];
    if (!current) void loadDir(projectId, ROOT_DIR);
  }, [projectId, loadDir]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    services.fs.readFile(projectId, selected).then(
      (content) => {
        if (!cancelled) setFile({ path: selected, kind: "ready", file: content });
      },
      (error: unknown) => {
        if (!cancelled) setFile({ path: selected, kind: "error", message: errorMessage(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, selected, fileAttempt]);

  const onToggle = (relPath: string, open: boolean) => {
    const next = new Set(expanded);
    if (open) next.add(relPath);
    else next.delete(relPath);
    setExpandedDirs(projectId, [...next]);
    const state = useWorkspaceStore.getState().workspaces[projectId]?.dirs?.[relPath];
    if (open && (!state || state.status === "error")) void loadDir(projectId, relPath);
  };

  const currentFile = selected && file?.path === selected ? file : undefined;

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-64 shrink-0 overflow-y-auto border-r bg-surface px-1.5 py-2">
        <p className="px-2 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{projectName}</p>
        {!root || (root.status === "loading" && !root.entries) ? (
          <div className="space-y-2 px-2 py-1" role="status">
            <span className="sr-only">Loading files…</span>
            {[60, 80, 50, 70].map((w) => (
              <Skeleton key={w} className="h-4" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : root.status === "error" && !root.entries ? (
          <EmptyState
            icon={FolderX}
            tone="danger"
            title="Could not load files"
            description={root.error}
            className="px-3 py-6"
            action={
              <Button variant="outline" size="sm" onClick={() => void loadDir(projectId, ROOT_DIR)}>
                Retry
              </Button>
            }
          />
        ) : root.entries?.length === 0 ? (
          <EmptyState icon={FolderOpen} title="No files" description="This folder is empty." className="px-3 py-6" />
        ) : (
          <FileTree
            entries={root.entries ?? []}
            dirs={dirs}
            expanded={expanded}
            selected={selected}
            onSelect={(path) => setSelectedFile(projectId, path)}
            onToggle={onToggle}
            onRetry={(path) => void loadDir(projectId, path)}
            label={`${projectName} files`}
          />
        )}
      </aside>
      <section className="flex min-w-0 flex-1 flex-col" aria-label="File preview">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <EmptyState
              icon={FileQuestion}
              title="Select a file"
              description="Choose a file in the tree to preview it. Use the arrow keys to navigate."
            />
          </div>
        ) : (
          <>
            <div className="flex h-9 shrink-0 items-center gap-2 border-b px-4 font-mono text-xs">
              <span className="truncate">{selected}</span>
              <span className="ml-auto flex items-center gap-1 font-sans text-muted-foreground">
                <Lock className="size-3" aria-hidden="true" /> Read-only
              </span>
            </div>
            {!currentFile ? (
              <div className="space-y-2 p-4" role="status">
                <span className="sr-only">Loading file…</span>
                {[70, 45, 85, 60, 30].map((w) => (
                  <Skeleton key={w} className="h-4" style={{ width: `${w}%` }} />
                ))}
              </div>
            ) : currentFile.kind === "error" ? (
              <div className="p-8">
                <EmptyState
                  icon={FileWarning}
                  tone="danger"
                  title="Could not open file"
                  description={currentFile.message}
                  action={
                    <Button variant="outline" size="sm" onClick={() => setFileAttempt((n) => n + 1)}>
                      Retry
                    </Button>
                  }
                />
              </div>
            ) : currentFile.file.binary ? (
              <div className="p-8">
                <EmptyState
                  icon={FileQuestion}
                  title="Binary file"
                  description="This file is not text, so it cannot be previewed."
                />
              </div>
            ) : (
              <>
                {currentFile.file.truncated ? (
                  <p className="flex shrink-0 items-center gap-2 border-b bg-warning/10 px-4 py-1.5 text-xs">
                    <Scissors className="size-3.5 shrink-0" aria-hidden="true" />
                    Large file — only the first 1 MB is shown.
                  </p>
                ) : null}
                <CodeView content={currentFile.file.content} />
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** Text with a line-number gutter. Two text nodes, so even 1 MB files render quickly. */
function CodeView({ content }: { content: string }) {
  const lineCount = useMemo(() => content.replace(/\n$/, "").split("\n").length, [content]);
  const gutter = useMemo(() => Array.from({ length: lineCount }, (_, i) => i + 1).join("\n"), [lineCount]);
  return (
    // Focusable scroll region so the preview can be scrolled with the keyboard.
    <div
      role="region"
      aria-label="File content"
      tabIndex={0}
      className="flex min-h-0 flex-1 overflow-auto bg-surface font-mono text-[13px] leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <pre
        className="sticky left-0 shrink-0 bg-surface py-3 pr-4 pl-3 text-right text-muted-foreground select-none"
        aria-hidden="true"
      >
        {gutter}
      </pre>
      <pre className="py-3 pr-6">
        <code>{content.replace(/\n$/, "")}</code>
      </pre>
    </div>
  );
}
