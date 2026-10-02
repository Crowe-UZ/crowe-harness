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
    ["custom", "Custom"],
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

describe("Settings → Advanced → Claude Code location", () => {
  it("chooses Claude Code by hand and confirms the result", async () => {
    fakeNative().pickedExecutable = { ...fixtures.CUSTOM_INSTALL };
    const { user } = await renderApp("/settings?tab=advanced");
    await screen.findByText("Native install");
    expect(screen.queryByRole("button", { name: "Use automatic detection" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Change…" }));

    expect(await screen.findByText("Using Claude Code 2.1.284 (Custom)")).toBeInTheDocument();
    expect(screen.getByText("D:\\Tools\\claude\\claude.exe")).toBeInTheDocument();
    expect(screen.getByText("Custom")).toBeInTheDocument();
    expect(screen.getByText(/You chose it by hand/)).toBeInTheDocument();
  });

  it("keeps the current Claude Code when the picker is cancelled", async () => {
    const { user } = await renderApp("/settings?tab=advanced");
    await screen.findByText("Native install");

    await user.click(screen.getByRole("button", { name: "Change…" }));

    expect(fakeNative().claudePickExecutable).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "Change…" })).toBeInTheDocument();
    expect(screen.getByText("Native install")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows why a chosen file cannot be used", async () => {
    fakeNative().fail(
      "claudePickExecutable",
      "The selected file is not a working Claude Code: it is not a program that can be run (not_executable).",
      "invalid_executable",
    );
    const { user } = await renderApp("/settings?tab=advanced");
    await screen.findByText("Native install");

    await user.click(screen.getByRole("button", { name: "Change…" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("not a program that can be run (not_executable)");
    expect(screen.getByText("Native install")).toBeInTheDocument();
  });

  it("returns to automatic detection", async () => {
    fakeNative().status = fixtures.subscriptionStatus({ install: { ...fixtures.CUSTOM_INSTALL } });
    const { user } = await renderApp("/settings?tab=advanced");
    expect(await screen.findByText("Custom")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use automatic detection" }));

    expect(await screen.findByText("Using Claude Code 2.3.0 (Native install)")).toBeInTheDocument();
    expect(fakeNative().claudeClearExecutable).toHaveBeenCalledTimes(1);
    expect(screen.getByText("C:\\Users\\dev\\.local\\bin\\claude.exe")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use automatic detection" })).not.toBeInTheDocument();
  });

  it("reports a failure to return to automatic detection", async () => {
    fakeNative().status = fixtures.subscriptionStatus({ install: { ...fixtures.CUSTOM_INSTALL } });
    fakeNative().fail("claudeClearExecutable", "Claude Code location: Access is denied.", "io");
    const { user } = await renderApp("/settings?tab=advanced");
    await screen.findByText("Custom");

    await user.click(screen.getByRole("button", { name: "Use automatic detection" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Access is denied.");
    expect(screen.getByText("Custom")).toBeInTheDocument();
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
