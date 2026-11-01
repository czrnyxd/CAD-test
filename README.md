# BusBar CAD: prototyp

Wczesny prototyp aplikacji na tablet do projektowania giętych szyn miedzianych. Plan całości: [PLAN.md](PLAN.md).

## Uruchomienie

```bash
npm install
npm run dev        # serwer deweloperski, dostępny też w sieci lokalnej (np. z tabletu)
npm test           # testy obliczeń
npm run build      # wersja produkcyjna w katalogu dist/ (statyczne pliki)
```

Po `npm run dev` otwórz na tablecie adres `http://<ip-komputera>:5173`.

## Co działa

- **Edytor kroków:** odcinek, gięcie płaskie, gięcie na kant, skręt. Wartości wpisuje się na dużej klawiaturze numerycznej z szybkimi kątami. Kierunek gięcia wybiera się strzałkami. Nowe gięcie wstawia się za zaznaczonym odcinkiem.
- **Model 3D:**
  - obrót jednym palcem, zoom i przesuwanie dwoma,
  - widoki ISO/Przód/Góra/Bok i automatyczne dopasowanie kadru,
  - tap na szynę zaznacza krok,
  - etykiety wymiarów i oznaczenie końca **A**.
- **Pomiar:** punkt–punkt z przyciąganiem do narożników przekroju, wynik z ΔX/ΔY/ΔZ, gabaryty.
- **Obliczenia:**
  - naddatek na gięcie (BA), setback i długość rozwinięcia,
  - pozycje linii gięć (początek, środek lub koniec łuku),
  - nastawa kąta z korektą sprężynowania,
  - wymiarowanie po zewnętrznej, wewnętrznej lub po osi.
- **Walidacje:** za krótkie odcinki, minimalne ramię, minimalny promień, strefa skrętu, długość handlowa, kolizja szyny z samą sobą.
- **Rozwinięcie:** rysunek z wymiarami łańcuchowymi i od bazy, strefy gięć i skrętów, tabela gięć dla operatora.
- **Wydruk A4 / PDF:** nagłówek zlecenia, widok 3D, tabela gięć, rozwinięcie.
- **Projekty:** autozapis w przeglądarce (localStorage), lista projektów, kopiowanie, eksport i import JSON, cofnij/ponów.
- **Ustawienia maszyny:** promienie, K, sprężynowanie, minimalne ramię, punkt odniesienia gięcia.

## Struktura

```
src/core/      model danych, obliczenia gięć, geometria 3D (bez UI, z testami)
src/ui/        widok 3D (three.js), lista kroków, klawiatura, rozwinięcie
src/store.ts   stan aplikacji, historia cofnij/ponów, zapis lokalny
```

## Ograniczenia prototypu

- Współczynniki K i sprężynowania to wartości przykładowe. Trzeba je skalibrować na próbkach z maszyny.
- Brak otworów, eksportu DXF, kreatora kalibracji i trybu offline (service worker). To kolejne etapy z planu.
- Kierunki „w górę/w dół/w lewo/w prawo” są liczone względem szyny w chwili gięcia. Do ustalenia z operatorem, jak to przełożyć na ułożenie szyny w maszynie.
