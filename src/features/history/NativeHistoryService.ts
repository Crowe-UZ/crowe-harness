import type { NativeClient } from "@/features/native/client";
import type { HistoryService } from "./history";

export class NativeHistoryService implements HistoryService {
  constructor(private readonly client: NativeClient) {}

  listProjects() {
    return this.client.projectsList();
  }

  openFolder() {
    return this.client.projectsOpenFolder();
  }

  listSessions(projectId: string) {
    return this.client.sessionsList(projectId);
  }

  readSession(projectId: string, sessionId: string) {
    return this.client.sessionRead(projectId, sessionId);
  }

  readSubagent(projectId: string, sessionId: string, agentId: string) {
    return this.client.subagentRead(projectId, sessionId, agentId);
  }
}
