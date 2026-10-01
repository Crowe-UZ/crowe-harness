import { isOneOf, isRecord, isString, isStringArray } from "@/lib/guards";
import { MCP_TRANSPORTS, PROJECT_LANGUAGES, type Agent, type McpServer, type Project, type Session } from "./types";

/** Guards for records read back from persisted storage. Malformed records are dropped, not repaired. */

export function isProject(value: unknown): value is Project {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isString(value.path) &&
    isOneOf(PROJECT_LANGUAGES, value.language) &&
    isString(value.branch) &&
    isString(value.lastOpened)
  );
}

export function isSession(value: unknown): value is Session {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.projectId) &&
    isString(value.title) &&
    isString(value.createdAt) &&
    isString(value.updatedAt) &&
    (value.runtimeSessionId === undefined || isString(value.runtimeSessionId))
  );
}

export function isAgent(value: unknown): value is Agent {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isString(value.description) &&
    isStringArray(value.tools) &&
    typeof value.builtIn === "boolean"
  );
}

export function isMcpServer(value: unknown): value is McpServer {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isString(value.description) &&
    isOneOf(MCP_TRANSPORTS, value.transport) &&
    isString(value.target) &&
    value.status === "not_connected"
  );
}
