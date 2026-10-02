import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { authTiming } from "@/stores/authStore";
import { fakeNative, fixtures } from "@/test/fakes";
import { renderApp } from "@/test/renderApp";

const shell = () => screen.queryByRole("navigation", { name: "Main" });
const gateHeading = (name: string) => screen.findByRole("heading", { level: 1, name });

describe("AuthGate", () => {
  it("shows a checking state until the first status arrives", async () => {
    fakeNative().claudeStatus.mockReturnValue(new Promise(() => {}));
    await renderApp("/");

    expect(screen.getByRole("status")).toHaveTextContent("Checking Claude Code…");
    expect(shell()).not.toBeInTheDocument();
    expect(document.title).toBe("Checking Claude Code · Crowe Harness");
  });

  it("opens the app shell with a Claude subscription", async () => {
    await renderApp("/");
    expect(await screen.findByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(screen.getByLabelText("Status bar")).toHaveTextContent("Claude: Signed in · Max");
  });

  it("asks for the desktop app in a plain browser", async () => {
    fakeNative().desktop = false;
    await renderApp("/");

    expect(await gateHeading("Open Crowe Harness desktop app")).toHaveFocus();
    expect(shell()).not.toBeInTheDocument();
    expect(fakeNative().claudeStatus).not.toHaveBeenCalled();
  });

  it("offers to install Claude Code when it is missing and checks again", async () => {
    fakeNative().status = fixtures.notInstalledStatus();
    const { user } = await renderApp("/");

    expect(await gateHeading("Claude Code not found")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Install Claude Code" })).toBeInTheDocument();
    expect(shell()).not.toBeInTheDocument();

    fakeNative().status = fixtures.subscriptionStatus();
    await user.click(screen.getByRole("button", { name: "Check again" }));

    expect(await screen.findByRole("navigation", { name: "Main" })).toBeInTheDocument();
  });

  it("signs in through Claude Code and polls until the subscription sign-in completes", async () => {
    const fake = fakeNative();
    fake.status = fixtures.signedOutStatus();
    const { user } = await renderApp("/");

    await gateHeading("Sign in with your Claude subscription");
    await user.click(screen.getByRole("button", { name: "Sign in with Claude" }));

    expect(fake.claudeAuthLogin).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Waiting for sign-in…")).toBeInTheDocument();
    expect(screen.getByText(/Complete sign-in in the browser window that opened/)).toBeInTheDocument();
    expect(shell()).not.toBeInTheDocument();

    fake.status = fixtures.subscriptionStatus();

    expect(await screen.findByRole("navigation", { name: "Main" })).toBeInTheDocument();
  });

  it("can cancel waiting for sign-in", async () => {
    fakeNative().status = fixtures.signedOutStatus();
    const { user } = await renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Sign in with Claude" }));
    await screen.findByText("Waiting for sign-in…");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Waiting for sign-in…")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with Claude" })).toBeInTheDocument();
  });

  it("shows why the sign-in console could not open", async () => {
    fakeNative().status = fixtures.signedOutStatus();
    fakeNative().fail("claudeAuthLogin", "No console available");
    const { user } = await renderApp("/");

    await user.click(await screen.findByRole("button", { name: "Sign in with Claude" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No console available");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("blocks a Console / API key sign-in and offers to sign out", async () => {
    const fake = fakeNative();
    fake.status = fixtures.apiKeyStatus();
    const { user } = await renderApp("/");

    await gateHeading("A Claude subscription is required");
    expect(screen.getByText(/signed in as api@example\.com \(console\)/)).toBeInTheDocument();
    expect(shell()).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(fake.claudeAuthLogout).toHaveBeenCalledTimes(1);
    expect(await gateHeading("Sign in with your Claude subscription")).toHaveFocus();
  });

  it("shows an error with retry when the status cannot be read", async () => {
    fakeNative().fail("claudeStatus", "claude auth status failed");
    const { user } = await renderApp("/");

    await gateHeading("Could not check Claude Code");
    expect(screen.getByRole("alert")).toHaveTextContent("claude auth status failed");

    fakeNative().recover("claudeStatus");
    await user.click(screen.getByRole("button", { name: "Check again" }));

    expect(await screen.findByRole("navigation", { name: "Main" })).toBeInTheDocument();
  });

  it("re-checks on window focus and returns to the gate after signing out elsewhere", async () => {
    await renderApp("/");
    await screen.findByRole("navigation", { name: "Main" });

    fakeNative().status = fixtures.signedOutStatus();
    fireEvent.focus(window);

    expect(await gateHeading("Sign in with your Claude subscription")).toBeInTheDocument();
    expect(shell()).not.toBeInTheDocument();
  });

  it("keeps the app open when a background re-check fails", async () => {
    await renderApp("/");
    await screen.findByRole("navigation", { name: "Main" });
    const calls = fakeNative().claudeStatus.mock.calls.length;

    fakeNative().fail("claudeStatus");
    fireEvent.focus(window);

    await waitFor(() => expect(fakeNative().claudeStatus.mock.calls.length).toBe(calls + 1));
    expect(shell()).toBeInTheDocument();
  });

  it("re-checks periodically", async () => {
    authTiming.recheckIntervalMs = 20;
    await renderApp("/");
    await screen.findByRole("navigation", { name: "Main" });

    fakeNative().status = fixtures.apiKeyStatus();

    expect(await gateHeading("A Claude subscription is required")).toBeInTheDocument();
  });
});
