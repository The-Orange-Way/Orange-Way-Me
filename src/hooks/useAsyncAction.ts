import { useCallback, useRef, useState } from "react";

/**
 * useAsyncAction — single-flight wrapper for async click handlers.
 *
 * Why: every `<Button onClick={async () => { ... }}>` is a double-click
 * vulnerability. The naive pattern fires the request twice if the user
 * is impatient or has a flaky touchpad — which on destructive or
 * money-moving actions is exactly the wrong behaviour.
 *
 * Use it like:
 *
 *   const [submit, busy] = useAsyncAction(async () => {
 *     await api.doThing();
 *   });
 *   <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
 *
 * The returned `run` does three things:
 *   1. Drops any call that lands while a previous one is in flight
 *      (single-flight via a ref so the guard doesn't lag a render
 *      behind state).
 *   2. Flips `busy` to `true` during the call so the button can show a
 *      spinner / disabled style.
 *   3. Always resets `busy` in `finally` so a thrown error doesn't
 *      strand the UI in a stuck state.
 *
 * Errors are NOT swallowed — they re-throw so the caller's own
 * try/catch or error boundary can show a toast. This hook only owns the
 * in-flight guard.
 */
export function useAsyncAction<TArgs extends unknown[]>(
  fn: (...args: TArgs) => Promise<unknown>,
): readonly [(...args: TArgs) => Promise<void>, boolean] {
  const [busy, setBusy] = useState(false);
  const runningRef = useRef(false);

  const run = useCallback(
    async (...args: TArgs) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setBusy(true);
      try {
        await fn(...args);
      } finally {
        runningRef.current = false;
        setBusy(false);
      }
    },
    [fn],
  );

  return [run, busy] as const;
}
