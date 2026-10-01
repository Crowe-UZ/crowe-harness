import { describe, expect, it } from "vitest";
import { describeAuthStatus } from "./auth";
import { MockAuthService } from "./MockAuthService";

describe("MockAuthService", () => {
  it("starts signed out by default", async () => {
    await expect(new MockAuthService(undefined, 0).getStatus()).resolves.toEqual({ state: "signed_out" });
  });

  it("reports the initial status it was created with", async () => {
    const service = new MockAuthService({ state: "signed_in", method: "claude.ai", subscriptionType: "max" }, 0);
    await expect(service.getStatus()).resolves.toMatchObject({ state: "signed_in", subscriptionType: "max" });
  });

  it("rejects sign-in because it is not available yet", async () => {
    await expect(new MockAuthService(undefined, 0).startLogin()).rejects.toThrow(/future update/);
  });

  it("signs out", async () => {
    const service = new MockAuthService({ state: "signed_in", method: "console" }, 0);
    await service.logout();
    await expect(service.getStatus()).resolves.toEqual({ state: "signed_out" });
  });

  it("lets the debug panel preview any status", async () => {
    const service = new MockAuthService(undefined, 0);
    service.debugSetStatus({ state: "cli_not_found" });
    await expect(service.getStatus()).resolves.toEqual({ state: "cli_not_found" });
  });
});

describe("describeAuthStatus", () => {
  it.each([
    [undefined, "Checking…"],
    [{ state: "cli_not_found" } as const, "Claude Code not found"],
    [{ state: "signed_out" } as const, "Not signed in"],
    [{ state: "signed_in", method: "claude.ai" } as const, "Signed in"],
    [{ state: "signed_in", method: "claude.ai", subscriptionType: "pro" } as const, "Signed in · Pro"],
  ])("describes %j as %s", (status, expected) => {
    expect(describeAuthStatus(status)).toBe(expected);
  });
});
