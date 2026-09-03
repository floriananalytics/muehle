# CLAUDE.md - Mühle (PWA)

Privates Hobbyprojekt von Florian. Installierbare Web-App (GitHub Pages) für das Brettspiel Mühle.
Live: https://floriananalytics.github.io/muehle/

## Sprache und Stil
- Immer Deutsch, echte Umlaute (ä/ö/ü/ß) in Code, Texten, Commits.
- Kein Mittelpunkt-Zeichen (·) - stattdessen Bindestrich oder Pipe.
- Rückfragen stellen, bevor größere Umbauten begonnen werden. Kritische Einschätzung ist erwünscht, keine geschönten Antworten.
- Kein "Take" als Anglizismus.

## Architektur
- Eine Datei: `index.html` (Regeln, KI, Oberfläche, Ton, Speicherung). Kein Build-Schritt, keine Abhängigkeiten.
- `manifest.json`, `sw.js` (Service Worker, Cache-first mit Netz-Update), Icons `icon-192.png`, `icon-512.png`, `icon-512-maskable.png`.
- Alle Pfade relativ (`./`), weil die App unter `/muehle/` liegt, nicht im Root.
- Speicherung nur in `localStorage` unter dem Präfix `muehle:` (settings: mode/level/starter/sound, stats: w/d/l). Keine Server, kein Tracking.

## Pflicht bei jeder Änderung
- In `sw.js` die Konstante `CACHE` hochzählen (`muehle-v1` -> `muehle-v2` ...), sonst behalten installierte Geräte die alte Version.
- `index.html` nach Änderungen syntaktisch prüfen (z. B. Skriptblock mit Node laden) und eine Partie KI gegen KI simulieren. Für Node-Prüfungen den Skriptblock bis zum Kommentar `/* ---------- Ton` laden (davor stehen nur Brett, Spiellogik und KI ohne DOM-Zugriff).
- Direkt auf `main` committen, deutsche Commit-Nachricht.

## Spielregeln (fest)
- Klassisch: 9 Steine je Seite, Setzen -> Ziehen -> Springen bei genau 3 Steinen.
- Mühle: einen gegnerischen Stein schlagen, der nicht in einer Mühle steht; nur wenn alle in Mühlen stehen, darf aus einer Mühle geschlagen werden.
- Verloren: weniger als 3 Steine nach der Setzphase, oder kein legaler Zug.
- Remis: dreifache Stellungswiederholung (Schlüssel = Brett + Spieler am Zug + Vorrat) oder 50 Züge ohne Schlag ab der Ziehphase (beide Vorräte leer). Ein Schlag setzt den Zähler zurück. Zählt in der Bilanz als Remis (Feld `d`), im Zwei-Spieler-Modus ohne Bilanz.

## Brettmodell
- 24 Punkte, Indizes 0-23, Koordinaten in `POS` (7x7-Raster), Nachbarn in `ADJ`, Mühlen in `MILLS`.
- Spieler 1 = Senf (Mensch bzw. Spieler 1), Spieler 2 = Petrol (Computer bzw. Spieler 2).
- Zustand `{b: Array(24), hand: [0, n1, n2], turn, nc}` (nc = Züge ohne Schlag in der Ziehphase); Züge `{from, to, remove}` (from = -1 beim Setzen, remove = -1 ohne Schlag).
- Stellungsschlüssel `posKey(s)`; Wiederholungszähler `reps` (Map Schlüssel -> Anzahl) lebt in der Oberfläche, wird im Snapshot für Rückgängig mitgesichert und beim Neustart geleert.

## KI
- Minimax mit Alpha-Beta (`search`), Bewertung in `evaluate(s, me, level)`, Stufen in `LEVELS`, Zugwahl in `bestMove(s, me, level, hist)`.
- Stufen:
  - Leicht: feste Tiefe 2, Bewertung nur Material (30) und Mühlen (9), in 30 % der Fälle zufällig einer der drei besten Züge.
  - Mittel: feste Tiefe 4, Bewertung Material 30, Mühlen 9, offene Zweier 4, Beweglichkeit 2, blockierte Gegnersteine 3 (Beweglichkeit erst, wenn ein Vorrat leer ist). Diese Bewertung bleibt unverändert.
  - Schwer: iterative Vertiefung bis 3000 ms oder Tiefe 12. Bewertung wie Mittel, aber: offene Zweier 6 in der Setzphase und 3 danach; Beweglichkeit immer (auch beim Setzen); blockierte Gegnersteine +5 und eigene blockierte Steine -5; Doppelmühlen symmetrisch +25/-25; Malus 15 bei Stellungen, die in der Partie schon vorkamen (bei Nachteil als Bonus, Vorzeichen nach Wurzelbewertung); dritte Wiederholung im Suchbaum gilt als Remis (0).
  - Zugtabelle (`K.tt`) nur bei Schwer: Map Stellungsschlüssel -> `{d: Tiefe, v: Wert, f: Schrankentyp}` (0 exakt, 1 untere, 2 obere Schranke), pro Zugberechnung neu.
  - Zugsortierung auf allen Stufen: Schlagzüge, dann Züge, die eine offene gegnerische Zweierreihe blockieren, dann Rest. 50-Züge-Regel wird auf allen Stufen in der Suche erkannt.
- Messung (Änderungsauftrag 1): 20 Partien Mittel gegen Schwer, abwechselnder Anfang: 20:0 für Schwer; mit 4 zufälligen Eröffnungshalbzügen 18:1 bei 1 Remis. Simulation über Node: Skriptblock bis zum Ton-Abschnitt in `vm` laden, `bestMove` beider Seiten aufrufen, `reps` wie in der Oberfläche führen.
- Mühle ist gelöst (Gasser 1993): bei perfektem Spiel Remis. Ziel der KI ist, Fehler zu bestrafen und Vorteile zu verwerten, nicht "unbesiegbar" zu sein.

## Design
- Sci-fi-Bordcomputer-Optik, ruhig, technisch. Farbwelt (nur Palette, keine Figuren/Namen/Logos aus Serien):
  - Schwarz `#0c0a0c`, Schwarz 2 `#151216`
  - Senf `#e8a93a` (dunkel `#b07a22`) - Spieler 1
  - Petrol `#2f8a90` (dunkel `#123e42`) - Spieler 2 / Akzent HUD
  - Elfenbein `#f0e2c4` (Linien, Text), Rot `#b8322a` (Mühle, Schlagen, Alarm)
- Monospace-Schrift für alles, Koordinatenring A-G / 1-7, Eckklammern in Senf, Scanlinien-Overlay.
- Bewegung sparsam: nur als Antwort auf Aktionen (Zug, Mühle, Schlag), `prefers-reduced-motion` respektieren.
- Touch-Ziele mindestens 44 px; Hit-Kreise im SVG bleiben groß (r=6 im 100er-Viewbox).
- Startmenü (`#menu`, Overlay im Bordcomputer-Stil): Titel, große Schaltflächen "Gegen Computer" | "Zwei Spieler" (Modus, gewählter in Senf), Segmente Stärke (nur bei Computer) und Anfang ("Ich" | "Computer" bzw. "Senf" | "Petrol"), "Weiterspielen" (nur bei laufender Partie) und "Neue Partie", Bilanz mit "zurücksetzen", Link "Regeln". Modus und Anfang wirken erst bei "Neue Partie", Stärke sofort. Header im Spiel: "◀ Zug", "Ton an/aus", "Menü". Escape schließt Regeln bzw. das Menü (nur bei laufender Partie). Unter dem Brett steht nur das HUD.
- Regel-Overlay (`#rules`): gleicher Stil, 8 kurze Absätze, "Schließen" oben rechts.
- Animationen, nur als Antwort auf Aktionen; `prefers-reduced-motion: reduce` schaltet alle ab (CSS) und entfernt geschlagene Steine sofort (JS `reduceMotion()`):
  - Steine sind `<g class="stone-g">` mit `style.transform=translate(x px, y px)`; `render()` verwendet Elemente je Feld wieder (`stoneEls`), Ziehen verschiebt nur das Element (Transition 180 ms ease-out), Setzen skaliert 0,6 -> 1 (120 ms, Klasse `pop`), Schlagen zerfällt (250 ms, Klasse `gone` + Elfenbein-Ring), Mühle blitzt zweimal 150 ms (Klasse `flash` auf Steinen und Mühlenlinie, `flashMill`). Rückgängig und Neustart rendern ohne Animation (`render({reset:true})`).
  - Computerzug mit Schlag: erst Zug und Mühle-Blitz, 320 ms später der Schlag; `thinking` bleibt solange gesetzt.
  - Sieg/Niederlage/Remis: HUD-Rand pulsiert dreimal (Klasse `pulse`, Farbe über `--pc`).
  - Fortschrittsleiste `#bar` im HUD während der Computer rechnet: Animation nur auf `transform` (läuft auf dem Compositor, obwohl die KI den Hauptthread blockiert), Dauer 380 ms plus Zeitbudget bei Schwer.
- Vibration (`buzz`, `navigator.vibrate`, stumm ignoriert wenn nicht vorhanden): Setzen/Ziehen 10, Mühle 30-40-30, Schlagen 60, Sieg 40-60-40-60, Niederlage 120, Remis 30-30. Folgt der Ton-Einstellung.

## Umgesetzt
- Remisregeln, Remis-Spalte in der Bilanz, KI-Malus für Stellungswiederholung (Änderungsauftrag 1).
- Stärkestufen spürbar getrennt (Änderungsauftrag 1).
- Startmenü, Animationen (Gleiten, Mühle-Blitz, Zerfall beim Schlag), Vibration, Regel-Overlay (Änderungsauftrag 2).

## Offene Punkte (Reihenfolge)
1. Zugvorschlag (Regelerklärung als Overlay ist mit Auftrag 2 umgesetzt).
2. Weitere Spiele im selben Rahmen (Dame, Vier gewinnt) - Engine-Struktur wiederverwenden.
- Online-Spiel ist ohne Server nicht vorgesehen.
