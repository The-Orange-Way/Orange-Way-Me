import { scrubPostHogEvent } from "@/lib/observability/posthog-scrubber";

const FALLBACK_KEY = "phc_nRhAFVKYD7WuckiEVBVrNx4NpefL7sipM6cp5oZnjQEE";
const HOST = "https://eu.i.posthog.com";
export const CONSENT_KEY = "analytics-consent";
export const OPEN_PRIVACY_CHOICES = "open-privacy-choices";

export type Consent = "granted" | "denied";

let started = false;

function projectKey() {
  const fromEnv = import.meta.env.VITE_POSTHOG_KEY;
  return fromEnv && fromEnv.trim() ? fromEnv : FALLBACK_KEY;
}

function pinnedHost() {
  const configured = import.meta.env.VITE_POSTHOG_HOST;
  return configured === "https://eu.i.posthog.com" || configured === "https://eu.posthog.com"
    ? configured
    : HOST;
}

export function readConsent(): Consent | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

function writeConsent(value: Consent) {
  window.localStorage.setItem(CONSENT_KEY, value);
}

export function openPrivacyChoices() {
  window.dispatchEvent(new Event(OPEN_PRIVACY_CHOICES));
}

export function isAnalyticsStarted() {
  return started;
}

async function startCapture() {
  const { default: posthog } = await import("posthog-js");
  if (started) {
    posthog.opt_in_capturing();
    posthog.startSessionRecording?.();
    return;
  }
  started = true;
  posthog.init(projectKey(), {
    api_host: pinnedHost(),
    persistence: "memory",
    person_profiles: "identified_only",
    respect_dnt: true,
    autocapture: true,
    capture_heatmaps: true,
    disable_session_recording: false,
    session_recording: { maskAllInputs: true, maskTextSelector: "[data-ph-mask]" },
    capture_pageview: "history_change",
    opt_out_capturing_by_default: true,
    before_send: scrubPostHogEvent,
    loaded: (client) => {
      client.register({ app: "orangeway-app", brand: "orange-way" });
      client.opt_in_capturing();
      client.capture("$pageview");
    },
  });
}

export async function grantAnalytics() {
  writeConsent("granted");
  await startCapture();
}

export async function denyAnalytics() {
  writeConsent("denied");
  await pauseAnalytics();
}

export async function pauseAnalytics() {
  if (!started) return;
  const { default: posthog } = await import("posthog-js");
  posthog.opt_out_capturing();
  posthog.stopSessionRecording?.();
}

export function restoreAnalytics() {
  if (readConsent() === "granted") void grantAnalytics();
}

export async function resetUser() {
  if (!started) return;
  const { default: posthog } = await import("posthog-js");
  posthog.reset();
}

export async function captureException(error: Error, props?: Record<string, unknown>) {
  if (!started) return;
  const { default: posthog } = await import("posthog-js");
  posthog.captureException?.(error, props);
}
