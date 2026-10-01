import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MockAIProvider } from "@/features/ai/MockAIProvider";
import { services } from "@/features/ai/services";
import { useChatStore } from "@/stores/chatStore";
import { useSessionStore } from "@/stores/sessionStore";
import { renderApp } from "@/test/renderApp";
import { ScriptedProvider } from "@/test/scriptedProvider";

/** Opens a fresh, empty session of Project Atlas. */
async function openNewSession() {
  const session = useSessionStore.getState().createSession("atlas", "Scratch");
  const view = await renderApp(`/projects/atlas/sessions/${session.id}`);
  const composer = await screen.findByRole("textbox", { name: "Message" });
  const conversation = screen.getByRole("log", { name: "Conversation" });
  return { ...view, session, composer, conversation };
}

describe("Composer", () => {
  it("sends with Enter and shows the streamed reply", async () => {
    const { user, composer, conversation } = await openNewSession();
    expect(within(conversation).getByText("Start the conversation")).toBeInTheDocument();

    await user.type(composer, "Add input validation{Enter}");

    expect(composer).toHaveValue("");
    const mine = await within(conversation).findByRole("article", { name: "Your message" });
    expect(mine).toHaveTextContent("Add input validation");
    const reply = await within(conversation).findByRole("article", { name: "Assistant message" });
    await waitFor(() =>
      expect(reply).toHaveTextContent(/Demo response from the mock runtime for "Add input validation"/),
    );
    await waitFor(() => expect(reply).not.toHaveAttribute("aria-busy"));
  });

  it("inserts a new line with Shift+Enter instead of sending", async () => {
    const { user, composer, conversation } = await openNewSession();

    await user.type(composer, "First line{Shift>}{Enter}{/Shift}Second line");

    expect(composer).toHaveValue("First line\nSecond line");
    expect(within(conversation).queryByRole("article")).not.toBeInTheDocument();
  });

  it("does not send whitespace-only messages", async () => {
    const { user, composer, conversation, session } = await openNewSession();
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toHaveAttribute("aria-disabled", "true");

    await user.type(composer, "   {Enter}");
    await user.click(send);

    expect(send).toHaveAttribute("aria-disabled", "true");
    expect(within(conversation).queryByRole("article")).not.toBeInTheDocument();
    expect(useChatStore.getState().conversations[session.id]).toBeUndefined();
  });

  it("uses one button that turns into Stop while the reply runs and back to Send", async () => {
    const provider = new ScriptedProvider();
    provider.interrupt.mockImplementation(() => {
      provider.emit({ type: "message_end", messageId: "m1", stopReason: "interrupted" });
      provider.end();
      return Promise.resolve();
    });
    services.ai = provider;
    const { user, composer, conversation } = await openNewSession();

    await user.type(composer, "Long task");
    const button = screen.getByRole("button", { name: "Send" });
    await user.click(button);

    await waitFor(() => expect(button).toHaveAccessibleName("Stop"));
    expect(button).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Assistant is responding");
    provider.emit({ type: "message_start", messageId: "m1" }, { type: "text_delta", messageId: "m1", text: "Halfway" });
    await within(conversation).findByText("Halfway");

    await user.click(button);

    await waitFor(() => expect(button).toHaveAccessibleName("Send"));
    expect(button).toHaveFocus();
    expect(provider.interrupt).toHaveBeenCalledTimes(1);
    expect(within(conversation).getByText("Stopped")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("shows runtime errors in an alert", async () => {
    const provider = new ScriptedProvider();
    provider.startSession.mockRejectedValue(new Error("Claude Code is not installed"));
    services.ai = provider;
    const { user, composer } = await openNewSession();

    await user.type(composer, "Hello{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("Claude Code is not installed");
  });
});

describe("PermissionPrompt", () => {
  async function sendUntilPermission() {
    services.ai = new MockAIProvider({ chunkDelayMs: 0, stepDelayMs: 0, askPermissionFor: ["Bash"] });
    const view = await openNewSession();
    await view.user.type(view.composer, "Run the tests{Enter}");
    const prompt = await screen.findByRole("alertdialog", { name: "Allow Claude to use Bash?" });
    return { ...view, prompt };
  }

  it("moves focus to Deny and describes the request", async () => {
    const { prompt } = await sendUntilPermission();

    expect(prompt).toHaveAccessibleDescription("Running tests");
    expect(within(prompt).getByRole("button", { name: "Deny" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for your permission");
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });

  it("allowing hides the prompt, returns focus to the composer and finishes the reply", async () => {
    const { user, prompt, composer, conversation } = await sendUntilPermission();

    await user.click(within(prompt).getByRole("button", { name: "Allow once" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(composer).toHaveFocus();
    const reply = within(conversation).getByRole("article", { name: "Assistant message" });
    await waitFor(() => expect(reply).toHaveTextContent(/Demo response/));
    expect(within(reply).getByRole("list", { name: "Activity" })).toHaveTextContent(/Running tests.*Done/);
  });

  it("denying marks the step as failed and returns focus to the composer", async () => {
    const { user, prompt, composer, conversation } = await sendUntilPermission();

    await user.keyboard("{Enter}"); // Deny has focus

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(composer).toHaveFocus();
    const reply = within(conversation).getByRole("article", { name: "Assistant message" });
    await waitFor(() => expect(reply).toHaveTextContent(/Demo response/));
    expect(within(reply).getByRole("list", { name: "Activity" })).toHaveTextContent(/Running tests.*Failed/);
    expect(prompt).not.toBeInTheDocument();
  });
});
