import { create } from "zustand";
import type { InstallChannel, InstallPhase, InstallPlan } from "@/features/ai/installer";
import { services } from "@/features/ai/services";
import { toNativeError } from "@/features/native/client";
import type { ClaudeInstall } from "@/features/native/contract";
import { RateEstimator } from "@/lib/transfer";
import { useAuthStore } from "./authStore";

/** Timing of the install flow. Mutable so tests can shorten it. */
export const installTiming = {
  /** How long "Claude Code … installed" stays on screen before the sign-in status is re-checked. */
  successDelayMs: 1_500,
  /** Clock used for speed and time-left estimates. */
  now: (): number => Date.now(),
};

export type PlanState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; plan: InstallPlan }
  | { status: "error"; code: string; message: string };

export type InstallStep =
  | { step: "idle" }
  /** The consent panel is open (plan details, channel choice, Install / Cancel). */
  | { step: "confirming" }
  | {
      step: "running";
      channel: InstallChannel;
      phase: InstallPhase;
      receivedBytes: number;
      totalBytes: number;
      startedAt: number;
      /** Smoothed download speed; undefined until it can be estimated. */
      bytesPerSecond: number | undefined;
      secondsLeft: number | undefined;
      /** Cancel was requested; waiting for the installer to confirm. */
      cancelling: boolean;
    }
  /** `rechecked`: the sign-in status was re-checked and Claude Code was still not found. */
  | { step: "done"; install: ClaudeInstall; rechecked: boolean }
  | { step: "error"; code: string; message: string }
  | { step: "cancelled" };

interface InstallState {
  channel: InstallChannel;
  plan: PlanState;
  install: InstallStep;
  /** Opens the consent panel and loads a fresh plan. */
  openConsent: () => void;
  closeConsent: () => void;
  setChannel: (channel: InstallChannel) => void;
  /** Loads (or reloads) the plan of the selected channel. */
  loadPlan: () => Promise<void>;
  /** Starts installing from the selected channel. Ignored while an install is running. */
  start: () => Promise<void>;
  cancel: () => Promise<void>;
  /** Starts again after an error or a cancelled install. */
  retry: () => Promise<void>;
  /** Leaves the flow (the install screen closed): back to idle unless an install is running. */
  dismiss: () => void;
  /** Stops following the current install and plan request (tests, teardown). */
  reset: () => void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let planRequest = 0;
let installRun = 0;
let activeCancel: (() => Promise<void>) | undefined;

export const useInstallStore = create<InstallState>()((set, get) => ({
  channel: "stable",
  plan: { status: "idle" },
  install: { step: "idle" },

  openConsent: () => {
    if (get().install.step === "running") return;
    set({ install: { step: "confirming" } });
    void get().loadPlan();
  },

  closeConsent: () => {
    if (get().install.step !== "confirming") return;
    planRequest += 1;
    set({ install: { step: "idle" } });
  },

  setChannel: (channel) => {
    if (channel === get().channel) return;
    set({ channel });
    void get().loadPlan();
  },

  loadPlan: async () => {
    const request = ++planRequest;
    const { channel } = get();
    set({ plan: { status: "loading" } });
    try {
      const plan = await services.installer.plan(channel);
      if (request === planRequest) set({ plan: { status: "ready", plan } });
    } catch (error) {
      const { code, message } = toNativeError(error);
      if (request === planRequest) set({ plan: { status: "error", code, message } });
    }
  },

  start: async () => {
    if (get().install.step === "running") return; // one install at a time
    const run = ++installRun;
    const isCurrent = () => run === installRun;
    const { channel, plan } = get();
    const knownSize = plan.status === "ready" && plan.plan.channel === channel ? plan.plan.sizeBytes : 0;
    const estimator = new RateEstimator();
    set({
      install: {
        step: "running",
        channel,
        phase: "resolving",
        receivedBytes: 0,
        totalBytes: knownSize,
        startedAt: installTiming.now(),
        bytesPerSecond: undefined,
        secondsLeft: undefined,
        cancelling: false,
      },
    });

    const handle = services.installer.start(channel);
    activeCancel = () => handle.cancel();
    let finished = false;
    try {
      for await (const event of handle.events) {
        if (!isCurrent()) return;
        const current = get().install;
        switch (event.type) {
          case "phase":
            if (current.step === "running") set({ install: { ...current, phase: event.phase } });
            break;
          case "progress": {
            if (current.step !== "running") break;
            estimator.sample(event.receivedBytes, installTiming.now());
            set({
              install: {
                ...current,
                receivedBytes: event.receivedBytes,
                totalBytes: event.totalBytes,
                bytesPerSecond: estimator.bytesPerSecond,
                secondsLeft: estimator.secondsLeft(event.receivedBytes, event.totalBytes),
              },
            });
            break;
          }
          case "done":
            finished = true;
            set({ install: { step: "done", install: event.install, rechecked: false } });
            break;
          case "error":
            finished = true;
            set({ install: { step: "error", code: event.code, message: event.message } });
            break;
          case "cancelled":
            finished = true;
            set({ install: { step: "cancelled" } });
            break;
        }
      }
    } catch (error) {
      if (!isCurrent()) return;
      finished = true;
      const { code, message } = toNativeError(error);
      set({ install: { step: "error", code, message } });
    } finally {
      if (isCurrent()) activeCancel = undefined;
    }
    if (!isCurrent()) return;
    if (!finished) {
      set({
        install: { step: "error", code: "unknown", message: "The installer stopped without reporting a result." },
      });
      return;
    }
    if (get().install.step !== "done") return;

    // Show the success briefly, then re-check: the gate moves on to the sign-in screen by itself.
    await sleep(installTiming.successDelayMs);
    if (!isCurrent() || get().install.step !== "done") return;
    await useAuthStore.getState().refresh();
    if (!isCurrent()) return;
    const installed = get().install;
    if (installed.step !== "done") return;
    if (useAuthStore.getState().status?.state === "cli_not_found") {
      set({ install: { ...installed, rechecked: true } });
    } else {
      set({ install: { step: "idle" }, plan: { status: "idle" } });
    }
  },

  cancel: async () => {
    const current = get().install;
    if (current.step !== "running" || current.cancelling || !activeCancel) return;
    set({ install: { ...current, cancelling: true } });
    try {
      await activeCancel();
    } catch {
      // The installer could not be stopped; it keeps running and the user can try again.
      const latest = get().install;
      if (latest.step === "running") set({ install: { ...latest, cancelling: false } });
    }
  },

  retry: async () => {
    const { step } = get().install;
    if (step !== "error" && step !== "cancelled") return;
    await get().start();
  },

  dismiss: () => {
    if (get().install.step === "running") return;
    planRequest += 1;
    set({ install: { step: "idle" }, plan: { status: "idle" } });
  },

  reset: () => {
    planRequest += 1;
    installRun += 1;
    activeCancel = undefined;
  },
}));
