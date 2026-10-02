/** Helpers for showing download progress: sizes, speed and time left. */

const MB = 1024 * 1024;

/** "98.4 MB" (binary megabytes, one decimal; "0.4 MB" for small values). */
export function formatMegabytes(bytes: number): string {
  const value = Math.max(0, bytes) / MB;
  return `${value.toFixed(1)} MB`;
}

/** "4.2 MB/s"; below 0.1 MB/s in KB/s. */
export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond < MB / 10) return `${Math.max(0, Math.round(bytesPerSecond / 1024))} KB/s`;
  return `${(bytesPerSecond / MB).toFixed(1)} MB/s`;
}

/** "About 20 seconds left" / "About 3 minutes left" / "Less than 5 seconds left". */
export function formatTimeLeft(seconds: number): string {
  if (seconds < 5) return "Less than 5 seconds left";
  if (seconds < 60) {
    const rounded = Math.max(5, Math.round(seconds / 5) * 5);
    return `About ${rounded} seconds left`;
  }
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "About 1 minute left" : `About ${minutes} minutes left`;
}

/**
 * Smoothed transfer rate. Samples closer together than `minIntervalMs` are merged so bursts of
 * progress events do not make the speed jump; the rate is an exponential moving average.
 */
export class RateEstimator {
  private lastAt: number | undefined;
  private lastBytes = 0;
  private average: number | undefined;

  constructor(
    private readonly smoothing = 0.3,
    private readonly minIntervalMs = 500,
  ) {}

  /** Records that `bytes` have been received at time `at` (ms). */
  sample(bytes: number, at: number): void {
    if (this.lastAt === undefined || bytes < this.lastBytes) {
      // First sample, or the transfer restarted (e.g. a retried download): start over.
      this.lastAt = at;
      this.lastBytes = bytes;
      this.average = undefined;
      return;
    }
    const elapsed = at - this.lastAt;
    if (elapsed < this.minIntervalMs) return;
    const rate = ((bytes - this.lastBytes) * 1000) / elapsed;
    this.average = this.average === undefined ? rate : this.smoothing * rate + (1 - this.smoothing) * this.average;
    this.lastAt = at;
    this.lastBytes = bytes;
  }

  /** Bytes per second, or undefined until there are two samples far enough apart. */
  get bytesPerSecond(): number | undefined {
    return this.average;
  }

  /** Seconds until `totalBytes`, or undefined while the rate is unknown or zero. */
  secondsLeft(receivedBytes: number, totalBytes: number): number | undefined {
    const rate = this.average;
    if (rate === undefined || rate <= 0) return undefined;
    return Math.max(0, totalBytes - receivedBytes) / rate;
  }
}
