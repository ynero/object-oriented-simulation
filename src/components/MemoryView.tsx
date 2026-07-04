import { useRef, useLayoutEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { SimulationStep, Variable, VarValue, Reference, HeapObject, StackFrame } from '../engine/types';

interface Props {
  step: SimulationStep | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isRef(v: VarValue): v is Reference {
  return typeof v === 'object' && v !== null && (v as Reference).kind === 'ref';
}

function displayValue(v: VarValue, heap: HeapObject[]): { text: string; isRef: boolean; refId: string | null } {
  if (isRef(v)) {
    if (v.heapId === null) return { text: 'null', isRef: false, refId: null };
    const obj = heap.find(o => o.id === v.heapId);
    // Show the reference arrow (→ id) rather than the dereferenced value so the
    // stack frame clearly communicates "this variable holds a reference, not a value".
    if (obj?.isString) return { text: `→ ${v.heapId}`, isRef: true, refId: v.heapId };
    return { text: `→ ${v.heapId}`, isRef: true, refId: v.heapId };
  }
  if (typeof v === 'boolean') return { text: String(v), isRef: false, refId: null };
  if (typeof v === 'number') return { text: String(v), isRef: false, refId: null };
  return { text: String(v), isRef: false, refId: null };
}

// ── Arrow drawing via SVG overlay ─────────────────────────────────────────────

interface ArrowDef {
  fromId: string; // DOM element id for source
  toId: string;   // DOM element id for target
  color: string;
}

function ArrowLayer({ arrows }: { arrows: ArrowDef[] }) {
  const [lines, setLines] = useState<{ x1: number; y1: number; x2: number; y2: number; color: string; key: string }[]>([]);

  const recalc = useCallback(() => {
    const container = document.querySelector('.memory-panel') as HTMLElement;
    if (!container) return;
    const cRect = container.getBoundingClientRect();

    const computed = arrows.flatMap(a => {
      const from = document.getElementById(a.fromId);
      const to = document.getElementById(a.toId);
      if (!from || !to) return [];
      const fRect = from.getBoundingClientRect();
      const tRect = to.getBoundingClientRect();
      return [{
        x1: fRect.right - cRect.left,
        y1: fRect.top + fRect.height / 2 - cRect.top,
        x2: tRect.left - cRect.left,
        y2: tRect.top + tRect.height / 2 - cRect.top,
        color: a.color,
        key: `${a.fromId}-${a.toId}`,
      }];
    });
    setLines(computed);
  }, [arrows]);

  useLayoutEffect(() => {
    recalc();
    window.addEventListener('resize', recalc);
    return () => window.removeEventListener('resize', recalc);
  }, [recalc]);

  return (
    <svg className="arrow-overlay" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10 }}>
      <defs>
        <marker id="arrow-head" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill="#f59e0b" />
        </marker>
        <marker id="arrow-head-blue" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill="#60a5fa" />
        </marker>
      </defs>
      {lines.map(l => {
        const dx = l.x2 - l.x1;
        const dy = l.y2 - l.y1;
        const midX = l.x1 + dx * 0.5;
        const d = `M${l.x1},${l.y1} C${midX},${l.y1} ${midX},${l.y2} ${l.x2 - 6},${l.y2}`;
        const isBlue = l.color === '#60a5fa';
        return (
          <path
            key={l.key}
            d={d}
            stroke={l.color}
            strokeWidth="1.5"
            fill="none"
            markerEnd={isBlue ? 'url(#arrow-head-blue)' : 'url(#arrow-head)'}
            opacity={0.8}
          />
        );
      })}
    </svg>
  );
}

// ── Variable row ──────────────────────────────────────────────────────────────

interface VarRowProps {
  variable: Variable;
  frameId: string;
  heap: HeapObject[];
  isNew: boolean;
  isChanged: boolean;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
}

function VarRow({ variable: v, frameId, heap, isNew, isChanged, hoveredId, onHover }: VarRowProps) {
  const { text, isRef: isRefVal, refId } = displayValue(v.value, heap);
  const isHovered = refId !== null && hoveredId === refId;
  const domId = `var-${frameId}-${v.name}`;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      className={`var-row ${isNew ? 'var-new' : ''} ${isChanged ? 'var-changed' : ''} ${isHovered ? 'var-hovered' : ''}`}
      onMouseEnter={() => refId && onHover(refId)}
      onMouseLeave={() => onHover(null)}
    >
      <span className="var-type">{v.type}</span>
      <span className="var-name">{v.name}</span>
      <span className="var-equals">=</span>
      <span id={domId} className={`var-value ${isRefVal ? 'ref-value' : 'prim-value'}`}>
        {text}
      </span>
    </motion.div>
  );
}

// ── Stack panel ───────────────────────────────────────────────────────────────

interface StackPanelProps {
  frames: StackFrame[];
  step: SimulationStep;
  heap: HeapObject[];
  hoveredId: string | null;
  onHover: (id: string | null) => void;
}

function StackPanel({ frames, step, heap, hoveredId, onHover }: StackPanelProps) {
  return (
    <div className="stack-panel">
      <div className="panel-header">Stack</div>
      <div className="stack-frames">
        <AnimatePresence>
          {[...frames].reverse().map(frame => (
            <motion.div
              key={frame.id}
              layout
              initial={{ opacity: 0, y: -16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16, scale: 0.95 }}
              className={`stack-frame ${frame.label === 'main' ? 'frame-main' : 'frame-method'}`}
            >
              <div className="frame-label">{frame.label}</div>
              <div className="frame-vars">
                {frame.variables.length === 0 && (
                  <div className="empty-hint">(no variables)</div>
                )}
                {frame.variables.map(v => (
                  <VarRow
                    key={v.name}
                    variable={v}
                    frameId={frame.id}
                    heap={heap}
                    isNew={step.newVarKeys.includes(`${frame.id}:${v.name}`)}
                    isChanged={false}
                    hoveredId={hoveredId}
                    onHover={onHover}
                  />
                ))}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Heap object card ──────────────────────────────────────────────────────────

interface HeapCardProps {
  obj: HeapObject;
  step: SimulationStep;
  heap: HeapObject[];
  refLabels: string[];
  isHighlighted: boolean;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
}

function HeapCard({ obj, step, heap, refLabels, isHighlighted, hoveredId, onHover }: HeapCardProps) {
  const isNew = step.newHeapIds.includes(obj.id);
  const isChanged = step.changedHeapId === obj.id;

  if (obj.isString) {
    return (
      <motion.div
        id={`heap-${obj.id}`}
        key={obj.id}
        layout
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`heap-card heap-string ${isNew ? 'heap-new' : ''} ${isHighlighted ? 'heap-highlighted' : ''}`}
      >
        <div className="heap-card-header">
          <span className="heap-class-label">String</span>
        </div>
        <div className="string-value">"{obj.stringValue}"</div>
        <div className="heap-id">{obj.id}</div>
        {refLabels.length > 0 && (
          <div className="heap-incoming-refs">
            {refLabels.map(lbl => (
              <span key={lbl} className="incoming-ref">⟵ {lbl}</span>
            ))}
          </div>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div
      id={`heap-${obj.id}`}
      key={obj.id}
      layout
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`heap-card heap-object ${isNew ? 'heap-new' : ''} ${isChanged ? 'heap-changed' : ''} ${isHighlighted ? 'heap-highlighted' : ''}`}
    >
      <div className="heap-card-header">
        <span className="heap-class-label">{obj.className}</span>
        {refLabels.length > 0 && (
          <span className="heap-ref-badges">
            {refLabels.map(lbl => <span key={lbl} className="ref-badge">{lbl}</span>)}
          </span>
        )}
      </div>
      <div className="heap-id">{obj.id}</div>
      <div className="heap-fields">
        {obj.fields.length === 0 && <div className="empty-hint">(no fields)</div>}
        {obj.fields.map(f => {
          const { text, isRef: isRefVal, refId } = displayValue(f.value, heap);
          const fieldChanged = isChanged && step.changedField === f.name;
          const isHovered = refId !== null && hoveredId === refId;
          return (
            <div
              key={f.name}
              id={`heap-field-${obj.id}-${f.name}`}
              className={`heap-field ${fieldChanged ? 'field-changed' : ''} ${isHovered ? 'field-hovered' : ''}`}
              onMouseEnter={() => refId && onHover(refId)}
              onMouseLeave={() => onHover(null)}
            >
              <span className="field-type">{f.type}</span>
              <span className="field-name">{f.name}</span>
              <span className="field-equals">=</span>
              <span className={`field-value ${isRefVal ? 'ref-value' : 'prim-value'}`}>
                {text}
              </span>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ── Heap panel ────────────────────────────────────────────────────────────────

interface HeapPanelProps {
  objects: HeapObject[];
  step: SimulationStep;
  refLabels: Map<string, string[]>;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
}

function HeapPanel({ objects, step, refLabels, hoveredId, onHover }: HeapPanelProps) {
  return (
    <div className="heap-panel">
      <div className="panel-header">Heap</div>
      <div className="heap-objects">
        <AnimatePresence>
          {objects.map(obj => (
            <HeapCard
              key={obj.id}
              obj={obj}
              step={step}
              heap={objects}
              refLabels={refLabels.get(obj.id) ?? []}
              isHighlighted={hoveredId === obj.id}
              hoveredId={hoveredId}
              onHover={onHover}
            />
          ))}
        </AnimatePresence>
        {objects.length === 0 && <div className="heap-empty">Heap is empty</div>}
      </div>
    </div>
  );
}

// ── Output console ────────────────────────────────────────────────────────────

function OutputPanel({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="output-panel">
      <div className="panel-header">Output</div>
      <div className="output-lines">
        {lines.map((l, i) => <div key={i} className="output-line">{l}</div>)}
      </div>
    </div>
  );
}

// ── Main MemoryView ───────────────────────────────────────────────────────────

export function MemoryView({ step }: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (!step) {
    return (
      <div className="memory-panel empty-memory">
        <div className="empty-message">
          <div className="empty-icon">⟨ / ⟩</div>
          <div>Write Java code and press Run</div>
          <div className="empty-sub">The memory will animate step by step</div>
        </div>
      </div>
    );
  }

  const { stack, heap, output } = step.state;

  // Build refLabels: heapId → variable names that point to it (from the stack)
  const refLabels = new Map<string, string[]>();
  stack.forEach(frame => {
    frame.variables.forEach(v => {
      if (isRef(v.value) && v.value.heapId !== null) {
        const labels = refLabels.get(v.value.heapId) ?? [];
        labels.push(v.name);
        refLabels.set(v.value.heapId, labels);
      }
    });
  });

  // Build arrows: from each reference variable to its heap object
  const arrows: ArrowDef[] = [];
  stack.forEach(frame => {
    frame.variables.forEach(v => {
      if (isRef(v.value) && v.value.heapId !== null) {
        const heapId = v.value.heapId;
        const heapObj = heap.find(o => o.id === heapId);
        if (heapObj) {
          arrows.push({
            fromId: `var-${frame.id}-${v.name}`,
            toId: `heap-${heapId}`,
            color: heapObj.isString ? '#60a5fa' : '#f59e0b',
          });
        }
      }
    });
  });

  return (
    <div className="memory-panel" style={{ position: 'relative' }}>
      <ArrowLayer arrows={arrows} />
      <div className="memory-content">
        <StackPanel
          frames={stack}
          step={step}
          heap={heap}
          hoveredId={hoveredId}
          onHover={setHoveredId}
        />
        <HeapPanel
          objects={heap}
          step={step}
          refLabels={refLabels}
          hoveredId={hoveredId}
          onHover={setHoveredId}
        />
      </div>
      {output.length > 0 && <OutputPanel lines={output} />}
    </div>
  );
}
