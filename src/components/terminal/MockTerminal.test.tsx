import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { navigateTo, renderApp } from "@/test/renderApp";

async function openTerminal(path = "/projects/atlas/sessions/fix-auth") {
  const view = await renderApp(path);
  await view.user.click(await screen.findByRole("tab", { name: "Terminal" }));
  const output = await screen.findByRole("log", { name: "Terminal output" });
  const input = screen.getByRole("textbox", { name: "Terminal command" });
  return { ...view, output, input };
}

describe("MockTerminal", () => {
  it("echoes commands without executing them", async () => {
    const { user, output, input } = await openTerminal();
    expect(output).toHaveTextContent("$ pnpm test");

    await user.type(input, "rm -rf node_modules{Enter}");

    expect(input).toHaveValue("");
    expect(within(output).getByText("$ rm -rf node_modules")).toBeInTheDocument();
    expect(
      within(output).getByText("Command execution is disabled in this version (demo terminal)."),
    ).toBeInTheDocument();
    expect(screen.getByText("Demo · commands are not executed")).toBeInTheDocument();
  });

  it("ignores empty commands", async () => {
    const { user, output, input } = await openTerminal();
    const before = output.textContent;

    await user.type(input, "   {Enter}");

    expect(output.textContent).toBe(before);
  });

  it.each(["clear", "cls"])("clears the output with the %s command", async (command) => {
    const { user, output, input } = await openTerminal();

    await user.type(input, `${command}{Enter}`);

    expect(output.textContent).toBe("");
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
  });

  it("clears the output with the Clear button", async () => {
    const { user, output } = await openTerminal();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(output.textContent).toBe("");
  });

  it("keeps history per project across tab and project switches", async () => {
    const { user, input } = await openTerminal();
    await user.type(input, "ls -la{Enter}");

    await user.click(screen.getByRole("tab", { name: "Chat" }));
    await user.click(screen.getByRole("tab", { name: "Terminal" }));

    expect(await screen.findByText("$ ls -la")).toBeInTheDocument();

    await navigateTo("/projects/mercury");
    await user.click(await screen.findByRole("tab", { name: "Terminal" }));
    const mercuryOutput = await screen.findByRole("log", { name: "Terminal output" });
    expect(mercuryOutput).not.toHaveTextContent("$ ls -la");
    expect(mercuryOutput).toHaveTextContent("$ pnpm test");

    await navigateTo("/projects/atlas");
    expect(await screen.findByText("$ ls -la")).toBeInTheDocument();
  });
});
