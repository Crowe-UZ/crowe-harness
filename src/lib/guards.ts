/** Small runtime type guards for untrusted values (persisted state, Radix string callbacks). */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

export function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

/** Keeps only the array items that pass `guard`; returns undefined when `value` is not an array. */
export function filterValid<T>(value: unknown, guard: (item: unknown) => item is T): T[] | undefined {
  return Array.isArray(value) ? value.filter(guard) : undefined;
}
