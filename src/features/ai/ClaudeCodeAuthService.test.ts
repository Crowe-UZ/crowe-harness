import { describe, expect, it } from "vitest";
import { FakeNativeClient, fixtures } from "@/test/fakes";
import { describeAuthStatus, describeCheck, hasAccess } from "./auth";
import { ClaudeCodeAuthService, toAuthStatus } from "./ClaudeCodeAuthService";

describe("toAuthStatus", () => {
  it("maps a missing install to cli_not_found", () => {
    expect(toAuthStatus(fixtures.notInstalledStatus())).toEqual({ state: "cli_not_found" });
  });

  it("maps a signed-out install", () => {
    expect(toAuthStatus(fixtures.signedOutStatus())).toEqual({ state: "signed_out", install: fixtures.INSTALL });
  });

  it("maps a subscription sign-in with account details", () => {
    const status = toAuthStatus(fixtures.subscriptionStatus());
    expect(status).toEqual({
      state: "signed_in",
      install: fixtures.INSTALL,
      subscription: true,
      method: "claude.ai",
      email: "dev@example.com",
      orgName: "Example Org",
      subscriptionType: "max",
    });
    expect(hasAccess(status)).toBe(true);
    expect(describeAuthStatus(status)).toBe("Signed in · Max");
  });

  it("does not grant access to a Console / API key sign-in", () => {
    const status = toAuthStatus(fixtures.apiKeyStatus());
    expect(status).toMatchObject({ state: "signed_in", subscription: false });
    expect(hasAccess(status)).toBe(false);
    expect(describeAuthStatus(status)).toBe("No Claude subscription");
  });
});

describe("ClaudeCodeAuthService", () => {
  it("reports unavailable outside the desktop runtime without calling Rust", async () => {
    const client = new FakeNativeClient();
    const service = new ClaudeCodeAuthService(client, () => false);

    expect(await service.getStatus()).toEqual({ state: "unavailable" });
    expect(client.claudeStatus).not.toHaveBeenCalled();
  });

  it("delegates sign-in and sign-out to Claude Code", async () => {
    const client = new FakeNativeClient();
    const service = new ClaudeCodeAuthService(client, () => true);

    await service.startLogin();
    await service.logout();

    expect(client.claudeAuthLogin).toHaveBeenCalledTimes(1);
    expect(client.claudeAuthLogout).toHaveBeenCalledTimes(1);
    expect(await service.getStatus()).toMatchObject({ state: "signed_out" });
  });
});

describe("ClaudeCodeAuthService — locating Claude Code", () => {
  it("forces re-discovery only when asked", async () => {
    const client = new FakeNativeClient();
    const service = new ClaudeCodeAuthService(client, () => true);

    await service.getStatus();
    expect(client.claudeStatus).toHaveBeenLastCalledWith({ forceRefresh: false });
    await service.getStatus({ force: true });
    expect(client.claudeStatus).toHaveBeenLastCalledWith({ forceRefresh: true });
  });

  it("maps a picked executable to the auth status, and a cancelled picker to null", async () => {
    const client = new FakeNativeClient();
    const service = new ClaudeCodeAuthService(client, () => true);

    expect(await service.pickExecutable()).toBeNull();

    client.pickedExecutable = { ...fixtures.CUSTOM_INSTALL };
    expect(await service.pickExecutable()).toMatchObject({
      state: "signed_in",
      install: fixtures.CUSTOM_INSTALL,
    });
  });

  it("rejects an invalid executable with its reason", async () => {
    const client = new FakeNativeClient();
    client.fail("claudePickExecutable", "not a working Claude Code (timeout)", "invalid_executable");
    const service = new ClaudeCodeAuthService(client, () => true);

    await expect(service.pickExecutable()).rejects.toMatchObject({
      code: "invalid_executable",
      message: "not a working Claude Code (timeout)",
    });
  });

  it("returns to automatic detection and lists what was checked", async () => {
    const client = new FakeNativeClient();
    client.status = fixtures.subscriptionStatus({ install: { ...fixtures.CUSTOM_INSTALL } });
    const service = new ClaudeCodeAuthService(client, () => true);

    expect(await service.clearExecutable()).toMatchObject({ install: fixtures.INSTALL });
    client.detectedInstall = null;
    expect(await service.clearExecutable()).toEqual({ state: "cli_not_found" });
    expect(await service.locateReport()).toEqual(fixtures.locateReport());
  });

  it("describes checked locations", () => {
    const check = (result: "ok" | "missing" | "rejected", reason?: string) =>
      describeCheck({ path: "x", source: "path", result, reason });
    expect(check("ok")).toBe("Works");
    expect(check("missing")).toBe("Not found");
    expect(check("missing", "summarized")).toBe("Not found (summarized)");
    expect(check("rejected", "not_executable")).toBe("Not a program that can be run");
    expect(check("rejected", "spawn_failed")).toBe("Could not be started");
    expect(check("rejected", "future_code")).toBe("Rejected (future_code)");
    expect(check("rejected")).toBe("Rejected");
  });
});
