import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StealthChannel } from "../channel";
import { OR_CONNECT_BASE } from "../../or/widget";

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

  it("defaults the outbound target origin to the exact origin of OR_CONNECT_BASE", () => {
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
    expect(posts[0].target).toBe(new URL(OR_CONNECT_BASE).origin);

    channel.stop();
  });
});
