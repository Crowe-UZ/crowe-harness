import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useProjectStore } from "@/stores/projectStore";
import { useSessionStore } from "@/stores/sessionStore";
import { currentPath, renderApp } from "@/test/renderApp";

const sidebar = () => screen.getByRole("navigation", { name: "Main" });

describe("project routes", () => {
  it("shows a not-found state for an unknown project", async () => {
    const { user } = await renderApp("/projects/does-not-exist");

    expect(await screen.findByRole("alert")).toHaveTextContent(/Project not found/);
    expect(document.title).toBe("Project not found · Crowe Harness");

    await user.click(screen.getByRole("link", { name: "Back to projects" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Projects" })).toBeInTheDocument();
    expect(currentPath()).toBe("/projects");
  });

  it("shows a not-found state for an unknown session inside a known project", async () => {
    const { user } = await renderApp("/projects/atlas/sessions/nope");

    expect(await screen.findByRole("alert")).toHaveTextContent(/Session not found/);
    expect(document.title).toBe("Session not found · Project Atlas · Crowe Harness");

    await user.click(screen.getByRole("link", { name: "Open project" }));
    await waitFor(() => expect(currentPath()).toBe("/projects/atlas/sessions/fix-auth"));
  });

  it("does not resolve a session through a project it does not belong to", async () => {
    await renderApp("/projects/mercury/sessions/fix-auth");
    expect(await screen.findByRole("alert")).toHaveTextContent(/Session not found/);
  });

  it("redirects /projects/:id to the most recently updated session", async () => {
    await renderApp("/projects/atlas");

    await waitFor(() => expect(currentPath()).toBe("/projects/atlas/sessions/fix-auth"));
    expect(await screen.findByRole("log", { name: "Conversation" })).toHaveTextContent("Fix the authentication bug");
    expect(document.title).toBe("Fix authentication · Project Atlas · Crowe Harness");
  });

  it("offers to start a session in a project without sessions", async () => {
    const project = useProjectStore
      .getState()
      .addProject({ name: "Project Orion", path: "C:\\dev\\orion", language: "Rust" });
    const { user } = await renderApp(`/projects/${project.id}`);

    expect(await screen.findByText("No sessions yet", { selector: "main *" })).toBeInTheDocument();
    expect(currentPath()).toBe(`/projects/${project.id}`);

    await user.click(screen.getByRole("button", { name: "Start a session" }));

    const created = useSessionStore.getState().sessions.find((s) => s.projectId === project.id);
    expect(created).toBeDefined();
    await waitFor(() => expect(currentPath()).toBe(`/projects/${project.id}/sessions/${created?.id}`));
    expect(await screen.findByText("Start the conversation")).toBeInTheDocument();
  });
});

describe("sidebar navigation", () => {
  it("opens a project and marks the current page", async () => {
    const { user } = await renderApp("/");

    await user.click(within(sidebar()).getByRole("link", { name: "Project Mercury" }));

    await waitFor(() => expect(currentPath()).toBe("/projects/mercury/sessions/data-pipeline"));
    expect(await screen.findByRole("heading", { level: 1, name: "Project Mercury" })).toBeInTheDocument();
    expect(within(sidebar()).getByRole("link", { name: "Speed up data pipeline" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await user.click(within(sidebar()).getByRole("link", { name: "Skills" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Skills" })).toBeInTheDocument();
    expect(within(sidebar()).getByRole("link", { name: "Skills" })).toHaveAttribute("aria-current", "page");
    expect(within(sidebar()).getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("creates a new session in the active project and opens it", async () => {
    const { user } = await renderApp("/projects/atlas/sessions/fix-auth");
    await screen.findByRole("log", { name: "Conversation" });
    const before = useSessionStore.getState().sessions.length;

    await user.click(within(sidebar()).getByRole("button", { name: "New session" }));

    const sessions = useSessionStore.getState().sessions;
    expect(sessions).toHaveLength(before + 1);
    const created = sessions[0];
    expect(created).toMatchObject({ projectId: "atlas", title: "New session" });
    await waitFor(() => expect(currentPath()).toBe(`/projects/atlas/sessions/${created?.id}`));
    expect(await screen.findByText("Start the conversation")).toBeInTheDocument();
    expect(within(sidebar()).getByRole("link", { name: "New session" })).toHaveAttribute("aria-current", "page");
  });
});

describe("skip link", () => {
  it("moves focus to the main region without changing the route", async () => {
    const { user } = await renderApp("/settings?tab=appearance");
    await screen.findByRole("heading", { level: 1, name: "Settings" });

    await user.tab();
    const skip = screen.getByRole("button", { name: "Skip to content" });
    expect(skip).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("main")).toHaveFocus();
    expect(currentPath()).toBe("/settings?tab=appearance");
  });
});

describe("document title", () => {
  it.each([
    ["/", "Home · Crowe Harness"],
    ["/projects", "Projects · Crowe Harness"],
    ["/agents", "Agents · Crowe Harness"],
    ["/skills", "Skills · Crowe Harness"],
    ["/mcp", "MCP servers · Crowe Harness"],
    ["/settings", "General · Settings · Crowe Harness"],
    ["/settings?tab=account", "Account · Settings · Crowe Harness"],
    ["/projects/phoenix/sessions/grpc-health", "Add gRPC health checks · Project Phoenix · Crowe Harness"],
    ["/no/such/page", "Page not found · Crowe Harness"],
  ])("%s → %s", async (path, title) => {
    await renderApp(path);
    await waitFor(() => expect(document.title).toBe(title));
  });
});
