import { FileQuestion, FileWarning, FolderX, Lock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { services } from "@/features/ai/services";
import { collectDirs, type FileNode } from "@/features/workspace/fs";
import { errorMessage } from "@/lib/errors";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { FileTree } from "./FileTree";

type TreeResult = { attempt: number } & ({ kind: "ready"; nodes: FileNode[] } | { kind: "error"; message: string });
type FileResult = { path: string } & ({ kind: "ready"; content: string } | { kind: "error"; message: string });

const NO_NODES: FileNode[] = [];

/** Read-only project browser. Selection and expanded folders live in the per-project workspace store. */
export function FilesView({ projectId, projectName, projectPath }: { projectId: string; projectName: string; projectPath: string }) {
  const selected = useWorkspaceStore((s) => s.workspaces[projectId]?.selectedFile);
  const storedExpanded = useWorkspaceStore((s) => s.workspaces[projectId]?.expandedDirs);
  const setSelectedFile = useWorkspaceStore((s) => s.setSelectedFile);
  const setExpandedDirs = useWorkspaceStore((s) => s.setExpandedDirs);
  const [attempt, setAttempt] = useState(0);
  const [tree, setTree] = useState<TreeResult>();
  const [file, setFile] = useState<FileResult>();

  useEffect(() => {
    let cancelled = false;
    services.fs.tree(projectPath).then(
      (nodes) => {
        if (!cancelled) setTree({ attempt, kind: "ready", nodes });
      },
      (error: unknown) => {
        if (!cancelled) setTree({ attempt, kind: "error", message: errorMessage(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectPath, attempt]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    services.fs.read(projectPath, selected).then(
      (content) => {
        if (!cancelled) setFile({ path: selected, kind: "ready", content });
      },
      (error: unknown) => {
        if (!cancelled) setFile({ path: selected, kind: "error", message: errorMessage(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectPath, selected]);

  const currentTree = tree?.attempt === attempt ? tree : undefined;
  const nodes = currentTree?.kind === "ready" ? currentTree.nodes : NO_NODES;
  const expanded = useMemo(() => new Set(storedExpanded ?? collectDirs(nodes)), [storedExpanded, nodes]);
  const currentFile = selected && file?.path === selected ? file : undefined;

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-64 shrink-0 overflow-y-auto border-r bg-surface px-1.5 py-2">
        <p className="px-2 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{projectName}</p>
        {!currentTree ? (
          <div className="space-y-2 px-2 py-1" role="status">
            <span className="sr-only">Loading files…</span>
            {[60, 80, 50, 70].map((w) => (
              <Skeleton key={w} className="h-4" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : currentTree.kind === "error" ? (
          <EmptyState
            icon={FolderX}
            tone="danger"
            title="Could not load files"
            description={currentTree.message}
            className="px-3 py-6"
            action={
              <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
                Retry
              </Button>
            }
          />
        ) : (
          <FileTree
            nodes={nodes}
            selected={selected}
            onSelect={(path) => setSelectedFile(projectId, path)}
            expanded={expanded}
            onExpandedChange={(dirs) => setExpandedDirs(projectId, dirs)}
            label={`${projectName} files`}
          />
        )}
      </aside>
      <section className="flex min-w-0 flex-1 flex-col" aria-label="File preview">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <EmptyState icon={FileQuestion} title="Select a file" description="Choose a file in the tree to preview it. Use the arrow keys to navigate." />
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
                <EmptyState icon={FileWarning} tone="danger" title="Could not open file" description={currentFile.message} />
              </div>
            ) : (
              <CodeView content={currentFile.content} />
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
              <span className="w-12 shrink-0 pr-4 text-right text-muted-foreground select-none" aria-hidden="true">
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
