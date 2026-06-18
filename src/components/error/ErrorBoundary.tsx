import { Component, type ErrorInfo, type ReactNode } from "react";

// Reusable error boundary. Single responsibility: catch render-phase throws
// in its subtree, run the onError side effect, and render a fallback.
// UI is injected via `fallback` (element) or `fallbackRender` (function) so
// callers control what users see; the boundary itself never hardcodes copy.
//
// ZKA invariant: the boundary only forwards the Error object and its stack
// to onError. It MUST NOT receive or log React props/state of the failing
// subtree — those may contain decrypted customer data. Loggers (PostHog /
// console) should likewise stay error-only. See src/routes/__root.tsx for
// the canonical onError used by the root boundary.

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  fallbackRender?: (error: Error, reset: () => void) => ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error) {
      if (this.props.fallbackRender) return this.props.fallbackRender(error, this.reset);
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}
