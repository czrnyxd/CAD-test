import { useState } from 'react';
import { connect, disconnect, syncNow, useSync, type SyncState } from '../sync';
import { Notice } from './controls';
import { Icon } from './Icon';

const STATE_LABEL: Record<SyncState, string> = {
  off: 'Nie połączono – projekty są tylko na tym urządzeniu.',
  detected: 'Serwer dostępny – wpisz kod dostępu.',
  syncing: 'Synchronizacja…',
  ok: 'Połączono – projekty są zapisywane na serwerze.',
  offline: 'Brak połączenia – projekty zapisują się na tym urządzeniu i zostaną wysłane później.',
  auth: 'Nieprawidłowy kod dostępu.',
  error: 'Błąd synchronizacji.',
};

/** Ustawienia → Serwer: where projects are saved. */
export function ServerSettings() {
  const { state, lastSync, message, config } = useSync();
  const [url, setUrl] = useState(config?.url ?? '');
  const [token, setToken] = useState(config?.token ?? '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const tone =
    state === 'ok' ? 'ok' : state === 'auth' || state === 'error' ? 'danger' : state === 'offline' ? 'warning' : 'info';
  return (
    <section className="bb-card server-card">
      <h3 className="bb-card-title">Serwer – zapis projektów</h3>
      <Notice tone={tone}>
        {state === 'error' && message ? message : STATE_LABEL[state]}
        {lastSync && state !== 'off' && ` Ostatnia synchronizacja ${new Date(lastSync).toLocaleTimeString('pl-PL')}.`}
      </Notice>
      <label className="bb-chip bb-input">
        <span className="bb-chip-label">Adres serwera (puste = ten, z którego otwarto aplikację)</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://cad.twojadomena.pl" inputMode="url" />
      </label>
      <label className="bb-chip bb-input">
        <span className="bb-chip-label">Kod dostępu</span>
        <input value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" />
      </label>
      <div className="bb-row server-actions">
        {config && (
          <>
            <button className="bb-btn bb-btn--secondary" onClick={() => void syncNow()}>
              <Icon name="rotate" />
              Synchronizuj
            </button>
            <button
              className="bb-btn bb-btn--secondary"
              onClick={() => {
                disconnect();
                setResult('Odłączono. Projekty zostają na tym urządzeniu.');
              }}
            >
              Odłącz
            </button>
          </>
        )}
        <button
          className="bb-btn bb-btn--primary bb-grow"
          disabled={busy || !token.trim()}
          onClick={async () => {
            setBusy(true);
            const r = await connect({ url: url.trim(), token: token.trim() });
            setResult(r.message);
            setBusy(false);
          }}
        >
          {config ? 'Zapisz i połącz ponownie' : 'Połącz'}
        </button>
      </div>
      {result && <p className="bb-p">{result}</p>}
      <p className="bb-p">
        Projekty zapisują się najpierw na tym urządzeniu, więc aplikacja działa bez internetu. Serwer przechowuje poprzednie
        wersje każdego projektu i usunięte projekty (kosz).
      </p>
    </section>
  );
}

/** Small indicator for the status bar. */
export function SyncBadge({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { state, lastSync } = useSync();
  if (state === 'off') return null;
  const time = lastSync ? new Date(lastSync).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '';
  const [icon, text] =
    state === 'ok'
      ? (['cloud', `Na serwerze ${time}`] as const)
      : state === 'syncing'
        ? (['cloud', 'Zapisywanie…'] as const)
        : state === 'offline'
          ? (['offline', 'Offline, zapis lokalny'] as const)
          : state === 'auth' || state === 'detected'
            ? (['cloud', 'Podaj kod dostępu'] as const)
            : (['warn', 'Błąd serwera'] as const);
  return (
    <button className={`bb-st-item sync-badge sync-${state}`} onClick={onOpenSettings}>
      <span className="bb-st-cap">Zapis</span>
      <span className="sync-val">
        <Icon name={icon} size={20} />
        {text}
      </span>
    </button>
  );
}
