import { useState, useCallback, useMemo } from 'react';
import { runSimulation } from '../engine/interpreter';
import type { SimulationStep } from '../engine/types';

export type SimStatus = 'idle' | 'running' | 'error';

export interface SimulationState {
  steps: SimulationStep[];
  stepIndex: number;
  status: SimStatus;
  errorMsg: string;
  currentStep: SimulationStep | null;
  canStepForward: boolean;
  canStepBack: boolean;
  compile: (code: string) => void;
  stepForward: () => void;
  stepBack: () => void;
  reset: () => void;
  jumpTo: (index: number) => void;
}

export function useSimulation(): SimulationState {
  const [steps, setSteps] = useState<SimulationStep[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [status, setStatus] = useState<SimStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const compile = useCallback((code: string) => {
    try {
      const result = runSimulation(code);
      setSteps(result);
      setStepIndex(0);
      setStatus('running');
      setErrorMsg('');
    } catch (e) {
      setStatus('error');
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setSteps([]);
    }
  }, []);

  const stepForward = useCallback(() => {
    setStepIndex(i => Math.min(i + 1, steps.length - 1));
  }, [steps.length]);

  const stepBack = useCallback(() => {
    setStepIndex(i => Math.max(i - 1, 0));
  }, []);

  const reset = useCallback(() => {
    setStepIndex(0);
  }, []);

  const jumpTo = useCallback((index: number) => {
    setStepIndex(Math.max(0, Math.min(index, steps.length - 1)));
  }, [steps.length]);

  const currentStep = useMemo(() => steps[stepIndex] ?? null, [steps, stepIndex]);
  const canStepForward = stepIndex < steps.length - 1;
  const canStepBack = stepIndex > 0;

  return { steps, stepIndex, status, errorMsg, currentStep, canStepForward, canStepBack, compile, stepForward, stepBack, reset, jumpTo };
}
