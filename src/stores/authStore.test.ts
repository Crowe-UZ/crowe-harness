import { describe, expect, it, vi } from "vitest";
import type { AuthService, AuthStatus } from "@/features/ai/auth";
import { MockAuthService } from "@/features/ai/MockAuthService";
import { services } from "@/features/ai/services";
import { useAuthStore } from "./authStore";

const auth = () => useAuthStore.getState();

/** Auth service whose getStatus() calls resolve or reject only when the test says so. */
function controllableAuth() {
  const calls: { resolve: (s: AuthStatus) => void; reject: (e: unknown) => void }[] = [];
  const service: AuthService = {
    id: "mock",
    getStatus: () => new Promise<AuthStatus>((resolve, reject) => calls.push({ resolve, reject })),
    startLogin: () => Promise.resolve(),
    logout: () => Promise.resolve(),
  };
  return { service, calls };
}

describe("useAuthStore", () => {
  it("refresh loads the status and toggles loading", async () => {
    services.auth = new MockAuthService({ state: "signed_in", method: "claude.ai", email: "dev@example.com" }, 0);
    const pending = auth().refresh();
    expect(auth().loading).toBe(true);
    await pending;

    expect(auth().status).toMatchObject({ state: "signed_in", email: "dev@example.com" });
    expect(auth().loading).toBe(false);
    expect(auth().error).toBeUndefined();
  });

  it("refresh keeps the previous status and records the error when the service fails", async () => {
    services.auth = new MockAuthService({ state: "signed_out" }, 0);
    await auth().refresh();
    vi.spyOn(services.auth, "getStatus").mockRejectedValueOnce(new Error("CLI crashed"));

    await auth().refresh();

    expect(auth().status).toEqual({ state: "signed_out" });
    expect(auth().error).toBe("CLI crashed");
    expect(auth().loading).toBe(false);
  });

  it("signIn reports the error and stops loading", async () => {
    await auth().signIn();
    expect(auth().error).toMatch(/future update/);
    expect(auth().loading).toBe(false);
    expect(auth().status).toBeUndefined();
  });

  it("signOut signs out and refreshes the status", async () => {
    services.auth = new MockAuthService({ state: "signed_in", method: "console" }, 0);
    await auth().refresh();
    expect(auth().status?.state).toBe("signed_in");

    await auth().signOut();

    expect(auth().status).toEqual({ state: "signed_out" });
    expect(auth().loading).toBe(false);
  });

  it("a new action clears the previous error", async () => {
    await auth().signIn();
    expect(auth().error).toBeDefined();
    await auth().refresh();
    expect(auth().error).toBeUndefined();
  });

  it("ignores a stale refresh that resolves after a newer one", async () => {
    const { service, calls } = controllableAuth();
    services.auth = service;

    const older = auth().refresh();
    const newer = auth().refresh();
    expect(calls).toHaveLength(2);

    calls[1]?.resolve({ state: "signed_in", method: "claude.ai" });
    await newer;
    expect(auth().status?.state).toBe("signed_in");
    expect(auth().loading).toBe(false);

    calls[0]?.resolve({ state: "signed_out" });
    await older;
    expect(auth().status?.state).toBe("signed_in");
    expect(auth().loading).toBe(false);
  });

  it("an older request does not clear loading while a newer one is in flight", async () => {
    const { service, calls } = controllableAuth();
    services.auth = service;

    const older = auth().refresh();
    const newer = auth().refresh();

    calls[0]?.reject(new Error("stale failure"));
    await older;
    expect(auth().loading).toBe(true);
    expect(auth().error).toBeUndefined();

    calls[1]?.resolve({ state: "signed_out" });
    await newer;
    expect(auth().loading).toBe(false);
    expect(auth().status).toEqual({ state: "signed_out" });
  });
});
