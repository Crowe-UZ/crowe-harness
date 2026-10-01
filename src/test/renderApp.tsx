import { act, render, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "@/App";
import { router } from "@/app/router";

/** Navigates the app's module-level hash router (wrapped in act so mounted routes settle). */
export async function navigateTo(path: string): Promise<void> {
  await act(() => router.navigate(path));
}

/** Current route as "pathname?search", e.g. "/settings?tab=appearance". */
export function currentPath(): string {
  const { pathname, search } = router.state.location;
  return `${pathname}${search}`;
}

/**
 * Renders the whole app (providers + router) at `path`. The router is a module singleton,
 * so every render first resets it to the requested route.
 */
export async function renderApp(path = "/"): Promise<RenderResult & { user: ReturnType<typeof userEvent.setup> }> {
  await navigateTo(path);
  const user = userEvent.setup();
  const view = render(<App />);
  return { ...view, user };
}
