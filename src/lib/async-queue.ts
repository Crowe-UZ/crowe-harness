/**
 * Push-based async iterable: producers `push()` values and `close()` the queue,
 * a single consumer reads them with `for await`. Values pushed after `close()` are dropped.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = [];
  private closed = false;
  private wake: (() => void) | undefined;

  push(value: T): void {
    if (this.closed) return;
    this.buffer.push(value);
    this.notify();
  }

  close(): void {
    this.closed = true;
    this.notify();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for (;;) {
      const value = this.buffer.shift();
      if (value !== undefined) {
        yield value;
        continue;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => (this.wake = resolve));
    }
  }

  private notify(): void {
    const wake = this.wake;
    this.wake = undefined;
    wake?.();
  }
}
