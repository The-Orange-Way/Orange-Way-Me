import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  shouldReloadForStaleChunk,
  installChunkReloadHandler,
  RELOAD_COOLDOWN_MS,
  type ReloadStampStore,
  type PreloadErrorTarget,
} from "../chunk-reload";

/** Map-backed Storage stand-in: unit tests run in node, no sessionStorage. */
function fakeStorage(): ReloadStampStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe("shouldReloadForStaleChunk", () => {
  let storage: ReturnType<typeof fakeStorage>;

  beforeEach(() => {
    storage = fakeStorage();
  });

  it("allows the first reload and records the attempt", () => {
    expect(shouldReloadForStaleChunk(1_000_000, storage)).toBe(true);
    expect(storage.map.get("ow-chunk-reload-at")).toBe("1000000");
  });

  it("refuses a second reload inside the cooldown (no reload loop)", () => {
    expect(shouldReloadForStaleChunk(1_000_000, storage)).toBe(true);
    // A chunk that is STILL missing after the reload fires the event again
    // almost immediately; the guard must let the error surface instead of
    // reloading forever.
    expect(shouldReloadForStaleChunk(1_000_000 + 5_000, storage)).toBe(false);
    expect(shouldReloadForStaleChunk(1_000_000 + RELOAD_COOLDOWN_MS - 1, storage)).toBe(false);
  });

  it("allows a reload again after the cooldown (next stale deploy)", () => {
    expect(shouldReloadForStaleChunk(1_000_000, storage)).toBe(true);
    expect(shouldReloadForStaleChunk(1_000_000 + RELOAD_COOLDOWN_MS, storage)).toBe(true);
  });

  it("treats garbage storage state as no prior reload", () => {
    storage.setItem("ow-chunk-reload-at", "not-a-number");
    // Number("not-a-number") is NaN; NaN comparisons are false, so the
    // guard must fail open (allow the reload) rather than brick recovery.
    expect(shouldReloadForStaleChunk(1_000_000, storage)).toBe(true);
  });

  it("fails closed when storage throws (private mode / sandboxed iframe)", () => {
    const throwing: ReloadStampStore = {
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: () => {
        throw new Error("storage disabled");
      },
    };
    // Without a working stamp we cannot rule out a reload loop, so no
    // automatic reload: the error surfaces, same as before the handler.
    expect(shouldReloadForStaleChunk(1_000_000, throwing)).toBe(false);
  });
});

describe("installChunkReloadHandler", () => {
  /** Minimal EventTarget stand-in that captures the registered listener. */
  function fakeTarget(): PreloadErrorTarget & {
    listeners: Map<string, (event: Event) => void>;
    fire(type: string): { defaultPrevented: boolean };
  } {
    const listeners = new Map<string, (event: Event) => void>();
    return {
      listeners,
      addEventListener: (type, listener) => void listeners.set(type, listener),
      fire(type: string) {
        const state = { defaultPrevented: false };
        const event = {
          preventDefault: () => {
            state.defaultPrevented = true;
          },
        } as unknown as Event;
        listeners.get(type)?.(event);
        return state;
      },
    };
  }

  beforeEach(() => {
    // The installed listener uses the real sessionStorage default; give the
    // node test run one backed by a plain map.
    const storage = fakeStorage();
    vi.stubGlobal("sessionStorage", storage);
  });

  it("listens for vite:preloadError, prevents default, and reloads once", () => {
    const reload = vi.fn();
    const target = fakeTarget();
    installChunkReloadHandler(reload, target);

    expect(target.listeners.has("vite:preloadError")).toBe(true);

    const first = target.fire("vite:preloadError");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(first.defaultPrevented).toBe(true);

    // Second failure inside the cooldown: no reload, no preventDefault, so
    // the error reaches the boundary instead of looping.
    const second = target.fire("vite:preloadError");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(false);
  });
});
