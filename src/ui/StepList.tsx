import { useEffect, useRef } from 'react';
import { fmt, type Analysis, type Issue } from '../core/analyze';
import { minRadius } from '../core/bending';
import {
  DIRECTION_ARROW,
  bend,
  straight,
  twist,
  type Busbar,
  type Direction,
  type MachineSettings,
  type Plane,
  type Step,
} from '../core/model';
import type { NumPadRequest } from './NumPad';

interface Props {
  bar: Busbar;
  analysis: Analysis;
  issues: Issue[];
  settings: MachineSettings;
  selected: number | null;
  onSelect: (i: number | null) => void;
  updateSteps: (fn: (steps: Step[]) => Step[]) => void;
  numpad: (req: NumPadRequest) => void;
}

const ANGLES = [15, 30, 45, 60, 90, 120, 135];

export function StepList({ bar, analysis, issues, settings, selected, onSelect, updateSteps, numpad }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected === null) return;
    listRef.current?.querySelector(`[data-step="${selected}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  const patch = (i: number, p: Partial<Step>) =>
    updateSteps((steps) => steps.map((s, k) => (k === i ? ({ ...s, ...p } as Step) : s)));

  /** Insert a new operation + straight after the selected straight (or at the end). */
  const add = (kind: 'flat' | 'edge' | 'twist') => {
    const op: Step =
      kind === 'twist'
        ? twist(90, Math.max(2 * bar.section.width, 60))
        : bend(kind as Plane, 90, kind === 'flat' ? 'up' : 'right', kind === 'flat' ? settings.radiusFlat : settings.radiusEdge);
    const leg = straight(150);
    let insertAt = bar.steps.length;
    if (selected !== null && bar.steps[selected]?.kind === 'straight') insertAt = selected + 1;
    updateSteps((steps) => [...steps.slice(0, insertAt), op, leg, ...steps.slice(insertAt)]);
    onSelect(insertAt);
  };

  const remove = (i: number) => {
    const s = bar.steps[i];
    updateSteps((steps) => {
      if (s.kind === 'straight') {
        // Removing a leg also removes the operation before it (or after, for the first leg).
        if (steps.length <= 1) return steps;
        if (i > 0 && steps[i - 1].kind !== 'straight') return steps.filter((_, k) => k !== i && k !== i - 1);
        if (steps[i + 1] && steps[i + 1].kind !== 'straight') return steps.filter((_, k) => k !== i && k !== i + 1);
        return steps.filter((_, k) => k !== i);
      }
      // Removing an operation merges the two neighbouring legs.
      const prev = steps[i - 1];
      const next = steps[i + 1];
      if (prev?.kind === 'straight' && next?.kind === 'straight') {
        const merged = { ...prev, length: prev.length + next.length };
        return [...steps.slice(0, i - 1), merged, ...steps.slice(i + 2)];
      }
      return steps.filter((_, k) => k !== i);
    });
    onSelect(null);
  };

  let legNo = 0;
  return (
    <div className="steps">
      <div className="steps-list" ref={listRef}>
        {bar.steps.map((s, i) => {
          const stepIssues = issues.filter((x) => x.stepIndex === i);
          const level = stepIssues.some((x) => x.level === 'error') ? 'error' : stepIssues.length ? 'warning' : '';
          const sel = i === selected;
          const common = {
            'data-step': i,
            className: `step step-${s.kind} ${sel ? 'selected' : ''} ${level}`,
            onClick: () => onSelect(sel ? null : i),
          };
          if (s.kind === 'straight') {
            legNo++;
            const net = analysis.netStraight[i];
            return (
              <div key={s.id} {...common}>
                <div className="step-head">
                  <span className="step-icon">━</span>
                  <span className="step-title">Odcinek {legNo}</span>
                  <Del onClick={() => remove(i)} disabled={bar.steps.length <= 1} />
                </div>
                <div className="step-body">
                  <Chip
                    big
                    label="Długość"
                    value={`${fmt(s.length)} mm`}
                    onClick={() =>
                      numpad({
                        title: `Odcinek ${legNo} – długość (${bar.dimensionMode === 'outside' ? 'zewn.' : bar.dimensionMode === 'inside' ? 'wewn.' : 'oś'})`,
                        value: s.length,
                        unit: 'mm',
                        min: 1,
                        max: 10000,
                        onOk: (v) => patch(i, { length: v }),
                      })
                    }
                  />
                  {net !== undefined && Math.abs(net - s.length) > 0.05 && (
                    <span className="step-note">prosta część: {fmt(net)} mm</span>
                  )}
                </div>
                <IssueList issues={stepIssues} />
              </div>
            );
          }
          if (s.kind === 'bend') {
            const info = analysis.bends.find((b) => b.stepIndex === i);
            const dirs: Direction[] = s.plane === 'flat' ? ['up', 'down'] : ['left', 'right'];
            return (
              <div key={s.id} {...common}>
                <div className="step-head">
                  <span className="step-icon">↱</span>
                  <span className="step-title">Gięcie {info?.no}</span>
                  <Del onClick={() => remove(i)} />
                </div>
                <div className="step-body">
                  <div className="seg">
                    {(['flat', 'edge'] as Plane[]).map((p) => (
                      <button
                        key={p}
                        className={s.plane === p ? 'on' : ''}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (p === s.plane) return;
                          patch(i, {
                            plane: p,
                            direction: p === 'flat' ? 'up' : 'right',
                            radius: p === 'flat' ? settings.radiusFlat : settings.radiusEdge,
                          });
                        }}
                      >
                        {p === 'flat' ? 'Płaskie' : 'Na kant'}
                      </button>
                    ))}
                  </div>
                  <div className="seg">
                    {dirs.map((d) => (
                      <button
                        key={d}
                        className={`dir ${s.direction === d ? 'on' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          patch(i, { direction: d });
                        }}
                      >
                        {DIRECTION_ARROW[d]}
                      </button>
                    ))}
                  </div>
                  <Chip
                    big
                    label="Kąt"
                    value={`${fmt(s.angle)}°`}
                    onClick={() =>
                      numpad({
                        title: `Gięcie ${info?.no} – kąt gięcia`,
                        value: s.angle,
                        unit: '°',
                        min: 1,
                        max: 179,
                        quick: ANGLES,
                        onOk: (v) => patch(i, { angle: v }),
                      })
                    }
                  />
                  <Chip
                    label="R"
                    value={`${fmt(s.radius)}`}
                    onClick={() =>
                      numpad({
                        title: `Gięcie ${info?.no} – promień wewnętrzny`,
                        value: s.radius,
                        unit: 'mm',
                        min: 0,
                        max: 1000,
                        quick: [minRadius(bar.section, s.plane), s.plane === 'flat' ? settings.radiusFlat : settings.radiusEdge],
                        onOk: (v) => patch(i, { radius: v }),
                      })
                    }
                  />
                </div>
                {info && (
                  <div className="step-note">
                    nastawa {fmt(info.machineAngle)}° · pozycja {fmt(info.position)} mm
                  </div>
                )}
                <IssueList issues={stepIssues} />
              </div>
            );
          }
          return (
            <div key={s.id} {...common}>
              <div className="step-head">
                <span className="step-icon">⟲</span>
                <span className="step-title">Skręt</span>
                <Del onClick={() => remove(i)} />
              </div>
              <div className="step-body">
                <Chip
                  big
                  label="Kąt"
                  value={`${fmt(s.angle)}°`}
                  onClick={() =>
                    numpad({
                      title: 'Skręt – kąt',
                      value: s.angle,
                      unit: '°',
                      min: -180,
                      max: 180,
                      quick: [90, -90, 45, -45],
                      onOk: (v) => patch(i, { angle: v }),
                    })
                  }
                />
                <Chip
                  label="Strefa"
                  value={`${fmt(s.length)} mm`}
                  onClick={() =>
                    numpad({
                      title: 'Skręt – długość strefy skrętu',
                      value: s.length,
                      unit: 'mm',
                      min: 1,
                      max: 2000,
                      quick: [2 * bar.section.width, 3 * bar.section.width],
                      onOk: (v) => patch(i, { length: v }),
                    })
                  }
                />
              </div>
              <IssueList issues={stepIssues} />
            </div>
          );
        })}
      </div>
      <div className="steps-add">
        <button onClick={() => add('flat')}>
          <b>+</b> Gięcie płaskie
        </button>
        <button onClick={() => add('edge')}>
          <b>+</b> Gięcie na kant
        </button>
        <button onClick={() => add('twist')}>
          <b>+</b> Skręt
        </button>
      </div>
      <div className="steps-hint">
        {selected !== null && bar.steps[selected]?.kind === 'straight'
          ? 'Nowe gięcie zostanie wstawione za zaznaczonym odcinkiem.'
          : 'Nowe gięcie zostanie dodane na końcu szyny.'}
      </div>
    </div>
  );
}

function Chip({ label, value, onClick, big }: { label: string; value: string; onClick: () => void; big?: boolean }) {
  return (
    <button
      className={`chip ${big ? 'chip-big' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <span className="chip-label">{label}</span>
      <span className="chip-value">{value}</span>
    </button>
  );
}

function Del({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      className="del"
      disabled={disabled}
      title="Usuń"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      🗑
    </button>
  );
}

function IssueList({ issues }: { issues: Issue[] }) {
  if (!issues.length) return null;
  return (
    <div className="step-issues">
      {issues.map((x, k) => (
        <div key={k} className={x.level}>
          {x.level === 'error' ? '⛔' : '⚠'} {x.message}
        </div>
      ))}
    </div>
  );
}
