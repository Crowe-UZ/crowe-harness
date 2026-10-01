import type { ConfigService } from "@/features/config/config";
import { NativeConfigService } from "@/features/config/NativeConfigService";
import type { HistoryService } from "@/features/history/history";
import { NativeHistoryService } from "@/features/history/NativeHistoryService";
import { isDesktopRuntime, tauriClient } from "@/features/native/client";
import type { FsService } from "@/features/workspace/fs";
import { NativeFsService } from "@/features/workspace/NativeFsService";
import type { AuthService } from "./auth";
import { ClaudeCodeAuthService } from "./ClaudeCodeAuthService";
import { ClaudeCodeProvider } from "./ClaudeCodeProvider";
import type { AIProvider } from "./types";

export interface Services {
  ai: AIProvider;
  auth: AuthService;
  history: HistoryService;
  fs: FsService;
  config: ConfigService;
}

/**
 * Single composition point for runtime services. The UI imports `services`
 * and only ever sees the interfaces; every implementation talks to the Rust
 * core through the typed native client. Tests replace the members with
 * implementations backed by an in-memory fake client (src/test/fakes).
 */
export const services: Services = {
  ai: new ClaudeCodeProvider(tauriClient),
  auth: new ClaudeCodeAuthService(tauriClient, isDesktopRuntime),
  history: new NativeHistoryService(tauriClient),
  fs: new NativeFsService(tauriClient),
  config: new NativeConfigService(tauriClient),
};
