import { createContext } from "react";

/** Resolves a Task/Agent tool_use id to the route of its agent chat (when the subagent is known). */
export const AgentLinkContext = createContext<(toolUseId: string) => string | undefined>(() => undefined);
