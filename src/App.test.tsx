import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { router } from "./app/router";

describe("App", () => {
  beforeEach(async () => {
    await act(() => router.navigate("/"));
  });

  it("renders the home screen inside the shell", async () => {
    render(<App />);
    expect(await screen.findByText("Welcome to Crowe Harness.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent projects" })).toBeInTheDocument();
    expect(screen.getAllByText("Project Atlas").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Status bar")).toHaveTextContent(/v\d+\.\d+\.\d+/);
  });

  it("switches the theme from the Appearance settings", async () => {
    const user = userEvent.setup();
    render(<App />);
    await act(() => router.navigate("/settings?tab=appearance"));

    await user.click(await screen.findByLabelText("Light"));
    expect(document.documentElement).toHaveClass("light");
    expect(document.documentElement).not.toHaveClass("dark");

    await user.click(screen.getByLabelText("Dark"));
    expect(document.documentElement).toHaveClass("dark");
  });

  it("shows the 404 page for unknown routes", async () => {
    render(<App />);
    await act(() => router.navigate("/does-not-exist"));
    expect(await screen.findByText("Page not found")).toBeInTheDocument();
  });

  it("opens a project with Chat, Files and Terminal tabs", async () => {
    render(<App />);
    await act(() => router.navigate("/projects/atlas/sessions/fix-auth"));
    expect(await screen.findByRole("tab", { name: "Chat" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Files" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Terminal" })).toBeInTheDocument();
    const log = screen.getByRole("log", { name: "Conversation" });
    expect(within(log).getByText("Fix the authentication bug")).toBeInTheDocument();
  });
});
