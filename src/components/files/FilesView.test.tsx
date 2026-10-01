import { act, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeNative } from "@/test/fakes";
import { renderApp } from "@/test/renderApp";

async function openFiles(path = "/projects/atlas/sessions/s-docs") {
  const view = await renderApp(path);
  await view.user.click(await screen.findByRole("tab", { name: "Files" }));
  const tree = await screen.findByRole("tree", { name: "atlas files" });
  return { ...view, tree };
}

const item = (name: string) => screen.getByRole("treeitem", { name });
const names = (tree: HTMLElement) =>
  within(tree)
    .getAllByRole("treeitem")
    .map((el) => el.textContent);

describe("FilesView", () => {
  it("lists the project root lazily, folders collapsed and nothing selected", async () => {
    const { tree } = await openFiles();

    expect(names(tree)).toEqual(["src", "README.md", "logo.png", "build.log"]);
    expect(item("src")).toHaveAttribute("aria-expanded", "false");
    expect(item("src")).toHaveAttribute("tabindex", "0");
    expect(fakeNative().fsListDir).toHaveBeenCalledTimes(1);
    expect(fakeNative().fsListDir).toHaveBeenCalledWith("atlas", "");
    expect(screen.getByText("Select a file")).toBeInTheDocument();
  });

  it("loads folders on expand and supports arrow-key navigation", async () => {
    const { user, tree } = await openFiles();
    act(() => item("src").focus());

    await user.keyboard("{ArrowRight}");
    await within(tree).findByRole("treeitem", { name: "auth" });
    expect(fakeNative().fsListDir).toHaveBeenCalledWith("atlas", "src");
    expect(item("src")).toHaveAttribute("aria-expanded", "true");
    expect(item("auth")).toHaveAttribute("aria-level", "2");

    await user.keyboard("{ArrowRight}");
    expect(item("auth")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await within(tree).findByRole("treeitem", { name: "login.ts" })).toHaveAttribute("aria-level", "3");

    await user.keyboard("{ArrowDown}{Enter}");
    expect(item("login.ts")).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("export function login() {}")).toBeInTheDocument();
    expect(fakeNative().fsReadFile).toHaveBeenCalledWith("atlas", "src/auth/login.ts");

    await user.keyboard("{ArrowLeft}");
    expect(item("auth")).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.queryByRole("treeitem", { name: "login.ts" })).not.toBeInTheDocument();
  });

  it("previews a file with line numbers", async () => {
    const { user } = await openFiles();

    await user.click(item("README.md"));

    const content = await screen.findByRole("region", { name: "File content" });
    expect(content).toHaveTextContent("# Atlas");
    expect(content).toHaveTextContent("A sample project.");
    expect(content).toHaveTextContent(/^1\s*2\s*3/);
  });

  it("explains binary and truncated files", async () => {
    const { user } = await openFiles();

    await user.click(item("logo.png"));
    expect(await screen.findByText("Binary file")).toBeInTheDocument();

    await user.click(item("build.log"));
    expect(await screen.findByText(/only the first 1 MB is shown/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "File content" })).toHaveTextContent("step 2");
  });

  it("keeps the selection and expanded folders when switching tabs", async () => {
    const { user } = await openFiles();
    await user.click(item("src"));
    await screen.findByRole("treeitem", { name: "app.ts" });
    await user.click(item("app.ts"));
    await screen.findByRole("region", { name: "File content" });

    await user.click(screen.getByRole("tab", { name: "Chat" }));
    await user.click(screen.getByRole("tab", { name: "Files" }));

    expect(await screen.findByRole("treeitem", { name: "app.ts" })).toHaveAttribute("aria-selected", "true");
    expect(fakeNative().fsListDir).toHaveBeenCalledTimes(2);
  });

  it("shows an error with retry when the tree cannot be read", async () => {
    fakeNative().fail("fsListDir", "Access denied");
    const view = await renderApp("/projects/atlas/sessions/s-docs");
    await view.user.click(await screen.findByRole("tab", { name: "Files" }));

    expect(await screen.findByText("Could not load files")).toBeInTheDocument();
    expect(screen.getByText("Access denied")).toBeInTheDocument();

    fakeNative().recover("fsListDir");
    await view.user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("tree", { name: "atlas files" })).toBeInTheDocument();
  });

  it("retries a folder that failed to load from inside the tree", async () => {
    const { user, tree } = await openFiles();
    fakeNative().fail("fsListDir", "Folder is locked");

    await user.click(item("src"));
    const error = await within(tree).findByRole("treeitem", { name: /Could not load this folder: Folder is locked/ });

    fakeNative().recover("fsListDir");
    await user.click(error);
    expect(await within(tree).findByRole("treeitem", { name: "auth" })).toBeInTheDocument();
  });

  it("shows an error when a file cannot be opened", async () => {
    const { user } = await openFiles();
    fakeNative().fail("fsReadFile", "File vanished");

    await user.click(item("README.md"));

    expect(await screen.findByText("Could not open file")).toBeInTheDocument();
    expect(screen.getByText("File vanished")).toBeInTheDocument();
  });
});
