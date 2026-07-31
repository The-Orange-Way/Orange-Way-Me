import { useState } from "react";
import type { ComponentType, ReactNode } from "react";

// Feature flag for the v2 typeform-style onboarding (DL-0429).
// Off by default. Enable per environment with VITE_ONBOARDING_V2="true".
export const ONBOARDING_V2_ENABLED = import.meta.env.VITE_ONBOARDING_V2 === "true";

export interface OnboardingStepProps {
  onNext: () => void;
  onBack: () => void;
  isFirst: boolean;
  isLast: boolean;
}

export interface OnboardingStep {
  id: string;
  title: string;
  Component: ComponentType<OnboardingStepProps>;
}

/**
 * StepShell gives every step the same typeform frame: one question centered on
 * the viewport, a progress bar, and Back/Next controls. Steps render their own
 * body and never own navigation, so the container stays the single source of
 * truth for where the user is in the flow.
 */
export function StepShell({
  title,
  children,
  onNext,
  onBack,
  isFirst,
  isLast,
  nextLabel,
}: OnboardingStepProps & {
  title: string;
  children?: ReactNode;
  nextLabel?: string;
}) {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col justify-center px-6">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{title}</h1>
      <div className="mt-6 min-h-[8rem] text-muted-foreground">{children}</div>
      <div className="mt-10 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          disabled={isFirst}
          className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {nextLabel ?? (isLast ? "Finish" : "Continue")}
        </button>
      </div>
    </div>
  );
}

/**
 * OnboardingFlow is the container/router for the whole flow. It walks the
 * ordered step registry, tracks the active index, and hands each step its
 * navigation callbacks. onComplete fires once the last step calls onNext.
 */
export function OnboardingFlow({
  steps,
  onComplete,
}: {
  steps: OnboardingStep[];
  onComplete: () => void;
}) {
  const [index, setIndex] = useState(0);
  const total = steps.length;
  const active = steps[index];

  if (!active) {
    return null;
  }

  const isFirst = index === 0;
  const isLast = index === total - 1;

  const onNext = () => {
    if (isLast) {
      onComplete();
      return;
    }
    setIndex((current) => Math.min(current + 1, total - 1));
  };

  const onBack = () => {
    setIndex((current) => Math.max(current - 1, 0));
  };

  const percent = total > 0 ? Math.round(((index + 1) / total) * 100) : 0;
  const StepComponent = active.Component;

  return (
    <div className="min-h-screen bg-background">
      <div className="h-1 w-full bg-muted">
        <div
          className="h-1 bg-primary transition-all"
          style={{ width: `${percent}%` }}
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <StepComponent onNext={onNext} onBack={onBack} isFirst={isFirst} isLast={isLast} />
    </div>
  );
}
