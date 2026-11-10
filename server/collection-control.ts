export const COLLECTION_TIMEOUT_MS = 10 * 60_000;
export const COLLECTION_STEP_TIMEOUT_MS = 90_000;

export class CollectionControl {
  readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private timer = setTimeout(() => this.stop("Сбор остановлен: превышен лимит 10 минут."), COLLECTION_TIMEOUT_MS);
  stop(message: string) { this.controller.abort(new Error(message)); }
  check() { if (this.signal.aborted) throw this.signal.reason; }
  async wait<T>(operation: Promise<T>, label: string): Promise<T> {
    this.check();
    const timer = setTimeout(() => this.stop(`Сбор остановлен: ${label} не ответил за 90 секунд.`), COLLECTION_STEP_TIMEOUT_MS);
    let onAbort: () => void = () => {};
    try {
      const cancelled = new Promise<never>((_, reject) => {
        onAbort = () => reject(this.signal.reason);
        this.signal.addEventListener("abort", onAbort, { once: true });
        if (this.signal.aborted) onAbort();
      });
      const result = await Promise.race([operation, cancelled]);
      this.check();
      return result;
    } finally {
      clearTimeout(timer);
      this.signal.removeEventListener("abort", onAbort);
    }
  }
  close() { clearTimeout(this.timer); }
}
