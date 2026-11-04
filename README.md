# BusBar CAD: prototyp

Wczesny prototyp aplikacji na tablet do projektowania giętych szyn miedzianych. Plan całości: [PLAN.md](PLAN.md).

## Uruchomienie

```bash
npm install
npm run dev        # serwer deweloperski, dostępny też w sieci lokalnej (np. z tabletu)
npm test           # testy obliczeń i geometrii
npm run lint       # formatowanie (Prettier) i typy
npm run format     # automatyczne formatowanie kodu
npm run build      # wersja produkcyjna w katalogu dist/ (statyczne pliki)
```

Po `npm run dev` otwórz na tablecie adres `http://<ip-komputera>:5173`.

## Serwer projektów (VPS)

`server/server.mjs` (Node, bez zależności) przechowuje projekty i wspólne ustawienia maszyny jako pliki JSON, z historią wersji i koszem, i jednocześnie serwuje aplikację. Dostęp chroni kod dostępu (`API_TOKEN`). Aplikacja zapisuje zawsze najpierw lokalnie, a gdy jest połączenie, synchronizuje się z serwerem (Ustawienia → Serwer; status na pasku stanu). Wdrożenie Dockerem obok innych usług: **[docs/DEPLOY.md](docs/DEPLOY.md)**.

```bash
API_TOKEN=tajny-kod npm run server   # lokalnie: aplikacja + API na http://localhost:8080
```

## Wersja online (GitHub Pages)

Każdy push na `master` buduje aplikację i publikuje ją pod adresem **https://czrnyxd.github.io/CAD-test/** (workflow `.github/workflows/pages.yml`).

Jednorazowa konfiguracja na github.com (da się zrobić z telefonu):
1. **Settings → General → Danger Zone → Change visibility → Public** (Pages na darmowym koncie działa tylko dla publicznych repozytoriów).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. **Actions → Deploy to GitHub Pages → Run workflow** (albo dowolny nowy push).

Na telefonie lub tablecie możesz potem dodać stronę do ekranu głównego („Dodaj do ekranu głównego”), żeby otwierała się jak aplikacja. Po pierwszym otwarciu aplikacja działa także **bez internetu** (service worker), a po powrocie sieci sama pobiera nowszą wersję.

## Co działa

- **Edytor kroków:** odcinki i gięcia płaskie (przez grubość szyny). Wartości wpisuje się na dużej klawiaturze numerycznej (na tablecie poziomo wysuwa się z prawej, więc model zostaje widoczny) z szybkimi kątami i przyciskiem **„OK i dalej”** (przejście do następnego pola). Kąt to „o ile giąć” (odchylenie od prostej) – klawiatura pokazuje to na rysunku. Usunięcie kroku pokazuje komunikat z „Cofnij”; licznik błędów na dole przenosi do błędnego kroku. Kierunek gięcia wybiera się przyciskami ↑ w górę / ↓ w dół. Nowe gięcie wstawia się za zaznaczonym odcinkiem.
- **Otwory:** okrągłe i fasolki na odcinkach prostych. Pozycja wzdłuż odcinka (tak jak jego wymiar), średnica, długość fasolki i przesunięcie od osi. W modelu 3D otwory są przelotowe (ze ściankami, widać przez nie na wylot) i mają numery O1, O2… zgodne z tabelą. Na rozwinięciu są wymiary od końca A i osobna tabela otworów. Aplikacja ostrzega, gdy otwór jest w strefie gięcia, za blisko gięcia albo poza szerokością szyny.
- **Podwójna szyna:** dwie szyny, które po wygięciu składa się razem (druga nad albo pod pierwszą, z opcjonalnym odstępem). Obie gnie się **osobno, tym samym narzędziem** (promień R w każdym gięciu). Aplikacja wylicza długości odcinków szyny 2 tak, żeby jej proste odcinki były równoległe do szyny 1 w odległości grubość + odstęp: w każdym gięciu odcinki szyny wewnętrznej są krótsze, a zewnętrznej dłuższe o d·tan(kąt/2). Otwory wypadają dokładnie na sobie. W łukach szyny nie przylegają, a aplikacja podaje największą szczelinę. Każda szyna ma własną długość cięcia, tabelę gięć i otworów oraz rysunek. Wymiary wpisuje się dla szyny 1.
- **Model 3D:**
  - obrót jednym palcem, zoom i przesuwanie dwoma,
  - widoki ISO/Przód/Góra/Bok i automatyczne dopasowanie kadru,
  - tap na szynę zaznacza krok,
  - linie wymiarowe ramion jak na rysunku technicznym: pomarańczowe punkty pokazują, skąd dokąd liczony jest wymiar (zależnie od trybu: zewnętrzny / wewnętrzny ostry narożnik albo oś), przerywane linie przedłużają ściany do ostrego narożnika,
  - oznaczenie końca **A**.
- **Pomiar:** punkt–punkt z przyciąganiem do narożników, środków otworów, końców i **punktów wymiarów** (ostrych narożników – można zmierzyć dokładnie wpisany wymiar). Punkty mają stały rozmiar na ekranie i kształt zależny od rodzaju (narożnik – kwadrat, punkt wymiaru – pomarańczowy romb, otwór – kółko z krzyżykiem, środek końca – zielone kółko); punkty po niewidocznej stronie szyny są przygaszone. **Przytrzymanie palca** (ok. 0,3 s) otwiera lupę nad palcem (powiększenie 3×, krzyżyk, podpis punktu): przesuwanie palca zmienia punkt, puszczenie go wybiera, drugi palec anuluje. Zwykłe tapnięcie i obrót działają jak wcześniej. Przycisk „Inny punkt” przełącza na sąsiedni punkt bez ponownego celowania; wynik z ΔX/ΔY/ΔZ w karcie w rogu widoku.
- **Obliczenia:**
  - naddatek na gięcie (BA), setback i długość rozwinięcia,
  - pozycje linii gięć (początek, środek lub koniec łuku),
  - nastawa kąta z korektą sprężynowania,
  - wymiarowanie po zewnętrznej (domyślnie), wewnętrznej lub po osi; w Ustawieniach rysunek objaśniający wybrany tryb i długość cięcia projektu w każdym trybie.
- **Walidacje:** za krótkie odcinki, minimalne ramię, minimalny promień, długość handlowa, kolizja szyny z samą sobą, otwory nachodzące na siebie lub z za cienkim mostkiem materiału (do krawędzi, końca, innego otworu). Projekt z błędami ma na rozwinięciu i wydruku oznaczenie „NIE DO PRODUKCJI”.
- **Rozwinięcie:**
  - rysunek gotowej szyny (widok z przodu, w skali) z wymiarami ramion i kątami – do sprawdzenia po gięciu,
  - rozwinięcie: widok na górną stronę szyny (↑ = gięcie w stronę patrzącego), wymiary łańcuchowe i od bazy, strefy gięć, otwory,
  - tabela gięć dla operatora z kolumną **„Ułożenie szyny”**: szynę wkłada się końcem A do zderzaka, a przed gięciem w przeciwną stronę niż poprzednie obraca się ją („↻ obróć szynę”); na telefonie tabela jako karty.
- **Wydruk A4 / PDF:** nagłówek zlecenia, rysunek gotowej szyny z wymiarami, widok 3D, rozwinięcie, tabela gięć i otworów (pojedyncza szyna na 1 stronie).
- **Projekty:** autozapis w przeglądarce (localStorage, z ostrzeżeniem gdy zapis się nie uda), lista projektów, kopiowanie, eksport i import JSON, cofnij/ponów. Import sprawdza dane: odrzuca plik bez poprawnego przekroju lub odcinków, a każdą poprawkę (np. przy projekcie ze starszej wersji) pokazuje do sprawdzenia.
- **Przekroje:** lista typowych przekrojów Cu oraz **„Inny przekrój…”** (na liście u góry; w oknie nowej szyny pola rozwijają się w tym samym oknie): szerokość 5–300 mm, grubość 1–50 mm (mniejsza od szerokości), podgląd przekroju w skali. Własne przekroje są zapamiętywane na liście.
- **Ustawienia maszyny:** nazwa maszyny, promień narzędzia (z przyciskiem „ustaw we wszystkich gięciach projektu”), K, sprężynowanie, minimalne ramię, punkt odniesienia gięcia.

## Szafa (odniesienie)

Przycisk **Szafa** nad listą kroków: rama szafy z polami, położenie końca A, kierunek szyny,
fazy L1–L3 (+N) z rozstawem. Model pokazuje szynę w ramie, kolejne fazy, najmniejszy odstęp od
ramy i kolizje (na czerwono). Służy tylko do sprawdzenia – nie zmienia szyny ani rozwinięcia.

## Wygląd (system projektowy)

Interfejs korzysta z systemu projektowego „BusBar CAD”: tokeny kolorów, odstępów i typografii w `src/tokens.css`, style komponentów (`bb-*`) w `src/design.css`, układ aplikacji w `src/styles.css`. Krój Barlow jest dołączony do aplikacji (pakiety `@fontsource`), więc działa bez internetu. Zasady: obrys = „stuknij, by zmienić”, szare tło bez obrysu = wynik obliczeń, niebieskie wypełnienie = wybrane / główna akcja, miedź tylko dla szyny. Układy: tablet poziomo (model po lewej, kroki 460 px po prawej, klawiatura na miejscu panelu), tablet pionowo i telefon (nagłówek w 2 rzędach), wydruk A4 poziomo.

## Struktura

```
src/core/      model danych, obliczenia gięć, geometria 3D (bez UI, z testami)
src/ui/        widok 3D (three.js), lista kroków, klawiatura, rozwinięcie, ikony i kontrolki systemu projektowego
src/store.ts   stan aplikacji, historia cofnij/ponów, zapis lokalny
```

## Ograniczenia prototypu

- Współczynniki K i sprężynowania to wartości przykładowe. Trzeba je skalibrować na próbkach z maszyny.
- Brak eksportu DXF i kreatora kalibracji. To kolejne etapy z planu.
- Kierunki „w górę/w dół” są liczone względem szyny w chwili gięcia. Do ustalenia z operatorem, jak to przełożyć na ułożenie szyny w maszynie.
- Giętarka robi tylko gięcia płaskie, więc gięć na kant i skrętów celowo nie ma. Starsze projekty z nimi są przy wczytaniu konwertowane (gięcie na kant staje się płaskim, strefa skrętu jest doliczana do odcinka) i aplikacja prosi o sprawdzenie projektu.
