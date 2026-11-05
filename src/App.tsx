import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { Chip, Notice, Seg } from './ui/controls';
import { Dialog } from './ui/Dialog';
import { DimensionModeHelp } from './ui/DimensionModeHelp';
import { Icon, Mark, type IconName } from './ui/Icon';
import { ProfileView } from './ui/ProfileView';
import { SectionDialog } from './ui/SectionDialog';
import { ServerSettings, SyncBadge } from './ui/ServerSettings';
import { BendTable, FlatPatternSvg, HoleTable } from './ui/FlatPattern';
import { NumPad, type NumPadRequest } from './ui/NumPad';
import { renderSnapshot } from './ui/scene';
import { StepList } from './ui/StepList';
import { InlineEditor } from './ui/InlineEditor';
import { KeysDialog } from './ui/KeysDialog';
import { keyboardBusy } from './ui/keys';
import { CabinetPanel } from './ui/CabinetPanel';
import { cabinetConfig, checkCabinet } from './core/cabinet';
import { Viewer3D } from './ui/Viewer3D';

type Tab = 'model' | 'flat' | 'settings';
type Layout = 'tablet' | 'portrait' | 'phone';

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
type Modal = null | 'new' | 'projects' | 'keys';

/** How values are entered on this device: on-screen keypad (touch) or a field typed into (mouse and keyboard). */
type InputPref = 'auto' | 'mouse' | 'touch';
const LS_INPUT = 'busbar.input.v1';

function useInputMode(): [boolean, InputPref, (p: InputPref) => void] {
  const read = (): InputPref => {
    try {
      const v = localStorage.getItem(LS_INPUT);
      return v === 'mouse' || v === 'touch' ? v : 'auto';
    } catch {
      return 'auto';
    }
  };
  const fine = () => typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
  const [pref, setPrefState] = useState<InputPref>(read);
  const [isFine, setFine] = useState(fine);
  useEffect(() => {
    const mq = window.matchMedia?.('(pointer: fine)');
    const on = () => setFine(fine());
    mq?.addEventListener?.('change', on);
    return () => mq?.removeEventListener?.('change', on);
  }, []);
  const setPref = (p: InputPref) => {
    setPrefState(p);
    try {
      localStorage.setItem(LS_INPUT, p);
    } catch {
      /* only a convenience of this device */
    }
  };
  return [pref === 'mouse' || (pref === 'auto' && isFine), pref, setPref];
}

/** Tablet in landscape (model left, steps right), tablet in portrait (stacked) or phone. */
function useLayout(): Layout {
  const get = (): Layout =>
    window.innerWidth < 700
      ? 'phone'
      : window.innerWidth < 1000 || window.innerHeight > window.innerWidth
        ? 'portrait'
        : 'tablet';
  const [layout, setLayout] = useState(get);
  useEffect(() => {
    const on = () => setLayout(get());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return layout;
}

const TABS: { value: Tab; label: string; short: string; icon: IconName }[] = [
  { value: 'model', label: 'Model 3D', short: 'Model', icon: 'cube' },
  { value: 'flat', label: 'Rozwinięcie', short: 'Rozwinięcie', icon: 'flat' },
  { value: 'settings', label: 'Ustawienia', short: 'Ustaw.', icon: 'gear' },
];

function ToolButton({
  icon,
  label,
  onClick,
  disabled,
  className,
  title,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  /** Tooltip (with the keyboard shortcut). */
  title?: string;
}) {
  return (
    <button type="button" className={`bb-tool ${className ?? ''}`} onClick={onClick} disabled={disabled} title={title}>
      <Icon name={icon} />
      <span className="bb-tool-label">{label}</span>
    </button>
  );
}

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
  const layout = useLayout();
  const [desktop, inputPref, setInputPref] = useInputMode();
  // The value that was clicked last – the typed-in editor opens right over it.
  const lastPress = useRef<{ el: HTMLElement | null; at: number }>({ el: null, at: 0 });
  useEffect(() => {
    const on = (e: PointerEvent) => {
      lastPress.current = {
        el: (e.target as Element | null)?.closest?.('.bb-chip, button') as HTMLElement | null,
        at: Date.now(),
      };
    };
    window.addEventListener('pointerdown', on, true);
    return () => window.removeEventListener('pointerdown', on, true);
  }, []);
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
  const [np, setNp] = useState<(NumPadRequest & { seq: number; anchor?: HTMLElement | null }) | null>(null);
  // Every request gets its own keypad instance (key), so "OK i dalej" never shows the previous value.
  const npSeq = useRef(0);
  const openNumpad = useCallback((r: NumPadRequest) => {
    const lp = lastPress.current;
    setNp({ ...r, seq: ++npSeq.current, anchor: Date.now() - lp.at < 1000 ? lp.el : null });
  }, []);
  // A keypad belongs to the screen it was opened on.
  useEffect(() => setNp(null), [tab]);
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
  const cabCfg = useMemo(() => cabinetConfig(bar.cabinet), [bar.cabinet]);
  const cabCheck = useMemo(
    () => (cabCfg.enabled ? checkCabinet(assembly, cabCfg, bar.section.width, bar.section.thickness) : null),
    [assembly, cabCfg, bar.section],
  );
  const cabinetView = useMemo(() => (cabCheck ? { cfg: cabCfg, check: cabCheck } : null), [cabCfg, cabCheck]);
  const [panel, setPanel] = useState<'steps' | 'cabinet'>('steps');
  const issues: Issue[] = assembly.issues;
  const errorSteps = useMemo(
    () => new Set(issues.filter((i) => i.level === 'error' && i.stepIndex !== undefined).map((i) => i.stepIndex!)),
    [issues],
  );
  const errors = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.length - errors;
  const cutText = double
    ? `Sz.1 ${fmt(assembly.parts[0].analysis.flatLength, 0)} · Sz.2 ${fmt(assembly.parts[1].analysis.flatLength, 0)} mm`
    : `${fmt(analysis.flatLength)} mm`;

  const onSelect = useCallback((i: number | null) => select(i), [select]);

  /** Jump to the step of the first error (or warning) and select it. */
  const goToFirstIssue = () => {
    const first =
      issues.find((i) => i.level === 'error' && i.stepIndex !== undefined) ?? issues.find((i) => i.stepIndex !== undefined);
    setTab('model');
    if (first?.stepIndex !== undefined) select(first.stepIndex);
  };

  // Keyboard: undo / redo, print, help, and moving through the steps (model tab).
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      if (!document.querySelector('.bb-scrim')) print();
      return;
    }
    if (keyboardBusy(e)) return;
    if (ctrl && e.key.toLowerCase() === 'z') (e.shiftKey ? redo : undo)();
    else if (ctrl && e.key.toLowerCase() === 'y') redo();
    else if (e.key === 'F1' || e.key === '?') {
      e.preventDefault();
      setModal('keys');
    }
    if (ctrl || e.altKey || tab !== 'model') return;
    const click = (sel: string) => (document.querySelector(sel) as HTMLElement | null)?.click();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = bar.steps.length;
      const d = e.key === 'ArrowDown' ? 1 : -1;
      select(selected === null ? (d > 0 ? 0 : n - 1) : Math.max(0, Math.min(n - 1, selected + d)));
    } else if (e.key === 'Enter' && selected !== null) {
      e.preventDefault();
      click('.bb-step.is-selected .bb-step-body .bb-chip');
    } else if (e.key === 'Delete' && selected !== null) {
      click('.bb-step.is-selected .bb-step-del');
    } else if (e.key === 'Insert' || e.key === '+') {
      click('.add-bend');
    } else if (e.key === 'Escape') {
      select(null);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const print = () => {
    if (IN_FRAME) {
      setToast({ text: 'Drukowanie nie działa w podglądzie osadzonym. Otwórz aplikację w osobnej karcie przeglądarki.' });
      return;
    }
    setSnapshot(renderSnapshot(assembly.parts, assembly.bbox));
    setTimeout(() => window.print(), 150);
  };

  const sections = sectionList(customSections, bar.section);
  const nameField = (
    <label className="bb-name">
      <span className="bb-name-cap">Nazwa szyny</span>
      <input
        className="bb-name-val"
        value={bar.name}
        onChange={(e) => update((b) => ({ ...b, name: e.target.value }), false)}
        aria-label="Nazwa szyny"
      />
    </label>
  );
  const sectionPick = (
    <label className="bb-sect">
      <span className="bb-name-cap">Przekrój</span>
      <span className="bb-sect-val">
        <select
          value={sectionKey(bar.section)}
          aria-label="Przekrój"
          onChange={(e) => {
            if (e.target.value === CUSTOM) {
              askCustomSection(bar.section, (sec) => update((b) => ({ ...b, section: sec })));
              return;
            }
            const sec = sections.find((x) => sectionKey(x) === e.target.value)!;
            update((b) => ({ ...b, section: { ...sec } }));
          }}
        >
          {sections.map((sec) => (
            <option key={sectionKey(sec)} value={sectionKey(sec)}>
              {sectionLabel(sec)}
            </option>
          ))}
          <option value={CUSTOM}>Inny przekrój…</option>
        </select>
        <Icon name="chevdown" size={20} />
      </span>
    </label>
  );
  const tabs = (
    <Seg
      label="Widok"
      className={`bb-tabs ${layout === 'tablet' ? '' : 'bb-grow'}`}
      value={tab}
      options={TABS.map((t) => ({
        value: t.value,
        label: layout === 'phone' ? t.short : t.label,
        icon: layout === 'phone' ? undefined : <Icon name={t.icon} />,
      }))}
      onChange={setTab}
    />
  );
  const history = (
    <div className="bb-tgroup">
      <ToolButton icon="undo" label="Cofnij" title="Cofnij (Ctrl+Z)" onClick={undo} disabled={!past.length} />
      <ToolButton icon="redo" label="Ponów" title="Ponów (Ctrl+Y)" onClick={redo} disabled={!future.length} />
    </div>
  );
  const tools = (
    <div className="bb-tgroup">
      <ToolButton icon="plus" label="Nowa" onClick={() => setModal('new')} />
      <ToolButton icon="folder" label="Projekty" onClick={() => setModal('projects')} />
      <ToolButton icon="print" label="Drukuj" title="Drukuj (Ctrl+P)" onClick={print} />
      {desktop && <ToolButton icon="keyboard" label="Skróty" title="Skróty klawiszowe (F1)" onClick={() => setModal('keys')} />}
    </div>
  );

  return (
    <div className={`bb-screen app app--${layout} ${layout === 'phone' ? 'bb-phone' : ''} ${desktop ? 'app--desktop' : ''}`}>
      {layout === 'tablet' ? (
        <header className="bb-header">
          <Mark />
          {nameField}
          {sectionPick}
          {tabs}
          <span className="bb-spacer" />
          {history}
          {tools}
        </header>
      ) : layout === 'portrait' ? (
        <header className="bb-header bb-header--stack">
          <div className="bb-hrow">
            <Mark />
            {nameField}
            {sectionPick}
            <span className="bb-spacer" />
            {tools}
          </div>
          <div className="bb-hrow">
            {tabs}
            {history}
          </div>
        </header>
      ) : (
        <header className="bb-header bb-header--stack">
          <div className="bb-hrow">
            {nameField}
            {sectionPick}
            <div className="menu-wrap">
              <ToolButton icon="more" label="Menu" onClick={() => setMenuOpen((v) => !v)} />
              {menuOpen && (
                <div className="top-menu" onClick={() => setMenuOpen(false)}>
                  <button className="bb-btn bb-btn--secondary bb-btn--block" onClick={() => setModal('new')}>
                    <Icon name="plus" />
                    Nowa szyna
                  </button>
                  <button className="bb-btn bb-btn--secondary bb-btn--block" onClick={() => setModal('projects')}>
                    <Icon name="folder" />
                    Projekty
                  </button>
                  <button className="bb-btn bb-btn--secondary bb-btn--block" onClick={print}>
                    <Icon name="print" />
                    Drukuj
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="bb-hrow">
            {tabs}
            {history}
          </div>
        </header>
      )}

      {!saveOk && (
        <div className="bb-banner bb-banner--save" role="alert">
          <Icon name="nosave" size={28} />
          <span className="bb-banner-text">
            <strong>Projekt nie jest zapisany.</strong>
            <span className="bb-banner-sub"> Pamięć urządzenia jest pełna albo zablokowana. Wyeksportuj projekt do pliku.</span>
          </span>
          <button className="bb-banner-act" onClick={() => setModal('projects')}>
            Projekty
            <Icon name="next" />
          </button>
        </div>
      )}

      {tab === 'model' && (
        <div className={`bb-main ${layout === 'tablet' ? '' : 'bb-main--stack'}`}>
          <Viewer3D
            bar={bar}
            assembly={assembly}
            selected={selected}
            errorSteps={errorSteps}
            issues={issues}
            onSelect={onSelect}
            cabinet={cabinetView}
            foot={
              double && assembly.arcGaps.length > 0 ? (
                <span className="vf-gap">
                  Szczelina w łukach <b>do {fmt(Math.max(...assembly.arcGaps.map((g) => g.gap)))} mm</b>
                </span>
              ) : undefined
            }
          />
          {panel === 'cabinet' ? (
            <CabinetPanel
              cfg={cabCfg}
              check={cabCheck}
              barWidth={bar.section.width}
              onChange={(cfg) => update((b) => ({ ...b, cabinet: cfg }))}
              onClose={() => setPanel('steps')}
              numpad={openNumpad}
            />
          ) : (
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
              onCabinet={() => setPanel('cabinet')}
              cabinetOn={cabCfg.enabled}
            />
          )}
        </div>
      )}
      {tab === 'flat' && (
        <>
          {errors > 0 && <StopBanner issues={issues} onShow={goToFirstIssue} />}
          <div className={`bb-doc flat-doc ${errors ? 'bb-doc--void' : ''}`}>
            <CutStrip assembly={assembly} bar={bar} cutText={cutText} />
            {double ? (
              <>
                <Notice tone="info">
                  <b>Podwójna szyna.</b> {doubleNote(assembly)}
                </Notice>
                <section className="bb-card">
                  <h3 className="bb-card-title">
                    Gotowy układ<span className="bb-card-sub">sprawdź po gięciu i złożeniu</span>
                  </h3>
                  <Fit>{(w) => <ProfileView project={bar} assembly={assembly} width={w} maxHeight={360} />}</Fit>
                </section>
                {assembly.parts.map((part) => (
                  <PartDocs key={part.index} part={part} settings={settings} double />
                ))}
              </>
            ) : (
              <>
                <div className="bb-docgrid">
                  <section className="bb-card">
                    <h3 className="bb-card-title">
                      Gotowa szyna<span className="bb-card-sub">sprawdź po gięciu</span>
                    </h3>
                    <Fit>{(w) => <ProfileView project={bar} assembly={assembly} width={w} maxHeight={320} />}</Fit>
                  </section>
                  <section className="bb-card">
                    <h3 className="bb-card-title">
                      Rozwinięcie<span className="bb-card-sub">do trasowania i cięcia</span>
                    </h3>
                    <Fit min={600}>{(w) => <FlatPatternSvg bar={bar} analysis={analysis} settings={settings} width={w} />}</Fit>
                  </section>
                </div>
                <div className="bb-docgrid2">
                  <section className="bb-card">
                    <h3 className="bb-card-title">Gięcia</h3>
                    <BendTable analysis={analysis} settings={settings} />
                  </section>
                  <section className="bb-card">
                    <h3 className="bb-card-title">Otwory</h3>
                    <HoleTable bar={bar} analysis={analysis} />
                  </section>
                </div>
              </>
            )}
          </div>
        </>
      )}
      {tab === 'settings' && (
        <SettingsTab
          bar={bar}
          settings={settings}
          update={update}
          setSettings={setSettings}
          numpad={openNumpad}
          inputPref={inputPref}
          setInputPref={setInputPref}
        />
      )}

      <footer className={`bb-status ${layout === 'phone' ? 'bb-status--compact' : ''}`}>
        <div className="bb-st-cut">
          <span className="bb-st-cap">Długość cięcia</span>
          <span className={`bb-st-cutval ${errors ? 'is-void' : ''}`}>{cutText}</span>
        </div>
        {layout !== 'phone' && (
          <>
            <div className="bb-st-item">
              <span className="bb-st-cap">Przekrój</span>
              <span className="bb-st-val">{sectionLabel(bar.section)}</span>
            </div>
            <div className="bb-st-item">
              <span className="bb-st-cap">Wymiary</span>
              <span className="bb-st-val">{DIMENSION_MODE_LABEL[bar.dimensionMode]}</span>
            </div>
          </>
        )}
        <SyncBadge onOpenSettings={() => setTab('settings')} />
        <span className="bb-spacer" />
        {issues.length ? (
          <button
            className={`bb-st-check bb-st-check--${errors ? 'danger' : 'warning'}`}
            onClick={goToFirstIssue}
            title="Pokaż krok z problemem"
          >
            <Icon name={errors ? 'stop' : 'warn'} />
            {errors ? plural(errors, ['błąd', 'błędy', 'błędów']) : plural(warnings, ['ostrzeżenie', 'ostrzeżenia', 'ostrzeżeń'])}
            {errors > 0 && warnings > 0 && layout !== 'phone' && (
              <span className="st-more">+ {plural(warnings, ['ostrzeżenie', 'ostrzeżenia', 'ostrzeżeń'])}</span>
            )}
            <Icon name="next" />
          </button>
        ) : (
          <span className="bb-st-check bb-st-check--ok">
            <Icon name="check" />
            {double ? 'Szyny poprawne' : 'Szyna poprawna'}
          </span>
        )}
      </footer>

      {toast && (
        <div className="bb-toast-wrap">
          <div className="bb-toast" role="status">
            <span className="bb-toast-text" onClick={() => setToast(null)}>
              {toast.text}
            </span>
            {toast.undo && (
              <button
                className="bb-toast-act"
                onClick={() => {
                  undo();
                  setToast(null);
                }}
              >
                <Icon name="undo" />
                Cofnij
              </button>
            )}
          </div>
        </div>
      )}
      {notice && (
        <Dialog
          title="Sprawdź projekt"
          width={620}
          footer={
            <>
              <span className="bb-spacer" />
              <button className="bb-btn bb-btn--primary bb-btn--lg bb-wide" onClick={() => setNotice(null)}>
                <Icon name="check" />
                Rozumiem
              </button>
            </>
          }
        >
          <div className="notice-text">{notice}</div>
        </Dialog>
      )}
      {modal === 'new' && (
        <NewModal
          current={bar.section}
          sections={sections}
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
      {np &&
        (desktop ? (
          <InlineEditor key={np.seq} req={np} onClose={() => setNp(null)} />
        ) : (
          <NumPad key={np.seq} req={np} onClose={() => setNp(null)} />
        ))}
      {modal === 'keys' && <KeysDialog onClose={() => setModal(null)} />}

      <PrintSheet bar={bar} assembly={assembly} settings={settings} snapshot={snapshot} issues={issues} />
    </div>
  );
}

/** Measures the available width, so drawings are drawn at their real size (text stays readable). */
function Fit({ children, min = 280 }: { children: (width: number) => ReactNode; min?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setW(Math.floor(el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="fit">
      {w > 0 && children(Math.max(min, w))}
    </div>
  );
}

function StopBanner({ issues, onShow }: { issues: Issue[]; onShow: () => void }) {
  const first = issues.find((i) => i.level === 'error');
  return (
    <div className="bb-banner bb-banner--stop" role="alert">
      <Icon name="stop" size={28} />
      <span className="bb-banner-text">
        <strong>NIE DO PRODUKCJI</strong>
        {first && <span className="bb-banner-sub"> {first.message}</span>}
      </span>
      <button className="bb-banner-act" onClick={onShow}>
        Pokaż błędny krok
        <Icon name="next" />
      </button>
    </div>
  );
}

function CutStrip({ assembly, bar, cutText }: { assembly: Assembly; bar: Busbar; cutText: string }) {
  const double = assembly.parts.length > 1;
  const a = assembly.parts[0].analysis;
  return (
    <div className="bb-cutstrip">
      <div className="bb-cutstrip-main">
        <span className="bb-tile-label">{double ? 'Długości cięcia' : 'Długość cięcia'}</span>
        <span className="bb-cutnum">{cutText}</span>
      </div>
      <div className="bb-cutstrip-item">
        <span className="bb-tile-label">Przekrój</span>
        <span className="bb-cutitem">{sectionLabel(bar.section)}</span>
      </div>
      <div className="bb-cutstrip-item">
        <span className="bb-tile-label">Gięcia</span>
        <span className="bb-cutitem">{double ? `${a.bends.length} + ${a.bends.length}` : a.bends.length}</span>
      </div>
      <div className="bb-cutstrip-item">
        <span className="bb-tile-label">Otwory</span>
        <span className="bb-cutitem">{a.holes.length}</span>
      </div>
      <div className="bb-cutstrip-item">
        <span className="bb-tile-label">Wymiary</span>
        <span className="bb-cutitem">{DIMENSION_MODE_LABEL[bar.dimensionMode]}</span>
      </div>
    </div>
  );
}

/** Sketch of a corner with the "from – to" points of a dimension mode. */
function ModeSketch({ mode }: { mode: DimensionMode }) {
  const t = 16;
  const R = 16;
  const x0 = 14;
  const y0 = 96;
  const xw = 140;
  const top = 12;
  const outer = `M${x0} ${y0}H${xw - R - t}A${R + t} ${R + t} 0 0 0 ${xw} ${y0 - R - t}V${top}H${xw - t}V${y0 - t - R}A${R} ${R} 0 0 1 ${xw - t - R} ${y0 - t}H${x0}Z`;
  const px = mode === 'outside' ? xw : mode === 'centerline' ? xw - t / 2 : xw - t;
  const py = mode === 'outside' ? y0 : mode === 'centerline' ? y0 - t / 2 : y0 - t;
  return (
    <svg className="bb-svg" width={180} height={120} viewBox="0 0 180 120" aria-hidden="true">
      <path d={outer} className="bb-bar2d" />
      <path className="bb-sk-guide" d={`M${x0} ${py}H${px}V${top}`} />
      <circle className="bb-dim-pt" cx={x0} cy={py} r={6} />
      <circle className="bb-dim-pt" cx={px} cy={py} r={6} />
    </svg>
  );
}

const MODE_HOW: Record<DimensionMode, string> = {
  outside: 'od końca do zewnętrznej ściany (ostry narożnik)',
  centerline: 'od końca do osi grubości szyny',
  inside: 'od końca do wewnętrznej ściany',
};

function SettingsTab({
  bar,
  settings,
  update,
  setSettings,
  numpad,
  inputPref,
  setInputPref,
}: {
  bar: Busbar;
  settings: MachineSettings;
  update: (fn: (b: Busbar) => Busbar, record?: boolean) => void;
  setSettings: (s: Partial<MachineSettings>) => void;
  numpad: (r: NumPadRequest) => void;
  inputPref: InputPref;
  setInputPref: (p: InputPref) => void;
}) {
  const cutLength = (m: DimensionMode) => analyze({ ...bar, dimensionMode: m }, settings).flatLength;
  const firstBendAt = (ref: MachineSettings['bendLineReference']) =>
    analyze(bar, { ...settings, bendLineReference: ref }).bends[0]?.position;
  const otherRadius = bar.steps.filter((st) => st.kind === 'bend' && st.radius !== settings.radius).length;
  const num = (key: keyof MachineSettings, title: string, unit: string, min: number, max: number, show = fmt) => (
    <Chip
      label={title}
      value={show(settings[key] as number)}
      unit={unit || undefined}
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
    />
  );
  const refOpt = (k: MachineSettings['bendLineReference'], l: string) => {
    const at = firstBendAt(k);
    return { value: k, label: at === undefined ? l : `${l} · ${fmt(at, 0)}` };
  };
  return (
    <div className="bb-doc bb-settings settings-tab">
      <section className="bb-card">
        <h3 className="bb-card-title">Wymiarowanie odcinków</h3>
        <div className="bb-modes" role="radiogroup" aria-label="Tryb wymiarowania">
          {(['outside', 'centerline', 'inside'] as DimensionMode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={bar.dimensionMode === m}
              className={`bb-mode ${bar.dimensionMode === m ? 'is-selected' : ''}`}
              onClick={() => update((b) => ({ ...b, dimensionMode: m }))}
            >
              <ModeSketch mode={m} />
              <span className="bb-mode-name">{DIMENSION_MODE_LABEL[m].replace(/^po /, 'Po ')}</span>
              <span className="bb-mode-how">{MODE_HOW[m]}</span>
              <span className="bb-mode-cut">
                <span className="bb-tile-label">Cięcie</span>
                <span className="bb-mode-val">{fmt(cutLength(m), 0)} mm</span>
              </span>
            </button>
          ))}
        </div>
        <p className="bb-p">
          Zmiana trybu nie zmienia wpisanych liczb. Zmienia to, skąd dokąd są mierzone, więc zmienia się wygięta szyna i długość
          cięcia (podana przy każdym trybie dla tego projektu).
        </p>
        <DimensionModeHelp mode={bar.dimensionMode} />
      </section>
      <div className="bb-col">
        <section className="bb-card">
          <h3 className="bb-card-title">Maszyna</h3>
          <label className="bb-chip bb-input">
            <span className="bb-chip-label">Nazwa (na wydruku)</span>
            <input value={settings.machineName} onChange={(e) => setSettings({ machineName: e.target.value })} />
          </label>
          <div className="bb-row">
            <Chip
              label="Promień narzędzia"
              value={`R${fmt(settings.radius)}`}
              className="radius-chip"
              onClick={() =>
                numpad({
                  title: 'Promień gięcia (narzędzie)',
                  unit: 'mm',
                  min: 0,
                  max: 500,
                  value: settings.radius,
                  onOk: (v) => setSettings({ radius: v }),
                })
              }
            />
            <button
              className="bb-btn bb-btn--secondary bb-grow radius-all"
              disabled={!otherRadius}
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
          {otherRadius > 0 && (
            <Notice tone="warning">
              W tym projekcie {plural(otherRadius, ['gięcie ma', 'gięcia mają', 'gięć ma'])} promień inny niż narzędzie.
            </Notice>
          )}
          <div className="bb-row3">
            {num('k', 'Współczynnik K', '', 0, 1, (v) => fmt(v, 3))}
            {num('springbackPct', 'Sprężynowanie', '%', 0, 30)}
            {num('minLeg', 'Minimalne ramię', 'mm', 0, 500)}
          </div>
          <div className="bb-row">{num('maxLength', 'Długość handlowa', 'mm', 100, 12000)}</div>
          <span className="bb-field-label">
            Punkt odniesienia linii gięcia{firstBendAt('center') !== undefined ? ' (G1 od A, mm)' : ''}
          </span>
          <Seg
            label="Punkt odniesienia"
            block
            tall
            value={settings.bendLineReference}
            options={[refOpt('start', 'Początek łuku'), refOpt('center', 'Środek łuku'), refOpt('end', 'Koniec łuku')]}
            onChange={(k) => setSettings({ bendLineReference: k })}
          />
          <p className="bb-p">
            K, sprężynowanie, minimalne ramię i długość handlowa działają od razu we wszystkich projektach. Promień narzędzia
            dotyczy nowych gięć. Wartości K i sprężynowania trzeba skalibrować na próbkach z tej maszyny.
          </p>
        </section>
        <section className="bb-card">
          <h3 className="bb-card-title">
            Sterowanie<span className="bb-card-sub">tylko to urządzenie</span>
          </h3>
          <Seg
            label="Sterowanie"
            block
            value={inputPref}
            options={[
              { value: 'auto', label: 'Automatycznie' },
              { value: 'mouse', label: 'Mysz i klawiatura' },
              { value: 'touch', label: 'Dotyk' },
            ]}
            onChange={setInputPref}
          />
          <p className="bb-p">
            Mysz i klawiatura: wartości wpisujesz w polu, które otwiera się w miejscu kliknięcia (Enter zapisuje i przechodzi
            dalej), działają skróty klawiszowe (F1). Dotyk: duża klawiatura ekranowa. Automatycznie wybiera według urządzenia.
            Wszystko można powiększyć klawiszami Ctrl + plus.
          </p>
        </section>
        <ServerSettings />
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
  const [shape, setShape] = useState(TEMPLATES[0].id);
  // "Inny przekrój" edited right here (no extra dialog).
  const [custom, setCustom] = useState<{ width: number; thickness: number } | null>(null);
  const customError = custom ? sectionError(custom.width, custom.thickness) : null;
  const list = sections.some((x) => sectionKey(x) === sectionKey(section)) ? sections : sectionList(sections, section);
  const create = () => {
    const t = TEMPLATES.find((x) => x.id === shape)!;
    onCreate({ ...newBusbar(section, t.build(settings), `Szyna ${t.name}`), orderNo: orderNo.trim() });
  };
  return (
    <Dialog
      title="Nowa szyna"
      width={960}
      onClose={onClose}
      footer={
        <>
          <span className="bb-spacer" />
          <button className="bb-btn bb-btn--primary bb-btn--lg bb-wide" disabled={!!custom} onClick={create}>
            <Icon name="check" />
            Utwórz szynę
          </button>
        </>
      }
    >
      <div className="bb-newgrid">
        <div className="bb-col">
          <label className="bb-chip bb-input">
            <span className="bb-chip-label">Nr zlecenia (opcjonalnie, drukuje się w nagłówku)</span>
            <input value={orderNo} onChange={(e) => setOrderNo(e.target.value)} placeholder="np. ZL/2026/123" />
          </label>
          <span className="bb-field-label">Przekrój (szerokość × grubość, Cu)</span>
          <div className="bb-picks">
            {list.map((x) => (
              <button
                key={sectionKey(x)}
                type="button"
                className={`bb-pick ${!custom && sectionKey(x) === sectionKey(section) ? 'is-selected' : ''}`}
                onClick={() => {
                  setSection(x);
                  setCustom(null);
                }}
              >
                {fmt(x.width)}×{fmt(x.thickness)}
              </button>
            ))}
            <button
              type="button"
              className={`bb-pick ${custom ? 'is-selected' : ''}`}
              onClick={() => setCustom(custom ? null : { width: section.width, thickness: section.thickness })}
            >
              Inny…
            </button>
          </div>
          {custom && (
            <>
              <div className="bb-other">
                <Chip
                  label="Szerokość"
                  value={fmt(custom.width)}
                  unit="mm"
                  className="bb-grow"
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
                />
                <span className="bb-times">×</span>
                <Chip
                  label="Grubość"
                  value={fmt(custom.thickness)}
                  unit="mm"
                  state={customError ? 'error' : undefined}
                  className="bb-grow"
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
                />
              </div>
              {customError ? (
                <Notice tone="danger">{customError}</Notice>
              ) : (
                <button
                  className="bb-btn bb-btn--primary"
                  onClick={() => {
                    const sec: Section = { ...custom, material: 'Cu' };
                    onAddCustom(sec);
                    setSection(sec);
                    setCustom(null);
                  }}
                >
                  <Icon name="check" />
                  Użyj Cu {fmt(custom.width)}×{fmt(custom.thickness)}
                </button>
              )}
            </>
          )}
        </div>
        <div className="bb-col">
          <span className="bb-field-label">Kształt startowy</span>
          <div className="bb-shapes">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`bb-shape ${shape === t.id ? 'is-selected' : ''}`}
                onClick={() => setShape(t.id)}
                onDoubleClick={() => {
                  setShape(t.id);
                  if (!custom) create();
                }}
              >
                <TemplateIcon id={t.id} />
                <span className="bb-shape-name">{t.name}</span>
                <span className="bb-shape-desc">{t.description}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
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
    <svg viewBox="0 0 100 60" width={110} height={66} className="tpl-icon" aria-hidden="true">
      <path d={d[id]} fill="none" stroke="var(--copper)" strokeWidth="9" strokeLinejoin="round" strokeLinecap="round" />
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
  const [pendingDelete, setPendingDelete] = useState<Busbar | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const filtered = list.filter((p) => `${p.name} ${p.orderNo}`.toLowerCase().includes(q.toLowerCase()));
  const exportCurrent = async () => {
    const cur = projects[currentId];
    if (!cur) return;
    if (IN_FRAME) {
      try {
        await navigator.clipboard.writeText(JSON.stringify(cur, null, 2));
        setMsg('Projekt skopiowany do schowka jako JSON.');
      } catch {
        setMsg('Nie udało się skopiować. Otwórz aplikację w osobnej karcie.');
      }
      return;
    }
    const blob = new Blob([JSON.stringify(cur, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${cur.name.replace(/[^\w\-ąćęłńóśźż ]+/gi, '_')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <Dialog
      title="Projekty"
      width={1040}
      onClose={onClose}
      className="projects-dialog"
      footer={
        <>
          <label className="bb-btn bb-btn--secondary bb-btn--lg file-btn">
            <Icon name="import" />
            Import
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
                  setMsg('Nie udało się odczytać pliku. To nie jest plik JSON.');
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
          <button className="bb-btn bb-btn--secondary bb-btn--lg" onClick={() => void exportCurrent()}>
            <Icon name="export" />
            {IN_FRAME ? 'Kopiuj bieżący (JSON)' : 'Eksport bieżącego'}
          </button>
          {msg && <span className="foot-msg">{msg}</span>}
        </>
      }
    >
      <label className="bb-search">
        <Icon name="search" />
        <input placeholder="Szukaj: nazwa albo nr zlecenia" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="bb-projlist">
        {filtered.map((p) => (
          <div key={p.id} className={`bb-proj ${p.id === currentId ? 'is-current' : ''}`}>
            <button type="button" className="bb-proj-open" onClick={() => onOpen(p)}>
              <span className="bb-proj-name">{p.name}</span>
              <span className="bb-proj-meta">
                {sectionLabel(p.section)} ·{' '}
                {plural(p.steps.filter((s) => s.kind === 'bend').length, ['gięcie', 'gięcia', 'gięć'])}
              </span>
              <span className="bb-proj-meta">{p.orderNo || '—'}</span>
              <span className="bb-proj-meta">{new Date(p.updatedAt).toLocaleDateString('pl-PL')}</span>
            </button>
            <button type="button" className="bb-btn bb-btn--secondary" onClick={() => onOpen(duplicateBar(p))}>
              <Icon name="copy" />
              Kopiuj
            </button>
            <button
              type="button"
              className="bb-btn bb-btn--danger-quiet bb-proj-del"
              disabled={p.id === currentId}
              title={p.id === currentId ? 'Otwartego projektu nie można usunąć' : undefined}
              onClick={() => setPendingDelete(p)}
            >
              <Icon name="trash" />
              Usuń
            </button>
          </div>
        ))}
        {!filtered.length && <p className="bb-p">Brak projektów.</p>}
      </div>
      {pendingDelete && (
        <div className="bb-scrim bb-scrim--inner">
          <div className="bb-dialog" role="alertdialog" style={{ width: 520 }}>
            <div className="bb-dialog-body">
              <h2 className="bb-dialog-title">Usunąć projekt?</h2>
              <p className="bb-p">
                <b>{pendingDelete.name}</b> zniknie z tego tabletu (na serwerze trafi do kosza).
              </p>
            </div>
            <div className="bb-dialog-foot bb-foot-split">
              <button className="bb-btn bb-btn--secondary bb-btn--lg" onClick={() => setPendingDelete(null)}>
                Nie, zostaw
              </button>
              <button
                className="bb-btn bb-btn--danger bb-btn--lg"
                onClick={() => {
                  deleteProject(pendingDelete.id);
                  setPendingDelete(null);
                  setProjects(loadProjects());
                }}
              >
                <Icon name="trash" />
                Tak, usuń
              </button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** Instructions for a double bar: separate bending with the same tool, gap in the arcs. */
function doubleNote(assembly: Assembly): string {
  const worst = assembly.arcGaps.reduce<{ no: number; gap: number } | null>((m, g) => (!m || g.gap > m.gap ? g : m), null);
  const gapText = worst ? ` W łukach szyny nie przylegają: największa szczelina ${fmt(worst.gap)} mm (gięcie ${worst.no}).` : '';
  return (
    'Każdą szynę tnij i gnij osobno według jej własnej tabeli, tym samym narzędziem. Na prostych odcinkach szyny ' +
    'przylegają (lub mają zadany odstęp), a otwory wypadają na sobie.' +
    gapText
  );
}

function PartDocs({ part, settings, double }: { part: BarPart; settings: MachineSettings; double: boolean }) {
  const { bar, analysis } = part;
  return (
    <section className={`bb-card part-block part-${part.index}`}>
      <h3 className="bb-card-title">
        {double ? part.label : 'Rozwinięcie'}
        <span className="bb-card-sub">cięcie {fmt(analysis.flatLength)} mm</span>
      </h3>
      <Fit min={600}>{(w) => <FlatPatternSvg bar={bar} analysis={analysis} settings={settings} width={w} />}</Fit>
      <div className="bb-docgrid2">
        <div>
          <h4 className="sub-title">Gięcia</h4>
          <BendTable analysis={analysis} settings={settings} />
        </div>
        <div>
          <h4 className="sub-title">Otwory</h4>
          <HoleTable bar={bar} analysis={analysis} />
        </div>
      </div>
    </section>
  );
}

function A4Meta({ label, value, big }: { label: string; value: ReactNode; big?: boolean }) {
  return (
    <div className={`bb-tile ${big ? 'bb-tile--big' : ''}`}>
      <span className="bb-tile-label">{label}</span>
      <span className="bb-tile-value">{value}</span>
    </div>
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
  const p1 = assembly.parts[0];
  const errors = issues.some((i) => i.level === 'error');
  const printed = new Date().toLocaleDateString('pl-PL');
  const footer = (page: number) => (
    <div className="bb-a4-foot">
      <span>
        Wymiary {DIMENSION_MODE_LABEL[bar.dimensionMode]} · koniec A do zderzaka · R{fmt(settings.radius)} · K{' '}
        {fmt(settings.k, 3)} · sprężynowanie {fmt(settings.springbackPct)}% · {settings.machineName}
      </span>
      <span>
        Wydrukowano {printed} · strona {page}/{assembly.parts.length}
      </span>
    </div>
  );
  return (
    <div className="print-sheet" data-theme="light">
      <div className={`bb-a4 ${errors ? 'bb-doc--void' : ''}`}>
        {errors && (
          <div className="bb-banner bb-banner--stop print-stop">
            <Icon name="stop" size={28} />
            <span className="bb-banner-text">
              <strong>NIE DO PRODUKCJI</strong>
              <span className="bb-banner-sub"> {issues.find((i) => i.level === 'error')?.message}</span>
            </span>
          </div>
        )}
        <div className="bb-a4-head">
          <div className="bb-a4-title">
            <Mark size={28} />
            <div>
              <b>{bar.name}</b>
              <span className="bb-a4-sub">Karta operatora giętarki{double ? ' · podwójna szyna' : ''}</span>
            </div>
          </div>
          <div className="bb-a4-meta">
            {bar.orderNo && <A4Meta label="Zlecenie" value={bar.orderNo} />}
            <A4Meta label="Przekrój" value={sectionLabel(bar.section)} />
            <A4Meta label="Gięcia / otwory" value={`${p1.analysis.bends.length} / ${p1.analysis.holes.length}`} />
            <A4Meta
              big
              label={double ? 'Długość cięcia Sz.1 / Sz.2' : 'Długość cięcia'}
              value={`${assembly.parts.map((p) => fmt(p.analysis.flatLength)).join(' / ')} mm`}
            />
          </div>
        </div>
        <div className="bb-a4-grid">
          <div className="bb-a4-col">
            <section className="bb-card">
              <h3 className="bb-card-title">
                {double ? 'Gotowy układ (sprawdź po gięciu)' : 'Gotowa szyna (sprawdź po gięciu)'}
              </h3>
              <ProfileView project={bar} assembly={assembly} width={420} maxHeight={300} />
            </section>
            {snapshot && (
              <section className="bb-card print-3d-card">
                <h3 className="bb-card-title">Widok 3D</h3>
                <img src={snapshot} className="print-3d" alt="Widok 3D" />
              </section>
            )}
          </div>
          <div className="bb-a4-col">
            <section className="bb-card">
              <h3 className="bb-card-title">Rozwinięcie{double ? ` – ${p1.label}` : ''}</h3>
              <FlatPatternSvg bar={p1.bar} analysis={p1.analysis} settings={settings} width={600} />
            </section>
            <section className="bb-card">
              <h3 className="bb-card-title">Gięcia{double ? ` – ${p1.label}` : ''}</h3>
              <BendTable analysis={p1.analysis} settings={settings} print />
            </section>
            {p1.analysis.holes.length > 0 && (
              <section className="bb-card">
                <h3 className="bb-card-title">Otwory</h3>
                <HoleTable bar={p1.bar} analysis={p1.analysis} print />
              </section>
            )}
            {(double || issues.length > 0) && (
              <div className="print-notes">
                {double && <div>Podwójna szyna: {doubleNote(assembly)}</div>}
                {issues.map((i, k) => (
                  <div key={k} className={i.level === 'error' ? 'print-error' : ''}>
                    {i.level === 'error' ? 'Błąd: ' : 'Uwaga: '}
                    {i.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {footer(1)}
      </div>
      {assembly.parts.slice(1).map((part) => (
        <div key={part.index} className={`bb-a4 ${errors ? 'bb-doc--void' : ''}`}>
          <div className="bb-a4-head">
            <div className="bb-a4-title">
              <Mark size={28} />
              <div>
                <b>
                  {bar.name} – {part.label}
                </b>
                <span className="bb-a4-sub">Karta operatora giętarki · podwójna szyna</span>
              </div>
            </div>
            <div className="bb-a4-meta">
              <A4Meta label="Gięcia / otwory" value={`${part.analysis.bends.length} / ${part.analysis.holes.length}`} />
              <A4Meta big label="Długość cięcia" value={`${fmt(part.analysis.flatLength)} mm`} />
            </div>
          </div>
          <section className="bb-card">
            <h3 className="bb-card-title">Rozwinięcie – {part.label}</h3>
            <FlatPatternSvg bar={part.bar} analysis={part.analysis} settings={settings} width={1050} />
          </section>
          <section className="bb-card">
            <h3 className="bb-card-title">Gięcia – {part.label}</h3>
            <BendTable analysis={part.analysis} settings={settings} print />
          </section>
          {part.analysis.holes.length > 0 && (
            <section className="bb-card">
              <h3 className="bb-card-title">Otwory</h3>
              <HoleTable bar={part.bar} analysis={part.analysis} print />
            </section>
          )}
          <span className="bb-spacer" />
          {footer(part.index)}
        </div>
      ))}
    </div>
  );
}
