import { Dialog } from './Dialog';

const GROUPS: [string, [string[], string][]][] = [
  [
    'Kroki (zakładka Model 3D)',
    [
      [['↑', '↓'], 'poprzedni / następny krok'],
      [['Enter'], 'zmień wartość zaznaczonego kroku'],
      [['Insert'], 'dodaj gięcie za zaznaczonym odcinkiem'],
      [['Delete'], 'usuń zaznaczony krok'],
      [['Esc'], 'odznacz krok'],
    ],
  ],
  [
    'Wpisywanie wartości',
    [
      [['Enter'], 'zapisz i przejdź do następnej wartości'],
      [['Shift', 'Enter'], 'zapisz bez przechodzenia dalej'],
      [['↑', '↓'], 'zwiększ / zmniejsz o 1 (z Shift o 10)'],
      [['Esc'], 'anuluj'],
    ],
  ],
  [
    'Model',
    [
      [['1'], 'widok ISO'],
      [['2'], 'przód'],
      [['3'], 'góra'],
      [['4'], 'bok'],
      [['F'], 'dopasuj do okna'],
      [['W'], 'wymiary wł. / wył.'],
      [['M'], 'pomiar wł. / wył.'],
      [['Mysz'], 'lewy – obrót, prawy – przesuwanie, kółko – powiększenie'],
    ],
  ],
  [
    'Ogólne',
    [
      [['Ctrl', 'Z'], 'cofnij'],
      [['Ctrl', 'Y'], 'ponów'],
      [['Ctrl', 'P'], 'drukuj'],
      [['Ctrl', '+'], 'powiększ cały ekran (Ctrl − zmniejsza)'],
      [['F1'], 'ta lista'],
    ],
  ],
];

/** List of keyboard shortcuts (F1). */
export function KeysDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Skróty klawiszowe" width={900} onClose={onClose}>
      <div className="keys-grid">
        {GROUPS.map(([title, rows]) => (
          <section key={title} className="keys-group">
            <h3 className="bb-card-title">{title}</h3>
            <dl className="keys-list">
              {rows.map(([keys, what]) => (
                <div key={keys.join('+') + what} className="keys-row">
                  <dt>
                    {keys.map((k, i) => (
                      <span key={k}>
                        {i > 0 && (keys[0] === '↑' ? ' ' : ' + ')}
                        <kbd>{k}</kbd>
                      </span>
                    ))}
                  </dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
