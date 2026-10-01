import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { services } from "@/features/ai/services";
import type { AIEvent, PermissionDecision } from "@/features/ai/types";
import { AsyncQueue } from "@/lib/async-queue";
import { fakeNative, waitForTurn } from "@/test/fakes";
import { currentPath, renderApp } from "@/test/renderApp";

const conversation = () => screen.getByRole("log", { name: "Conversation" });
const sidebar = () => screen.getByRole("navigation", { name: "Main" });

async function openChat(path: string) {
  const view = await renderApp(path);
  const composer = await screen.findByRole("textbox", { name: "Message" });
  return { ...view, composer };
}

describe("stored chats", () => {
  it("renders the transcript with paired tool cards and an agent-chat link", async () => {
    const { user } = await openChat("/projects/atlas/sessions/s-auth");
    const log = conversation();

    expect(await within(log).findByText("The login form accepts empty passwords. Fix it.")).toBeInTheDocument();
    expect(within(log).getByText("Fixed: empty passwords are now rejected.")).toBeInTheDocument();
    // Tool results are not shown as user messages.
    expect(within(log).getAllByRole("article", { name: "Your message" })).toHaveLength(1);

    const read = within(log).getByRole("button", { name: /Read.*src\/auth\/login\.ts.*Done/ });
    const bash = within(log).getByRole("button", { name: /Bash.*Run the tests.*Failed/ });
    expect(read).toHaveAttribute("aria-expanded", "false");

    await user.click(bash);
    expect(bash).toHaveAttribute("aria-expanded", "true");
    expect(within(log).getByText("1 test failed")).toBeInTheDocument();
    expect(within(log).getByText("Error")).toBeInTheDocument();

    const agentLink = within(log).getByRole("link", { name: "Open agent chat" });
    expect(agentLink).toHaveAttribute("href", "#/projects/atlas/sessions/s-auth/agents/agent-1");
    expect(document.title).toBe("Fix the login bug · atlas · Crowe Harness");
  });

  it("notes when earlier messages were truncated", async () => {
    await openChat("/projects/mercury/sessions/s-pipeline");
    expect(await within(conversation()).findByText(/Earlier messages truncated/)).toBeInTheDocument();
  });

  it("shows the inspector with real chat data", async () => {
    await openChat("/projects/atlas/sessions/s-auth");
    const inspector = screen.getByRole("complementary", { name: "Chat inspector" });

    await within(inspector).findByText("Fix the login bug");
    expect(within(inspector).getByText("claude-opus-4-5")).toBeInTheDocument();
    expect(within(inspector).getByRole("list", { name: "Tool usage" })).toHaveTextContent(/Bash1.*Read1.*Task1/);
    expect(within(inspector).getByRole("link", { name: /code-reviewer/ })).toHaveAttribute(
      "href",
      "#/projects/atlas/sessions/s-auth/agents/agent-1",
    );
  });

  it("shows a not-found state for an unknown chat", async () => {
    await renderApp("/projects/atlas/sessions/nope");
    expect(await screen.findByRole("alert")).toHaveTextContent(/Chat not found/);
    expect(screen.getByRole("link", { name: "Open project" })).toHaveAttribute("href", "#/projects/atlas");
  });

  it("retries a transcript that failed to load", async () => {
    fakeNative().fail("sessionRead", "Transcript is locked");
    const { user } = await renderApp("/projects/atlas/sessions/s-docs");

    expect(await screen.findByRole("alert")).toHaveTextContent(/Transcript is locked/);
    fakeNative().recover("sessionRead");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await within(conversation()).findByText("Here is a first draft.")).toBeInTheDocument();
  });
});

describe("new chat", () => {
  it("creates the session with the first turn and continues under its real route", async () => {
    const fake = fakeNative();
    const { user, composer } = await openChat("/projects/atlas/sessions/new");
    expect(within(conversation()).getByText("Start a new chat")).toBeInTheDocument();
    expect(document.title).toBe("New chat · atlas · Crowe Harness");

    await user.type(composer, "Add a health check{Enter}");

    const turn = await waitForTurn();
    expect(turn.args).toEqual({
      projectId: "atlas",
      sessionId: null,
      prompt: "Add a health check",
      permissionMode: "default",
    });
    expect(within(conversation()).getByRole("article", { name: "Your message" })).toHaveTextContent(
      "Add a health check",
    );

    turn.emit({ type: "session_started", sessionId: "s-new", model: "claude-opus-4-5" });
    await waitFor(() => expect(currentPath()).toBe("/projects/atlas/sessions/s-new"));
    // Same chat view: the optimistic message is still there and focus stays in the composer.
    expect(await within(conversation()).findByText("Add a health check")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveFocus();

    turn.emit(
      { type: "message_start", messageId: "m1" },
      { type: "text_delta", messageId: "m1", text: "Added /health." },
    );
    expect(await within(conversation()).findByText("Added /health.")).toBeInTheDocument();

    // Claude Code wrote the chat to its history; the turn ends and the lists refresh.
    const session = {
      id: "s-new",
      projectId: "atlas",
      title: "Add a health check",
      createdAt: "2026-10-01T13:00:00Z",
      updatedAt: "2026-10-01T13:01:00Z",
      messageCount: 2,
      gitBranch: "main",
      model: "claude-opus-4-5",
      subagentCount: 0,
    };
    fake.sessions.atlas = [session, ...(fake.sessions.atlas ?? [])];
    fake.transcripts["atlas/s-new"] = {
      session,
      messages: [
        {
          id: "n1",
          role: "user",
          timestamp: null,
          model: null,
          blocks: [{ type: "text", text: "Add a health check" }],
        },
        {
          id: "n2",
          role: "assistant",
          timestamp: null,
          model: null,
          blocks: [{ type: "text", text: "Added /health (stored)." }],
        },
      ],
      subagents: [],
      truncated: false,
    };
    turn.emit({
      type: "message_end",
      messageId: "m1",
      stopReason: "end_turn",
      usage: { inputTokens: 1200, outputTokens: 80, costUsd: 0.0123 },
    });
    turn.exit(0);

    expect(await within(conversation()).findByText("Added /health (stored).")).toBeInTheDocument();
    expect(within(conversation()).queryByText("Added /health.")).not.toBeInTheDocument();
    expect(within(sidebar()).getByRole("link", { name: "Add a health check" })).toHaveAttribute("aria-current", "page");
    const inspector = screen.getByRole("complementary", { name: "Chat inspector" });
    // Formatted with the user's locale, like the app does (Testing Library normalizes whitespace in the DOM text only).
    const normalized = (text: string) => text.replace(/\s+/g, " ");
    const cost = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 });
    expect(within(inspector).getByText(normalized(new Intl.NumberFormat().format(1200)))).toBeInTheDocument();
    expect(within(inspector).getByText(normalized(cost.format(0.0123)))).toBeInTheDocument();
  });

  it("does not send empty messages and inserts new lines with Shift+Enter", async () => {
    const { user, composer } = await openChat("/projects/atlas/sessions/new");
    const send = screen.getByRole("button", { name: "Send" });

    await user.type(composer, "   {Enter}");
    expect(send).toHaveAttribute("aria-disabled", "true");
    await user.type(composer, "First{Shift>}{Enter}{/Shift}Second");

    expect(composer).toHaveValue("   First\nSecond");
    expect(fakeNative().turns).toHaveLength(0);
  });
});

describe("live turns", () => {
  it("continues an existing chat with the chosen permission mode", async () => {
    const { user, composer } = await openChat("/projects/atlas/sessions/s-docs");
    await within(conversation()).findByText("Here is a first draft.");

    await user.selectOptions(screen.getByRole("combobox", { name: "Permission mode" }), "Accept edits");
    await user.type(composer, "Add a license section{Enter}");

    const turn = await waitForTurn();
    expect(turn.args).toEqual({
      projectId: "atlas",
      sessionId: "s-docs",
      prompt: "Add a license section",
      permissionMode: "acceptEdits",
    });
    // The stored transcript stays visible above the live turn.
    expect(within(conversation()).getByText("Here is a first draft.")).toBeInTheDocument();
    expect(within(conversation()).getByText("Add a license section")).toBeInTheDocument();
    turn.exit(0);
    expect(await screen.findByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("uses one button that turns into Stop and cancels the turn", async () => {
    const fake = fakeNative();
    const { user, composer } = await openChat("/projects/atlas/sessions/s-docs");
    await user.type(composer, "Long task");
    const button = screen.getByRole("button", { name: "Send" });
    await user.click(button);

    const turn = await waitForTurn();
    await waitFor(() => expect(button).toHaveAccessibleName("Stop"));
    expect(button).toHaveFocus();
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent("Claude is responding");
    turn.emit({ type: "message_start", messageId: "m1" }, { type: "text_delta", messageId: "m1", text: "Halfway" });
    await within(conversation()).findByText("Halfway");

    await user.click(button);

    expect(fake.turnCancel).toHaveBeenCalledWith(turn.id);
    await waitFor(() => expect(button).toHaveAccessibleName("Send"));
    expect(button).toHaveFocus();
    expect(await screen.findByText("You stopped the response.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports permission denials with a hint to switch to Accept edits", async () => {
    const { user, composer } = await openChat("/projects/atlas/sessions/s-docs");
    await user.type(composer, "Write the file{Enter}");
    const turn = await waitForTurn();

    turn.emit(
      { type: "message_start", messageId: "m1" },
      { type: "tool_call_start", id: "t1", messageId: "m1", name: "Write", input: '{"file_path":"LICENSE"}' },
      { type: "permission_denied", toolName: "Write", toolUseId: "t1" },
      { type: "tool_call_end", id: "t1", status: "error", output: "Permission to use Write has been denied." },
    );

    expect(await screen.findByText(/was not allowed to use/)).toHaveTextContent(
      "Claude Code was not allowed to use Write.",
    );
    expect(screen.getByText(/switch the permission mode to “Accept edits”/)).toBeInTheDocument();
    expect(
      within(conversation()).getByRole("button", { name: /Write.*LICENSE.*Permission denied/ }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dismiss notice" }));
    expect(screen.queryByText(/was not allowed to use/)).not.toBeInTheDocument();
    turn.exit(0);
  });

  it("shows runtime errors in an alert", async () => {
    fakeNative().fail("turnStart", "Claude Code is not signed in");
    const { user, composer } = await openChat("/projects/atlas/sessions/s-docs");

    await user.type(composer, "Hello{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("Claude Code is not signed in");
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("supports runtimes with interactive permission prompts", async () => {
    const queue = new AsyncQueue<AIEvent>();
    const respondToPermission = vi.fn((_id: string, _decision: PermissionDecision) => Promise.resolve());
    services.ai = {
      id: "interactive",
      startTurn: () => ({ events: queue, cancel: () => Promise.resolve() }),
      respondToPermission,
    };
    const { user, composer } = await openChat("/projects/atlas/sessions/s-docs");
    await user.type(composer, "Run the tests{Enter}");

    queue.push({ type: "message_start", messageId: "m1" });
    queue.push({ type: "permission_request", id: "p1", tool: "Bash", input: '{"command":"npm test"}' });
    const prompt = await screen.findByRole("alertdialog", { name: "Allow Claude to use Bash?" });
    expect(prompt).toHaveAccessibleDescription("npm test");
    expect(within(prompt).getByRole("button", { name: "Deny" })).toHaveFocus();
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent("Waiting for your permission");

    await user.click(within(prompt).getByRole("button", { name: "Allow once" }));

    expect(respondToPermission).toHaveBeenCalledWith("p1", "allow");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(composer).toHaveFocus();
    queue.close();
  });
});

describe("agent chats", () => {
  it("opens a read-only agent chat from the tool card and lists it in the sidebar", async () => {
    const { user } = await openChat("/projects/atlas/sessions/s-auth");

    await user.click(await within(conversation()).findByRole("link", { name: "Open agent chat" }));

    await waitFor(() => expect(currentPath()).toBe("/projects/atlas/sessions/s-auth/agents/agent-1"));
    expect(await screen.findByRole("heading", { level: 2, name: "code-reviewer" })).toBeInTheDocument();
    expect(screen.getByText("Review the fix", { selector: "header *" })).toBeInTheDocument();
    const log = screen.getByRole("log", { name: "Agent conversation" });
    expect(within(log).getByRole("article", { name: "Main chat message" })).toHaveTextContent("Review the login fix");
    expect(within(log).getByRole("article", { name: "code-reviewer message" })).toHaveTextContent(
      "The fix looks correct",
    );
    expect(screen.queryByRole("textbox", { name: "Message" })).not.toBeInTheDocument();
    expect(document.title).toBe("code-reviewer · atlas · Crowe Harness");

    const agents = within(sidebar()).getByRole("list", { name: "Agent chats" });
    expect(within(agents).getByRole("link", { name: "code-reviewer" })).toHaveAttribute("aria-current", "page");

    await user.click(screen.getByRole("link", { name: "Back to chat" }));
    await waitFor(() => expect(currentPath()).toBe("/projects/atlas/sessions/s-auth"));
  });

  it("opened directly, still loads its parent chat for the sidebar and breadcrumb", async () => {
    await renderApp("/projects/atlas/sessions/s-auth/agents/agent-1");

    const agents = await within(await screen.findByRole("navigation", { name: "Main" })).findByRole("list", {
      name: "Agent chats",
    });
    expect(within(agents).getByRole("link", { name: "code-reviewer" })).toHaveAttribute("aria-current", "page");
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByRole("link", { name: "Fix the login bug" })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("code-reviewer · atlas · Crowe Harness"));
  });

  it("shows a not-found state for an unknown agent", async () => {
    await renderApp("/projects/atlas/sessions/s-auth/agents/nope");
    expect(await screen.findByRole("alert")).toHaveTextContent(/Agent chat not found/);
  });
});
