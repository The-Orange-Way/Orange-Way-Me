import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StealthChannel, type StealthInboundHandler } from "../channel";
import { STEALTH_MESSAGE, STEALTH_PROTOCOL_VERSION } from "../protocol";

const noopHandler = () => {};

describe("StealthChannel config guard", () => {
  it("start() refuses when the configured widget URL is an empty string", () => {
    const channel = new StealthChannel("");
    const popup = {} as Window;
    expect(() => channel.start(popup, noopHandler)).toThrow(/VITE_OR_CONNECT_URL/);
  });

  it("start() refuses when the configured widget URL is unset", () => {
    const channel = new StealthChannel(undefined);
    const popup = {} as Window;
    expect(() => channel.start(popup, noopHandler)).toThrow(/VITE_OR_CONNECT_URL/);
  });

  it("start() refuses when the configured widget URL is not a valid URL", () => {
    const channel = new StealthChannel("not a url");
    const popup = {} as Window;
    expect(() => channel.start(popup, noopHandler)).toThrow(/valid VITE_OR_CONNECT_URL/);
  });
});

describe("StealthChannel allowed origin", () => {
  const realWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    (globalThis as unknown as { window: unknown }).window = {
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  });

  afterEach(() => {
    (globalThis as unknown as { window: unknown }).window = realWindow;
  });

  it("derives the outbound target origin from the configured widget URL", () => {
    const posts: Array<{ message: unknown; target: string }> = [];
    const popup = {
      postMessage: (message: unknown, target: string) => posts.push({ message, target }),
    } as unknown as Window;

    // A non-empty raw URL clears the config guard, so start() proceeds and
    // derives the outbound target origin from that one value.
    const channel = new StealthChannel("https://connect.orangerails.com/connect");
    channel.start(popup, noopHandler);
    channel.sendInit({ hello: "world" });

    expect(posts).toHaveLength(1);
    expect(posts[0].target).toBe("https://connect.orangerails.com");

    channel.stop();
  });

  it("derives the target origin from a different host, so a hardcoded literal cannot pass", () => {
    const posts: Array<{ message: unknown; target: string }> = [];
    const popup = {
      postMessage: (message: unknown, target: string) => posts.push({ message, target }),
    } as unknown as Window;

    // A host other than the production widget proves the origin is derived
    // from the configured URL, not a constant that only happens to match.
    const channel = new StealthChannel("https://widget.example.test/x");
    channel.start(popup, noopHandler);
    channel.sendInit({ hello: "world" });

    expect(posts).toHaveLength(1);
    expect(posts[0].target).toBe("https://widget.example.test");

    channel.stop();
  });
});

describe("StealthChannel inbound version narrowing", () => {
  const realWindow = (globalThis as { window?: unknown }).window;
  const ORIGIN_URL = "https://connect.orangerails.com/connect";
  const ORIGIN = "https://connect.orangerails.com";

  let listeners: Array<(event: MessageEvent) => void>;

  beforeEach(() => {
    listeners = [];
    (globalThis as unknown as { window: unknown }).window = {
      addEventListener: (_type: string, fn: (event: MessageEvent) => void) => listeners.push(fn),
      removeEventListener: () => {},
    };
  });

  afterEach(() => {
    (globalThis as unknown as { window: unknown }).window = realWindow;
  });

  // Start a channel wired to capture what its handler received and what it
  // posted, plus a deliver() that drives a synthetic inbound event through the
  // real onMessage listener with a valid origin and source.
  function startChannel(handler: StealthInboundHandler) {
    const posts: Array<{ message: Record<string, unknown>; target: string }> = [];
    const popup = {
      postMessage: (message: Record<string, unknown>, target: string) =>
        posts.push({ message, target }),
    } as unknown as Window;
    const channel = new StealthChannel(ORIGIN_URL);
    channel.start(popup, handler);
    const deliver = (data: unknown) =>
      listeners.forEach((fn) => fn({ origin: ORIGIN, source: popup, data } as MessageEvent));
    return { channel, posts, deliver };
  }

  it("accepts a PROXY_REQUEST with no version field and registers its request_id", () => {
    const received: Array<Record<string, unknown>> = [];
    const { channel, posts, deliver } = startChannel((m) =>
      received.push(m as Record<string, unknown>),
    );

    // A PROXY_REQUEST carries no version field. The narrowed check must let it
    // through: the receiver's frames other than READY have no version at all.
    deliver({ type: STEALTH_MESSAGE.PROXY_REQUEST, request_id: "req-1", fn: "or-stealth-envelope-fetch" });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe(STEALTH_MESSAGE.PROXY_REQUEST);

    // The id registered only if the request was accepted, so respondToProxy
    // actually posts. This is the item-7 assertion: it goes RED exactly when a
    // blanket version check would have dropped the request and hung sync.
    channel.respondToProxy("req-1", { ok: true });
    expect(posts).toHaveLength(1);
    expect(posts[0].message.type).toBe(STEALTH_MESSAGE.PROXY_RESPONSE);
    expect(posts[0].message.request_id).toBe("req-1");
    expect(posts[0].message.version).toBeUndefined();
    expect(posts[0].message.protocol_version).toBeUndefined();

    channel.stop();
  });

  it("accepts a non-READY completion with no version field", () => {
    const received: Array<Record<string, unknown>> = [];
    const { channel, deliver } = startChannel((m) => received.push(m as Record<string, unknown>));

    deliver({ type: STEALTH_MESSAGE.SYNC_COMPLETE });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe(STEALTH_MESSAGE.SYNC_COMPLETE);

    channel.stop();
  });

  it("accepts a READY carrying the receiver's protocol_version", () => {
    const received: Array<Record<string, unknown>> = [];
    const { channel, deliver } = startChannel((m) => received.push(m as Record<string, unknown>));

    deliver({ type: STEALTH_MESSAGE.READY, protocol_version: STEALTH_PROTOCOL_VERSION });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe(STEALTH_MESSAGE.READY);

    channel.stop();
  });

  it("accepts a READY carrying the legacy version name", () => {
    const received: Array<Record<string, unknown>> = [];
    const { channel, deliver } = startChannel((m) => received.push(m as Record<string, unknown>));

    deliver({ type: STEALTH_MESSAGE.READY, version: STEALTH_PROTOCOL_VERSION });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe(STEALTH_MESSAGE.READY);

    channel.stop();
  });

  it("refuses a READY carrying the wrong version", () => {
    const received: Array<Record<string, unknown>> = [];
    const { channel, deliver } = startChannel((m) => received.push(m as Record<string, unknown>));

    deliver({ type: STEALTH_MESSAGE.READY, protocol_version: STEALTH_PROTOCOL_VERSION + 1 });

    expect(received).toHaveLength(0);

    channel.stop();
  });
});
