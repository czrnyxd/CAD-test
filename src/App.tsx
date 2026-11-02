import { useCallback, useEffect, useMemo, useState } from 'react';
import { analyze, fmt, type Issue } from './core/analyze';
import { buildAssembly, type Assembly, type BarPart } from './core/assembly';
import {
  DIMENSION_MODE_LABEL,
  SECTIONS,
  newBusbar,
  sectionLabel,
  type Busbar,
  type DimensionMode,
  type MachineSettings,
  type Section,
} from './core/model';
import { TEMPLATES } from './core/templates';
import { sanitizeBusbar } from './core/sanitize';
import { deleteProject, duplicateBar, loadProjects, useStore } from './store';
import { DimensionModeHelp } from './ui/DimensionModeHelp';
import { BendTable, FlatPatternSvg, HoleTable } from './ui/FlatPattern';
import { NumPad, type NumPadRequest } from './ui/NumPad';
import { renderSnapshot } from './ui/scene';
import { StepList } from './ui/StepList';
import { Viewer3D } from './ui/Viewer3D';

type Tab = 'model' | 'flat' | 'settings';

/** Running inside an iframe (e.g. an embedded preview): printing and downloads are blocked there. */
const IN_FRAME = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();
type Modal = null | 'new' | 'projects';

export default function App() {
  const {
    bar,
    settings,
    selected,
    past,
    future,
    saveOk,
    notice,
    update,
    updateSteps,
    undo,
    redo,
    select,
    setSettings,
    open,
    setNotice,
  } = useStore();
  const [tab, setTab] = useState<Tab>('model');
  const [modal, setModal] = useState<Modal>(null);
  const [np, setNp] = useState<NumPadRequest | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const assembly = useMemo(() => buildAssembly(bar, settings), [bar, settings]);
  const analysis = assembly.parts[0].analysis;
  const double = assembly.parts.length > 1;
  const issues: Issue[] = assembly.issues;
  const errorSteps = useMemo(
    () => new Set(issues.filter((i) => i.level === 'error' && i.stepIndex !== undefined).map((i) => i.stepIndex!)),
    [issues],
  );
  const errors = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.length - errors;

  const onSelect = useCallback((i: number | null) => select(i), [select]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') (e.shiftKey ? redo : undo)();
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') redo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const print = () => {
    if (IN_FRAME) {
      setToast('Drukowanie nie działa w podglądzie osadzonym. Otwórz aplikację w osobnej karcie przeglądarki.');
      return;
    }
    setSnapshot(renderSnapshot(assembly.parts, assembly.bbox));
    setTimeout(() => window.print(), 150);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">BusBar CAD</div>
        <input
          className="name-input"
          value={bar.name}
          onChange={(e) => update((b) => ({ ...b, name: e.target.value }), false)}
          aria-label="Nazwa szyny"
        />
        <select
          className="section-select"
          value={`${bar.section.width}x${bar.section.thickness}`}
          onChange={(e) => {
            const s = SECTIONS.find((x) => `${x.width}x${x.thickness}` === e.target.value)!;
            update((b) => ({ ...b, section: { ...s } }));
          }}
        >
          {SECTIONS.map((s) => (
            <option key={`${s.width}x${s.thickness}`} value={`${s.width}x${s.thickness}`}>
              {sectionLabel(s)}
            </option>
          ))}
        </select>
        <nav className="tabs">
          <button className={tab === 'model' ? 'on' : ''} onClick={() => setTab('model')}>
            Model 3D
          </button>
          <button className={tab === 'flat' ? 'on' : ''} onClick={() => setTab('flat')}>
            Rozwinięcie
          </button>
          <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>
            Ustawienia
          </button>
        </nav>
        <div className="top-actions">
          <button onClick={undo} disabled={!past.length} title="Cofnij">
            ↶
          </button>
          <button onClick={redo} disabled={!future.length} title="Ponów">
            ↷
          </button>
          <button onClick={() => setModal('new')}>Nowa</button>
          <button onClick={() => setModal('projects')}>Projekty</button>
          <button className="btn-primary" onClick={print}>
            🖨 Drukuj
          </button>
        </div>
      </header>

      <main className="main">
        {tab === 'model' && (
          <div className="model-tab">
            <Viewer3D bar={bar} assembly={assembly} selected={selected} errorSteps={errorSteps} onSelect={onSelect} />
            <StepList
              bar={bar}
              analysis={analysis}
              issues={issues}
              settings={settings}
              selected={selected}
              onSelect={onSelect}
              updateSteps={updateSteps}
              setDouble={(cfg) => update((b) => ({ ...b, double: cfg }))}
              numpad={setNp}
            />
          </div>
        )}
        {tab === 'flat' && (
          <div className="flat-tab">
            {errors > 0 && (
              <div className="no-production">
                ⛔ NIE DO PRODUKCJI – projekt zawiera błędy (szczegóły w kroku na zakładce Model 3D)
              </div>
            )}
            {double && (
              <div className="card double-note">
                <b>Podwójna szyna.</b> {doubleNote(assembly)}
              </div>
            )}
            {assembly.parts.map((part) => (
              <PartDocs key={part.index} part={part} double={double} settings={settings} />
            ))}
          </div>
        )}
        {tab === 'settings' && (
          <SettingsTab bar={bar} settings={settings} update={update} setSettings={setSettings} numpad={setNp} />
        )}
      </main>

      <footer className={`statusbar ${errors ? 'has-errors' : warnings ? 'has-warnings' : ''}`}>
        <span>
          Długość cięcia: <b>{assembly.parts.map((p) => `${fmt(p.analysis.flatLength)}`).join(' / ')} mm</b>
        </span>
        <span>{sectionLabel(bar.section)}</span>
        <span>Wymiary {DIMENSION_MODE_LABEL[bar.dimensionMode]}</span>
        <span className="status-issues">
          {errors ? `⛔ ${errors} błąd(y)` : ''} {warnings ? `⚠ ${warnings} ostrzeżenie(a)` : ''}
          {!issues.length && (double ? '✔ Szyny poprawne' : '✔ Szyna poprawna')}
        </span>
      </footer>

      {np && <NumPad req={np} onClose={() => setNp(null)} />}
      {toast && (
        <div className="toast" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
      {notice && (
        <div className="modal-backdrop">
          <div className="modal notice">
            <h2>Sprawdź projekt</h2>
            <div className="notice-text">{notice}</div>
            <div className="modal-actions">
              <button className="btn-primary" onClick={() => setNotice(null)}>
                Rozumiem
              </button>
            </div>
          </div>
        </div>
      )}
      {!saveOk && (
        <div className="save-error">
          ⚠ Nie udało się zapisać projektu w pamięci urządzenia (brak miejsca lub zablokowany zapis). Wyeksportuj projekt do pliku
          w oknie „Projekty”.
        </div>
      )}
      {modal === 'new' && (
        <NewModal
          current={bar.section}
          settings={settings}
          onClose={() => setModal(null)}
          onCreate={(b) => {
            open(b);
            setModal(null);
            setTab('model');
          }}
        />
      )}
      {modal === 'projects' && (
        <ProjectsModal
          currentId={bar.id}
          onClose={() => setModal(null)}
          onOpen={(b, changes) => {
            open(b, changes);
            setModal(null);
            setTab('model');
          }}
        />
      )}

      <PrintSheet bar={bar} assembly={assembly} settings={settings} snapshot={snapshot} issues={issues} />
    </div>
  );
}

function SettingsTab({
  bar,
  settings,
  update,
  setSettings,
  numpad,
}: {
  bar: Busbar;
  settings: MachineSettings;
  update: (fn: (b: Busbar) => Busbar, record?: boolean) => void;
  setSettings: (s: Partial<MachineSettings>) => void;
  numpad: (r: NumPadRequest) => void;
}) {
  const cutLength = (m: DimensionMode) => analyze({ ...bar, dimensionMode: m }, settings).flatLength;
  const otherRadius = bar.steps.filter((st) => st.kind === 'bend' && st.radius !== settings.radius).length;
  const num = (key: keyof MachineSettings, title: string, unit: string, min: number, max: number) => (
    <button
      className="field"
      onClick={() =>
        numpad({
          title,
          unit,
          min,
          max,
          value: settings[key] as number,
          onOk: (v) => setSettings({ [key]: v } as Partial<MachineSettings>),
        })
      }
    >
      <span className="field-label">{title}</span>
      <span className="field-value">
        {fmt(settings[key] as number, 3)} {unit}
      </span>
    </button>
  );
  return (
    <div className="settings-tab">
      <div className="card">
        <h3>Projekt</h3>
        <div className="fields">
          <label className="field">
            <span className="field-label">Nr zlecenia</span>
            <input value={bar.orderNo} onChange={(e) => update((b) => ({ ...b, orderNo: e.target.value }), false)} />
          </label>
          <button
            className="field"
            onClick={() =>
              numpad({
                title: 'Ilość sztuk',
                unit: 'szt.',
                min: 1,
                max: 10000,
                value: bar.quantity,
                onOk: (v) => update((b) => ({ ...b, quantity: Math.round(v) })),
              })
            }
          >
            <span className="field-label">Ilość</span>
            <span className="field-value">{bar.quantity} szt.</span>
          </button>
        </div>
        <div className="dim-mode">
          <div className="dim-mode-controls">
            <span className="field-label">Długości odcinków wymiarowane</span>
            <div className="seg seg-vertical">
              {(['outside', 'inside', 'centerline'] as DimensionMode[]).map((m) => (
                <button
                  key={m}
                  className={bar.dimensionMode === m ? 'on' : ''}
                  onClick={() => update((b) => ({ ...b, dimensionMode: m }))}
                >
                  <span>{DIMENSION_MODE_LABEL[m]}</span>
                  <small>długość cięcia {fmt(cutLength(m))} mm</small>
                </button>
              ))}
            </div>
            <p className="muted">
              Zmiana trybu nie zmienia wpisanych liczb – zmienia to, skąd dokąd są mierzone, więc zmienia się wygięta szyna i
              długość cięcia (podana przy każdym przycisku dla tego projektu).
            </p>
          </div>
          <DimensionModeHelp mode={bar.dimensionMode} />
        </div>
      </div>
      <div className="card">
        <h3>Maszyna i narzędzia</h3>
        <p className="muted">
          K, sprężynowanie, minimalne ramię i długość handlowa działają od razu we wszystkich projektach. Promień narzędzia jest
          używany dla nowych gięć – w istniejących gięciach zmieniasz go przyciskiem poniżej albo w każdym gięciu. Wartości K i
          sprężynowania trzeba skalibrować na próbkach z tej maszyny.
        </p>
        <div className="fields">
          <label className="field">
            <span className="field-label">Nazwa maszyny (na wydruku)</span>
            <input value={settings.machineName} onChange={(e) => setSettings({ machineName: e.target.value })} />
          </label>
          {num('radius', 'Promień gięcia (narzędzie)', 'mm', 0, 500)}
          {num('k', 'Współczynnik K', '', 0, 1)}
          {num('springbackPct', 'Sprężynowanie', '%', 0, 30)}
          {num('minLeg', 'Minimalne ramię', 'mm', 0, 500)}
          {num('maxLength', 'Długość handlowa szyny', 'mm', 100, 12000)}
        </div>
        {otherRadius > 0 && (
          <div className="radius-mismatch">
            <span>
              W tym projekcie {otherRadius} {otherRadius === 1 ? 'gięcie ma' : 'gięć ma'} promień inny niż narzędzie (R
              {fmt(settings.radius)}).
            </span>
            <button
              className="btn-primary"
              onClick={() =>
                update((b) => ({
                  ...b,
                  steps: b.steps.map((st) => (st.kind === 'bend' ? { ...st, radius: settings.radius } : st)),
                }))
              }
            >
              Ustaw R{fmt(settings.radius)} we wszystkich gięciach
            </button>
          </div>
        )}
        <div className="field-row">
          <span className="field-label">Pozycja gięcia ustawiana na</span>
          <div className="seg">
            {(
              [
                ['start', 'początek łuku'],
                ['center', 'środek łuku'],
                ['end', 'koniec łuku'],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                className={settings.bendLineReference === k ? 'on' : ''}
                onClick={() => setSettings({ bendLineReference: k })}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function NewModal({
  current,
  settings,
  onClose,
  onCreate,
}: {
  current: Section;
  settings: MachineSettings;
  onClose: () => void;
  onCreate: (b: Busbar) => void;
}) {
  const [sec, setSec] = useState(`${current.width}x${current.thickness}`);
  const section = SECTIONS.find((x) => `${x.width}x${x.thickness}` === sec)!;
  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <h2>Nowa szyna</h2>
        <div className="muted">1. Wybierz przekrój</div>
        <div className="section-grid">
          {SECTIONS.map((s) => {
            const k = `${s.width}x${s.thickness}`;
            return (
              <button key={k} className={k === sec ? 'on' : ''} onClick={() => setSec(k)}>
                {s.width}×{s.thickness}
              </button>
            );
          })}
        </div>
        <div className="muted">2. Wybierz kształt startowy</div>
        <div className="template-grid">
          {TEMPLATES.map((t) => (
            <button key={t.id} onClick={() => onCreate(newBusbar(section, t.build(settings), `Szyna ${t.name}`))}>
              <TemplateIcon id={t.id} />
              <b>{t.name}</b>
              <span>{t.description}</span>
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>
            Anuluj
          </button>
        </div>
      </div>
    </div>
  );
}

function TemplateIcon({ id }: { id: string }) {
  const d: Record<string, string> = {
    straight: 'M10 40 H90',
    L: 'M10 50 H70 V10',
    Z: 'M5 50 H35 L60 20 H95',
    U: 'M15 10 V50 H85 V10',
    Z90: 'M5 50 H40 V15 H95',
    offsetL: 'M5 50 H25 L40 38 H70 V8',
  };
  return (
    <svg viewBox="0 0 100 60" className="tpl-icon">
      <path d={d[id]} fill="none" stroke="#c87533" strokeWidth="7" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function ProjectsModal({
  currentId,
  onClose,
  onOpen,
}: {
  currentId: string;
  onClose: () => void;
  onOpen: (b: Busbar, changes?: string[]) => void;
}) {
  const [projects, setProjects] = useState(() => loadProjects());
  const list = Object.values(projects).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const [q, setQ] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const filtered = list.filter((p) => `${p.name} ${p.orderNo}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <h2>Projekty</h2>
        <input
          className="search"
          placeholder="Szukaj po nazwie lub nr zlecenia…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="project-list">
          {filtered.map((p) => (
            <div key={p.id} className={`project ${p.id === currentId ? 'current' : ''}`}>
              <button className="project-open" onClick={() => onOpen(p)}>
                <b>{p.name}</b>
                <span>
                  {sectionLabel(p.section)} · {p.steps.filter((s) => s.kind === 'bend').length} gięć
                  {p.orderNo ? ` · zl. ${p.orderNo}` : ''} · {new Date(p.updatedAt).toLocaleString('pl-PL')}
                </span>
              </button>
              <button onClick={() => onOpen(duplicateBar(p))}>Kopiuj</button>
              <button
                disabled={p.id === currentId}
                className={pendingDelete === p.id ? 'danger' : ''}
                onClick={() => {
                  if (pendingDelete !== p.id) return setPendingDelete(p.id);
                  deleteProject(p.id);
                  setPendingDelete(null);
                  setProjects(loadProjects());
                }}
              >
                {pendingDelete === p.id ? 'Na pewno?' : '🗑'}
              </button>
            </div>
          ))}
          {!filtered.length && <p className="muted">Brak projektów.</p>}
        </div>
        {msg && <div className="muted">{msg}</div>}
        <div className="modal-actions">
          <button
            className="btn-secondary"
            onClick={async () => {
              const cur = projects[currentId];
              if (!cur) return;
              if (IN_FRAME) {
                try {
                  await navigator.clipboard.writeText(JSON.stringify(cur, null, 2));
                  setMsg('Projekt skopiowany do schowka jako JSON.');
                } catch {
                  setMsg('Nie udało się skopiować – otwórz aplikację w osobnej karcie.');
                }
                return;
              }
              const blob = new Blob([JSON.stringify(cur, null, 2)], { type: 'application/json' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `${cur.name.replace(/[^\w\-ąćęłńóśźż ]+/gi, '_')}.json`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            {IN_FRAME ? 'Kopiuj bieżący (JSON)' : 'Eksport bieżącego (JSON)'}
          </button>
          <label className="btn-secondary file-btn">
            Import JSON
            <input
              type="file"
              accept="application/json,.json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                e.target.value = '';
                let data: unknown;
                try {
                  data = JSON.parse(await f.text());
                } catch {
                  setMsg('Nie udało się odczytać pliku – to nie jest plik JSON.');
                  return;
                }
                const res = sanitizeBusbar(data, useStore.getState().settings);
                if (!res.bar) {
                  setMsg(`Nie zaimportowano: ${res.error}`);
                  return;
                }
                const copy = duplicateBar(res.bar);
                onOpen({ ...copy, name: res.bar.name }, res.changes);
              }}
            />
          </label>
          <button className="btn-secondary" onClick={onClose}>
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
}

/** Instructions for a double bar: separate bending with the same tool, gap in the arcs. */
function doubleNote(assembly: Assembly): string {
  const worst = assembly.arcGaps.reduce<{ no: number; gap: number } | null>((m, g) => (!m || g.gap > m.gap ? g : m), null);
  const gapText = worst ? ` W łukach szyny nie przylegają – największa szczelina ${fmt(worst.gap)} mm (gięcie ${worst.no}).` : '';
  return (
    'Każdą szynę tnij i gnij osobno według jej własnej tabeli, tym samym narzędziem. Na prostych odcinkach szyny ' +
    'przylegają (lub mają zadany odstęp), a otwory wypadają na sobie.' +
    gapText
  );
}

function PartDocs({ part, double, settings }: { part: BarPart; double: boolean; settings: MachineSettings }) {
  const { bar, analysis } = part;
  return (
    <section className="part-block">
      <div className="flat-head">
        {double && <div className={`part-title part-${part.index}`}>{part.label}</div>}
        <div>
          <div className="muted">Długość cięcia</div>
          <div className="flat-length">{fmt(analysis.flatLength)} mm</div>
        </div>
        <div>
          <div className="muted">Przekrój</div>
          <div className="flat-val">{sectionLabel(bar.section)}</div>
        </div>
        <div>
          <div className="muted">Gięcia / otwory</div>
          <div className="flat-val">
            {analysis.bends.length} / {analysis.holes.length}
          </div>
        </div>
        <div>
          <div className="muted">Wymiary ramion</div>
          <div className="flat-val">{DIMENSION_MODE_LABEL[bar.dimensionMode]}</div>
        </div>
      </div>
      <div className="card">
        <FlatPatternSvg bar={bar} analysis={analysis} settings={settings} />
      </div>
      <div className="card">
        <h3>Tabela gięć dla operatora{double ? ` – ${part.label}` : ''}</h3>
        <div className="table-scroll">
          <BendTable analysis={analysis} settings={settings} />
        </div>
        {analysis.holes.length > 0 && (
          <>
            <h3 className="mt">Otwory</h3>
            <div className="table-scroll">
              <HoleTable bar={bar} analysis={analysis} />
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function PrintSheet({
  bar,
  assembly,
  settings,
  snapshot,
  issues,
}: {
  bar: Busbar;
  assembly: Assembly;
  settings: MachineSettings;
  snapshot: string | null;
  issues: Issue[];
}) {
  const double = assembly.parts.length > 1;
  const first = assembly.parts[0];
  return (
    <div className={`print-sheet ${double ? 'print-double' : ''}`}>
      {issues.some((i) => i.level === 'error') && (
        <div className="no-production">⛔ NIE DO PRODUKCJI – projekt zawiera błędy</div>
      )}
      <table className="print-header">
        <tbody>
          <tr>
            <td rowSpan={2} className="ph-title">
              {bar.name}
              {double && <div className="ph-sub">podwójna szyna</div>}
            </td>
            <td>
              <span>Nr zlecenia</span>
              <b>{bar.orderNo || '—'}</b>
            </td>
            <td>
              <span>Przekrój</span>
              <b>{sectionLabel(bar.section)}</b>
            </td>
            <td>
              <span>{double ? 'Ilość kompletów' : 'Ilość'}</span>
              <b>{bar.quantity} szt.</b>
            </td>
          </tr>
          <tr>
            <td>
              <span>Długość cięcia{double ? ' (szyna 1 / szyna 2)' : ''}</span>
              <b className="ph-len">{assembly.parts.map((p) => fmt(p.analysis.flatLength)).join(' / ')} mm</b>
            </td>
            <td>
              <span>Maszyna</span>
              <b>{settings.machineName}</b>
            </td>
            <td>
              <span>Data</span>
              <b>{new Date(bar.updatedAt).toLocaleDateString('pl-PL')}</b>
            </td>
          </tr>
        </tbody>
      </table>
      <div className="print-row">
        {snapshot && <img src={snapshot} className="print-3d" alt="Widok 3D" />}
        <div className="print-notes">
          {!double && (
            <>
              <BendTable analysis={first.analysis} settings={settings} />
              <HoleTable bar={first.bar} analysis={first.analysis} />
            </>
          )}
          <div>
            Wymiary ramion: <b>{DIMENSION_MODE_LABEL[bar.dimensionMode]}</b> · K {settings.k} · koniec A oznaczony na zielono
          </div>
          {double && <div>Podwójna szyna: {doubleNote(assembly)}</div>}
          {issues.length > 0 && (
            <div className="print-issues">
              {issues.map((i, k) => (
                <div key={k}>
                  {i.level === 'error' ? '⛔' : '⚠'} {i.message}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {assembly.parts.map((part) => (
        <div key={part.index} className="print-part">
          <h3>Rozwinięcie{double ? ` – ${part.label}` : ''}</h3>
          <FlatPatternSvg bar={part.bar} analysis={part.analysis} settings={settings} width={1000} />
          {double && (
            <div className="print-tables">
              <BendTable analysis={part.analysis} settings={settings} />
              <HoleTable bar={part.bar} analysis={part.analysis} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
