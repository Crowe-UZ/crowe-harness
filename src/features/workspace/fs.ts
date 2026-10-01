import type { DirEntry, FileContent } from "@/data/types";

/** Relative path of the project root. */
export const ROOT_DIR = "";

/**
 * Read-only access to the files of a registered project. Rust resolves the
 * project id to its folder and rejects paths outside it.
 */
export interface FsService {
  /** Direct children of `relPath` ("" = project root), directories first, `.gitignore`-aware. */
  listDir(projectId: string, relPath: string): Promise<DirEntry[]>;
  /** File content (at most 1 MB; `truncated`/`binary` describe what was returned). */
  readFile(projectId: string, relPath: string): Promise<FileContent>;
}
