import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { fakeNative } from "@/test/fakes";
import { currentPath, navigateTo, renderApp } from "@/test/renderApp";

const sidebar = () => screen.getByRole("navigation", { name: "Main" });

describe("home", () => {
  it("greets the user and shows recent projects and chats from Claude Code history", async () => {
    await renderApp("/");

    expect(await screen.findByText(/signed in as dev@example\.com/)).toBeInTheDocument();
    const projects = screen.getByRole("region", { name: "Recent projects" });
    expect(await within(projects).findByRole("link", { name: /atlas/ })).toHaveAttribute("href", "#/projects/atlas");
    expect(within(projects).getByRole("link", { name: /orion/ })).toHaveTextContent("Opened");

    const chats = screen.getByRole("region", { name: "Recent chats" });
    const links = await within(chats).findAllByRole("link");
    expect(links.map((l) => l.textContent?.split(/atlas|mercury/)[0])).toEqual([
      "Fix the login bug",
      "Speed up the pipeline",
      "Write the README",
    ]);
    expect(document.title).toBe("Home · Crowe Harness");
  });

  it("shows an empty state without history", async () => {
    fakeNative().projects = [];
    await renderApp("/");
    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
    expect(screen.getByText("No chats yet")).toBeInTheDocument();
  });

  it("shows a load error with retry", async () => {
    fakeNative().fail("projectsList", "History folder unreadable");
    const { user } = await renderApp("/");

    expect(await screen.findByText("History folder unreadable")).toBeInTheDocument();
    fakeNative().recover("projectsList");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("link", { name: /Fix the login bug/ })).toBeInTheDocument();
  });
});

describe("projects", () => {
  it("lists and filters all projects", async () => {
    const { user } = await renderApp("/projects");
    expect(await screen.findByText(/3 projects from Claude Code history/)).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Filter projects" }), "mercury");
    expect(within(screen.getByRole("main")).getAllByRole("link", { name: /mercury|atlas|orion/ })).toHaveLength(1);

    await user.clear(screen.getByRole("textbox", { name: "Filter projects" }));
    await user.type(screen.getByRole("textbox", { name: "Filter projects" }), "nothing");
    expect(screen.getByText("No matching projects")).toBeInTheDocument();
  });

  it("redirects /projects/:id to the newest chat", async () => {
    await renderApp("/projects/atlas");
    await waitFor(() => expect(currentPath()).toBe("/projects/atlas/sessions/s-auth"));
    expect(await screen.findByRole("heading", { level: 1, name: "atlas" })).toBeInTheDocument();
  });

  it("offers to start a new chat in a project without chats", async () => {
    const { user } = await renderApp("/projects/orion");

    expect(await screen.findByText("No chats yet", { selector: "main *" })).toBeInTheDocument();
    expect(currentPath()).toBe("/projects/orion");
    await user.click(screen.getByRole("link", { name: "Start a new chat" }));

    await waitFor(() => expect(currentPath()).toBe("/projects/orion/sessions/new"));
    expect(await screen.findByRole("textbox", { name: "Message" })).toBeInTheDocument();
  });

  it("shows a not-found state for an unknown project", async () => {
    const { user } = await renderApp("/projects/does-not-exist");

    expect(await screen.findByRole("alert")).toHaveTextContent(/Project not found/);
    expect(document.title).toBe("Project not found · Crowe Harness");
    await user.click(screen.getByRole("link", { name: "Back to projects" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Projects" })).toBeInTheDocument();
  });

  it("removed the Terminal tab until the PTY milestone", async () => {
    await renderApp("/projects/atlas/sessions/s-auth");
    expect(await screen.findByRole("tab", { name: "Chat" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Files" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Terminal" })).not.toBeInTheDocument();
  });
});

describe("sidebar", () => {
  it("lists projects, the chats of the current project and a New chat action", async () => {
    const { user } = await renderApp("/");
    await screen.findByRole("navigation", { name: "Main" });
    await user.click(await within(sidebar()).findByRole("link", { name: "mercury" }));

    await waitFor(() => expect(currentPath()).toBe("/projects/mercury/sessions/s-pipeline"));
    const chats = await within(sidebar()).findByRole("list", { name: "Chats in mercury" });
    expect(within(chats).getByRole("link", { name: "Speed up the pipeline" })).toHaveAttribute("aria-current", "page");

    await user.click(within(sidebar()).getByRole("link", { name: "New chat" }));
    await waitFor(() => expect(currentPath()).toBe("/projects/mercury/sessions/new"));
    expect(await screen.findByText("Start a new chat")).toBeInTheDocument();

    await user.click(within(sidebar()).getByRole("link", { name: "Skills" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Skills" })).toBeInTheDocument();
    expect(within(sidebar()).getByRole("link", { name: "Skills" })).toHaveAttribute("aria-current", "page");
  });

  it("opens a folder through the native picker and shows the project", async () => {
    const fake = fakeNative();
    fake.openFolderResult = {
      id: "vega",
      name: "vega",
      path: "D:\\work\\vega",
      sessionCount: 0,
      lastActivity: null,
      source: "opened",
    };
    const { user } = await renderApp("/");
    await screen.findByRole("region", { name: "Recent projects" });

    await user.click(within(sidebar()).getByRole("button", { name: "Open folder" }));

    await waitFor(() => expect(currentPath()).toBe("/projects/vega"));
    expect(await screen.findByRole("heading", { level: 1, name: "vega" })).toBeInTheDocument();
    expect(within(sidebar()).getByRole("link", { name: "vega" })).toBeInTheDocument();
  });

  it("does nothing when the folder picker is cancelled", async () => {
    const { user } = await renderApp("/");
    await screen.findByRole("region", { name: "Recent projects" });

    await user.click(within(sidebar()).getByRole("button", { name: "Open folder" }));

    expect(fakeNative().projectsOpenFolder).toHaveBeenCalledTimes(1);
    expect(currentPath()).toBe("/");
  });
});

describe("startup", () => {
  it("opens the most recently active project when enabled", async () => {
    useSettingsStore.getState().setOpenLastProjectOnStartup(true);
    await renderApp("/");
    await waitFor(() => expect(currentPath()).toBe("/projects/atlas/sessions/s-auth"));
  });
});

describe("skip link", () => {
  it("moves focus to the main region without changing the route", async () => {
    const { user } = await renderApp("/settings?tab=appearance");
    await screen.findByRole("heading", { level: 1, name: "Settings" });

    await user.tab();
    expect(screen.getByRole("button", { name: "Skip to content" })).toHaveFocus();
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
    ["/projects/mercury/sessions/s-pipeline", "Speed up the pipeline · mercury · Crowe Harness"],
    ["/projects/atlas/sessions/new", "New chat · atlas · Crowe Harness"],
    ["/no/such/page", "Page not found · Crowe Harness"],
  ])("%s → %s", async (path, title) => {
    await renderApp(path);
    await waitFor(() => expect(document.title).toBe(title));
  });

  it("shows the 404 page after navigating to an unknown route", async () => {
    await renderApp("/");
    await screen.findByRole("navigation", { name: "Main" });
    await navigateTo("/does-not-exist");
    expect(await screen.findByText("Page not found")).toBeInTheDocument();
  });
});
