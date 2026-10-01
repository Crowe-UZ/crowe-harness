import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeNative } from "@/test/fakes";
import { navigateTo, renderApp } from "@/test/renderApp";

describe("Agents page", () => {
  it("lists user agents, and project agents of the last opened project", async () => {
    const { user } = await renderApp("/projects/atlas/sessions/s-docs");
    await screen.findByRole("tab", { name: "Chat" });
    await navigateTo("/agents");

    const list = await screen.findByRole("list", { name: "Agents" });
    expect(within(list).getByText("code-reviewer")).toBeInTheDocument();
    expect(within(list).getByText("atlas-helper")).toBeInTheDocument();
    expect(within(list).getByText("Project")).toBeInTheDocument();
    expect(within(list).getByText("User")).toBeInTheDocument();
    expect(fakeNative().agentsList).toHaveBeenLastCalledWith("atlas");

    await user.selectOptions(screen.getByRole("combobox", { name: "Project" }), "None (user level only)");

    expect(await screen.findByRole("list", { name: "Agents" })).not.toHaveTextContent("atlas-helper");
    expect(fakeNative().agentsList).toHaveBeenLastCalledWith(null);
  });

  it("explains where agents come from when there are none", async () => {
    fakeNative().agents = [];
    await renderApp("/agents");
    expect(await screen.findByText("No agents found")).toBeInTheDocument();
    expect(screen.getByText("~/.claude/agents")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create/i })).not.toBeInTheDocument();
  });

  it("shows a load error with retry", async () => {
    fakeNative().fail("agentsList", "Cannot read ~/.claude/agents");
    const { user } = await renderApp("/agents");

    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot read ~/.claude/agents");
    fakeNative().recover("agentsList");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("list", { name: "Agents" })).toHaveTextContent("code-reviewer");
  });
});

describe("Skills page", () => {
  it("lists skills with their scope", async () => {
    await renderApp("/skills");
    const list = await screen.findByRole("list", { name: "Skills" });
    expect(within(list).getByText("release-notes")).toBeInTheDocument();
    expect(within(list).getByText("Drafts release notes from git history.")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("explains where skills come from when there are none", async () => {
    fakeNative().skills = [];
    await renderApp("/skills");
    expect(await screen.findByText("No skills found")).toBeInTheDocument();
  });
});

describe("MCP page", () => {
  it("lists servers with their status from claude mcp list", async () => {
    await renderApp("/mcp");
    const list = await screen.findByRole("list", { name: "MCP servers" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([expect.stringMatching(/^github.*Connected$/), expect.stringMatching(/^jira.*Needs authentication$/)]);
    expect(screen.queryByRole("button", { name: /add/i })).not.toBeInTheDocument();
  });

  it("shows how to add a server when none is configured", async () => {
    fakeNative().mcp = [];
    await renderApp("/mcp");
    expect(await screen.findByText("No MCP servers configured")).toBeInTheDocument();
    expect(screen.getByText(/claude mcp add <name> -- <command>/)).toBeInTheDocument();
  });

  it("refreshes the list", async () => {
    const { user } = await renderApp("/mcp");
    await screen.findByRole("list", { name: "MCP servers" });
    fakeNative().mcp = [{ name: "sentry", target: "https://mcp.sentry.dev", status: "failed" }];

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByText("sentry")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });
});
