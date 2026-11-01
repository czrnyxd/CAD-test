import { useCallback, useEffect, useMemo, useState } from 'react';
import { analyze, fmt, type Issue } from './core/analyze';
import { buildPath, collisionIssues } from './core/geometry';
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
import { deleteProject, duplicateBar, loadProjects, useStore } from './store';
import { BendTable, FlatPatternSvg } from './ui/FlatPattern';
import { NumPad, type NumPadRequest } from './ui/NumPad';
import { renderSnapshot } from './ui/scene';
import { StepList } from './ui/StepList';
import { Viewer3D } from './ui/Viewer3D';

type Tab = 'model' | 'flat' | 'settings';
type Modal = null | 'new' | 'projects';

export default function App() {
  const { bar, settings, selected, past, future, update, updateSteps, undo, redo, select, setSettings, open } = useStore();
  const [tab, setTab] = useState<Tab>('model');
  const [modal, setModal] = useState<Modal>(null);
  const [np, setNp] = useState<NumPadRequest | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);

  const analysis = useMemo(() => analyze(bar, settings), [bar, settings]);
  const path = useMemo(() => buildPath(bar, analysis), [bar, analysis]);
  const issues: Issue[] = useMemo(() => [...analysis.issues, ...collisionIssues(bar, path)], [analysis, bar, path]);
  const errorSteps = useMemo(
    () => new Set(issues.filter((i) => i.level === 'error' && i.stepIndex !== undefined).map((i) => i.stepIndex!)),
    [issues],
  );
  const errors = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.length - errors;

  const onSelect = useCallback((i: number | null) => select(i), [select]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') (e.shiftKey ? redo : undo)();
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') redo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const print = () => {
    setSnapshot(renderSnapshot(bar, path));
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
            <Viewer3D bar={bar} path={path} analysis={analysis} selected={selected} errorSteps={errorSteps} onSelect={onSelect} />
            <StepList
              bar={bar}
              analysis={analysis}
              issues={issues}
              settings={settings}
              selected={selected}
              onSelect={onSelect}
              updateSteps={updateSteps}
              numpad={setNp}
            />
          </div>
        )}
        {tab === 'flat' && (
          <div className="flat-tab">
            <div className="flat-head">
              <div>
                <div className="muted">Długość cięcia</div>
                <div className="flat-length">{fmt(analysis.flatLength)} mm</div>
              </div>
              <div>
                <div className="muted">Przekrój</div>
                <div className="flat-val">{sectionLabel(bar.section)}</div>
              </div>
              <div>
                <div className="muted">Gięć / skrętów</div>
                <div className="flat-val">
                  {analysis.bends.length} / {analysis.twists.length}
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
              <h3>Tabela gięć dla operatora</h3>
              <BendTable analysis={analysis} settings={settings} />
            </div>
          </div>
        )}
        {tab === 'settings' && <SettingsTab bar={bar} settings={settings} update={update} setSettings={setSettings} numpad={setNp} />}
      </main>

      <footer className={`statusbar ${errors ? 'has-errors' : warnings ? 'has-warnings' : ''}`}>
        <span>
          Długość cięcia: <b>{fmt(analysis.flatLength)} mm</b>
        </span>
        <span>{sectionLabel(bar.section)}</span>
        <span>Wymiary {DIMENSION_MODE_LABEL[bar.dimensionMode]}</span>
        <span className="status-issues">
          {errors ? `⛔ ${errors} błąd(y)` : ''} {warnings ? `⚠ ${warnings} ostrzeżenie(a)` : ''}
          {!issues.length && '✔ Szyna poprawna'}
        </span>
      </footer>

      {np && <NumPad req={np} onClose={() => setNp(null)} />}
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
          onOpen={(b) => {
            open(b);
            setModal(null);
            setTab('model');
          }}
        />
      )}

      <PrintSheet bar={bar} settings={settings} snapshot={snapshot} issues={issues} />
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
  const num = (key: keyof MachineSettings, title: string, unit: string, min: number, max: number) => (
    <button
      className="field"
      onClick={() =>
        numpad({ title, unit, min, max, value: settings[key] as number, onOk: (v) => setSettings({ [key]: v } as Partial<MachineSettings>) })
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
              numpad({ title: 'Ilość sztuk', unit: 'szt.', min: 1, max: 10000, value: bar.quantity, onOk: (v) => update((b) => ({ ...b, quantity: Math.round(v) })) })
            }
          >
            <span className="field-label">Ilość</span>
            <span className="field-value">{bar.quantity} szt.</span>
          </button>
        </div>
        <div className="field-row">
          <span className="field-label">Długości odcinków wymiarowane</span>
          <div className="seg">
            {(['outside', 'inside', 'centerline'] as DimensionMode[]).map((m) => (
              <button key={m} className={bar.dimensionMode === m ? 'on' : ''} onClick={() => update((b) => ({ ...b, dimensionMode: m }))}>
                {DIMENSION_MODE_LABEL[m]}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="card">
        <h3>Maszyna i narzędzia</h3>
        <p className="muted">
          Wartości K i sprężynowania należy skalibrować na próbkach z tej maszyny. Zmiana dotyczy wszystkich projektów.
        </p>
        <div className="fields">
          {num('radiusFlat', 'Promień – gięcie płaskie', 'mm', 0, 500)}
          {num('radiusEdge', 'Promień – gięcie na kant', 'mm', 0, 1000)}
          {num('kFlat', 'Współczynnik K – płaskie', '', 0, 1)}
          {num('kEdge', 'Współczynnik K – na kant', '', 0, 1)}
          {num('springbackFlatPct', 'Sprężynowanie – płaskie', '%', 0, 30)}
          {num('springbackEdgePct', 'Sprężynowanie – na kant', '%', 0, 30)}
          {num('minLeg', 'Minimalne ramię', 'mm', 0, 500)}
          {num('maxLength', 'Długość handlowa szyny', 'mm', 100, 12000)}
        </div>
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
              <button key={k} className={settings.bendLineReference === k ? 'on' : ''} onClick={() => setSettings({ bendLineReference: k })}>
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
    edge: 'M10 50 H60 Q70 50 70 40 V15',
    twist: 'M10 45 H40 M40 45 L55 35 M55 35 H70 V10',
  };
  return (
    <svg viewBox="0 0 100 60" className="tpl-icon">
      <path d={d[id]} fill="none" stroke="#c87533" strokeWidth="7" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function ProjectsModal({ currentId, onClose, onOpen }: { currentId: string; onClose: () => void; onOpen: (b: Busbar) => void }) {
  const [projects, setProjects] = useState(() => loadProjects());
  const list = Object.values(projects).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const [q, setQ] = useState('');
  const filtered = list.filter((p) => `${p.name} ${p.orderNo}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <h2>Projekty</h2>
        <input className="search" placeholder="Szukaj po nazwie lub nr zlecenia…" value={q} onChange={(e) => setQ(e.target.value)} />
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
                onClick={() => {
                  if (!confirm(`Usunąć projekt „${p.name}”?`)) return;
                  deleteProject(p.id);
                  setProjects(loadProjects());
                }}
              >
                🗑
              </button>
            </div>
          ))}
          {!filtered.length && <p className="muted">Brak projektów.</p>}
        </div>
        <div className="modal-actions">
          <button
            className="btn-secondary"
            onClick={() => {
              const cur = projects[currentId];
              if (!cur) return;
              const blob = new Blob([JSON.stringify(cur, null, 2)], { type: 'application/json' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `${cur.name.replace(/[^\w\-ąćęłńóśźż ]+/gi, '_')}.json`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            Eksport bieżącego (JSON)
          </button>
          <label className="btn-secondary file-btn">
            Import JSON
            <input
              type="file"
              accept="application/json,.json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const b = JSON.parse(await f.text()) as Busbar;
                  if (!b.steps || !b.section) throw new Error('format');
                  onOpen(duplicateBar({ ...b, name: b.name.replace(/ \(kopia\)$/, '') }));
                } catch {
                  alert('Nieprawidłowy plik projektu.');
                }
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

function PrintSheet({
  bar,
  settings,
  snapshot,
  issues,
}: {
  bar: Busbar;
  settings: MachineSettings;
  snapshot: string | null;
  issues: Issue[];
}) {
  const analysis = useMemo(() => analyze(bar, settings), [bar, settings]);
  return (
    <div className="print-sheet">
      <table className="print-header">
        <tbody>
          <tr>
            <td rowSpan={2} className="ph-title">
              {bar.name}
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
              <span>Ilość</span>
              <b>{bar.quantity} szt.</b>
            </td>
          </tr>
          <tr>
            <td>
              <span>Długość cięcia</span>
              <b className="ph-len">{fmt(analysis.flatLength)} mm</b>
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
          <BendTable analysis={analysis} settings={settings} />
          <div>
            Wymiary ramion: <b>{DIMENSION_MODE_LABEL[bar.dimensionMode]}</b> · K płaskie {settings.kFlat} · K kant{' '}
            {settings.kEdge} · koniec A oznaczony na zielono
          </div>
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
      <h3>Rozwinięcie</h3>
      <FlatPatternSvg bar={bar} analysis={analysis} settings={settings} width={1000} />
    </div>
  );
}
