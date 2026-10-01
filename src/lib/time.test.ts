import { describe, expect, it } from "vitest";
import { formatRelativeTime, greeting } from "./time";

const NOW = new Date("2026-10-01T15:00:00Z").getTime();
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("formatRelativeTime", () => {
  it.each([
    [30_000, "just now"],
    [60_000, "1 minute ago"],
    [10 * 60_000, "10 minutes ago"],
    [3 * 3_600_000, "3 hours ago"],
    [26 * 3_600_000, "yesterday"],
    [4 * 86_400_000, "4 days ago"],
  ])("formats %i ms ago as %s", (msAgo, expected) => {
    expect(formatRelativeTime(at(msAgo), NOW)).toBe(expected);
  });

  it("returns an empty string for invalid input", () => {
    expect(formatRelativeTime("not-a-date", NOW)).toBe("");
  });
});

describe("greeting", () => {
  it.each([
    [8, "Good morning"],
    [14, "Good afternoon"],
    [20, "Good evening"],
    [2, "Good evening"],
  ])("at %i:00 says %s", (hour, expected) => {
    expect(greeting(new Date(2026, 9, 1, hour, 0, 0))).toBe(expected);
  });
});
