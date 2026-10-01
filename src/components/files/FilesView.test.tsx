import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { services } from "@/features/ai/services";
import { renderApp } from "@/test/renderApp";

async function openFiles() {
  const view = await renderApp("/projects/atlas/sessions/fix-auth");
  await view.user.click(await screen.findByRole("tab", { name: "Files" }));
  const tree = await screen.findByRole("tree", { name: "Project Atlas files" });
  return { ...view, tree };
}

const item = (name: string) => screen.getByRole("treeitem", { name });

describe("FilesView", () => {
  it("shows the project tree with every folder expanded and nothing selected", async () => {
    const { tree } = await openFiles();

    expect(
      within(tree)
        .getAllByRole("treeitem")
        .map((el) => el.textContent),
    ).toEqual([
      "src",
      "auth",
      "login.ts",
      "session.ts",
      "middleware.ts",
      "app.ts",
      "tests",
      "auth.test.ts",
      "package.json",
      "README.md",
      "CLAUDE.md",
    ]);
    expect(item("src")).toHaveAttribute("aria-expanded", "true");
    expect(item("auth")).toHaveAttribute("aria-level", "2");
    expect(item("src")).toHaveAttribute("tabindex", "0");
    expect(screen.getByText("Select a file")).toBeInTheDocument();
  });

  it("supports arrow-key navigation, expand/collapse and opening a file with Enter", async () => {
    const { user } = await openFiles();
    act(() => item("src").focus());

    await user.keyboard("{ArrowDown}");
    expect(item("auth")).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(item("auth")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("treeitem", { name: "login.ts" })).not.toBeInTheDocument();
    expect(item("auth")).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(item("auth")).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{ArrowRight}");
    expect(item("login.ts")).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(item("login.ts")).toHaveAttribute("aria-selected", "true");
    const preview = screen.getByRole("region", { name: "File preview" });
    expect(within(preview).getByText("src/auth/login.ts")).toBeInTheDocument();
    expect(
      await within(preview).findByText("export async function login({ email, password }: LoginInput) {"),
    ).toBeInTheDocument();

    await user.keyboard("{ArrowLeft}");
    expect(item("auth")).toHaveFocus();

    await user.keyboard("{End}");
    expect(item("CLAUDE.md")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(item("src")).toHaveFocus();
  });

  it("keeps the selection when switching tabs", async () => {
    const { user } = await openFiles();
    await user.click(item("README.md"));
    expect(await screen.findByText("# Project Atlas")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Chat" }));
    await user.click(screen.getByRole("tab", { name: "Files" }));

    expect(await screen.findByRole("treeitem", { name: "README.md" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("# Project Atlas")).toBeInTheDocument();
  });

  it("shows an error with a retry when the tree cannot be loaded", async () => {
    const tree = vi.spyOn(services.fs, "tree").mockRejectedValueOnce(new Error("Disk unavailable"));
    const view = await renderApp("/projects/atlas/sessions/fix-auth");
    await view.user.click(await screen.findByRole("tab", { name: "Files" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not load files.*Disk unavailable/);

    await view.user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("tree", { name: "Project Atlas files" })).toBeInTheDocument();
    expect(tree).toHaveBeenCalledTimes(2);
  });

  it("shows an error when a file cannot be read", async () => {
    vi.spyOn(services.fs, "read").mockRejectedValueOnce(new Error("Permission denied"));
    const { user } = await openFiles();

    await user.click(item("app.ts"));

    await waitFor(() =>
      expect(screen.getByRole("region", { name: "File preview" })).toHaveTextContent(
        /Could not open file.*Permission denied/,
      ),
    );
  });
});
