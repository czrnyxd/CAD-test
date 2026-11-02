# BusBar CAD: plan aplikacji do projektowania giętych szyn miedzianych

## 1. Cel i założenia

Aplikacja działa na tablecie przy giętarce do szyn. Pracownik w kilka minut:

1. wybiera szynę (np. Cu 40×10),
2. buduje jej kształt z kolejnych odcinków i gięć,
3. widzi model 3D i sprawdza wymiary,
4. dostaje **rozwinięcie (płaski wzór)** z wymiarami do gięć i drukuje/eksportuje dokumentację.

**Zasady nadrzędne:**
- **Banalna obsługa.** Pracownik nie rysuje szkicu jak w klasycznym CAD. Szynę opisuje jak instrukcję: *odcinek, gięcie, odcinek, gięcie...* Model 3D generuje się sam.
- **Dokładność.** Wszystkie obliczenia w mm, z dokładnością do 0,1 mm, z uwzględnieniem promienia gięcia, współczynnika K i sprężynowania, skalibrowanych dla **tej konkretnej maszyny**.
- **Tablet przy maszynie.** Duże przyciski (min. 48–56 px), wysoki kontrast, obsługa w rękawicach, praca offline, bez klawiatury (własna klawiatura numeryczna na ekranie).

---

## 2. Kluczowa decyzja: model parametryczny zamiast swobodnego CAD

Szyna gięta jest w istocie **łańcuchem**: prosty odcinek, gięcie, prosty odcinek... (podobnie jak w gięciu rur: system LRA, czyli Length–Rotation–Angle). Dzięki temu:

- nie potrzebujemy ciężkiego silnika CAD (B-rep, OpenCascade itp.),
- geometria 3D, rozwinięcie i wymiary są **wyliczane z tej samej listy kroków**, więc nie ma rozbieżności między rysunkiem a modelem,
- interfejs to prosta lista kroków, którą można edytować palcem.

### Rodzaje operacji

> **Aktualizacja:** giętarka na stanowisku wykonuje tylko **gięcia płaskie**. Gięcia na kant i skręty zostały usunięte z aplikacji. Poniższa tabela zostaje jako ewentualna rozbudowa przy innej maszynie.


| Operacja | Opis | Parametry |
|---|---|---|
| **Odcinek prosty** | prosta część szyny | długość [mm] |
| **Gięcie płaskie** („na płasko”) | gięcie przez grubość T | kąt, kierunek (góra/dół), promień wewn. R |
| **Gięcie na kant** („na żebro”) | gięcie przez szerokość W | kąt, kierunek (lewo/prawo), promień R |
| **Skręt** | obrót szyny wokół osi (zwykle 90°) | kąt, długość strefy skrętu |
| **Otwór / fasolka** (etap 2) | otwory pod śruby | pozycja, średnica / wymiary owalu |
| **Ścięcie / zaokrąglenie końca** (etap 2) | obróbka końców | typ, wymiar |

---

## 3. Ekrany i przepływ pracy (UX)

```
[Start] -> [Nowa szyna: materiał i przekrój] -> [Edytor kształtu] -> [Rozwinięcie i dokumentacja] -> [Druk / PDF / zapis]
```

### 3.1 Ekran startowy
- Duże kafle: **Nowa szyna**, **Ostatnie projekty**, **Szablony** (np. „Z”, „U”, „L”, „offset”).
- Wyszukiwanie po numerze zlecenia / nazwie.

### 3.2 Wybór szyny
- Lista przekrojów z biblioteki: 20×5, 30×5, 30×10, 40×10, 50×10, 60×10, 80×10, 100×10... (konfigurowalna przez kierownika).
- Materiał: Cu-ETP (miedź), opcjonalnie Al.
- Narzędzie/matryca na maszynie (określa promień gięcia).

### 3.3 Edytor kształtu (ekran główny)
Podział ekranu (tablet poziomo):

```
+------------------------------+-------------------------+
|                              |  KROKI                  |
|        WIDOK 3D              |  1. Odcinek   150 mm    |
|   (obrót 1 palcem,           |  2. Gięcie ↑  90°       |
|    zoom 2 palcami)           |  3. Odcinek   200 mm  ◄ |
|                              |  4. Gięcie na kant → 45°|
|                              |  5. Odcinek   120 mm    |
|  [Widoki: Przód Bok Góra ISO]|  [+ Odcinek] [+ Gięcie] |
|  [Zmierz]                    |  [+ Skręt]   [Cofnij]   |
+------------------------------+-------------------------+
| Długość rozwinięcia: 492,6 mm   ⚠ Za krótki odcinek 3   |
+--------------------------------------------------------+
```

- Kliknięcie kroku na liście **podświetla** go w 3D i odwrotnie (tap na odcinek w 3D wybiera krok).
- Edycja wartości: duża klawiatura numeryczna + szybkie przyciski kątów (15°, 30°, 45°, 60°, 90°).
- Kierunek gięcia wybierany **strzałkami pokazanymi na modelu 3D**, nie słowami.
- Na bieżąco: długość rozwinięcia, ostrzeżenia (za krótki odcinek między gięciami, promień poniżej minimum, kolizja szyny z samą sobą).
- Cofnij / Ponów bez limitu.

### 3.4 Pomiary
- Tryb **Zmierz**: tap w 2 punkty (przyciąganie do narożników, krawędzi, osi, środków otworów), wynik: odległość oraz składowe ΔX/ΔY/ΔZ.
- Pomiar kąta między dwoma ścianami.
- **Wymiary automatyczne**: wymiary gabarytowe i wymiary zewnętrzne każdego ramienia widoczne od razu.
- Przełącznik konwencji wymiarowania: **po zewnętrznej / po wewnętrznej / po osi** (pracownik mierzy zwykle miarką po zewnętrznej, więc to domyślne).

### 3.5 Rozwinięcie i dokumentacja
- Płaski widok szyny w skali z:
  - całkowitą **długością cięcia**,
  - **liniami gięcia** z wymiarem od początku szyny (łańcuchowym i od bazy),
  - przy każdej linii: nr gięcia, kąt, kierunek (↑/↓, ←/→), typ (płaskie/kant), promień,
  - strefami skrętu, otworami (etap 2).
- **Tabela gięć dla operatora** w kolejności wykonywania:

| Nr | Pozycja od początku | Typ | Kąt | Kierunek | Ustaw. maszyny (z korektą) |
|---|---|---|---|---|---|
| 1 | 148,3 mm | płaskie | 90° | ↑ | 92,5° |
| 2 | 341,7 mm | kant | 45° | → | 46,0° |

- Arkusz A4: nagłówek (nr zlecenia, nazwa, przekrój, materiał, ilość, autor, data, wersja), widok 3D izometryczny, widoki główne z wymiarami, rozwinięcie, tabela gięć.
- Eksport: **PDF** (druk), **DXF** rozwinięcia (np. do wykrawarki/plotera), **PNG**, plik projektu JSON.

---

## 4. Obliczenia (rdzeń dokładności)

Oznaczenia: T to grubość, W to szerokość, R to promień wewnętrzny, A to kąt gięcia (o ile zagięto, nie kąt zawarty), K to współczynnik położenia warstwy obojętnej (dla miedzi typowo 0,33–0,45, **kalibrowany**).

Dla gięcia płaskiego „grubością gięcia” jest T, dla gięcia na kant jest W (oznaczmy ją jako `t_g`).

- **Naddatek na gięcie (długość łuku warstwy obojętnej):**
  `BA = A·π/180 · (R + K·t_g)`
- **Odsunięcie zewnętrzne:**
  `OSSB = (R + t_g) · tan(A/2)`
- **Odjęcie na gięcie:**
  `BD = 2·OSSB − BA`
- **Długość rozwinięcia** (przy wymiarach zewnętrznych ramion `L_i`):
  `L_flat = Σ L_i − Σ BD_j`
- **Pozycja linii gięcia** na płasko: suma odcinków prostych przed gięciem + połowa BA (środek łuku). Punkt odniesienia (początek łuku / środek / koniec) zależy od tego, jak operator ustawia zderzak, więc jest **ustawieniem maszyny**.
- **Sprężynowanie:** kąt nastawy = kąt docelowy + korekta(kąt, przekrój, narzędzie), z tabeli kalibracyjnej z interpolacją.
- **Skręt:** strefa skrętu o długości min. ok. 2×W (konfigurowalne). Długość osi praktycznie bez zmian, opcjonalna korekta z kalibracji.

### Kalibracja maszyny (kreator)
1. Operator gnie próbkę o znanej długości cięcia (np. 300 mm, gięcie 90°).
2. Mierzy oba ramiona i rzeczywisty kąt.
3. Aplikacja wylicza rzeczywiste K (lub bezpośrednio BD) i korektę sprężynowania dla tego przekroju i narzędzia.
4. Wyniki zapisywane w tabeli `przekrój × narzędzie × typ gięcia`.

Tryb alternatywny: **tabela BD wpisana ręcznie** (wiele zakładów ma takie wartości z doświadczenia).

### Walidacje
- minimalny promień gięcia (np. płaskie R ≥ T, kant R ≥ 1–1,5·W, konfigurowalne),
- minimalne ramię między gięciami (wynika z matrycy/zderzaka maszyny),
- maksymalna długość szyny (długość handlowa, np. 4000 mm),
- kolizja szyny z samą sobą (prosty test odcinków/prostopadłościanów),
- (etap 3) kolizja z maszyną w danej kolejności gięć.

---

## 5. Architektura techniczna

**Rekomendacja: aplikacja webowa PWA** (działa w przeglądarce tabletu, instaluje się jak aplikacja, działa offline). Jeden kod na Android, iPad i Windows, bez sklepu z aplikacjami, aktualizacje bez instalacji.

| Warstwa | Technologia |
|---|---|
| Język | TypeScript |
| UI | React + Vite, prosty system komponentów pod dotyk |
| 3D | Three.js (przez React Three Fiber + drei) |
| Stan i undo/redo | Zustand + historia poleceń (immutable) |
| Rdzeń geometrii | czysty moduł TS bez zależności od UI (łatwy do testów) |
| Rysunek 2D / rozwinięcie | SVG generowane z rdzenia |
| PDF | jsPDF + svg2pdf (lub druk HTML przez `window.print`) |
| DXF | prosty własny eksporter (LINE/ARC/TEXT/DIMENSION) |
| Dane lokalne | IndexedDB (Dexie), eksport/import JSON |
| Offline | Service Worker (vite-plugin-pwa) |
| Testy | Vitest (obliczenia), Playwright (UI na rozdzielczości tabletu) |
| Opcja natywna | Capacitor, jeśli potrzebny dostęp do drukarki/USB lub kiosk mode |

### Struktura modułów

```
src/
  core/              # bez React, w 100% testowalne
    model.ts         # typy: Busbar, Step, Material, MachineProfile
    bending.ts       # BA, BD, K, sprężynowanie
    geometry.ts      # łańcuch kroków -> ścieżka 3D (ramki, łuki, skręty)
    mesh.ts          # ścieżka -> siatka (wyciągnięcie prostokąta po ścieżce)
    flatPattern.ts   # rozwinięcie + linie gięć + tabela gięć
    validate.ts      # walidacje i ostrzeżenia
    measure.ts       # przyciąganie, pomiary
  export/
    pdf.ts  dxf.ts  json.ts
  ui/
    screens/ (Start, Section, Editor, FlatPattern, Settings, Calibration)
    components/ (NumPad, StepList, Viewer3D, DimensionOverlay, BigButton)
  store/
  db/
```

### Model danych (szkic)

```ts
type Section = { width: number; thickness: number; material: 'Cu' | 'Al' };

type Step =
  | { kind: 'straight'; length: number }
  | { kind: 'bend'; plane: 'flat' | 'edge'; angle: number;
      direction: 'up' | 'down' | 'left' | 'right'; radius: number }
  | { kind: 'twist'; angle: number; length: number }
  | { kind: 'hole'; position: number; offset: number; diameter: number; slot?: number };

type Busbar = {
  id: string; name: string; orderNo?: string; quantity: number;
  section: Section; toolId: string;
  dimensionMode: 'outside' | 'inside' | 'centerline';
  steps: Step[];
  createdAt: string; updatedAt: string; revision: number;
};

type MachineProfile = {
  id: string; name: string;
  tools: { id: string; name: string; radiusFlat: number; radiusEdge: number }[];
  calibration: { sectionKey: string; toolId: string; plane: 'flat' | 'edge';
                 kFactor?: number; bdTable?: { angle: number; bd: number }[];
                 springback: { angle: number; correction: number }[] }[];
  minLeg: number; bendLineReference: 'start' | 'center' | 'end';
};
```

### Generowanie geometrii 3D
- Ramka lokalna (położenie + orientacja T/N/B) przesuwana krok po kroku:
  - odcinek: przesunięcie wzdłuż osi,
  - gięcie płaskie: łuk wokół osi szerokości (oś obrotu równoległa do W),
  - gięcie na kant: łuk wokół osi grubości,
  - skręt: obrót przekroju wokół osi szyny na długości strefy.
- Siatka: wyciągnięcie prostokąta W×T po ścieżce (łuki dzielone na N segmentów). Dla kilkunastu gięć to kilka tysięcy trójkątów, płynnie na każdym tablecie.
- Krawędzie (linie) rysowane osobno dla czytelności i przyciągania pomiaru.

---

## 6. Etapy realizacji

### Etap 0: Walidacja z produkcją (1 tydzień)
- Rozmowa z operatorem i technologiem: typ maszyny, jak ustawia się zderzak, jak dziś wygląda dokumentacja, typowe przekroje, czy używane są tabele BD.
- Zebranie 5–10 prawdziwych szyn (rysunki + zmierzone gotowe detale) jako **przypadki testowe**.
- Wybór tabletu (zalecane ≥ 11", np. Android z rysikiem, osłona przemysłowa).

### Etap 1: MVP (4–6 tygodni)
- Biblioteka przekrojów i jedno narzędzie.
- Odcinki + gięcia płaskie + gięcia na kant.
- Widok 3D z gestami, widoki standardowe, wymiary automatyczne.
- Rozwinięcie z długością cięcia i pozycjami gięć, tabela gięć.
- Ręczna tabela K / BD i korekt sprężynowania.
- Druk PDF A4, zapis lokalny, praca offline.
- Testy jednostkowe obliczeń na przypadkach z produkcji (tolerancja ±0,5 mm).

### Etap 2: Produkcja (3–4 tygodnie)
- Skręty, otwory i fasolki, obróbka końców.
- Narzędzie pomiaru punkt–punkt i kąta.
- Kreator kalibracji maszyny.
- Szablony kształtów, duplikowanie projektów, numery rewizji.
- Eksport DXF, kod QR na wydruku (otwiera projekt).
- Tryb kierownika (PIN): edycja bibliotek i kalibracji; tryb operatora: tylko projekty.

### Etap 3: Rozszerzenia (opcjonalnie)
- Symulacja kolejności gięć i kolizji z maszyną.
- Synchronizacja z serwerem / współdzielenie projektów między stanowiskami.
- Import zlecenia (CSV / ERP), eksport programu bezpośrednio do sterownika giętarki (jeśli maszyna ma CNC i znany format).
- Wyliczanie zużycia materiału i nestingu z długości handlowych.

---

## 7. Ryzyka i jak je ograniczyć

| Ryzyko | Ograniczenie |
|---|---|
| Rozbieżność obliczonej długości z rzeczywistą | kalibracja per maszyna/narzędzie/przekrój, testy na realnych detalach |
| Różne konwencje wymiarowania (zewn./wewn./oś) | jawny przełącznik, widoczny na wydruku |
| Niejasny kierunek gięcia dla operatora | strzałki na modelu i na rozwinięciu, oznaczenie strony „A” szyny (znacznik na początku) |
| Za trudny interfejs | testy z operatorem przy maszynie po każdym etapie, max 3 tapnięcia na dodanie gięcia |
| Brak sieci na hali | PWA offline-first, dane w IndexedDB, eksport plików |
| Utrata danych na tablecie | automatyczny zapis, eksport/backup JSON, w etapie 3 synchronizacja |

---

## 8. Pytania do ustalenia przed startem

1. Jaka giętarka (producent/model)? Czy ma CNC lub zderzak z odczytem pozycji?
2. Od czego operator mierzy pozycję gięcia: od początku łuku, od środka, od znacznika na matrycy?
3. Jakie przekroje i promienie narzędzi są używane?
4. Czy wykonuje się gięcia na kant i skręty, czy tylko gięcia płaskie?
5. Czy otwory są wykrawane przed gięciem (wtedy muszą być na rozwinięciu)?
6. Jaki tablet / system i czy przy stanowisku jest drukarka?
7. Czy projekty mają trafiać gdzieś dalej (serwer, ERP, inne stanowiska)?

---

## 9. Do zrobienia (backlog)

### Pomiar: dokładniejsze zaznaczanie punktów

Dziś punkt wybiera się tapnięciem z przyciąganiem do najbliższego punktu w promieniu 60 px, a
przyciskiem „↻ Inny punkt” przełącza się między sąsiednimi punktami. Przy łukach i małych
przekrojach punkty leżą gęsto, a palec (zwłaszcza w rękawicy) zasłania miejsce, w które celuje.

**Lupa pod palcem przy przytrzymaniu**
- Przytrzymanie palca na modelu w trybie „Zmierz” (ok. 300 ms bez ruchu) otwiera lupę:
  okrągłe powiększenie (ok. 2,5–3×, średnica ok. 140 px) wyświetlane **nad palcem**, z boku
  przy krawędzi ekranu, tak żeby palec nigdy go nie zasłaniał.
- W lupie: krzyżyk w miejscu pod palcem, punkty przyciągania w powiększeniu i wyróżniony punkt,
  który zostanie wybrany (pierścień + opis, np. „narożnik”, „środek otworu O1”, „punkt wymiaru”).
- Przesuwanie palca przesuwa krzyżyk i na żywo zmienia wybrany punkt (bez obracania modelu).
- Puszczenie palca zatwierdza punkt; zsunięcie poza widok albo drugi palec anuluje.
- Zwykłe krótkie tapnięcie działa jak dziś (bez lupy), obrót modelu jednym palcem też – lupa
  włącza się tylko po przytrzymaniu bez ruchu.
- Technicznie: drugi render tej samej sceny do małego płótna (kamera ortogonalna o mniejszym
  kadrze wokół punktu pod palcem) albo powiększony fragment głównego płótna; aktualizacja przy
  ruchu palca (requestAnimationFrame), bez przebudowy sceny.

**Lepszy wygląd kropek punktów (wierzchołków)**
- Stały rozmiar na ekranie niezależnie od powiększenia modelu (dziś kule mają rozmiar w mm, więc
  przy oddaleniu znikają, a przy zbliżeniu są ogromne) – np. sprite'y / `Points` z
  `sizeAttenuation: false`, ok. 12–14 px.
- Czytelny styl: pierścień (jasne wypełnienie, ciemny obrys + cienka biała obwódka), dobrze
  widoczny na miedzi i na tle; zamiast półprzezroczystych niebieskich kul.
- Rodzaj punktu rozpoznawalny po kształcie i kolorze, z małą legendą w pasku pomiaru:
  narożnik (kwadrat), środek otworu (kółko z krzyżykiem), punkt wymiaru / ostry narożnik
  (romb, pomarańczowy), środek końca (kółko).
- Punkty po niewidocznej stronie bryły przygaszone (mniejsza nieprzezroczystość), żeby nie
  mieszały się z punktami z przodu; wybrany i wskazany punkt wyraźnie większy.
- Mniej punktów naraz: w pełnym widoku tylko punkty w pobliżu palca / kursora albo po
  przybliżeniu, żeby przy długich szynach nie było „chmury kropek”.

**Do sprawdzenia przy wdrożeniu:** test na prawdziwym tablecie w rękawicy (czas przytrzymania,
wielkość lupy, położenie przy krawędziach ekranu), zachowanie przy dwóch palcach (zoom) i w trybie
pionowym / na telefonie.
