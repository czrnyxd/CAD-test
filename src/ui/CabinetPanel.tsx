import { fmt } from '../core/analyze';
import {
  AXES,
  AXIS_LABEL,
  PHASE_NAMES,
  perpendicularAxes,
  phaseAxis,
  totalWidth,
  widthAxis,
  type CabinetCheck,
} from '../core/cabinet';
import type { CabinetAxis, CabinetConfig } from '../core/model';
import { Chip, Notice, Seg } from './controls';
import { Icon } from './Icon';
import type { NumPadRequest } from './NumPad';

interface Props {
  cfg: CabinetConfig;
  check: CabinetCheck | null;
  barWidth: number;
  onChange: (cfg: CabinetConfig) => void;
  onClose: () => void;
  numpad: (r: NumPadRequest) => void;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Settings of the reference cabinet: its size, where end A sits and which way the bar runs. */
export function CabinetPanel({ cfg, check, barWidth, onChange, onClose, numpad: openNumpad }: Props) {
  const numpad = (r: NumPadRequest) => openNumpad({ ...r, placement: 'side' });
  const set = (p: Partial<CabinetConfig>) => onChange({ ...cfg, ...p });
  const num = (title: string, value: number, min: number, max: number, onOk: (v: number) => void, quick?: number[]) =>
    numpad({ title, value, unit: 'mm', min, max, quick, onOk });
  const W = totalWidth(cfg);
  const wAxis = widthAxis(cfg);
  const opposite = (a: CabinetAxis) => `${a[0] === '-' ? '+' : '-'}${a[1]}` as CabinetAxis;

  const setHeading = (h: CabinetAxis) => {
    // Keep the bend side when it is still perpendicular; otherwise take the first one that is.
    const upSide =
      cfg.upSide[1] !== h[1] ? cfg.upSide : (perpendicularAxes(h).find((a) => a[1] !== 'y') ?? perpendicularAxes(h)[0]);
    set({ heading: h, upSide });
  };

  return (
    <aside className="bb-panel cab-panel" aria-label="Szafa">
      <div className="bb-panel-top cab-top">
        <h2 className="cab-title">Szafa</h2>
        <Seg
          label="Szafa w modelu"
          value={cfg.enabled ? 'on' : 'off'}
          options={[
            { value: 'off', label: 'Bez szafy' },
            { value: 'on', label: 'W szafie' },
          ]}
          onChange={(v) => set({ enabled: v === 'on' })}
        />
        <span className="bb-spacer" />
        <button className="bb-btn bb-btn--primary" onClick={onClose}>
          <Icon name="check" />
          Gotowe
        </button>
      </div>
      <div className="cab-body">
        {!cfg.enabled ? (
          <Notice tone="info">
            Włącz „W szafie”, żeby zobaczyć szynę w ramie szafy, kolejne fazy i odstęp od słupków. Szafa służy tylko do
            sprawdzenia – nie zmienia szyny ani rozwinięcia.
          </Notice>
        ) : (
          <>
            {check && <CheckNotice check={check} cfg={cfg} />}

            <section className="cab-sec">
              <h3 className="cab-h">
                Szafa · {fmt(W)} × {fmt(cfg.depth)} × {fmt(cfg.height)} mm
              </h3>
              <span className="bb-field-label">Pola od lewej (szerokość)</span>
              <div className="cab-bays">
                {cfg.bays.map((bw, i) => (
                  <Chip
                    key={i}
                    label={`Pole ${i + 1}`}
                    value={fmt(bw)}
                    unit="mm"
                    onClick={() =>
                      num(
                        `Pole ${i + 1} – szerokość`,
                        bw,
                        200,
                        2000,
                        (v) => set({ bays: cfg.bays.map((b, k) => (k === i ? v : b)) }),
                        [400, 600, 800, 1000, 1200],
                      )
                    }
                  />
                ))}
                {cfg.bays.length < 6 && (
                  <button
                    className="bb-btn bb-btn--secondary cab-add"
                    onClick={() => set({ bays: [...cfg.bays, cfg.bays.at(-1) ?? 800] })}
                  >
                    <Icon name="plus" />
                    Pole
                  </button>
                )}
                {cfg.bays.length > 1 && (
                  <button className="bb-btn bb-btn--danger-quiet cab-add" onClick={() => set({ bays: cfg.bays.slice(0, -1) })}>
                    <Icon name="trash" />
                    Ostatnie
                  </button>
                )}
              </div>
              <div className="bb-row3">
                <Chip
                  label="Głębokość"
                  value={fmt(cfg.depth)}
                  unit="mm"
                  onClick={() => num('Głębokość szafy', cfg.depth, 200, 2000, (v) => set({ depth: v }), [400, 500, 600, 800])}
                />
                <Chip
                  label="Wysokość"
                  value={fmt(cfg.height)}
                  unit="mm"
                  onClick={() => num('Wysokość szafy', cfg.height, 300, 3000, (v) => set({ height: v }), [1800, 2000, 2200])}
                />
                <Chip
                  label="Profil ramy"
                  value={fmt(cfg.post)}
                  unit="mm"
                  onClick={() => num('Profil ramy (słupek, kwadrat)', cfg.post, 10, 200, (v) => set({ post: v }), [40, 50, 60])}
                />
              </div>
            </section>

            <section className="cab-sec">
              <h3 className="cab-h">Koniec A w szafie</h3>
              <span className="bb-field-label">Środek czoła końca A, mierzony od zewnętrznej krawędzi ramy</span>
              <div className="bb-row3">
                <Chip
                  label="Od lewej"
                  value={fmt(cfg.a.x)}
                  unit="mm"
                  onClick={() => num('Koniec A – od lewej', cfg.a.x, -5000, 20000, (v) => set({ a: { ...cfg.a, x: v } }))}
                />
                <Chip
                  label="Od podłogi"
                  value={fmt(cfg.a.y)}
                  unit="mm"
                  onClick={() => num('Koniec A – od podłogi', cfg.a.y, -5000, 5000, (v) => set({ a: { ...cfg.a, y: v } }))}
                />
                <Chip
                  label="Od tyłu"
                  value={fmt(cfg.a.z)}
                  unit="mm"
                  onClick={() => num('Koniec A – od tyłu', cfg.a.z, -5000, 5000, (v) => set({ a: { ...cfg.a, z: v } }))}
                />
              </div>
              <span className="bb-field-label">Szyna biegnie od końca A</span>
              <Seg
                label="Kierunek szyny od końca A"
                className="cab-seg3"
                value={cfg.heading}
                options={AXES.map((a) => ({ value: a, label: cap(AXIS_LABEL[a].replace('pionowo ', '')) }))}
                onChange={setHeading}
              />
              <span className="bb-field-label">Gięcie „w górę” (↑) skręca szynę</span>
              <Seg
                label="Kierunek gięcia w górę"
                className="cab-seg2"
                value={cfg.upSide}
                options={perpendicularAxes(cfg.heading).map((a) => ({
                  value: a,
                  label: cap(AXIS_LABEL[a].replace('pionowo ', '')),
                }))}
                onChange={(v) => set({ upSide: v })}
              />
              <span className="cab-note">Szeroka ścianka szyny jest wtedy {wAxis[1] === 'y' ? 'pionowa' : 'pozioma'}.</span>
            </section>

            <section className="cab-sec">
              <h3 className="cab-h">Fazy</h3>
              <div className="bb-row">
                <Seg
                  label="Liczba faz"
                  className="bb-grow"
                  block
                  value={String(cfg.phases)}
                  options={[1, 2, 3, 4].map((n) => ({
                    value: String(n),
                    label: n === 4 ? 'L1–L3 + N' : n === 1 ? 'L1' : `L1–L${n}`,
                  }))}
                  onChange={(v) => set({ phases: Number(v) })}
                />
              </div>
              {cfg.phases > 1 && (
                <>
                  <div className="bb-row">
                    <Chip
                      label="Rozstaw faz (osie)"
                      value={fmt(cfg.pitch)}
                      unit="mm"
                      state={cfg.pitch < barWidth ? 'error' : undefined}
                      onClick={() =>
                        num('Rozstaw faz – od osi do osi', cfg.pitch, 1, 1000, (v) => set({ pitch: v }), [60, 100, 150, 185, 200])
                      }
                    />
                    <div className="bb-grow">
                      <span className="bb-field-label">{PHASE_NAMES.slice(1, cfg.phases).join(', ')} leżą</span>
                      <Seg
                        label="Strona kolejnych faz"
                        block
                        value={phaseAxis(cfg)}
                        options={[wAxis, opposite(wAxis)].map((a) => ({
                          value: a,
                          label: AXIS_LABEL[a].replace('pionowo w górę', 'wyżej').replace('pionowo w dół', 'niżej'),
                        }))}
                        onChange={(v) => set({ phaseDir: v === wAxis ? 1 : -1 })}
                      />
                    </div>
                  </div>
                  <span className="cab-note">
                    Odstęp między fazami {fmt(Math.max(0, cfg.pitch - barWidth))} mm (rozstaw − szerokość szyny {fmt(barWidth)}).
                  </span>
                </>
              )}
            </section>
          </>
        )}
      </div>
    </aside>
  );
}

function CheckNotice({ check, cfg }: { check: CabinetCheck; cfg: CabinetConfig }) {
  const names = (ks: number[]) => (cfg.phases > 1 ? ` (${ks.map((k) => PHASE_NAMES[k]).join(', ')})` : '');
  if (check.hits.length)
    return (
      <Notice tone="danger">
        <b>Szyna przechodzi przez ramę szafy{names(check.hitPhases)}.</b> Zmień położenie końca A albo kształt szyny – miejsce
        kolizji jest zaznaczone na czerwono.
      </Notice>
    );
  if (check.phasesOverlap)
    return (
      <Notice tone="danger">
        <b>Fazy nachodzą na siebie.</b> Rozstaw faz musi być większy od szerokości szyny.
      </Notice>
    );
  return (
    <Notice tone={check.outside ? 'warning' : 'ok'}>
      Najmniejszy odstęp od ramy <b>{fmt(check.clearance)} mm</b>
      {cfg.phases > 1 ? ` (${PHASE_NAMES[check.phase]})` : ''}.
      {check.outside && ' Szyna wychodzi poza szafę – dodaj pole, jeśli idzie do sąsiedniego.'}
    </Notice>
  );
}
