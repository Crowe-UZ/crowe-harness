import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  LoaderCircle,
} from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { DirEntry } from "@/data/types";
import { cn } from "@/lib/utils";
import type { DirState } from "@/stores/workspaceStore";

type VisibleNode = {
  /** Unique, stable id: the entry's relative path, or `<dir>::status` for a status row. */
  id: string;
  depth: number;
  parent?: string;
  /** 1-based position among its siblings and the sibling count (aria-posinset / aria-setsize). */
  posInSet: number;
  setSize: number;
} & (
  | { kind: "entry"; entry: DirEntry }
  | { kind: "status"; dir: string; text: string; tone: "muted" | "loading" | "error"; retry: boolean }
);

function statusRow(dir: string, depth: number, state: DirState | undefined): VisibleNode | undefined {
  const base = { id: `${dir}::status`, depth, parent: dir, posInSet: 1, setSize: 1, kind: "status" as const, dir };
  if (!state || state.status === "loading") {
    return state?.entries ? undefined : { ...base, text: "Loading…", tone: "loading", retry: false };
  }
  if (state.status === "error") {
    return {
      ...base,
      text: `Could not load this folder: ${state.error}. Press Enter to retry.`,
      tone: "error",
      retry: true,
    };
  }
  return state.entries.length === 0 ? { ...base, text: "Empty folder", tone: "muted", retry: false } : undefined;
}

function flatten(
  entries: DirEntry[],
  dirs: Record<string, DirState | undefined>,
  expanded: ReadonlySet<string>,
  depth = 0,
  parent?: string,
): VisibleNode[] {
  return entries.flatMap((entry, index) => {
    const node: VisibleNode = {
      id: entry.relPath,
      kind: "entry",
      entry,
      depth,
      parent,
      posInSet: index + 1,
      setSize: entries.length,
    };
    if (entry.kind !== "dir" || !expanded.has(entry.relPath)) return [node];
    const state = dirs[entry.relPath];
    const status = statusRow(entry.relPath, depth + 1, state);
    const children = state?.entries ? flatten(state.entries, dirs, expanded, depth + 1, entry.relPath) : [];
    return [node, ...(status && children.length === 0 ? [status] : []), ...children];
  });
}

/**
 * Accessible, lazily loaded tree (WAI-ARIA tree pattern) with roving focus and
 * arrow-key navigation. Expansion and listings are controlled by the parent.
 */
export function FileTree({
  entries,
  dirs,
  expanded,
  selected,
  onSelect,
  onToggle,
  onRetry,
  label,
}: {
  entries: DirEntry[];
  dirs: Record<string, DirState | undefined>;
  expanded: ReadonlySet<string>;
  selected?: string;
  onSelect: (relPath: string) => void;
  onToggle: (relPath: string, open: boolean) => void;
  onRetry: (relPath: string) => void;
  label: string;
}) {
  const visible = useMemo(() => flatten(entries, dirs, expanded), [entries, dirs, expanded]);
  const [focused, setFocused] = useState<string | undefined>(selected);
  const refs = useRef(new Map<string, HTMLDivElement>());
  const focusedId = visible.some((n) => n.id === focused) ? focused : visible[0]?.id;

  const focus = (id: string | undefined) => {
    if (!id) return;
    setFocused(id);
    refs.current.get(id)?.focus();
  };

  const activate = (node: VisibleNode) => {
    if (node.kind === "status") {
      if (node.retry) onRetry(node.dir);
    } else if (node.entry.kind === "dir") {
      onToggle(node.entry.relPath, !expanded.has(node.entry.relPath));
    } else {
      onSelect(node.entry.relPath);
    }
  };

  function onKeyDown(event: KeyboardEvent, node: VisibleNode, index: number) {
    const isDir = node.kind === "entry" && node.entry.kind === "dir";
    const isOpen = isDir && expanded.has(node.id);
    switch (event.key) {
      case "ArrowDown":
        focus(visible[index + 1]?.id);
        break;
      case "ArrowUp":
        focus(visible[index - 1]?.id);
        break;
      case "Home":
        focus(visible[0]?.id);
        break;
      case "End":
        focus(visible.at(-1)?.id);
        break;
      case "ArrowRight":
        if (isDir) {
          if (!isOpen) onToggle(node.id, true);
          else focus(visible[index + 1]?.id);
        }
        break;
      case "ArrowLeft":
        if (isOpen) onToggle(node.id, false);
        else focus(node.parent);
        break;
      case "Enter":
      case " ":
        activate(node);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  return (
    <div role="tree" aria-label={label} className="py-1 text-sm">
      {visible.map((node, index) => {
        const common = {
          ref: (el: HTMLDivElement | null) => {
            if (el) refs.current.set(node.id, el);
            else refs.current.delete(node.id);
          },
          role: "treeitem",
          "aria-level": node.depth + 1,
          "aria-setsize": node.setSize,
          "aria-posinset": node.posInSet,
          tabIndex: node.id === focusedId ? 0 : -1,
          onClick: () => {
            setFocused(node.id);
            activate(node);
          },
          onKeyDown: (e: KeyboardEvent) => onKeyDown(e, node, index),
          style: { paddingLeft: `${node.depth * 14 + 8}px` },
        };

        if (node.kind === "status") {
          return (
            <div
              key={node.id}
              {...common}
              aria-disabled={node.retry ? undefined : true}
              className={cn(
                "flex cursor-default items-center gap-1.5 rounded-md py-1 pr-2 text-xs outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                node.tone === "error" ? "text-destructive hover:bg-muted" : "text-muted-foreground",
              )}
            >
              <span className="w-3.5" aria-hidden="true" />
              {node.tone === "loading" ? (
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
              ) : node.tone === "error" ? (
                <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
              ) : null}
              <span className="min-w-0 break-words">{node.text}</span>
            </div>
          );
        }

        const { entry } = node;
        const isDir = entry.kind === "dir";
        const isOpen = isDir && expanded.has(entry.relPath);
        const isSelected = entry.relPath === selected;
        const Icon = isDir ? (isOpen ? FolderOpen : Folder) : /\.(md|txt)$/i.test(entry.name) ? FileText : FileCode2;
        return (
          <div
            key={node.id}
            {...common}
            aria-expanded={isDir ? isOpen : undefined}
            aria-selected={isDir ? undefined : isSelected}
            aria-busy={isOpen && dirs[entry.relPath]?.status === "loading" ? true : undefined}
            className={cn(
              "relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-2 outline-none select-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              // Selection is not conveyed by color alone: a primary bar on the left edge plus medium weight.
              isSelected &&
                "bg-accent font-medium text-accent-foreground before:absolute before:inset-y-1 before:left-0.5 before:w-1 before:rounded-full before:bg-primary hover:bg-accent",
            )}
          >
            {isDir ? (
              isOpen ? (
                <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
              ) : (
                <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
              )
            ) : (
              <span className="w-3.5" aria-hidden="true" />
            )}
            <Icon
              className={cn("size-4 shrink-0", isDir ? "text-primary" : "text-muted-foreground")}
              aria-hidden="true"
            />
            <span className="truncate">{entry.name}</span>
          </div>
        );
      })}
    </div>
  );
}
