import { toNativeError, type NativeClient } from "@/features/native/client";
import type { InstallChannel, InstallEvent, InstallPlan } from "@/features/native/contract";
import { AsyncQueue } from "@/lib/async-queue";
import { isTerminalInstallEvent, type ClaudeInstallerService, type InstallRun } from "./installer";

/** Installs Claude Code through the Rust core (`claude_install_plan|start|cancel`). */
export class ClaudeCodeInstallerService implements ClaudeInstallerService {
  constructor(private readonly client: NativeClient) {}

  plan(channel: InstallChannel): Promise<InstallPlan> {
    return this.client.claudeInstallPlan(channel);
  }

  start(channel: InstallChannel): InstallRun {
    const queue = new AsyncQueue<InstallEvent>();
    const onEvent = (event: InstallEvent) => {
      if (queue.isClosed) return; // nothing follows the terminal event
      queue.push(event);
      if (isTerminalInstallEvent(event)) queue.close();
    };

    // Channel events may arrive before `invoke` resolves; the queue buffers them.
    const started: Promise<string | undefined> = this.client.claudeInstallStart(channel, onEvent).then(
      (installId) => installId,
      (error: unknown) => {
        // Could not start (busy, not in the desktop app, …): report it like any other install error.
        const { code, message } = toNativeError(error);
        onEvent({ type: "error", code, message });
        return undefined;
      },
    );

    return {
      events: queue,
      cancel: async () => {
        const installId = await started;
        if (installId === undefined || queue.isClosed) return;
        await this.client.claudeInstallCancel(installId);
      },
    };
  }
}
