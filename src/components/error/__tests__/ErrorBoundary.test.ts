import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { ErrorBoundary } from "../ErrorBoundary";

// Vitest is configured for the `node` environment with no DOM, so we
// exercise the boundary's class lifecycle directly instead of mounting
// it. This is sufficient to lock the contract that protects against
// Lock the contract: derive error state from a throw, render fallback,
// invoke onError, and clear state on reset().

function makeBoundary(props: ConstructorParameters<typeof ErrorBoundary>[0]) {
  return new ErrorBoundary(props);
}

describe("ErrorBoundary", () => {
  it("renders children when no error has been caught", () => {
    const child = createElement("span", null, "ok");
    const boundary = makeBoundary({ children: child });
    expect(boundary.render()).toBe(child);
  });

  it("catches a render throw and renders the static fallback", () => {
    const fallback = createElement("div", null, "boom");
    const boundary = makeBoundary({
      children: createElement("span"),
      fallback,
    });
    boundary.state = ErrorBoundary.getDerivedStateFromError(new Error("xx"));
    expect(boundary.state.error).toBeInstanceOf(Error);
    expect(boundary.render()).toBe(fallback);
  });

  it("invokes onError with the caught error + info", () => {
    const onError = vi.fn();
    const boundary = makeBoundary({
      children: createElement("span"),
      onError,
    });
    const err = new Error("kaboom");
    const info = { componentStack: "<MyComp>" };
    boundary.componentDidCatch(err, info as never);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(err, info);
  });

  it("uses fallbackRender and resets state when reset() is called", () => {
    const fallbackRender = vi.fn((_e: Error, _reset: () => void) =>
      createElement("div", null, "retry"),
    );
    const boundary = makeBoundary({
      children: createElement("span", null, "child"),
      fallbackRender,
    });
    boundary.state = ErrorBoundary.getDerivedStateFromError(new Error("e"));
    boundary.setState = ((s: { error: Error | null }) => {
      boundary.state = { ...boundary.state, ...s };
    }) as never;

    const rendered = boundary.render();
    expect(rendered).toBeTruthy();
    expect(fallbackRender).toHaveBeenCalledTimes(1);

    const reset = fallbackRender.mock.calls[0][1];
    reset();
    expect(boundary.state.error).toBeNull();
    expect(boundary.render()).toEqual(createElement("span", null, "child"));
  });
});
