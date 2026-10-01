import { ChevronDown, ChevronRight, FileCode2, FileText, Folder, FolderOpen } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { FileNode } from "@/features/workspace/fs";
import { cn } from "@/lib/utils";

interface VisibleNode {
  node: FileNode;
  depth: number;
  parent?: string;
  /** 1-based position among its siblings and the sibling count (aria-posinset / aria-setsize). */
  posInSet: number;
  setSize: number;
}

function flatten(nodes: FileNode[], expanded: ReadonlySet<string>, depth = 0, parent?: string): VisibleNode[] {
  return nodes.flatMap((node, index) => [
    { node, depth, parent, posInSet: index + 1, setSize: nodes.length },
    ...(node.kind === "dir" && expanded.has(node.path)
      ? flatten(node.children ?? [], expanded, depth + 1, node.path)
      : []),
  ]);
}

/**
 * Accessible tree (WAI-ARIA tree pattern) with roving focus and arrow-key navigation.
 * Expansion is controlled so it can outlive the component (per-project workspace state).
 */
export function FileTree({
  nodes,
  selected,
  onSelect,
  expanded,
  onExpandedChange,
  label,
}: {
  nodes: FileNode[];
  selected?: string;
  onSelect: (path: string) => void;
  expanded: ReadonlySet<string>;
  onExpandedChange: (expanded: string[]) => void;
  label: string;
}) {
  const [focused, setFocused] = useState<string | undefined>(selected ?? nodes[0]?.path);
  const refs = useRef(new Map<string, HTMLDivElement>());
  const visible = useMemo(() => flatten(nodes, expanded), [nodes, expanded]);

  const focus = (path: string | undefined) => {
    if (!path) return;
    setFocused(path);
    refs.current.get(path)?.focus();
  };

  const toggle = (path: string, open?: boolean) => {
    const next = new Set(expanded);
    if (open ?? !next.has(path)) next.add(path);
    else next.delete(path);
    onExpandedChange([...next]);
  };

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
        const { node, depth, posInSet, setSize } = item;
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
            aria-setsize={setSize}
            aria-posinset={posInSet}
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
            <span className="truncate">{node.name}</span>
          </div>
        );
      })}
    </div>
  );
}
