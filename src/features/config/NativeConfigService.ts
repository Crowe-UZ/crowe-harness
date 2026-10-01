import type { NativeClient } from "@/features/native/client";
import type { ConfigService } from "./config";

export class NativeConfigService implements ConfigService {
  constructor(private readonly client: NativeClient) {}

  listAgents(projectId: string | null) {
    return this.client.agentsList(projectId);
  }

  listSkills(projectId: string | null) {
    return this.client.skillsList(projectId);
  }

  listMcpServers() {
    return this.client.mcpList();
  }
}
