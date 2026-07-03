/**
 * Recover from stale-deploy chunk failures.
 *
 * Every deploy renames the hashed chunk files; a tab that loaded index.html
 * before the deploy will request chunks that no longer exist when the user
 * next navigates, and the lazy route import throws ("Failed to fetch
 * dynamically imported module", seen in GlitchTip for the sonner chunk).
 * Vite surfaces those failures as a window-level "vite:preloadError" event:
 * one hard reload fetches the fresh index.html and its matching chunk set.
 *
 * The timestamp guard means a genuine outage (chunks still missing after a
 * reload) degrades to the normal error path instead of a reload loop.
 */

const CHUNK_RELOAD_KEY = "ow-chunk-reload-at";

/** Minimum gap between automatic reloads. Below this, let the error surface. */
export const RELOAD_COOLDOWN_MS = 60_000;

/** The subset of Storage the guard needs; injectable so tests run in node. */
export interface ReloadStampStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Guard half of the handler: decide whether an automatic reload is allowed
 * right now, and if so record the attempt. Exported for tests.
 *
 * Fails CLOSED when storage is unavailable (some private-browsing modes and
 * sandboxed iframes throw on any access): without a working stamp we cannot
 * rule out a reload loop, so we refuse the automatic reload and let the
 * error surface, which is exactly the pre-handler behavior.
 */
export function shouldReloadForStaleChunk(
  now: number = Date.now(),
  storage: ReloadStampStore = sessionStorage,
): boolean {
  try {
    const last = Number(storage.getItem(CHUNK_RELOAD_KEY) ?? "0");
    if (now - last < RELOAD_COOLDOWN_MS) return false;
    storage.setItem(CHUNK_RELOAD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

/** The subset of EventTarget the installer needs; injectable for tests. */
export interface PreloadErrorTarget {
  addEventListener(type: string, listener: (event: Event) => void): void;
}

/**
 * Install the listener. `reload` and `target` are injectable for tests;
 * production callers use the defaults (the real window, a real hard reload).
 */
export function installChunkReloadHandler(
  reload: () => void = () => window.location.reload(),
  target: PreloadErrorTarget = window,
): void {
  target.addEventListener("vite:preloadError", (event) => {
    if (!shouldReloadForStaleChunk()) return; // reloaded recently: let the error surface
    event.preventDefault(); // we own recovery; don't also throw to the error boundary
    reload();
  });
}
