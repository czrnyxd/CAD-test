import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyze, fmt, plural, type Issue } from './core/analyze';
import { buildAssembly, type Assembly, type BarPart } from './core/assembly';
import {
  DIMENSION_MODE_LABEL,
  SECTION_LIMITS,
  sectionError,
  sectionKey,
  sectionList,
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
import { ProfileView } from './ui/ProfileView';
import { SectionDialog } from './ui/SectionDialog';
import { BendTable, FlatPatternSvg, HoleTable } from './ui/FlatPattern';
import { NumPad, type NumPadRequest } from './ui/NumPad';
import { renderSnapshot } from './ui/scene';
import { StepList } from './ui/StepList';
import { Viewer3D } from './ui/Viewer3D';

type Tab = 'model' | 'flat' | 'settings';

/** Select value that opens the "Inny przekrój" dialog. */
const CUSTOM = '__custom';

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
    customSections,
    addCustomSection,
  } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sectionDialog, setSectionDialog] = useState<{ initial: Section; onOk: (s: Section) => void } | null>(null);
  const askCustomSection = (initial: Section, then: (s: Section) => void) =>
    setSectionDialog({
      initial,
      onOk: (sec) => {
        addCustomSection(sec);
        then(sec);
      },
    });
  const [tab, setTab] = useState<Tab>('model');
  const [modal, setModal] = useState<Modal>(null);
  const [np, setNp] = useState<(NumPadRequest & { seq: number }) | null>(null);
  // Every request gets its own keypad instance (key), so "OK i dalej" never shows the previous value.
  const npSeq = useRef(0);
  const openNumpad = useCallback((r: NumPadRequest) => setNp({ ...r, seq: ++npSeq.current }), []);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: boolean } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 7000 : 4000);
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

  /** Jump to the step of the first error (or warning) and select it. */
  const goToFirstIssue = () => {
    const first =
      issues.find((i) => i.level === 'error' && i.stepIndex !== undefined) ?? issues.find((i) => i.stepIndex !== undefined);
    setTab('model');
    if (first?.stepIndex !== undefined) select(first.stepIndex);
  };

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
      setToast({ text: 'Drukowanie nie działa w podglądzie osadzonym. Otwórz aplikację w osobnej karcie przeglądarki.' });
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
          value={sectionKey(bar.section)}
          onChange={(e) => {
            if (e.target.value === CUSTOM) {
              askCustomSection(bar.section, (sec) => update((b) => ({ ...b, section: sec })));
              return;
            }
            const sec = sectionList(customSections, bar.section).find((x) => sectionKey(x) === e.target.value)!;
            update((b) => ({ ...b, section: { ...sec } }));
          }}
        >
          {sectionList(customSections, bar.section).map((sec) => (
            <option key={sectionKey(sec)} value={sectionKey(sec)}>
              {sectionLabel(sec)}
            </option>
          ))}
          <option value={CUSTOM}>Inny przekrój…</option>
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
          <button className="undo-btn act-undo" onClick={undo} disabled={!past.length} title="Cofnij">
            ↶<span className="btn-text"> Cofnij</span>
          </button>
          <button className="undo-btn act-redo" onClick={redo} disabled={!future.length} title="Ponów">
            ↷<span className="btn-text"> Ponów</span>
          </button>
          <button className="wide-only" onClick={() => setModal('new')}>
            Nowa
          </button>
          <button className="wide-only" onClick={() => setModal('projects')}>
            Projekty
          </button>
          <button className="btn-primary wide-only" onClick={print}>
            🖨 Drukuj
          </button>
          <button className="act-menu narrow-only" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen}>
            ⋯
          </button>
          {menuOpen && (
            <div className="top-menu" onClick={() => setMenuOpen(false)}>
              <button onClick={() => setModal('new')}>＋ Nowa szyna</button>
              <button onClick={() => setModal('projects')}>📁 Projekty</button>
              <button className="btn-primary" onClick={print}>
                🖨 Drukuj
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="main">
        {tab === 'model' && (
          <div className="model-tab">
            <Viewer3D
              bar={bar}
              assembly={assembly}
              selected={selected}
              errorSteps={errorSteps}
              issues={issues}
              onSelect={onSelect}
            />
            <StepList
              bar={bar}
              analysis={analysis}
              issues={issues}
              settings={settings}
              selected={selected}
              onSelect={onSelect}
              updateSteps={updateSteps}
              setDouble={(cfg) => update((b) => ({ ...b, double: cfg }))}
              onRemoved={(text) => setToast({ text, undo: true })}
              numpad={openNumpad}
            />
          </div>
        )}
        {tab === 'flat' && (
          <div className="flat-tab">
            {errors > 0 && (
              <button className="no-production" onClick={goToFirstIssue}>
                ⛔ NIE DO PRODUKCJI – projekt zawiera błędy. Pokaż błędny krok ›
              </button>
            )}
            {double && (
              <div className="card double-note">
                <b>Podwójna szyna.</b> {doubleNote(assembly)}
              </div>
            )}
            <div className="card">
              <h3>Gotowa szyna – wymiary do sprawdzenia po gięciu</h3>
              <ProfileView project={bar} assembly={assembly} />
            </div>
            {assembly.parts.map((part) => (
              <PartDocs key={part.index} part={part} double={double} settings={settings} />
            ))}
          </div>
        )}
        {tab === 'settings' && (
          <SettingsTab bar={bar} settings={settings} update={update} setSettings={setSettings} numpad={openNumpad} />
        )}
      </main>

      <footer className={`statusbar ${errors ? 'has-errors' : warnings ? 'has-warnings' : ''}`}>
        <span>
          Długość cięcia:{' '}
          {double ? (
            <>
              Sz.1 <b>{fmt(assembly.parts[0].analysis.flatLength)}</b> · Sz.2 <b>{fmt(assembly.parts[1].analysis.flatLength)}</b>{' '}
              mm
            </>
          ) : (
            <b>{fmt(analysis.flatLength)} mm</b>
          )}
        </span>
        <span>{sectionLabel(bar.section)}</span>
        <span>Wymiary {DIMENSION_MODE_LABEL[bar.dimensionMode]}</span>
        {issues.length ? (
          <button className="status-issues" onClick={goToFirstIssue} title="Pokaż krok z problemem">
            {errors ? `⛔ ${plural(errors, ['błąd', 'błędy', 'błędów'])}` : ''}{' '}
            {warnings ? `⚠ ${plural(warnings, ['ostrzeżenie', 'ostrzeżenia', 'ostrzeżeń'])}` : ''} ›
          </button>
        ) : (
          <span className="status-issues">{double ? '✔ Szyny poprawne' : '✔ Szyna poprawna'}</span>
        )}
      </footer>

      {toast && (
        <div className="toast">
          <span onClick={() => setToast(null)}>{toast.text}</span>
          {toast.undo && (
            <button
              className="toast-undo"
              onClick={() => {
                undo();
                setToast(null);
              }}
            >
              ↶ Cofnij
            </button>
          )}
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
          sections={sectionList(customSections, bar.section)}
          onAddCustom={addCustomSection}
          numpad={openNumpad}
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

      {sectionDialog && (
        <SectionDialog
          initial={sectionDialog.initial}
          numpad={openNumpad}
          onClose={() => setSectionDialog(null)}
          onOk={(sec) => {
            sectionDialog.onOk(sec);
            setSectionDialog(null);
          }}
        />
      )}
      {np && <NumPad key={np.seq} req={np} onClose={() => setNp(null)} />}

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
              W tym projekcie {plural(otherRadius, ['gięcie ma', 'gięcia mają', 'gięć ma'])} promień inny niż narzędzie (R
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
  sections,
  onAddCustom,
  numpad,
  settings,
  onClose,
  onCreate,
}: {
  current: Section;
  sections: Section[];
  onAddCustom: (s: Section) => void;
  numpad: (r: NumPadRequest) => void;
  settings: MachineSettings;
  onClose: () => void;
  onCreate: (b: Busbar) => void;
}) {
  const [section, setSection] = useState<Section>(current);
  const [orderNo, setOrderNo] = useState('');
  // "Inny przekrój" edited right here (no extra dialog).
  const [custom, setCustom] = useState<{ width: number; thickness: number } | null>(null);
  const customError = custom ? sectionError(custom.width, custom.thickness) : null;
  const list = sections.some((x) => sectionKey(x) === sectionKey(section)) ? sections : sectionList(sections, section);
  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <h2>Nowa szyna</h2>
        <label className="field order-field">
          <span className="field-label">Nr zlecenia (opcjonalnie, drukuje się w nagłówku)</span>
          <input value={orderNo} onChange={(e) => setOrderNo(e.target.value)} placeholder="np. ZL/2026/123" />
        </label>
        <div className="muted">1. Wybierz przekrój</div>
        <div className="section-grid">
          {list.map((x) => (
            <button
              key={sectionKey(x)}
              className={sectionKey(x) === sectionKey(section) ? 'on' : ''}
              onClick={() => setSection(x)}
            >
              {x.width}×{x.thickness}
            </button>
          ))}
          <button
            className={`section-other ${custom ? 'on' : ''}`}
            onClick={() => setCustom(custom ? null : { width: section.width, thickness: section.thickness })}
          >
            Inny…
          </button>
        </div>
        {custom && (
          <div className="custom-section">
            <button
              className="field"
              onClick={() =>
                numpad({
                  title: 'Szerokość szyny',
                  value: custom.width,
                  unit: 'mm',
                  min: SECTION_LIMITS.width[0],
                  max: SECTION_LIMITS.width[1],
                  quick: [63, 75, 90, 125, 150, 160, 200],
                  onOk: (v) => setCustom((c) => (c ? { ...c, width: v } : c)),
                })
              }
            >
              <span className="field-label">Szerokość</span>
              <span className="field-value">{fmt(custom.width)} mm</span>
            </button>
            <span className="custom-x">×</span>
            <button
              className="field"
              onClick={() =>
                numpad({
                  title: 'Grubość szyny',
                  value: custom.thickness,
                  unit: 'mm',
                  min: SECTION_LIMITS.thickness[0],
                  max: SECTION_LIMITS.thickness[1],
                  quick: [2, 3, 4, 5, 6, 8, 10, 12, 15, 20],
                  onOk: (v) => setCustom((c) => (c ? { ...c, thickness: v } : c)),
                })
              }
            >
              <span className="field-label">Grubość</span>
              <span className="field-value">{fmt(custom.thickness)} mm</span>
            </button>
            <button
              className="btn-primary"
              disabled={!!customError}
              onClick={() => {
                const sec: Section = { ...custom, material: 'Cu' };
                onAddCustom(sec);
                setSection(sec);
                setCustom(null);
              }}
            >
              Użyj Cu {fmt(custom.width)}×{fmt(custom.thickness)}
            </button>
            {customError && <div className="section-error">⛔ {customError}</div>}
          </div>
        )}
        <div className="muted">2. Wybierz kształt startowy</div>
        <div className="template-grid">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => onCreate({ ...newBusbar(section, t.build(settings), `Szyna ${t.name}`), orderNo: orderNo.trim() })}
            >
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
                  {sectionLabel(p.section)} ·{' '}
                  {plural(p.steps.filter((s) => s.kind === 'bend').length, ['gięcie', 'gięcia', 'gięć'])}
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
        <figure className="print-profile">
          <figcaption>Gotowa szyna – wymiary do sprawdzenia po gięciu (widok z przodu)</figcaption>
          <ProfileView project={bar} assembly={assembly} width={900} maxHeight={420} />
        </figure>
        {snapshot && <img src={snapshot} className="print-3d" alt="Widok 3D" />}
      </div>
      <div className="print-notes">
        <div>
          Wymiary ramion: <b>{DIMENSION_MODE_LABEL[bar.dimensionMode]}</b> · K {settings.k} · szynę wkładaj końcem A do zderzaka
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
      {assembly.parts.map((part) => (
        <div key={part.index} className="print-part">
          <h3>Rozwinięcie{double ? ` – ${part.label}` : ''}</h3>
          <FlatPatternSvg bar={part.bar} analysis={part.analysis} settings={settings} width={1000} />
          <div className="print-tables">
            <BendTable analysis={part.analysis} settings={settings} />
            <HoleTable bar={part.bar} analysis={part.analysis} />
          </div>
        </div>
      ))}
    </div>
  );
}
