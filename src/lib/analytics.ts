import { scrubPostHogEvent } from "@/lib/observability/posthog-scrubber";

const FALLBACK_KEY = "phc_nRhAFVKYD7WuckiEVBVrNx4NpefL7sipM6cp5oZnjQEE";
const HOST = "https://eu.i.posthog.com";
export const CONSENT_KEY = "analytics-consent";
export const OPEN_PRIVACY_CHOICES = "open-privacy-choices";

export type Consent = "granted" | "denied";

const SESSION_RECORDING = { maskAllInputs: true, maskTextSelector: "[data-ph-mask]" };

let started = false;
let paused = false;

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

export function hasTrackingProtection(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { msDoNotTrack?: string; globalPrivacyControl?: boolean };
  const dnt =
    nav.doNotTrack ||
    (typeof window !== "undefined"
      ? (window as Window & { doNotTrack?: string }).doNotTrack
      : undefined) ||
    nav.msDoNotTrack;
  if (dnt === "1" || dnt === "yes") return true;
  if (nav.globalPrivacyControl === true) return true;
  return false;
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

function scrubPostHogDeviceStore() {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key !== CONSENT_KEY && (key.startsWith("__ph_") || key.startsWith("ph_")))
        keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
  try {
    for (const part of document.cookie.split(";")) {
      const name = part.split("=")[0]?.trim();
      if (name && (name.startsWith("__ph_") || name.startsWith("ph_"))) {
        document.cookie = `${name}=; Max-Age=0; path=/`;
      }
    }
  } catch {
    // ignore
  }
}

export function openPrivacyChoices() {
  window.dispatchEvent(new Event(OPEN_PRIVACY_CHOICES));
}

export function isAnalyticsStarted() {
  return started;
}

async function startTier1() {
  if (typeof window === "undefined" || hasTrackingProtection()) return;
  const { default: posthog } = await import("posthog-js");
  if (started) {
    if (paused) {
      posthog.opt_in_capturing();
      scrubPostHogDeviceStore();
      paused = false;
    }
    return;
  }
  started = true;
  posthog.init(projectKey(), {
    api_host: pinnedHost(),
    persistence: "memory",
    disable_persistence: true,
    person_profiles: "never",
    respect_dnt: true,
    autocapture: false,
    capture_heatmaps: false,
    disable_session_recording: true,
    disable_surveys: true,
    capture_performance: false,
    session_recording: SESSION_RECORDING,
    capture_pageview: "history_change",
    capture_pageleave: true,
    opt_out_capturing_by_default: false,
    before_send: scrubPostHogEvent,
    loaded: (client) => {
      scrubPostHogDeviceStore();
      client.register({ app: "orangeway-app", brand: "orange-way" });
    },
  });
  scrubPostHogDeviceStore();
}

async function enableTier2() {
  if (hasTrackingProtection()) return;
  await startTier1();
  if (!started) return;
  const { default: posthog } = await import("posthog-js");
  posthog.set_config({
    autocapture: true,
    capture_heatmaps: true,
    disable_session_recording: false,
    session_recording: SESSION_RECORDING,
  });
  posthog.startSessionRecording?.();
  scrubPostHogDeviceStore();
}

async function disableTier2() {
  if (!started) return;
  const { default: posthog } = await import("posthog-js");
  posthog.set_config({
    autocapture: false,
    capture_heatmaps: false,
    disable_session_recording: true,
  });
  posthog.stopSessionRecording?.();
  scrubPostHogDeviceStore();
}

export async function grantAnalytics() {
  writeConsent("granted");
  await enableTier2();
}

export async function denyAnalytics() {
  writeConsent("denied");
  await disableTier2();
  await startTier1();
}

export async function pauseAnalytics() {
  if (!started) return;
  const { default: posthog } = await import("posthog-js");
  posthog.opt_out_capturing();
  posthog.stopSessionRecording?.();
  paused = true;
  scrubPostHogDeviceStore();
}

export function restoreAnalytics() {
  if (hasTrackingProtection()) return;
  void startTier1().then(() => {
    if (readConsent() === "granted") void enableTier2();
  });
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
