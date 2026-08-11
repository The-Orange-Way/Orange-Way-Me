import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StealthChannel } from "../channel";

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
