/** Resolves after `ms` milliseconds; resolves immediately for 0 or negative values (tests). */
export function wait(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
