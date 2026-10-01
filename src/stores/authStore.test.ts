import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeNative, fixtures } from "@/test/fakes";
import { authTiming, useAuthStore } from "./authStore";

const auth = () => useAuthStore.getState();

describe("useAuthStore.refresh", () => {
  it("loads the status and toggles checking", async () => {
    const pending = auth().refresh();
    expect(auth().checking).toBe(true);
    await pending;

    expect(auth().status).toMatchObject({ state: "signed_in", subscription: true, email: "dev@example.com" });
    expect(auth().checking).toBe(false);
    expect(auth().error).toBeUndefined();
  });

  it("records a visible check failure but keeps the previous status", async () => {
    await auth().refresh();
    fakeNative().fail("claudeStatus", "claude auth status crashed");

    await auth().refresh();

    expect(auth().status).toMatchObject({ state: "signed_in" });
    expect(auth().error).toBe("claude auth status crashed");
  });

  it("ignores failures of silent background checks once a status is known", async () => {
    await auth().refresh();
    fakeNative().fail("claudeStatus");

    await auth().refresh({ silent: true });

    expect(auth().error).toBeUndefined();
    expect(auth().status).toMatchObject({ state: "signed_in" });
  });

  it("lets only the latest check write its result", async () => {
    fakeNative().status = fixtures.signedOutStatus();
    const first = auth().refresh();
    fakeNative().status = fixtures.subscriptionStatus();
    const second = auth().refresh();
    await Promise.all([first, second]);
    expect(auth().status).toMatchObject({ state: "signed_in" });
  });
});

describe("useAuthStore sign-in", () => {
  it("opens Claude Code's sign-in and polls until the user is signed in", async () => {
    const fake = fakeNative();
    fake.status = fixtures.signedOutStatus();
    await auth().refresh();
    let polls = 0;
    fake.claudeStatus.mockImplementation(() => {
      polls += 1;
      return Promise.resolve(polls < 3 ? fixtures.signedOutStatus() : fixtures.subscriptionStatus());
    });

    await auth().startSignIn();

    expect(fake.claudeAuthLogin).toHaveBeenCalledTimes(1);
    expect(polls).toBe(3);
    expect(auth().signIn).toEqual({ phase: "idle" });
    expect(auth().status).toMatchObject({ state: "signed_in", subscription: true });
  });

  it("keeps polling through transient status failures", async () => {
    const fake = fakeNative();
    fake.status = fixtures.signedOutStatus();
    fake.claudeStatus.mockRejectedValueOnce(new Error("busy")).mockResolvedValueOnce(fixtures.subscriptionStatus());

    await auth().startSignIn();

    expect(auth().status).toMatchObject({ state: "signed_in" });
  });

  it("stops polling when cancelled", async () => {
    fakeNative().status = fixtures.signedOutStatus();
    const run = auth().startSignIn();
    await waitFor(() => expect(auth().signIn.phase).toBe("waiting"));

    auth().cancelSignIn();
    await run;
    const calls = fakeNative().claudeStatus.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(auth().signIn).toEqual({ phase: "idle" });
    expect(fakeNative().claudeStatus.mock.calls.length).toBe(calls);
  });

  it("gives up after the timeout", async () => {
    fakeNative().status = fixtures.signedOutStatus();
    authTiming.pollTimeoutMs = 0;

    await auth().startSignIn();

    expect(auth().signIn).toEqual({ phase: "timed_out" });
  });

  it("reports a sign-in console that could not be opened", async () => {
    fakeNative().fail("claudeAuthLogin", "Could not open a console window");

    await auth().startSignIn();

    expect(auth().signIn).toEqual({ phase: "failed", message: "Could not open a console window" });
  });
});

describe("useAuthStore.signOut", () => {
  it("signs out through Claude Code and refreshes the status", async () => {
    await auth().refresh();

    expect(await auth().signOut()).toBe(true);

    expect(fakeNative().claudeAuthLogout).toHaveBeenCalledTimes(1);
    expect(auth().status).toMatchObject({ state: "signed_out" });
    expect(auth().signingOut).toBe(false);
  });

  it("reports a failed sign-out", async () => {
    await auth().refresh();
    fakeNative().fail("claudeAuthLogout", "logout failed");

    expect(await auth().signOut()).toBe(false);

    expect(auth().error).toBe("logout failed");
    expect(auth().status).toMatchObject({ state: "signed_in" });
  });
});
