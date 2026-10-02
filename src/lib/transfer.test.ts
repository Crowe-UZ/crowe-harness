import { describe, expect, it } from "vitest";
import { formatMegabytes, formatSpeed, formatTimeLeft, RateEstimator } from "./transfer";

const MB = 1024 * 1024;

describe("formatting", () => {
  it("formats sizes in megabytes with one decimal", () => {
    expect(formatMegabytes(0)).toBe("0.0 MB");
    expect(formatMegabytes(100 * MB)).toBe("100.0 MB");
    expect(formatMegabytes(1.25 * MB)).toBe("1.3 MB");
  });

  it("formats speed in MB/s, small rates in KB/s", () => {
    expect(formatSpeed(4.2 * MB)).toBe("4.2 MB/s");
    expect(formatSpeed(50 * 1024)).toBe("50 KB/s");
  });

  it("rounds the time left to friendly values", () => {
    expect(formatTimeLeft(2)).toBe("Less than 5 seconds left");
    expect(formatTimeLeft(22)).toBe("About 20 seconds left");
    expect(formatTimeLeft(70)).toBe("About 1 minute left");
    expect(formatTimeLeft(185)).toBe("About 3 minutes left");
  });
});

describe("RateEstimator", () => {
  it("has no estimate until two samples are far enough apart", () => {
    const rate = new RateEstimator();
    rate.sample(0, 0);
    rate.sample(MB, 100); // too close: merged into the next sample
    expect(rate.bytesPerSecond).toBeUndefined();
    expect(rate.secondsLeft(MB, 10 * MB)).toBeUndefined();

    rate.sample(2 * MB, 1000);
    expect(rate.bytesPerSecond).toBe(2 * MB);
    expect(rate.secondsLeft(2 * MB, 10 * MB)).toBe(4);
  });

  it("smooths rate changes with a moving average", () => {
    const rate = new RateEstimator(0.5, 0);
    rate.sample(0, 0);
    rate.sample(4 * MB, 1000); // 4 MB/s
    rate.sample(4 * MB, 2000); // stalled for a second: 0 MB/s
    expect(rate.bytesPerSecond).toBe(2 * MB);
  });

  it("starts over when the transfer restarts", () => {
    const rate = new RateEstimator(0.5, 0);
    rate.sample(0, 0);
    rate.sample(4 * MB, 1000);
    rate.sample(0, 1500);
    expect(rate.bytesPerSecond).toBeUndefined();
  });
});
