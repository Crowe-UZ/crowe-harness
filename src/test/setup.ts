import "@testing-library/jest-dom/vitest";
// RTL only auto-cleans when Vitest globals are enabled; they are not, so unmount explicitly below.
// eslint-disable-next-line testing-library/no-manual-cleanup
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import type { StoreApi } from "zustand";
import { MockAIProvider } from "@/features/ai/MockAIProvider";
import { MockAuthService } from "@/features/ai/MockAuthService";
import { services, type Services } from "@/features/ai/services";
import { MockFsService } from "@/features/workspace/MockFsService";
import { useAuthStore } from "@/stores/authStore";
import { useChatStore } from "@/stores/chatStore";
import { useProjectStore } from "@/stores/projectStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { installMatchMedia, resetMatchMedia } from "./matchMedia";

// --- jsdom gaps used by the UI ------------------------------------------------

installMatchMedia();

if (!("ResizeObserver" in window)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, "ResizeObserver", { configurable: true, writable: true, value: ResizeObserverStub });
}

if (!("scrollIntoView" in Element.prototype)) {
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: () => {} });
}

// --- Fast, deterministic services ---------------------------------------------

const realServices: Services = { ...services };

beforeEach(() => {
  // No delays and no permission prompts unless a test opts in (by assigning its own provider).
  services.ai = new MockAIProvider({ chunkDelayMs: 0, stepDelayMs: 0 });
  services.auth = new MockAuthService(undefined, 0);
  services.fs = new MockFsService(0);
});

// --- Isolation: every test starts from a fresh app state -----------------------

type ResettableStore = { resetToInitial: () => void };
const resettable = <T>(store: Pick<StoreApi<T>, "setState" | "getInitialState">): ResettableStore => ({
  // replace=true: drop keys a test may have added, restore the exact initial snapshot (pre-hydration).
  resetToInitial: () => store.setState(store.getInitialState(), true),
});

const stores: ResettableStore[] = [
  resettable(useProjectStore),
  resettable(useSessionStore),
  resettable(useChatStore),
  resettable(useSettingsStore),
  resettable(useAuthStore),
  resettable(useUiStore),
  resettable(useWorkspaceStore),
];

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // Abandon in-flight chat turns and live runtime sessions held outside the zustand state.
  useChatStore.getState().reset();
  for (const store of stores) store.resetToInitial();
  // After the store resets: persisted stores write their initial state back to storage.
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.className = "";
  document.title = "";
  resetMatchMedia();
  Object.assign(services, realServices);
});
