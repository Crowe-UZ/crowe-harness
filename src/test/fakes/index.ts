import { waitFor } from "@testing-library/react";
import { expect } from "vitest";
import { ClaudeCodeAuthService } from "@/features/ai/ClaudeCodeAuthService";
import { ClaudeCodeProvider } from "@/features/ai/ClaudeCodeProvider";
import { services } from "@/features/ai/services";
import { NativeConfigService } from "@/features/config/NativeConfigService";
import { NativeHistoryService } from "@/features/history/NativeHistoryService";
import { NativeFsService } from "@/features/workspace/NativeFsService";
import { FakeNativeClient, type FakeTurn } from "./FakeNativeClient";

export { FakeNativeClient, FakeTurn } from "./FakeNativeClient";
export * as fixtures from "./fixtures";

let current: FakeNativeClient | undefined;

/**
 * Wires the real service implementations to a fresh in-memory native client.
 * Called before every test by src/test/setup.ts; tests reach the fake with `fakeNative()`.
 */
export function installFakeServices(): FakeNativeClient {
  const client = new FakeNativeClient();
  current = client;
  services.ai = new ClaudeCodeProvider(client);
  services.auth = new ClaudeCodeAuthService(client, () => client.desktop);
  services.history = new NativeHistoryService(client);
  services.fs = new NativeFsService(client);
  services.config = new NativeConfigService(client);
  return client;
}

export function fakeNative(): FakeNativeClient {
  if (!current) throw new Error("installFakeServices() has not run");
  return current;
}

/** Waits until the `index`-th turn (0-based) has been started and returns it. */
export async function waitForTurn(index = 0): Promise<FakeTurn> {
  await waitFor(() => expect(fakeNative().turns.length).toBeGreaterThan(index));
  const turn = fakeNative().turns[index];
  if (!turn) throw new Error("unreachable");
  return turn;
}
