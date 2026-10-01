import { ChevronDown, ChevronRight, FileCode2, FileText, Folder, FolderOpen } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { FileNode } from "@/features/workspace/mockFs";
import { cn } from "@/lib/utils";

interface VisibleNode {
  node: FileNode;
  depth: number;
  parent?: string;
}

function flatten(nodes: FileNode[], expanded: Set<string>, depth = 0, parent?: string): VisibleNode[] {
  return nodes.flatMap((node) => [
    { node, depth, parent },
    ...(node.kind === "dir" && expanded.has(node.path) ? flatten(node.children ?? [], expanded, depth + 1, node.path) : []),
  ]);
}

function allDirs(nodes: FileNode[]): string[] {
  return nodes.flatMap((n) => (n.kind === "dir" ? [n.path, ...allDirs(n.children ?? [])] : []));
}

/** Accessible tree (WAI-ARIA tree pattern) with roving focus and arrow-key navigation. */
export function FileTree({
  nodes,
  selected,
  onSelect,
  label,
}: {
  nodes: FileNode[];
  selected?: string;
  onSelect: (path: string) => void;
  label: string;
}) {
  const [expanded, setExpanded] = useState(() => new Set(allDirs(nodes)));
  const [focused, setFocused] = useState<string | undefined>(selected ?? nodes[0]?.path);
  const refs = useRef(new Map<string, HTMLDivElement>());
  const visible = useMemo(() => flatten(nodes, expanded), [nodes, expanded]);

  const focus = (path: string | undefined) => {
    if (!path) return;
    setFocused(path);
    refs.current.get(path)?.focus();
  };

  const toggle = (path: string, open?: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      const shouldOpen = open ?? !next.has(path);
      if (shouldOpen) next.add(path);
      else next.delete(path);
      return next;
    });

  const activate = (node: FileNode) => (node.kind === "dir" ? toggle(node.path) : onSelect(node.path));

  function onKeyDown(event: KeyboardEvent, item: VisibleNode, index: number) {
    const { node } = item;
    switch (event.key) {
      case "ArrowDown":
        focus(visible[index + 1]?.node.path);
        break;
      case "ArrowUp":
        focus(visible[index - 1]?.node.path);
        break;
      case "Home":
        focus(visible[0]?.node.path);
        break;
      case "End":
        focus(visible.at(-1)?.node.path);
        break;
      case "ArrowRight":
        if (node.kind === "dir") {
          if (!expanded.has(node.path)) toggle(node.path, true);
          else focus(visible[index + 1]?.node.path);
        }
        break;
      case "ArrowLeft":
        if (node.kind === "dir" && expanded.has(node.path)) toggle(node.path, false);
        else focus(item.parent);
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
      {visible.map((item, index) => {
        const { node, depth } = item;
        const isDir = node.kind === "dir";
        const isOpen = isDir && expanded.has(node.path);
        const isSelected = node.path === selected;
        const Icon = isDir ? (isOpen ? FolderOpen : Folder) : node.name.endsWith(".md") ? FileText : FileCode2;
        return (
          <div
            key={node.path}
            ref={(el) => {
              if (el) refs.current.set(node.path, el);
              else refs.current.delete(node.path);
            }}
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={isDir ? isOpen : undefined}
            aria-selected={isDir ? undefined : isSelected}
            tabIndex={node.path === (focused ?? visible[0]?.node.path) ? 0 : -1}
            onClick={() => {
              setFocused(node.path);
              activate(node);
            }}
            onKeyDown={(e) => onKeyDown(e, item, index)}
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
            className={cn(
              "flex cursor-default items-center gap-1.5 rounded-md py-1 pr-2 outline-none select-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset",
              isSelected && "bg-accent text-accent-foreground hover:bg-accent",
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
            <Icon className={cn("size-4 shrink-0", isDir ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
            <span className="truncate">{node.name}</span>
          </div>
        );
      })}
    </div>
  );
}
