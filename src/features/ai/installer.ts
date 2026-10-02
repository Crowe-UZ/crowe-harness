/**
 * In-app installation of Claude Code (docs/NATIVE_API.md, "Installing Claude Code").
 * The Rust core downloads the official release from downloads.claude.ai, verifies the
 * signed manifest, the SHA-256 checksum and the publisher signature, then runs the
 * official `claude install`. The UI only sees plans and progress events.
 */

import type { InstallChannel, InstallEvent, InstallPlan } from "@/features/native/contract";

export type { InstallChannel, InstallEvent, InstallPhase, InstallPlan } from "@/features/native/contract";

/** The events that end an install: exactly one of them is the last event. */
export type TerminalInstallEvent = Extract<InstallEvent, { type: "done" | "error" | "cancelled" }>;

export function isTerminalInstallEvent(event: InstallEvent): event is TerminalInstallEvent {
  return event.type === "done" || event.type === "error" || event.type === "cancelled";
}

/** One running install. */
export interface InstallRun {
  /** Every event in order; the iteration ends after the terminal event (`done`, `error` or `cancelled`). */
  readonly events: AsyncIterable<InstallEvent>;
  /** Asks the installer to stop; the run then ends with `cancelled` (or with `done`/`error` if it finished first). */
  cancel(): Promise<void>;
}

export interface ClaudeInstallerService {
  /** What would be installed from `channel` (version, size, location) — or that Claude Code is already installed. */
  plan(channel: InstallChannel): Promise<InstallPlan>;
  /**
   * Starts installing from `channel`. Never throws: a failure to start is reported as an
   * `error` event, so consumers only have to read `events`.
   */
  start(channel: InstallChannel): InstallRun;
}
