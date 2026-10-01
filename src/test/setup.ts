import "@testing-library/jest-dom/vitest";
// RTL only auto-cleans when Vitest globals are enabled; they are not, so unmount explicitly below.
// eslint-disable-next-line testing-library/no-manual-cleanup
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import type { StoreApi } from "zustand";
import { services, type Services } from "@/features/ai/services";
import { authTiming, useAuthStore } from "@/stores/authStore";
import { useChatStore } from "@/stores/chatStore";
import { useProjectStore } from "@/stores/projectStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { installFakeServices } from "./fakes";
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

// --- Fake native runtime, zero delays -------------------------------------------

const realServices: Services = { ...services };
const realTiming = { ...authTiming };

beforeEach(() => {
  // Real service implementations over an in-memory native client (signed in with a subscription by default).
  installFakeServices();
  // Sign-in polling yields to the event loop but never waits.
  authTiming.pollIntervalMs = 0;
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
  // Abandon in-flight turns and sign-in polling held outside the zustand state.
  useChatStore.getState().reset();
  useAuthStore.getState().reset();
  for (const store of stores) store.resetToInitial();
  // After the store resets: persisted stores write their initial state back to storage.
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.className = "";
  document.title = "";
  resetMatchMedia();
  Object.assign(services, realServices);
  Object.assign(authTiming, realTiming);
});
