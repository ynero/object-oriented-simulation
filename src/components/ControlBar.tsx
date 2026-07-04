interface Props {
  status: string;
  stepIndex: number;
  totalSteps: number;
  canStepForward: boolean;
  canStepBack: boolean;
  description: string;
  onCompile: () => void;
  onStepForward: () => void;
  onStepBack: () => void;
  onReset: () => void;
  onJumpTo: (i: number) => void;
}

export function ControlBar({
  status, stepIndex, totalSteps, canStepForward, canStepBack,
  description, onCompile, onStepForward, onStepBack, onReset, onJumpTo,
}: Props) {
  return (
    <div className="control-bar">
      <div className="control-left">
        <button className="btn btn-primary" onClick={onCompile}>
          ▶ Run
        </button>
        <button className="btn" onClick={onReset} disabled={status !== 'running'}>
          ↺ Reset
        </button>
        <button className="btn" onClick={onStepBack} disabled={!canStepBack}>
          ← Step Back
        </button>
        <button className="btn" onClick={onStepForward} disabled={!canStepForward}>
          Step Forward →
        </button>
      </div>

      <div className="control-center">
        {status === 'running' && (
          <span className="step-desc">{description}</span>
        )}
        {status === 'error' && (
          <span className="step-desc error-text">{description}</span>
        )}
        {status === 'idle' && (
          <span className="step-desc idle-text">Press Run to start the simulation</span>
        )}
      </div>

      <div className="control-right">
        {status === 'running' && (
          <>
            <span className="step-counter">
              Step {stepIndex + 1} / {totalSteps}
            </span>
            <input
              type="range"
              className="step-slider"
              min={0}
              max={totalSteps - 1}
              value={stepIndex}
              onChange={e => onJumpTo(Number(e.target.value))}
            />
          </>
        )}
      </div>
    </div>
  );
}
