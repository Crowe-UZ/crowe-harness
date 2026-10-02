import { describe, expect, it } from "vitest";
import type { InstallEvent } from "@/features/native/contract";
import { FakeNativeClient, fixtures } from "@/test/fakes";
import { ClaudeCodeInstallerService } from "./ClaudeCodeInstallerService";

async function collect(events: AsyncIterable<InstallEvent>): Promise<InstallEvent[]> {
  const all: InstallEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
}

describe("ClaudeCodeInstallerService", () => {
  it("returns the plan of the requested channel", async () => {
    const client = new FakeNativeClient();
    const service = new ClaudeCodeInstallerService(client);

    expect(await service.plan("latest")).toEqual(fixtures.installPlan("latest"));
    expect(client.claudeInstallPlan).toHaveBeenCalledWith("latest");
  });

  it("streams install events and ends after the terminal event", async () => {
    const client = new FakeNativeClient();
    const service = new ClaudeCodeInstallerService(client);
    const run = service.start("stable");
    const events = collect(run.events);

    await expect.poll(() => client.installs.length).toBe(1);
    const install = client.installs[0];
    expect(install?.channel).toBe("stable");
    install?.phase("downloading");
    install?.progress(10, 100);
    install?.done();

    expect(await events).toEqual([
      { type: "phase", phase: "downloading" },
      { type: "progress", receivedBytes: 10, totalBytes: 100 },
      { type: "done", install: fixtures.INSTALL },
    ]);
  });

  it("reports a failure to start as an error event", async () => {
    const client = new FakeNativeClient();
    client.fail("claudeInstallStart", "An install is already running", "busy");
    const run = new ClaudeCodeInstallerService(client).start("stable");

    expect(await collect(run.events)).toEqual([
      { type: "error", code: "busy", message: "An install is already running" },
    ]);
    await run.cancel(); // nothing to cancel
    expect(client.claudeInstallCancel).not.toHaveBeenCalled();
  });

  it("cancels by install id, waiting for the id if needed", async () => {
    const client = new FakeNativeClient();
    const run = new ClaudeCodeInstallerService(client).start("latest");
    const events = collect(run.events);

    await run.cancel();

    expect(client.claudeInstallCancel).toHaveBeenCalledWith("install-1");
    expect(await events).toEqual([{ type: "cancelled" }]);
  });

  it("does not cancel an install that already finished", async () => {
    const client = new FakeNativeClient();
    const run = new ClaudeCodeInstallerService(client).start("stable");
    const events = collect(run.events);
    await expect.poll(() => client.installs.length).toBe(1);
    client.installs[0]?.fail("network", "offline");
    await events;

    await run.cancel();

    expect(client.claudeInstallCancel).not.toHaveBeenCalled();
  });
});
