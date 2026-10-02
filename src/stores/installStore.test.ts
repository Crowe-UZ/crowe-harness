import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeNative, fixtures, successfulInstallScript, waitForInstall } from "@/test/fakes";
import { useAuthStore } from "./authStore";
import { installTiming, useInstallStore } from "./installStore";

const store = () => useInstallStore.getState();

describe("useInstallStore — plan", () => {
  it("opens the consent step and loads the plan of the selected channel", async () => {
    store().openConsent();
    expect(store().install).toEqual({ step: "confirming" });
    expect(store().plan).toEqual({ status: "loading" });

    await waitFor(() => expect(store().plan).toEqual({ status: "ready", plan: fixtures.installPlan("stable") }));
    expect(fakeNative().claudeInstallPlan).toHaveBeenCalledWith("stable");
  });

  it("reloads the plan when the channel changes and ignores stale answers", async () => {
    const fake = fakeNative();
    let release: (() => void) | undefined;
    fake.claudeInstallPlan.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(fixtures.installPlan("stable"));
        }),
    );
    store().openConsent();
    store().setChannel("latest");
    await waitFor(() => expect(store().plan).toMatchObject({ status: "ready", plan: { channel: "latest" } }));

    release?.();
    await Promise.resolve();
    expect(store().plan).toMatchObject({ status: "ready", plan: { channel: "latest" } });
  });

  it("keeps the error code of a failed plan and can retry", async () => {
    fakeNative().fail("claudeInstallPlan", "connection refused", "network");
    store().openConsent();
    await waitFor(() =>
      expect(store().plan).toEqual({ status: "error", code: "network", message: "connection refused" }),
    );

    fakeNative().recover("claudeInstallPlan");
    await store().loadPlan();
    expect(store().plan).toMatchObject({ status: "ready" });
  });

  it("closes the consent step", () => {
    store().openConsent();
    store().closeConsent();
    expect(store().install).toEqual({ step: "idle" });
  });
});

describe("useInstallStore — install", () => {
  it("tracks phases and progress, then re-checks the sign-in status", async () => {
    fakeNative().status = fixtures.notInstalledStatus();
    await useAuthStore.getState().refresh();
    store().openConsent();
    await waitFor(() => expect(store().plan.status).toBe("ready"));

    const done = store().start();
    expect(store().install).toMatchObject({
      step: "running",
      channel: "stable",
      phase: "resolving",
      receivedBytes: 0,
      totalBytes: fixtures.installPlan("stable").sizeBytes,
      cancelling: false,
    });
    const install = await waitForInstall();

    install.phase("downloading");
    install.progress(25, 100);
    await waitFor(() =>
      expect(store().install).toMatchObject({ phase: "downloading", receivedBytes: 25, totalBytes: 100 }),
    );

    install.done();
    await done;

    // Claude Code is now found (signed out): the flow resets and the gate shows sign-in.
    expect(useAuthStore.getState().status).toMatchObject({ state: "signed_out" });
    expect(store().install).toEqual({ step: "idle" });
  });

  it("estimates speed from the clock", async () => {
    let now = 0;
    installTiming.now = () => now;
    const done = store().start();
    const install = await waitForInstall();

    install.progress(0, 10_000_000);
    // Events are read asynchronously: advance the clock only after the first sample was taken.
    await waitFor(() => expect(store().install).toMatchObject({ totalBytes: 10_000_000 }));
    now = 1000;
    install.progress(2_000_000, 10_000_000);
    await waitFor(() => expect(store().install).toMatchObject({ bytesPerSecond: 2_000_000, secondsLeft: 4 }));

    install.fail("network", "offline");
    await done;
  });

  it("stays on the success step when Claude Code is still not found afterwards", async () => {
    fakeNative().status = fixtures.notInstalledStatus();
    const done = store().start();
    const install = await waitForInstall();
    install.emit({ type: "done", install: { ...fixtures.INSTALL } });
    fakeNative().status = fixtures.notInstalledStatus(); // detection does not see it yet
    await done;

    expect(store().install).toEqual({ step: "done", install: fixtures.INSTALL, rechecked: true });
  });

  it("runs one install at a time", async () => {
    const first = store().start();
    await waitForInstall();
    await store().start();

    expect(fakeNative().claudeInstallStart).toHaveBeenCalledTimes(1);
    fakeNative().lastInstall?.fail("network");
    await first;
  });

  it("cancels the running install", async () => {
    const done = store().start();
    await waitForInstall();

    await store().cancel();
    await done;

    expect(fakeNative().claudeInstallCancel).toHaveBeenCalledWith("install-1");
    expect(store().install).toEqual({ step: "cancelled" });
  });

  it("shows cancelling until the installer confirms, and recovers if cancel fails", async () => {
    fakeNative().fail("claudeInstallCancel", "cannot stop");
    const done = store().start();
    await waitForInstall();

    const cancelling = store().cancel();
    expect(store().install).toMatchObject({ step: "running", cancelling: true });
    await cancelling;
    expect(store().install).toMatchObject({ step: "running", cancelling: false });

    fakeNative().lastInstall?.fail("network");
    await done;
  });

  it("records errors and retries", async () => {
    const first = store().start();
    (await waitForInstall()).fail("checksum_mismatch", "sha256 mismatch");
    await first;
    expect(store().install).toEqual({ step: "error", code: "checksum_mismatch", message: "sha256 mismatch" });

    fakeNative().installScript = successfulInstallScript();
    await store().retry();

    expect(fakeNative().claudeInstallStart).toHaveBeenCalledTimes(2);
    expect(store().install).toEqual({ step: "idle" });
  });

  it("reports an install that could not start", async () => {
    fakeNative().fail("claudeInstallStart", "Another install is running", "busy");
    await store().start();
    expect(store().install).toEqual({ step: "error", code: "busy", message: "Another install is running" });
  });

  it("dismiss leaves a running install alone", async () => {
    const done = store().start();
    await waitForInstall();
    store().dismiss();
    expect(store().install.step).toBe("running");

    fakeNative().lastInstall?.fail("network");
    await done;
    store().dismiss();
    expect(store().install).toEqual({ step: "idle" });
  });
});
