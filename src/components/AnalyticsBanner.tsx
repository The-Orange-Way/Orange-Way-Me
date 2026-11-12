import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  denyAnalytics,
  grantAnalytics,
  OPEN_PRIVACY_CHOICES,
  readConsent,
  restoreAnalytics,
} from "@/lib/analytics";

const COPY = "Help us improve this site with anonymous stats? No cookies.";

export function AnalyticsBanner() {
  const [visible, setVisible] = useState(false);
  const regionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    restoreAnalytics();
    if (!readConsent()) setVisible(true);
    const onOpen = () => setVisible(true);
    window.addEventListener(OPEN_PRIVACY_CHOICES, onOpen);
    return () => window.removeEventListener(OPEN_PRIVACY_CHOICES, onOpen);
  }, []);

  useEffect(() => {
    const node = regionRef.current;
    if (!visible || !node) {
      document.documentElement.style.removeProperty("--analytics-banner-space");
      return;
    }
    const apply = () => {
      const height = `${Math.ceil(node.getBoundingClientRect().height)}px`;
      document.documentElement.style.setProperty("--analytics-banner-space", height);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    window.addEventListener("resize", apply);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", apply);
      document.documentElement.style.removeProperty("--analytics-banner-space");
    };
  }, [visible]);

  if (!visible) return null;

  const closeAfter = (action: () => void | Promise<void>) => {
    void action();
    setVisible(false);
  };

  const control =
    "inline-flex min-h-7 shrink-0 items-center align-middle text-[13px] font-semibold leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

  return (
    <div
      ref={regionRef}
      role="region"
      aria-label="Privacy choices"
      className="z-40 shrink-0 bg-[#FAFAF9] max-sm:w-full sm:px-3 sm:pb-3 sm:pt-3"
    >
      <div className="border border-[#0F172A]/15 bg-[#FAFAF9] text-[13px] leading-snug text-[#0F172A] shadow-md max-sm:w-full max-sm:rounded-none max-sm:border-x-0 max-sm:border-b-0 max-sm:px-3 max-sm:py-1.5 sm:max-w-[420px] sm:rounded-full sm:px-3 sm:py-1.5">
        <span>{COPY}</span>{" "}
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 align-middle">
          <button
            type="button"
            className={`${control} rounded-full bg-primary px-2.5 text-zinc-950`}
            onClick={() => closeAfter(grantAnalytics)}
          >
            Sounds good
          </button>
          <button
            type="button"
            className={`${control} text-[#0F172A] underline underline-offset-2`}
            onClick={() => closeAfter(denyAnalytics)}
          >
            No thanks
          </button>
          <Link to="/privacy" className={`${control} text-[#0F172A] underline underline-offset-2`}>
            Privacy
          </Link>
        </span>
      </div>
    </div>
  );
}

export default AnalyticsBanner;
