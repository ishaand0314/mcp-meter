import * as fs from 'fs';

/**
 * Utilities for `--watch`: debouncing bursts of file-change events into a
 * single re-run, and registering/tearing down the underlying file watchers.
 * Kept dependency-free (Node's built-in `fs.watch` only) and decoupled from
 * the CLI's report-printing logic so the debounce/trigger behavior can be
 * unit tested in isolation, without touching the real filesystem or timers.
 */

export interface DebouncedTriggerOptions {
  onChange: () => void | Promise<void>;
  /** Quiet period after the last event before onChange actually fires. */
  debounceMs?: number;
}

export interface DebouncedTrigger {
  /** Feed a raw change event in; the actual re-run fires at most once per debounce window. */
  notify: () => void;
  /** Cancel any pending scheduled run (used on shutdown). */
  cancel: () => void;
}

const DEFAULT_DEBOUNCE_MS = 250;

/**
 * Wraps a callback so that a burst of rapid change events (editors and OSes
 * routinely fire several fs.watch events for a single logical save - a
 * temp-file-then-rename, multiple write() calls, etc.) collapses into a
 * single re-run, at most once per `debounceMs` quiet period.
 */
export function createDebouncedTrigger(options: DebouncedTriggerOptions): DebouncedTrigger {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function notify(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void options.onChange();
    }, debounceMs);
  }

  function cancel(): void {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  return { notify, cancel };
}

/** The minimal shape of an fs.watch() return value that watchFiles depends on. */
export interface MinimalWatcher {
  close: () => void;
}

export type WatchFn = (path: string, listener: () => void) => MinimalWatcher;

/**
 * Registers a file watcher on every given path, debouncing bursts of change
 * events into a single `onChange` call. Returns a `stop()` function that
 * cancels any pending debounced run and closes every underlying watcher -
 * call it on shutdown (e.g. SIGINT) to avoid dangling watchers or a zombie
 * process that never exits.
 *
 * `watchFn` defaults to Node's built-in `fs.watch` and is only overridable so
 * the debounce/registration logic can be unit tested without touching the
 * real filesystem.
 */
export function watchFiles(
  paths: string[],
  onChange: () => void | Promise<void>,
  watchFn: WatchFn = fs.watch as unknown as WatchFn,
  debounceMs?: number,
): () => void {
  const { notify, cancel } = createDebouncedTrigger({ onChange, debounceMs });
  const watchers = paths.map((p) => watchFn(p, () => notify()));
  return () => {
    cancel();
    for (const w of watchers) {
      try {
        w.close();
      } catch {
        /* ignore - already closed or the underlying fd is gone */
      }
    }
  };
}
