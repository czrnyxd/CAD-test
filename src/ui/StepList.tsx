import { useEffect, useRef } from 'react';
import { fmt, type Analysis, type Issue } from '../core/analyze';
import { minRadius } from '../core/bending';
import { doubleConfig } from '../core/assembly';
import {
  DIRECTION_ARROW,
  DIRECTION_LABEL,
  bend,
  hole,
  straight,
  type Busbar,
  type Direction,
  type DoubleConfig,
  type Hole,
  type MachineSettings,
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
  setDouble: (cfg: DoubleConfig) => void;
  numpad: (req: NumPadRequest) => void;
}

const HOLE_DIAMETERS = [9, 11, 13, 14, 17, 18];
const REF_TEXT = {
  outside: 'od zewnętrznej krawędzi poprzedniego ramienia',
  inside: 'od wewnętrznej krawędzi poprzedniego ramienia',
  centerline: 'od osi poprzedniego ramienia',
} as const;

const ANGLES = [15, 30, 45, 60, 90, 120, 135];

export function StepList({ bar, analysis, issues, settings, selected, onSelect, updateSteps, setDouble, numpad }: Props) {
  const dbl = doubleConfig(bar);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected === null) return;
    listRef.current?.querySelector(`[data-step="${selected}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  const patch = (i: number, p: Partial<Step>) =>
    updateSteps((steps) => steps.map((s, k) => (k === i ? ({ ...s, ...p } as Step) : s)));

  /** Insert a new bend + straight after the selected straight (or at the end). */
  const add = () => {
    const op: Step = bend(90, 'up', settings.radius);
    const leg = straight(150);
    let insertAt = bar.steps.length;
    if (selected !== null && bar.steps[selected]?.kind === 'straight') insertAt = selected + 1;
    updateSteps((steps) => [...steps.slice(0, insertAt), op, leg, ...steps.slice(insertAt)]);
    onSelect(insertAt);
  };

  const patchHole = (i: number, id: string, p: Partial<Hole>) =>
    updateSteps((steps) =>
      steps.map((s, k) =>
        k === i && s.kind === 'straight' ? { ...s, holes: (s.holes ?? []).map((h) => (h.id === id ? { ...h, ...p } : h)) } : s,
      ),
    );

  const removeHole = (i: number, id: string) =>
    updateSteps((steps) =>
      steps.map((s, k) => (k === i && s.kind === 'straight' ? { ...s, holes: (s.holes ?? []).filter((h) => h.id !== id) } : s)),
    );

  const addHole = (i: number) => {
    const s = bar.steps[i];
    if (s.kind !== 'straight') return;
    const net = Math.max(0, analysis.netStraight[i] ?? s.length);
    // Centre of the straight part of the leg, measured like the leg dimension.
    const sbBefore = analysis.bends.find((b) => b.stepIndex === i - 1)?.setback ?? 0;
    const pos = Math.round(sbBefore + net / 2);
    const d = bar.section.width >= 30 ? 13 : 9;
    updateSteps((steps) =>
      steps.map((st, k) => (k === i && st.kind === 'straight' ? { ...st, holes: [...(st.holes ?? []), hole(pos, d)] } : st)),
    );
    onSelect(i);
  };

  const remove = (i: number) => {
    const s = bar.steps[i];
    updateSteps((steps) => {
      if (s.kind === 'straight') {
        // Removing a leg also removes the bend before it (or after, for the first leg).
        if (steps.length <= 1) return steps;
        if (i > 0 && steps[i - 1].kind !== 'straight') return steps.filter((_, k) => k !== i && k !== i - 1);
        if (steps[i + 1] && steps[i + 1].kind !== 'straight') return steps.filter((_, k) => k !== i && k !== i + 1);
        return steps.filter((_, k) => k !== i);
      }
      // Removing a bend merges the two neighbouring legs.
      const prev = steps[i - 1];
      const next = steps[i + 1];
      if (prev?.kind === 'straight' && next?.kind === 'straight') {
        const holes = [...(prev.holes ?? []), ...(next.holes ?? []).map((h) => ({ ...h, position: h.position + prev.length }))];
        const merged = { ...prev, length: prev.length + next.length, holes };
        return [...steps.slice(0, i - 1), merged, ...steps.slice(i + 2)];
      }
      return steps.filter((_, k) => k !== i);
    });
    onSelect(null);
  };

  let legNo = 0;
  return (
    <div className="steps">
      <div className="pack">
        <div className="seg">
          <button className={!dbl.enabled ? 'on' : ''} onClick={() => setDouble({ ...dbl, enabled: false })}>
            Pojedyncza
          </button>
          <button className={dbl.enabled ? 'on' : ''} onClick={() => setDouble({ ...dbl, enabled: true })}>
            Podwójna
          </button>
        </div>
        {dbl.enabled && (
          <>
            <div className="seg">
              <button className={dbl.side === 'above' ? 'on' : ''} onClick={() => setDouble({ ...dbl, side: 'above' })}>
                2 nad
              </button>
              <button className={dbl.side === 'below' ? 'on' : ''} onClick={() => setDouble({ ...dbl, side: 'below' })}>
                2 pod
              </button>
            </div>
            <Chip
              label="Odstęp"
              value={`${fmt(dbl.gap)} mm`}
              onClick={() =>
                numpad({
                  title: 'Odstęp między szynami (0 = przylegają)',
                  value: dbl.gap,
                  unit: 'mm',
                  min: 0,
                  max: 200,
                  quick: [0, 1, 2, bar.section.thickness],
                  onOk: (v) => setDouble({ ...dbl, gap: v }),
                })
              }
            />
          </>
        )}
      </div>
      {dbl.enabled && <div className="pack-hint">Wymiary odcinków i otworów dotyczą szyny 1.</div>}
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
                {(s.holes ?? []).map((h) => {
                  const info = analysis.holes.find((x) => x.holeId === h.id);
                  const n = legNo;
                  const ref = i === 0 ? 'od końca A' : REF_TEXT[bar.dimensionMode];
                  return (
                    <div className="hole-row" key={h.id}>
                      <span className="hole-badge">O{info?.no ?? '?'}</span>
                      <Chip
                        label={i === 0 ? 'Od A' : 'Pozycja'}
                        value={`${fmt(h.position)}`}
                        onClick={() =>
                          numpad({
                            title: `Odcinek ${n} – środek otworu ${ref}`,
                            value: h.position,
                            unit: 'mm',
                            min: 0,
                            max: s.length,
                            onOk: (v) => patchHole(i, h.id, { position: v }),
                          })
                        }
                      />
                      <Chip
                        label="Ø"
                        value={`${fmt(h.diameter)}`}
                        onClick={() =>
                          numpad({
                            title: 'Średnica otworu / szerokość fasolki',
                            value: h.diameter,
                            unit: 'mm',
                            min: 1,
                            max: bar.section.width,
                            quick: HOLE_DIAMETERS,
                            onOk: (v) => patchHole(i, h.id, { diameter: v }),
                          })
                        }
                      />
                      <Chip
                        label="Fasolka"
                        value={h.slot > h.diameter ? `${fmt(h.slot)}` : '—'}
                        onClick={() =>
                          numpad({
                            title: 'Długość fasolki (0 = otwór okrągły)',
                            value: h.slot,
                            unit: 'mm',
                            min: 0,
                            max: 500,
                            quick: [0, 20, 25, 30, 40],
                            onOk: (v) => patchHole(i, h.id, { slot: v }),
                          })
                        }
                      />
                      <Chip
                        label="Od osi"
                        value={`${fmt(h.offset)}`}
                        onClick={() =>
                          numpad({
                            title: 'Przesunięcie otworu od osi szyny (w poprzek)',
                            value: h.offset,
                            unit: 'mm',
                            min: -bar.section.width / 2,
                            max: bar.section.width / 2,
                            quick: [0, -bar.section.width / 4, bar.section.width / 4],
                            onOk: (v) => patchHole(i, h.id, { offset: v }),
                          })
                        }
                      />
                      <Del onClick={() => removeHole(i, h.id)} />
                    </div>
                  );
                })}
                <button
                  className="add-hole"
                  onClick={(e) => {
                    e.stopPropagation();
                    addHole(i);
                  }}
                >
                  + Otwór
                </button>
                <IssueList issues={stepIssues} />
              </div>
            );
          }
          if (s.kind === 'bend') {
            const info = analysis.bends.find((b) => b.stepIndex === i);
            const dirs: Direction[] = ['up', 'down'];
            return (
              <div key={s.id} {...common}>
                <div className="step-head">
                  <span className="step-icon">↱</span>
                  <span className="step-title">Gięcie {info?.no}</span>
                  <Del onClick={() => remove(i)} />
                </div>
                <div className="step-body">
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
                        {DIRECTION_ARROW[d]} <span className="dir-text">{DIRECTION_LABEL[d]}</span>
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
                        quick: [...new Set([minRadius(bar.section), settings.radius])],
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
          return null;
        })}
      </div>
      <div className="steps-add">
        <button onClick={add}>
          <b>+</b> Dodaj gięcie
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
