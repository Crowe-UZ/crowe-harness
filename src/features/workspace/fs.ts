/**
 * Project file access contract. Implementations: MockFsService (now),
 * a Tauri-backed service with path guards in Rust (M5).
 */

export interface FileNode {
  /** Path relative to the project root, using "/" separators. */
  path: string;
  name: string;
  kind: "file" | "dir";
  children?: FileNode[];
}

/** Paths of every directory in the tree, depth-first. */
export function collectDirs(nodes: FileNode[]): string[] {
  return nodes.flatMap((n) => (n.kind === "dir" ? [n.path, ...collectDirs(n.children ?? [])] : []));
}

export interface FsService {
  readonly id: "mock" | "tauri";
  /** File tree of a registered project. */
  tree(projectPath: string): Promise<FileNode[]>;
  /** Text content of a file, `relPath` relative to the project root. */
  read(projectPath: string, relPath: string): Promise<string>;
}
