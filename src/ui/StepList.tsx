import { useEffect, useRef, type ReactNode } from 'react';
import { fmt, plural, type Analysis, type Issue } from '../core/analyze';
import { minRadius } from '../core/bending';
import { doubleConfig } from '../core/assembly';
import { freeHolePosition, removeStep } from '../core/edit';
import {
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
import { Chip, Notice, Seg, Tile } from './controls';
import { Icon } from './Icon';
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
  /** Open the cabinet settings; `cabinetOn` – the bar is shown in a cabinet. */
  onCabinet: () => void;
  cabinetOn: boolean;
}

const HOLE_DIAMETERS = [9, 11, 13, 14, 17, 18];
const REF_TEXT = {
  outside: 'od zewnętrznej krawędzi poprzedniego ramienia',
  inside: 'od wewnętrznej krawędzi poprzedniego ramienia',
  centerline: 'od osi poprzedniego ramienia',
} as const;

const ANGLES = [15, 30, 45, 60, 90, 120, 135];

type State = 'error' | 'warning' | undefined;

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
  onCabinet,
  cabinetOn,
}: Props) {
  // Keypads opened from the step list take the place of the panel on landscape tablets (model stays visible).
  const numpad = (r: NumPadRequest) => openNumpad({ ...r, placement: 'side' });
  const dbl = doubleConfig(bar);
  // Which bar is inside the arc in each bend ("up" turns towards the side above).
  const inner: number[] = [];
  const outer: number[] = [];
  analysis.bends.forEach((b) => ((b.direction === 'up') === (dbl.side === 'above') ? inner : outer).push(b.no));
  const innerOuterText = [
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

  const legNoOf = (i: number) => bar.steps.slice(0, i + 1).filter((st) => st.kind === 'straight').length;
  const bendNoOf = (i: number) => bar.steps.slice(0, i + 1).filter((st) => st.kind === 'bend').length;
  const insertAfterSelected = selected !== null && bar.steps[selected]?.kind === 'straight';

  /** Insert a new bend + straight after the selected straight (or at the end). */
  const add = () => {
    const op: Step = bend(90, 'up', settings.radius);
    const leg = straight(150);
    const insertAt = insertAfterSelected ? selected! + 1 : bar.steps.length;
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
      text = `Usunięto gięcie ${bendNoOf(i)}${merged?.kind === 'straight' ? `, odcinki połączone (${fmt(merged.length)} mm)` : ''}`;
    } else {
      text = `Usunięto odcinek ${legNoOf(i)}${bar.steps.length - next.length > 1 ? ' z sąsiednim gięciem' : ''}`;
    }
    updateSteps(() => next);
    onSelect(null);
    onRemoved(text);
  };

  return (
    <aside className="bb-panel steps" aria-label="Lista kroków">
      <div className="bb-panel-top bb-row">
        <Seg
          label="Układ szyn"
          className="bb-grow"
          block
          value={dbl.enabled ? 'd' : 's'}
          options={[
            { value: 's', label: 'Pojedyncza' },
            { value: 'd', label: 'Podwójna' },
          ]}
          onChange={(v) => setDouble({ ...dbl, enabled: v === 'd' })}
        />
        <button className={`bb-toggle cab-open ${cabinetOn ? 'is-on' : ''}`} onClick={onCabinet}>
          <Icon name="cabinet" />
          Szafa
          <span className="bb-toggle-state">{cabinetOn ? 'wł.' : 'wył.'}</span>
        </button>
      </div>
      {dbl.enabled && (
        <div className="bb-dual">
          <div className="bb-row">
            <div className="bb-grow">
              <span className="bb-field-label">Szyna 2</span>
              <Seg
                label="Położenie szyny 2"
                block
                value={dbl.side}
                options={[
                  { value: 'above', label: 'Nad' },
                  { value: 'below', label: 'Pod' },
                ]}
                onChange={(v) => setDouble({ ...dbl, side: v as DoubleConfig['side'] })}
              />
            </div>
            <Chip
              label="Odstęp"
              value={fmt(dbl.gap)}
              unit="mm"
              className="dual-gap"
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
          </div>
          <Notice tone="info">{innerOuterText} Wymiary odcinków i otworów wpisujesz dla szyny 1.</Notice>
        </div>
      )}
      <div className="bb-steps steps-list" ref={listRef}>
        {bar.steps.map((s, i) => {
          const stepIssues = issues.filter((x) => x.stepIndex === i);
          const state: State = stepIssues.some((x) => x.level === 'error') ? 'error' : stepIssues.length ? 'warning' : undefined;
          const sel = i === selected;
          const toggle = () => onSelect(sel ? null : i);
          if (s.kind === 'straight') {
            const n = legNoOf(i);
            const net = analysis.netStraight[i];
            const holes = [...(s.holes ?? [])].sort((a, b) => a.position - b.position);
            const holeIssues = (id: string) => stepIssues.filter((x) => x.holeId === id);
            const legIssues = stepIssues.filter((x) => !x.holeId);
            return (
              <StepCard
                key={s.id}
                index={i}
                kind="seg"
                badge={String(n)}
                title={`Odcinek ${n}`}
                selected={sel}
                state={state}
                onHead={toggle}
                summary={
                  <>
                    {holes.length > 0 && (
                      <span className="bb-step-extra">{plural(holes.length, ['otwór', 'otwory', 'otworów'])}</span>
                    )}
                    <span className="bb-step-val">{fmt(s.length)} mm</span>
                  </>
                }
                headAction={bar.steps.length > 1 && <DeleteButton className="bb-step-del" onClick={() => remove(i)} />}
              >
                <div className="bb-row">
                  <Chip
                    label="Długość"
                    value={fmt(s.length)}
                    unit="mm"
                    state={legIssues.some((x) => x.level === 'error') ? 'error' : undefined}
                    className="bb-grow"
                    onClick={() => editMain(i)}
                  />
                  <button className="bb-btn bb-btn--secondary add-hole" onClick={() => addHole(i)}>
                    <Icon name="plus" />
                    Dodaj otwór
                  </button>
                </div>
                {net !== undefined && net > 0 && Math.abs(net - s.length) > 0.05 && (
                  <div className="step-note">
                    Prosta część (bez łuków): <b>{fmt(net)} mm</b>
                  </div>
                )}
                <IssueList issues={legIssues} />
                {holes.map((h) => {
                  const info = analysis.holes.find((x) => x.holeId === h.id);
                  const ref = i === 0 ? 'od końca A' : REF_TEXT[bar.dimensionMode];
                  const slot = h.slot > h.diameter;
                  const hi = holeIssues(h.id);
                  const hState: State = hi.some((x) => x.level === 'error') ? 'error' : hi.length ? 'warning' : undefined;
                  return (
                    <section className={`bb-hole ${hState ? `is-${hState}` : ''}`} key={h.id}>
                      <div className="bb-hole-head">
                        <span className="bb-hole-id">O{info?.no ?? '?'}</span>
                        <span className="bb-hole-name">{slot ? 'Fasolka' : 'Otwór okrągły'}</span>
                        <DeleteButton className="bb-hole-del" onClick={() => removeHole(i, h.id)} />
                      </div>
                      <div className="bb-row3">
                        <Chip
                          label={i === 0 ? 'Od końca A' : 'Od narożnika'}
                          value={fmt(h.position)}
                          unit="mm"
                          state={hState === 'error' ? 'error' : undefined}
                          onClick={() =>
                            numpad({
                              title: `Otwór O${info?.no ?? ''} – środek ${ref}`,
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
                          value={`Ø${fmt(h.diameter)}`}
                          onClick={() =>
                            numpad({
                              title: slot
                                ? `Otwór O${info?.no ?? ''} – szerokość fasolki`
                                : `Otwór O${info?.no ?? ''} – średnica`,
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
                          label="W poprzek"
                          value={h.offset === 0 ? '0' : `${h.offset > 0 ? '+' : '−'}${fmt(Math.abs(h.offset))}`}
                          unit="mm"
                          onClick={() =>
                            numpad({
                              title: `Otwór O${info?.no ?? ''} – w poprzek od osi (+ w stronę dolnej krawędzi rysunku)`,
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
                      <div className="bb-row">
                        <Seg
                          label="Kształt otworu"
                          className="bb-grow"
                          value={slot ? 'slot' : 'round'}
                          options={[
                            { value: 'round', label: 'Okrągły' },
                            { value: 'slot', label: 'Fasolka' },
                          ]}
                          onChange={(v) => {
                            if (v === 'round') patchHole(i, h.id, { slot: 0 });
                            else if (!slot) patchHole(i, h.id, { slot: Math.round(h.diameter * 2) });
                          }}
                        />
                        {slot && (
                          <Chip
                            label="Długość fasolki"
                            value={fmt(h.slot)}
                            unit="mm"
                            className="slot-chip"
                            onClick={() =>
                              numpad({
                                title: `Otwór O${info?.no ?? ''} – długość fasolki (wzdłuż szyny, całkowita)`,
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
                      </div>
                      <IssueList issues={hi} />
                    </section>
                  );
                })}
              </StepCard>
            );
          }
          const info = analysis.bends.find((b) => b.stepIndex === i);
          const no = info?.no ?? bendNoOf(i);
          const dirs: Direction[] = ['up', 'down'];
          return (
            <StepCard
              key={s.id}
              index={i}
              kind="bend"
              badge={`G${no}`}
              title={`Gięcie ${no}`}
              selected={sel}
              state={state}
              onHead={toggle}
              summary={
                <>
                  <span className="bb-step-dir">
                    <Icon name={s.direction} size={22} />
                    {DIRECTION_LABEL[s.direction]}
                  </span>
                  <span className="bb-step-val">{fmt(s.angle)}°</span>
                </>
              }
              headAction={<DeleteButton className="bb-step-del" onClick={() => remove(i)} />}
            >
              <Seg
                label="Kierunek gięcia"
                block
                value={s.direction}
                options={dirs.map((d) => ({
                  value: d,
                  label: d === 'up' ? 'W górę' : 'W dół',
                  icon: <Icon name={d} />,
                }))}
                onChange={(v) => patch(i, { direction: v as Direction })}
              />
              <div className="bb-row4">
                <Chip
                  label="O ile giąć"
                  value={`${fmt(s.angle)}°`}
                  state={state === 'error' && !info ? 'error' : undefined}
                  onClick={() => editMain(i)}
                />
                <Chip
                  label="Promień"
                  value={`R${fmt(s.radius)}`}
                  state={s.radius !== settings.radius ? 'warning' : undefined}
                  onClick={() =>
                    numpad({
                      title: `Gięcie ${no} – promień wewnętrzny`,
                      value: s.radius,
                      unit: 'mm',
                      min: 0,
                      max: 1000,
                      quick: [...new Set([minRadius(bar.section), settings.radius])],
                      onOk: (v) => patch(i, { radius: v }),
                    })
                  }
                />
                <Tile label="Nastawa" value={info ? `${fmt(info.machineAngle)}°` : '–'} />
                <Tile label="Pozycja od A" value={info ? fmt(info.position, 0) : '–'} unit={info ? 'mm' : undefined} />
              </div>
              {s.radius !== settings.radius && (
                <Notice tone="warning">
                  R{fmt(s.radius)} inny niż narzędzie R{fmt(settings.radius)}. Sprawdź, czy maszyna ma takie narzędzie.
                </Notice>
              )}
              <IssueList issues={stepIssues} />
            </StepCard>
          );
        })}
      </div>
      <div className="bb-panel-add">
        <button className="bb-btn bb-btn--primary bb-btn--lg bb-btn--block add-bend" onClick={add}>
          <Icon name="plus" />
          Dodaj gięcie
          <span className="add-where">{insertAfterSelected ? `za odcinkiem ${legNoOf(selected!)}` : 'na końcu'}</span>
        </button>
      </div>
    </aside>
  );
}

function StepCard({
  index,
  kind,
  badge,
  title,
  selected,
  state,
  summary,
  headAction,
  onHead,
  children,
}: {
  index: number;
  kind: 'seg' | 'bend';
  badge: string;
  title: string;
  selected: boolean;
  state: State;
  summary: ReactNode;
  headAction?: ReactNode;
  onHead: () => void;
  children: ReactNode;
}) {
  return (
    <section
      data-step={index}
      className={`bb-step bb-step--${kind} ${selected ? 'is-selected' : ''} ${state ? `is-${state}` : ''}`}
    >
      <div className="bb-step-head" onClick={onHead} role="button" tabIndex={0} aria-expanded={selected}>
        <span className="bb-step-badge">{badge}</span>
        <span className="bb-step-title">{title}</span>
        {!selected && <span className="bb-step-summary">{summary}</span>}
        {state === 'error' && <Icon name="stop" className="bb-step-flag" />}
        {state === 'warning' && <Icon name="warn" className="bb-step-flag" />}
        {selected && headAction}
      </div>
      {selected && <div className="bb-step-body">{children}</div>}
    </section>
  );
}

function DeleteButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      className={`bb-btn bb-btn--danger-quiet ${className ?? ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Icon name="trash" />
      Usuń
    </button>
  );
}

function IssueList({ issues }: { issues: Issue[] }) {
  if (!issues.length) return null;
  return (
    <>
      {issues.map((x, k) => (
        <Notice key={k} tone={x.level === 'error' ? 'danger' : 'warning'}>
          {x.message}
        </Notice>
      ))}
    </>
  );
}
