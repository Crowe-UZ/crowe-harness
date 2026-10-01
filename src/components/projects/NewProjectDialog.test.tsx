import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useProjectStore } from "@/stores/projectStore";
import { currentPath, renderApp } from "@/test/renderApp";

async function openDialog() {
  const view = await renderApp("/projects");
  const page = await screen.findByRole("main");
  await view.user.click(within(page).getByRole("button", { name: "New project" }));
  const dialog = await screen.findByRole("dialog", { name: "New project" });
  return { ...view, dialog };
}

describe("NewProjectDialog", () => {
  it("focuses the name field when it opens", async () => {
    const { dialog } = await openDialog();
    expect(within(dialog).getByRole("textbox", { name: /Name/ })).toHaveFocus();
  });

  it("validates the name and moves focus to the first invalid field", async () => {
    const { user, dialog } = await openDialog();
    const name = within(dialog).getByRole("textbox", { name: /Name/ });
    expect(name).not.toHaveAttribute("aria-invalid");

    // Start from another field so the focus move is observable.
    await user.click(within(dialog).getByRole("textbox", { name: "Folder" }));
    await user.click(within(dialog).getByRole("button", { name: "Create project" }));

    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("Enter a project name.");
    expect(name).toHaveFocus();
    expect(useProjectStore.getState().projects).toHaveLength(3);

    await user.type(name, "   ");
    await user.keyboard("{Enter}");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("dialog", { name: "New project" })).toBeInTheDocument();
  });

  it("suggests a folder from the name and the default projects folder", async () => {
    const { user, dialog } = await openDialog();
    await user.type(within(dialog).getByRole("textbox", { name: /Name/ }), "Orion Service!");
    expect(within(dialog).getByRole("textbox", { name: "Folder" })).toHaveAttribute(
      "placeholder",
      "C:\\dev\\orion-service",
    );
  });

  it("creates the project and opens it", async () => {
    const { user, dialog } = await openDialog();

    await user.type(within(dialog).getByRole("textbox", { name: /Name/ }), "  Project Orion  ");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Language" }), "Rust");
    await user.click(within(dialog).getByRole("button", { name: "Create project" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const project = useProjectStore.getState().projects[0];
    expect(project).toMatchObject({ name: "Project Orion", path: "C:\\dev\\project-orion", language: "Rust" });
    await waitFor(() => expect(currentPath()).toBe(`/projects/${project?.id}`));
    expect(await screen.findByRole("heading", { level: 1, name: "Project Orion" })).toBeInTheDocument();
    expect(await screen.findByText("Project Orion added")).toBeInTheDocument();
  });

  it("uses an explicit folder when one is given", async () => {
    const { user, dialog } = await openDialog();
    await user.type(within(dialog).getByRole("textbox", { name: /Name/ }), "Vega");
    await user.type(within(dialog).getByRole("textbox", { name: "Folder" }), "D:\\src\\vega");
    await user.click(within(dialog).getByRole("button", { name: "Create project" }));

    await waitFor(() => expect(useProjectStore.getState().projects[0]?.path).toBe("D:\\src\\vega"));
  });

  it("closes without creating anything on Cancel", async () => {
    const { user, dialog } = await openDialog();
    await user.type(within(dialog).getByRole("textbox", { name: /Name/ }), "Abandoned");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(useProjectStore.getState().projects.map((p) => p.name)).not.toContain("Abandoned");
    expect(currentPath()).toBe("/projects");
  });
});
