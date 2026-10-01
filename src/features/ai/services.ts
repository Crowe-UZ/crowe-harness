import type { AuthService } from "./auth";
import { MockAIProvider } from "./MockAIProvider";
import { MockAuthService } from "./MockAuthService";
import type { AIProvider } from "./types";

export interface Services {
  ai: AIProvider;
  auth: AuthService;
}

/**
 * Single composition point for runtime services. The UI imports `services`
 * and never a concrete implementation, so switching to the Claude Code
 * adapter (M2/M3) only changes this file.
 */
export const services: Services = {
  ai: new MockAIProvider(),
  auth: new MockAuthService(),
};
