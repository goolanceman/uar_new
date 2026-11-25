"use client";

import { useCallback, useState } from "react";

/**
 * Linear wizard step machine — steps 1..total with a high-water mark
 * (`maxStep`) of validated progress. Encodes the distribution wizard's rules
 * in one place:
 *  - `next()` advances one step only if the CURRENT step validates.
 *  - `goTo(t)` moves freely to any already-visited (≤ maxStep) step; forward
 *    jumps require the current step to validate first.
 *  - `back()` steps back one, never below 1, without validation.
 *  - `reset()` restarts the wizard at step 1.
 * `next`/`goTo` return false when blocked so the caller can surface an error.
 */
export function useWizardSteps(total: number, validate: (step: number) => boolean) {
  const [step, setStep] = useState(1);
  const [maxStep, setMaxStep] = useState(1);

  const reset = useCallback(() => {
    setStep(1);
    setMaxStep(1);
  }, []);

  const next = useCallback((): boolean => {
    if (!validate(step)) return false;
    const n = Math.min(total, step + 1);
    setStep(n);
    setMaxStep((m) => Math.max(m, n));
    return true;
  }, [step, total, validate]);

  const back = useCallback(() => setStep((s) => Math.max(1, s - 1)), []);

  const goTo = useCallback(
    (target: number): boolean => {
      if (target === step) return true;
      if (target <= maxStep) {
        setStep(target);
        return true;
      }
      // Forward jumps must clear the current step first.
      if (!validate(step)) return false;
      setStep(target);
      setMaxStep((m) => Math.max(m, target));
      return true;
    },
    [step, maxStep, validate]
  );

  return { step, maxStep, reset, next, back, goTo } as const;
}
