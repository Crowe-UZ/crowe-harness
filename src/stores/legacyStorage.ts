/**
 * Storage keys written by the mock-era UI (M1). Projects and chats now come from
 * Claude Code history, so these snapshots are obsolete and only take space.
 */
export const LEGACY_STORAGE_KEYS = ["crowe-harness.projects", "crowe-harness.sessions"] as const;

/** Removes obsolete persisted state. Safe to call on every start; never throws. */
export function dropLegacyStorage(storage: Storage | undefined = globalThis.localStorage): void {
  if (!storage) return;
  for (const key of LEGACY_STORAGE_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      // Storage unavailable (private mode, quota): nothing to clean up.
    }
  }
}
