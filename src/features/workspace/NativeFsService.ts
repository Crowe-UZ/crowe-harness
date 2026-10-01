import type { NativeClient } from "@/features/native/client";
import type { FsService } from "./fs";

export class NativeFsService implements FsService {
  constructor(private readonly client: NativeClient) {}

  listDir(projectId: string, relPath: string) {
    return this.client.fsListDir(projectId, relPath);
  }

  readFile(projectId: string, relPath: string) {
    return this.client.fsReadFile(projectId, relPath);
  }
}
