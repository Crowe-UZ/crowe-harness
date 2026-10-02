import { act, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import { useSettingsStore } from "@/stores/settingsStore";
import { fakeNative, fixtures } from "@/test/fakes";
import { PREFERS_DARK, setMatches } from "@/test/matchMedia";
import { renderApp } from "@/test/renderApp";

describe("Settings → Account", () => {
  it("shows the Claude account, organization and plan", async () => {
    await renderApp("/settings?tab=account");

    expect(await screen.findByText("Signed in · Max")).toBeInTheDocument();
    expect(screen.getAllByText("dev@example.com").length).toBeGreaterThan(0);
    expect(screen.getByText("Example Org")).toBeInTheDocument();
    expect(screen.getByText("Max")).toBeInTheDocument();
    expect(screen.getByText("claude.ai")).toBeInTheDocument();
  });

  it("signs out after confirmation and returns to the sign-in gate", async () => {
    const { user } = await renderApp("/settings?tab=account");
    await user.click(await screen.findByRole("button", { name: "Sign out" }));

    const dialog = await screen.findByRole("dialog", { name: "Sign out of Claude Code?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(fakeNative().claudeAuthLogout).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Sign out" }));

    expect(fakeNative().claudeAuthLogout).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Sign in with your Claude subscription" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
  });

  it("keeps the app open and reports a failed sign-out", async () => {
    fakeNative().fail("claudeAuthLogout", "logout failed");
    const { user } = await renderApp("/settings?tab=account");
    await user.click(await screen.findByRole("button", { name: "Sign out" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("logout failed");
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
  });

  it("shows the detected Claude Code installation under Advanced", async () => {
    await renderApp("/settings?tab=advanced");
    expect(await screen.findByText("2.3.0")).toBeInTheDocument();
    expect(screen.getByText("C:\\Users\\dev\\.local\\bin\\claude.exe")).toBeInTheDocument();
    expect(screen.getByText("Native install")).toBeInTheDocument();
    expect(screen.queryByText(/demo/i)).not.toBeInTheDocument();
  });

  it.each([
    ["path", "PATH"],
    ["package", "Package manager"],
    ["desktop", "Claude desktop app"],
  ] as const)("labels a Claude Code found via %s", async (source, label) => {
    fakeNative().status = fixtures.subscriptionStatus({
      install: { path: "/opt/homebrew/bin/claude", version: "2.1.0", source },
    });
    await renderApp("/settings?tab=advanced");

    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(screen.getByText("/opt/homebrew/bin/claude")).toBeInTheDocument();
  });
});

describe("Settings → preferences", () => {
  it("changes the default permission mode used by new chats", async () => {
    const { user } = await renderApp("/settings?tab=security");
    await user.click(await screen.findByRole("radio", { name: "Accept edits" }));
    expect(useSettingsStore.getState().defaultPermissionMode).toBe("acceptEdits");
  });

  it("switches the theme and remembers it", async () => {
    const { user } = await renderApp("/settings?tab=appearance");

    await user.click(await screen.findByRole("radio", { name: "Light" }));
    expect(document.documentElement).toHaveClass("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");

    await user.click(screen.getByRole("radio", { name: "System" }));
    act(() => setMatches(PREFERS_DARK, true));
    expect(document.documentElement).toHaveClass("dark");
  });

  it("starts in the dark theme by default", async () => {
    await renderApp("/");
    await screen.findByRole("navigation", { name: "Main" });
    expect(document.documentElement).toHaveClass("dark");
  });
});
