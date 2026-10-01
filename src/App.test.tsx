import { act, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import { PREFERS_DARK, setMatches } from "@/test/matchMedia";
import { navigateTo, renderApp } from "@/test/renderApp";

describe("App", () => {
  it("renders the home screen inside the shell", async () => {
    await renderApp("/");
    expect(await screen.findByText("Welcome to Crowe Harness.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent projects" })).toBeInTheDocument();
    expect(screen.getAllByText("Project Atlas").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Status bar")).toHaveTextContent(/v\d+\.\d+\.\d+/);
  });

  it("shows the sign-in hint while signed out", async () => {
    await renderApp("/");
    expect(await screen.findByRole("link", { name: "Open account settings" })).toHaveAttribute(
      "href",
      "#/settings?tab=account",
    );
  });

  it("starts in the dark theme by default", async () => {
    await renderApp("/");
    await screen.findByText("Welcome to Crowe Harness.");
    expect(document.documentElement).toHaveClass("dark");
  });

  it("switches the theme from the Appearance settings and remembers it", async () => {
    const { user } = await renderApp("/settings?tab=appearance");

    await user.click(await screen.findByRole("radio", { name: "Light" }));
    expect(document.documentElement).toHaveClass("light");
    expect(document.documentElement).not.toHaveClass("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");

    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("follows the operating system with the System theme", async () => {
    const { user } = await renderApp("/settings?tab=appearance");

    await user.click(await screen.findByRole("radio", { name: "System" }));
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
    expect(document.documentElement).toHaveClass("light");

    act(() => setMatches(PREFERS_DARK, true));
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).not.toHaveClass("light");

    act(() => setMatches(PREFERS_DARK, false));
    expect(document.documentElement).toHaveClass("light");
  });

  it("restores a stored System theme and resolves it on start", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, "system");
    setMatches(PREFERS_DARK, true);
    await renderApp("/");
    await screen.findByText("Welcome to Crowe Harness.");
    expect(document.documentElement).toHaveClass("dark");
  });

  it("shows the 404 page for unknown routes", async () => {
    await renderApp("/");
    await navigateTo("/does-not-exist");
    expect(await screen.findByText("Page not found")).toBeInTheDocument();
  });

  it("opens a project with Chat, Files and Terminal tabs", async () => {
    await renderApp("/projects/atlas/sessions/fix-auth");
    expect(await screen.findByRole("tab", { name: "Chat" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Files" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Terminal" })).toBeInTheDocument();
    const log = screen.getByRole("log", { name: "Conversation" });
    expect(within(log).getByText("Fix the authentication bug")).toBeInTheDocument();
  });

  it("toggles skills from the Skills page", async () => {
    const { user } = await renderApp("/skills");
    const documentation = await screen.findByRole("switch", { name: "Documentation" });
    expect(documentation).not.toBeChecked();

    await user.click(documentation);

    expect(documentation).toBeChecked();
    expect(screen.getByText(/4 of 5 skills enabled/)).toBeInTheDocument();
  });
});
