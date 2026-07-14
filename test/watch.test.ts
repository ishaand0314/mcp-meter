import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDebouncedTrigger, watchFiles, WatchFn, MinimalWatcher } from '../src/watch';

describe('createDebouncedTrigger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('collapses a burst of rapid notify() calls into a single onChange invocation', () => {
    const onChange = vi.fn();
    const { notify } = createDebouncedTrigger({ onChange, debounceMs: 100 });

    notify();
    notify();
    notify();
    expect(onChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('fires again for a later, separate burst', () => {
    const onChange = vi.fn();
    const { notify } = createDebouncedTrigger({ onChange, debounceMs: 50 });

    notify();
    vi.advanceTimersByTime(50);
    expect(onChange).toHaveBeenCalledTimes(1);

    notify();
    notify();
    vi.advanceTimersByTime(50);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('does not fire before the debounce window elapses', () => {
    const onChange = vi.fn();
    const { notify } = createDebouncedTrigger({ onChange, debounceMs: 100 });
    notify();
    vi.advanceTimersByTime(99);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('cancel() prevents a pending run from ever firing', () => {
    const onChange = vi.fn();
    const { notify, cancel } = createDebouncedTrigger({ onChange, debounceMs: 100 });
    notify();
    cancel();
    vi.advanceTimersByTime(500);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('uses a sensible default debounce when none is given', () => {
    const onChange = vi.fn();
    const { notify } = createDebouncedTrigger({ onChange });
    notify();
    vi.advanceTimersByTime(249);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('watchFiles', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** A fake fs.watch()-shaped function: records every listener it's given and
   * every path it was asked to watch, and returns a closeable handle, so the
   * re-run trigger logic can be exercised without touching the real
   * filesystem or real timers. */
  function makeFakeWatchFn() {
    const listeners: Array<() => void> = [];
    const closeFns: Array<ReturnType<typeof vi.fn>> = [];
    const watchedPaths: string[] = [];
    const watchFn: WatchFn = vi.fn((p: string, listener: () => void): MinimalWatcher => {
      watchedPaths.push(p);
      listeners.push(listener);
      const close = vi.fn();
      closeFns.push(close);
      return { close };
    });
    return { watchFn, listeners, closeFns, watchedPaths };
  }

  it('registers one watcher per path and re-invokes the analysis function once per debounced burst', () => {
    const onChange = vi.fn();
    const { watchFn, listeners, watchedPaths } = makeFakeWatchFn();

    const stop = watchFiles(['/a/config.json', '/b/config.json'], onChange, watchFn, 100);

    expect(watchFn).toHaveBeenCalledTimes(2);
    expect(watchedPaths).toEqual(['/a/config.json', '/b/config.json']);

    // Simulate a burst of change events firing across both watched files -
    // this mimics what fs.watch does for a single logical save.
    listeners[0]();
    listeners[1]();
    listeners[0]();
    expect(onChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(onChange).toHaveBeenCalledTimes(1);

    stop();
  });

  it('re-invokes onChange again for a second change burst after the first has fired', () => {
    const onChange = vi.fn();
    const { watchFn, listeners } = makeFakeWatchFn();
    watchFiles(['/only.json'], onChange, watchFn, 50);

    listeners[0]();
    vi.advanceTimersByTime(50);
    expect(onChange).toHaveBeenCalledTimes(1);

    listeners[0]();
    vi.advanceTimersByTime(50);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('stop() cancels any pending debounced run and closes every watcher (no dangling watchers)', () => {
    const onChange = vi.fn();
    const { watchFn, listeners, closeFns } = makeFakeWatchFn();
    const stop = watchFiles(['/a.json', '/b.json'], onChange, watchFn, 100);

    listeners[0](); // schedule a pending run
    stop();

    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled(); // cancelled, never fires
    for (const close of closeFns) {
      expect(close).toHaveBeenCalledTimes(1);
    }
  });
});
