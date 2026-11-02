import { useEffect, useRef } from 'react';
import { fmt, type Analysis, type Issue } from '../core/analyze';
import { minRadius } from '../core/bending';
import { doubleConfig } from '../core/assembly';
import { freeHolePosition, removeStep } from '../core/edit';
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
  /** Called after a step was removed, with a description (shown with an undo button). */
  onRemoved: (text: string) => void;
  numpad: (req: NumPadRequest) => void;
}

const HOLE_DIAMETERS = [9, 11, 13, 14, 17, 18];
const REF_TEXT = {
  outside: 'od zewnętrznej krawędzi poprzedniego ramienia',
  inside: 'od wewnętrznej krawędzi poprzedniego ramienia',
  centerline: 'od osi poprzedniego ramienia',
} as const;

const ANGLES = [15, 30, 45, 60, 90, 120, 135];

export function StepList({
  bar,
  analysis,
  issues,
  settings,
  selected,
  onSelect,
  updateSteps,
  setDouble,
  onRemoved,
  numpad: openNumpad,
}: Props) {
  // Keypads opened from the step list dock to the side on landscape tablets (model stays visible).
  const numpad = (r: NumPadRequest) => openNumpad({ ...r, placement: 'side' });
  const dbl = doubleConfig(bar);
  // Which bar is inside the arc in each bend ("up" turns towards the side above).
  const inner: number[] = [];
  const outer: number[] = [];
  analysis.bends.forEach((b) => ((b.direction === 'up') === (dbl.side === 'above') ? inner : outer).push(b.no));
  const innerOuterText = !analysis.bends.length
    ? ''
    : [
        inner.length ? `Szyna 2 wewnątrz łuku w gięciu ${inner.join(', ')}.` : '',
        outer.length ? `Szyna 2 na zewnątrz łuku w gięciu ${outer.join(', ')}.` : '',
      ]
        .filter(Boolean)
        .join(' ');
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
    // Straight part of the leg in the leg's own coordinates (measured like the leg dimension).
    const sbBefore = analysis.bends.find((b) => b.stepIndex === i - 1)?.setback ?? 0;
    const d0 = bar.section.width >= 30 ? 13 : 9;
    const pos = freeHolePosition(
      (s.holes ?? []).map((h) => h.position),
      sbBefore,
      sbBefore + net,
      d0,
      1.5 * bar.section.thickness,
    );
    updateSteps((steps) =>
      steps.map((st, k) => (k === i && st.kind === 'straight' ? { ...st, holes: [...(st.holes ?? []), hole(pos, d0)] } : st)),
    );
    onSelect(i);
  };

  const legNoOf = (i: number) => bar.steps.slice(0, i + 1).filter((st) => st.kind === 'straight').length;
  const bendNoOf = (i: number) => bar.steps.slice(0, i + 1).filter((st) => st.kind === 'bend').length;
  const fieldLabel = (j: number) =>
    bar.steps[j]?.kind === 'straight' ? `odcinek ${legNoOf(j)}` : bar.steps[j] ? `gięcie ${bendNoOf(j)}` : '';
  /** "OK i dalej" opens the main value of the next step (length of a leg, angle of a bend). */
  const nextOf = (i: number) => (bar.steps[i + 1] ? { onNext: () => editMain(i + 1), nextLabel: fieldLabel(i + 1) } : {});
  const editMain = (i: number) => {
    const st = bar.steps[i];
    if (!st) return;
    onSelect(i);
    if (st.kind === 'straight') {
      numpad({
        title: `Odcinek ${legNoOf(i)} – długość (${bar.dimensionMode === 'outside' ? 'zewn.' : bar.dimensionMode === 'inside' ? 'wewn.' : 'oś'})`,
        value: st.length,
        unit: 'mm',
        min: 1,
        max: 10000,
        onOk: (v) => patch(i, { length: v }),
        ...nextOf(i),
      });
    } else {
      numpad({
        title: `Gięcie ${bendNoOf(i)} – o ile giąć`,
        value: st.angle,
        unit: '°',
        min: 1,
        max: 179,
        quick: ANGLES,
        figure: 'bend-angle',
        onOk: (v) => patch(i, { angle: v }),
        ...nextOf(i),
      });
    }
  };

  const remove = (i: number) => {
    const st = bar.steps[i];
    const next = removeStep(bar.steps, i);
    if (next === bar.steps) return;
    let text: string;
    if (st.kind === 'bend') {
      const merged = next[i - 1];
      text = `Usunięto gięcie ${bendNoOf(i)}${merged?.kind === 'straight' ? ` – odcinki połączone w jeden (${fmt(merged.length)} mm)` : ''}.`;
    } else {
      text = `Usunięto odcinek ${legNoOf(i)}${bar.steps.length - next.length > 1 ? ' razem z sąsiednim gięciem' : ''}.`;
    }
    updateSteps(() => next);
    onSelect(null);
    onRemoved(text);
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
                Szyna 2 nad
              </button>
              <button className={dbl.side === 'below' ? 'on' : ''} onClick={() => setDouble({ ...dbl, side: 'below' })}>
                Szyna 2 pod
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
      {dbl.enabled && <div className="pack-hint">{innerOuterText} Wymiary odcinków i otworów wpisujesz dla szyny 1.</div>}
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
            const n = legNo; // captured for click handlers (legNo keeps changing while rendering)
            const net = analysis.netStraight[i];
            return (
              <div key={s.id} {...common}>
                <div className="step-head">
                  <span className="step-icon">━</span>
                  <span className="step-title">Odcinek {n}</span>
                  <Del onClick={() => remove(i)} disabled={bar.steps.length <= 1} />
                </div>
                <div className="step-body">
                  <Chip big label="Długość" value={`${fmt(s.length)} mm`} onClick={() => editMain(i)} />
                  {net !== undefined && Math.abs(net - s.length) > 0.05 && (
                    <span className="step-note">prosta część: {fmt(net)} mm</span>
                  )}
                </div>
                {[...(s.holes ?? [])]
                  .sort((a, b) => a.position - b.position)
                  .map((h) => {
                    const info = analysis.holes.find((x) => x.holeId === h.id);
                    const ref = i === 0 ? 'od końca A' : REF_TEXT[bar.dimensionMode];
                    const slot = h.slot > h.diameter;
                    return (
                      <div className="hole-row" key={h.id}>
                        <div className="hole-line">
                          <span className="hole-badge">O{info?.no ?? '?'}</span>
                          <Chip
                            big
                            label={i === 0 ? 'Od końca A' : 'Od narożnika'}
                            value={`${fmt(h.position)} mm`}
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
                            label={slot ? 'Szerokość' : 'Średnica'}
                            value={`Ø ${fmt(h.diameter)}`}
                            onClick={() =>
                              numpad({
                                title: slot ? 'Szerokość fasolki' : 'Średnica otworu',
                                value: h.diameter,
                                unit: 'mm',
                                min: 1,
                                max: bar.section.width,
                                quick: HOLE_DIAMETERS,
                                onOk: (v) => patchHole(i, h.id, { diameter: v }),
                              })
                            }
                          />
                          <Del onClick={() => removeHole(i, h.id)} />
                        </div>
                        <div className="hole-line">
                          <div className="seg">
                            <button
                              className={!slot ? 'on' : ''}
                              onClick={(e) => {
                                e.stopPropagation();
                                patchHole(i, h.id, { slot: 0 });
                              }}
                            >
                              Okrągły
                            </button>
                            <button
                              className={slot ? 'on' : ''}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!slot) patchHole(i, h.id, { slot: Math.round(h.diameter * 2) });
                              }}
                            >
                              Fasolka
                            </button>
                          </div>
                          {slot && (
                            <Chip
                              label="Długość fasolki"
                              value={`${fmt(h.slot)} mm`}
                              onClick={() =>
                                numpad({
                                  title: 'Długość fasolki (wzdłuż szyny, całkowita)',
                                  value: h.slot,
                                  unit: 'mm',
                                  min: h.diameter,
                                  max: 500,
                                  quick: [20, 25, 30, 40],
                                  onOk: (v) => patchHole(i, h.id, { slot: v }),
                                })
                              }
                            />
                          )}
                          <Chip
                            label="W poprzek"
                            value={h.offset === 0 ? 'środek' : `${h.offset > 0 ? '+' : ''}${fmt(h.offset)} mm`}
                            onClick={() =>
                              numpad({
                                title: 'Przesunięcie w poprzek szyny od środka (+ w stronę dolnej krawędzi rysunku)',
                                value: h.offset,
                                unit: 'mm',
                                min: -bar.section.width / 2,
                                max: bar.section.width / 2,
                                quick: [0, -bar.section.width / 4, bar.section.width / 4],
                                onOk: (v) => patchHole(i, h.id, { offset: v }),
                              })
                            }
                          />
                        </div>
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
                  <Chip big label="Kąt" value={`${fmt(s.angle)}°`} onClick={() => editMain(i)} />
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
                {s.radius !== settings.radius && (
                  <div className="step-note radius-note">
                    R{fmt(s.radius)} ≠ narzędzie R{fmt(settings.radius)} – sprawdź, czy maszyna ma takie narzędzie
                  </div>
                )}
                {info && (
                  <div className="step-tiles">
                    <div className="tile">
                      <span className="chip-label">Nastawa</span>
                      <b>{fmt(info.machineAngle)}°</b>
                    </div>
                    <div className="tile">
                      <span className="chip-label">Pozycja od A</span>
                      <b>{fmt(info.position)} mm</b>
                    </div>
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
