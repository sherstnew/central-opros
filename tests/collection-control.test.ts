import { afterEach, describe, expect, it, vi } from "vitest";
import { CollectionControl, COLLECTION_TIMEOUT_MS, COLLECTION_STEP_TIMEOUT_MS } from "../server/collection-control";
afterEach(() => vi.useRealTimers());
describe("Collection deadlines", () => {
  it("aborts a stalled operation and rejects subsequent work", async () => {
    vi.useFakeTimers();
    const control = new CollectionControl();
    const pending = control.wait(new Promise(() => {}), "Telegram");
    const result = expect(pending).rejects.toThrow("Telegram не ответил за 90 секунд");
    await vi.advanceTimersByTimeAsync(COLLECTION_STEP_TIMEOUT_MS);
    await result;
    expect(control.signal.aborted).toBe(true);
    expect(() => control.check()).toThrow("Telegram");
    control.close();
  });
  it("stops the run even when individual operations keep finishing", async () => {
    vi.useFakeTimers();
    const control = new CollectionControl();
    for (let i = 0; i < 9; i++) {
      await control.wait(Promise.resolve(i), "ИИ");
      await vi.advanceTimersByTimeAsync(60_000);
    }
    await vi.advanceTimersByTimeAsync(COLLECTION_TIMEOUT_MS - 9 * 60_000);
    expect(() => control.check()).toThrow("10 минут");
    control.close();
  });
});
