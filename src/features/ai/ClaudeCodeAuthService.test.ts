import { describe, expect, it } from "vitest";
import { FakeNativeClient, fixtures } from "@/test/fakes";
import { describeAuthStatus, hasAccess } from "./auth";
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
