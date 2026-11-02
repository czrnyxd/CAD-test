import { useState } from 'react';
import { connect, disconnect, syncNow, useSync, type SyncState } from '../sync';

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

  return (
    <div className="card server-card">
      <h3>Serwer – zapis projektów</h3>
      <p className={`server-state server-${state}`}>
        {state === 'error' && message ? message : STATE_LABEL[state]}
        {lastSync && state !== 'off' && (
          <span className="muted"> Ostatnia synchronizacja: {new Date(lastSync).toLocaleTimeString('pl-PL')}</span>
        )}
      </p>
      <div className="fields">
        <label className="field">
          <span className="field-label">Adres serwera (puste = ten, z którego otwarto aplikację)</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://cad.twojadomena.pl" inputMode="url" />
        </label>
        <label className="field">
          <span className="field-label">Kod dostępu</span>
          <input value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" />
        </label>
      </div>
      <div className="modal-actions server-actions">
        {config && (
          <>
            <button className="btn-secondary" onClick={() => void syncNow()}>
              ⟳ Synchronizuj teraz
            </button>
            <button
              className="btn-secondary"
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
          className="btn-primary"
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
      {result && <p className="muted">{result}</p>}
      <p className="muted">
        Projekty i tak zapisują się najpierw na tym urządzeniu, więc aplikacja działa bez internetu. Serwer przechowuje poprzednie
        wersje każdego projektu i usunięte projekty (kosz).
      </p>
    </div>
  );
}

/** Small indicator for the status bar. */
export function SyncBadge({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { state, lastSync } = useSync();
  if (state === 'off') return null;
  const text =
    state === 'ok'
      ? `☁ Zapisano na serwerze${lastSync ? ` ${new Date(lastSync).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}` : ''}`
      : state === 'syncing'
        ? '☁ Zapisywanie…'
        : state === 'offline'
          ? '⚠ Offline – zapis lokalny'
          : state === 'auth' || state === 'detected'
            ? '☁ Podaj kod dostępu'
            : '⚠ Błąd serwera';
  return (
    <button className={`sync-badge sync-${state}`} onClick={onOpenSettings} title="Ustawienia serwera">
      {text}
    </button>
  );
}
