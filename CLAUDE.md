# CLAUDE.md - Konsole (PWA)

Privates Hobbyprojekt von Florian. Installierbare Web-App (GitHub Pages), Spielesammlung "Konsole": aktuell Mühle, Vier gewinnt und Dame. App-Name (Manifest, Titel, Spielauswahl) ist "Konsole"; Pfad `/muehle/`, Repo-Name, Cache-Präfix `muehle-v<n>` und localStorage-Präfix `muehle:` bleiben aus Kompatibilitätsgründen, damit installierte Geräte nichts migrieren müssen.
Live: https://floriananalytics.github.io/muehle/

## Sprache und Stil
- Immer Deutsch, echte Umlaute (ä/ö/ü/ß) in Code, Texten, Commits.
- Kein Mittelpunkt-Zeichen (·) - stattdessen Bindestrich oder Pipe.
- Rückfragen stellen, bevor größere Umbauten begonnen werden. Kritische Einschätzung ist erwünscht, keine geschönten Antworten.
- Kein "Take" als Anglizismus.

## Architektur
- Hülle und Spielmodule, kein Build-Schritt, keine Abhängigkeiten:
  - `index.html` - Hülle: Spielauswahl, Startmenü, Header, HUD, Ton/Vibration, Bilanz, localStorage, Service-Worker-Registrierung. Kein spielspezifischer Code.
  - `games/muehle.js` - Mühle (Brettmodell, Regeln, KI, SVG-Brett, Animationen).
  - `games/vier-gewinnt.js` - Vier gewinnt; dieselbe Datei läuft bei Schwer als Web Worker und unter Node.
  - `games/dame.js` - Dame nach deutschen Regeln; ebenfalls Worker bei Schwer und Node-fähig.
- `manifest.json` (Name "Konsole"), `sw.js` (Service Worker, Netz zuerst mit Cache-Rückfall; `FILES` enthält alle drei Module), Icons `icon-192.png`, `icon-512.png`, `icon-512-maskable.png`: 7x7-Raster in Elfenbein auf Schwarz, darauf vier Steine in Senf, Petrol, Zinnober und Nebelblau mit dunklem Kern, Eckklammern in Senf (nicht auf dem maskable-Icon, das einen Sicherheitsrand von 22 % hat). Erzeugt mit Pillow, Skript nicht im Repo. Das Mühle-Motiv gibt es nur noch als Kachelvorschau.
- Alle Pfade relativ (`./`), weil die App unter `/muehle/` liegt, nicht im Root.
- Speicherung nur in `localStorage` unter dem Präfix `muehle:`: `settings:<spiel-id>` (mode/level/starter), `stats:<spiel-id>` (w/d/l), `sound`, `lastGame`, `newVersion` (Merker für den Versionshinweis). Alte Schlüssel `stats` und `settings` werden beim Start einmalig nach `:muehle` migriert. Keine Server, kein Tracking.

## Schnittstelle der Spielmodule
- Ein Objekt je Datei unter `window.GAMES[id]`; unter Node exportiert `module.exports` die Logikfunktionen für Prüfungen.
- `meta`: `{id, name, untertitel, farben:[{name,hex,dunkel} Spieler 1, Spieler 2], akzent:{name,hex}, stufen:['Leicht','Mittel','Schwer'], regeln:[{titel,text}], vorschau()}` (vorschau liefert SVG-Markup in den eigenen Spielfarben für die Kachel).
- `mount(container, hooks)` baut das Brett in den Container und hängt sein CSS als `<style>` in den Head; `destroy()` entfernt beides und beendet Timer/Worker.
- `hooks`: `sfx` (place/move/mill/take/win/lose/draw), `vibrate(pattern)`, `hud(text, klasse)`, `hudRow(text)`, `progress(ms)` (Fortschrittsleiste, 0 = aus), `onEnd(ergebnis)` mit `{win:1|2}` oder `{draw:true, grund}`. Die Hülle setzt Endmeldung, Ton, Puls und Bilanz; das Modul meldet nur das Ergebnis.
- `newGame({twoPlayer, level, starter})`, `undo()`, `canUndo()`, `setLevel(n)` (Stärke wirkt sofort), `debug()` (nur für Prüfungen).
- Die Hülle kennt kein Brett; das Modul kennt kein Menü. Spielernamen: bei Zwei Spielern die Farbnamen aus `meta.farben`, gegen Computer "DU"/"COMPUTER".

## Pflicht bei jeder Änderung
- In `sw.js` die Konstante `CACHE` hochzählen (`muehle-v1` -> `muehle-v2` ...), sonst behalten installierte Geräte die alte Version.
- Module mit `node --check` prüfen, Logik über `require('./games/<spiel>.js')` in Node testen (Einheitsprüfungen, Simulation KI gegen KI), Oberfläche im Headless-Browser über einen lokalen HTTP-Server (Worker und Service Worker laufen nicht unter `file://`).
- Direkt auf `main` committen, deutsche Commit-Nachricht.

## Spielregeln Mühle (fest)
- Klassisch: 9 Steine je Seite, Setzen -> Ziehen -> Springen bei genau 3 Steinen.
- Mühle: einen gegnerischen Stein schlagen, der nicht in einer Mühle steht; nur wenn alle in Mühlen stehen, darf aus einer Mühle geschlagen werden.
- Verloren: weniger als 3 Steine nach der Setzphase, oder kein legaler Zug.
- Remis: dreifache Stellungswiederholung (Schlüssel = Brett + Spieler am Zug + Vorrat) oder 50 Züge ohne Schlag ab der Ziehphase (beide Vorräte leer). Ein Schlag setzt den Zähler zurück. Zählt in der Bilanz als Remis (Feld `d`), im Zwei-Spieler-Modus ohne Bilanz.

## Brettmodell Mühle
- 24 Punkte, Indizes 0-23, Koordinaten in `POS` (7x7-Raster), Nachbarn in `ADJ`, Mühlen in `MILLS`.
- Spieler 1 = Senf (Mensch bzw. Spieler 1), Spieler 2 = Petrol (Computer bzw. Spieler 2).
- Zustand `{b: Array(24), hand: [0, n1, n2], turn, nc}` (nc = Züge ohne Schlag in der Ziehphase); Züge `{from, to, remove}` (from = -1 beim Setzen, remove = -1 ohne Schlag).
- Stellungsschlüssel `posKey(s)`; Wiederholungszähler `reps` (Map Schlüssel -> Anzahl) lebt in der Oberfläche, wird im Snapshot für Rückgängig mitgesichert und beim Neustart geleert.

## KI Mühle
- Minimax mit Alpha-Beta (`search`), Bewertung in `evaluate(s, me, level)`, Stufen in `LEVELS`, Zugwahl in `bestMove(s, me, level, hist)`.
- Stufen:
  - Leicht: feste Tiefe 2, Bewertung nur Material (30) und Mühlen (9), in 30 % der Fälle zufällig einer der drei besten Züge.
  - Mittel: feste Tiefe 4, Bewertung Material 30, Mühlen 9, offene Zweier 4, Beweglichkeit 2, blockierte Gegnersteine 3 (Beweglichkeit erst, wenn ein Vorrat leer ist). Diese Bewertung bleibt unverändert.
  - Schwer: iterative Vertiefung bis 3000 ms oder Tiefe 12. Bewertung wie Mittel, aber: offene Zweier 6 in der Setzphase und 3 danach; Beweglichkeit immer (auch beim Setzen); blockierte Gegnersteine +5 und eigene blockierte Steine -5; Doppelmühlen symmetrisch +25/-25; Malus 15 bei Stellungen, die in der Partie schon vorkamen (bei Nachteil als Bonus, Vorzeichen nach Wurzelbewertung); dritte Wiederholung im Suchbaum gilt als Remis (0).
  - Zugtabelle (`K.tt`) nur bei Schwer: Map Stellungsschlüssel -> `{d: Tiefe, v: Wert, f: Schrankentyp}` (0 exakt, 1 untere, 2 obere Schranke), pro Zugberechnung neu.
  - Zugsortierung auf allen Stufen: Schlagzüge, dann Züge, die eine offene gegnerische Zweierreihe blockieren, dann Rest. 50-Züge-Regel wird auf allen Stufen in der Suche erkannt.
- Messung (Änderungsauftrag 1): 20 Partien Mittel gegen Schwer, abwechselnder Anfang: 20:0 für Schwer; mit 4 zufälligen Eröffnungshalbzügen 18:1 bei 1 Remis. Simulation über Node: Skriptblock bis zum Ton-Abschnitt in `vm` laden, `bestMove` beider Seiten aufrufen, `reps` wie in der Oberfläche führen.
- Mühle ist gelöst (Gasser 1993): bei perfektem Spiel Remis. Ziel der KI ist, Fehler zu bestrafen und Vorteile zu verwerten, nicht "unbesiegbar" zu sein.

## Vier gewinnt
- Regeln: 7 Spalten x 6 Reihen, Stein fällt in die unterste freie Reihe. Vier in einer Reihe (waagerecht, senkrecht, diagonal) gewinnt, volles Brett ohne Vier ist Remis. Spieler 1 Zinnober, Spieler 2 Nebelblau. Rückgängig: gegen Computer Zug plus Antwort, zu zweit ein Zug.
- Modell: `{b: Array(42), h: [7 Füllhöhen], turn, n}`, Index = Spalte*6 + Reihe (Reihe 0 unten). `winLine(b, i)` liefert die vier Felder der Gewinnreihe durch das zuletzt besetzte Feld.
- Oberfläche: SVG 100x92, Spalten als Elfenbein-Schächte, Löcher als Quadrate, Koordinaten A-G oben und unten, Eckklammern in Akzentfarbe. Trefferfläche ist die ganze Spalte. Maus: Zeigen zeigt das Kreuz (Landefeld und über der Spalte), Klick setzt. Touch: erstes Tippen wählt und zeigt, zweites Tippen auf dieselbe Spalte setzt. Stein fällt von oben (Transition 250 ms ease-in), Gewinnreihe blitzt zweimal plus rote Linie, `onEnd` 350 ms nach dem Blitz.
- KI: Negamax mit Alpha-Beta, Zugtabelle (`K.tt`, mit Schrankentyp und bestem Zug), Zugsortierung 3, 2, 4, 1, 5, 0, 6. Bewertung: Fenster von vier Feldern (3 eigene + 1 leer +50, 2 + 2 leer +10, gegnerisch -80/-10), Mittelspalte +3/-3 je Stein. Unmittelbare Gewinn- und Verlustzüge werden vor der Suche erkannt. Stufen: Leicht Tiefe 2 mit 30 % Zufall aus den drei besten, Mittel Tiefe 6, Schwer iterative Vertiefung bis 2000 ms oder Tiefe 14 im Web Worker (Rückfall auf den Hauptthread, wenn kein Worker möglich ist).
- Messung (Änderungsauftrag 3): 20 Partien Schwer gegen Mittel mit zwei zufälligen Eröffnungshalbzügen: 16:3 bei 1 Remis; als Anziehender 10 von 10. Vier gewinnt ist gelöst (Anziehender gewinnt bei perfektem Spiel mit Beginn in der Mittelspalte).

## Dame
- Regeln (deutsche Dame, fest): 8x8, nur dunkle Felder, a1 dunkel, je 12 Steine in drei Reihen. Olive (Spieler 1, unten) beginnt immer; bei "Anfang: Computer" spielt der Computer Olive und der Mensch Pflaume, bei Zwei Spielern sitzt mit "Anfang: Pflaume" Pflaume unten. Das Brett wird dann gedreht (`flip`), Olive zieht trotzdem zuerst. Stein: ein Feld diagonal vorwärts, schlägt nur vorwärts über einen Nachbarn. Dame: beliebig weit diagonal, schlägt einen einzelnen Stein auf freier Linie und landet auf jedem freien Feld dahinter. Schlagzwang mit freier Wahl, kein Mehrheitsschlag; Mehrfachschlag vollständig, Richtungswechsel erlaubt, geschlagene Steine bleiben bis zum Zugende stehen und werden nicht zweimal übersprungen. Umwandlung auf der Grundreihe; mitten im Mehrfachschlag endet der Zug dort. Verlust ohne Steine oder ohne legalen Zug. Remis bei dreifacher Wiederholung (Schlüssel Brett + Spieler am Zug) oder 30 Halbzügen ohne Schlag und ohne Steinzug (nur Damenzüge, `nc`).
- Modell: 32 dunkle Felder, Index = Reihe*4 + Position (Reihe 0 unten, links nach rechts), `RC[i]` = [Reihe, Spalte], `NB[i][d]` Nachbarn in den vier Diagonalen (0,1 vorwärts für Olive, 2,3 für Pflaume). Werte 0 leer, 1/2 Stein Olive/Pflaume, 3/4 Dame. Zustand `{b: Array(32), turn, nc}`, Zug `{path, captured, promote}`; `genMoves` liefert nur vollständige, legale Züge (Schlagfolgen per Tiefensuche über `captures`).
- Oberfläche: SVG 100x100, Zelle 9,6, dunkle Felder Elfenbein 15 %, Raster, Koordinaten a-h unten und 1-8 links (folgen der Drehung), Eckklammern in Pflaume. Vorratszeilen zeigen Steine und Damen (Damen als Quadrat mit Doppelrahmen) und "geschlagen". Bedienung Schritt für Schritt: wählbare Steine tragen einen dünnen Ring, gewählter Stein gestrichelt, Zielfelder als Kreuze; nach dem ersten Sprung ist der Zug bindend (`pend`), nur eine Fortsetzung wird nach 250 ms automatisch ausgeführt. Gleiten 180 ms je Schritt, Umwandlung blitzt und bekommt den Elfenbein-Ring, geschlagene Steine zerfallen nach dem letzten Schritt (Computer: 320 ms später). Töne: move, take je Sprung, mill bei Umwandlung.
- KI: Negamax mit Alpha-Beta, Zugtabelle mit Schrankentyp und bestem Zug, Ruhesuche bei Schlagzwang (bis 8 Halbzüge über die Tiefe hinaus). Bewertung aus Sicht des Spielers am Zug: Stein 100, Dame 300, Vormarsch 2 je Reihe, Grundreihe 8 (solange der Gegner Steine hat), Zentrum (Reihen und Spalten 2-5) 4, bei Materialvorteil (24 - Steinzahl)*2 als Abtauschbonus, Beweglichkeit als Differenz der legalen Züge. Stufen: Leicht Tiefe 2 mit 30 % Zufall aus den drei besten, Mittel Tiefe 5, Schwer iterative Vertiefung bis 3000 ms oder Tiefe 14 im Worker mit Wiederholungsmalus 15. Zugsortierung: Schläge nach Anzahl, Umwandlungen, Zug aus der Zugtabelle, Rest.
- Messung (Änderungsauftrag 5): 20 Partien Schwer (1500 ms Budget) gegen Mittel, abwechselnder Anfang, zwei zufällige Eröffnungshalbzüge, Zuglimit 300: 20:0 für Schwer, als Olive 10 von 10, als Pflaume 10 von 10, alle durch Zugunfähigkeit oder Steinverlust, im Schnitt 67 Halbzüge.

## Design
- Sci-fi-Bordcomputer-Optik, ruhig, technisch. Farbwelt (nur Palette, keine Figuren/Namen/Logos aus Serien):
  - Gemeinsame Basis: Schwarz `#0c0a0c`, Schwarz 2 `#151216` (Flächen), Elfenbein `#f0e2c4` (Linien, Text, 40 % / 15 % für Nebenlinien), Alarmrot `#b8322a` (Mühle, Schlagen, Niederlage, in allen Spielen die Warnfarbe).
  - Erweiterte Palette (CSS-Variablen in der Hülle): Senf `#e8a93a` (dunkel `#b07a22`), Petrol `#2f8a90` (`#123e42`), Zinnober `#d4552e` (`#8f3419`), Nebelblau `#7fb2c9` (`#3f6f85`), Olive `#9a9a3c` (`#5f6020`), Pflaume `#8a4f8e` (`#4f2a54`), Rauch `#6f6a66` (neutral, inaktive Elemente).
  - Zuordnung je Spiel: Mühle Senf | Petrol, Akzent Senf. Vier gewinnt Zinnober | Nebelblau, Akzent Nebelblau. Dame (später) Olive | Pflaume, Akzent Pflaume. Regel: neue Spiele bekommen ein noch nicht vergebenes Paar aus der Palette, kein neues Hex ohne Abstimmung.
  - Die Hülle setzt je Spiel `--spieler1`, `--spieler1-d`, `--spieler2`, `--spieler2-d`, `--akzent` auf dem Wurzelelement; Steine, HUD, Klammern und Segmente referenzieren nur diese Variablen. Zusätzlich `--spieler1-text`, `--spieler2-text`, `--akzent-text`: die Farbe selbst, wenn sie auf Schwarz mindestens 4,5:1 erreicht, sonst Elfenbein (Kontrast auf `#0c0a0c`: Senf 9,55, Nebelblau 8,56, Olive 6,63, Petrol 4,85, Zinnober 4,83, Pflaume 3,37, Rauch 3,69). Spielernamen in der Vorratszeile tragen immer einen Farbbalken. Steine haben einen dunklen Kern.
  - Spielauswahl: Kacheln (Mühle, Vier gewinnt, Dame) mit SVG-Vorschau in den eigenen Spielfarben, Kachelrahmen in der Akzentfarbe des Spiels.
- Monospace-Schrift für alles, Koordinatenring A-G / 1-7, Eckklammern in Senf, Scanlinien-Overlay.
- Bewegung sparsam: nur als Antwort auf Aktionen (Zug, Mühle, Schlag), `prefers-reduced-motion` respektieren.
- Touch-Ziele mindestens 44 px; Hit-Kreise im SVG bleiben groß (r=6 im 100er-Viewbox).
- Startmenü (`#menu`, Overlay im Bordcomputer-Stil): oberste Ebene Spielauswahl (Titel "KONSOLE", Untertitel "SPIELESAMMLUNG", Kacheln); danach je Spiel: Link "Zurück zur Spielauswahl", Titel, große Schaltflächen "Gegen Computer" | "Zwei Spieler" (Modus, gewählter in Senf), Segmente Stärke (nur bei Computer) und Anfang ("Ich" | "Computer" bzw. "Senf" | "Petrol"), "Weiterspielen" (nur bei laufender Partie) und "Neue Partie", Bilanz mit "zurücksetzen", Link "Regeln". Modus und Anfang wirken erst bei "Neue Partie", Stärke sofort. Header im Spiel zeigt Name und Untertitel des aktiven Spiels aus `meta` und die Knöpfe "◀ Zug", "Ton an/aus", "Menü". Beim Start öffnet sich immer die Spielauswahl; `muehle:lastGame` markiert dort nur die Kachel des zuletzt gespielten Spiels (Klasse `last`, doppelter Akzentrahmen, `aria-current`). Header ohne geladenes Spiel: "KONSOLE".
- Rückfrage (`#confirm`, gleicher Stil): "Laufende Partie beenden?" mit "Beenden" | "Zurück" vor einem Spielwechsel und vor "Neue Partie", solange eine Partie läuft (`started && !over`); Escape wirkt wie "Zurück".
- Versionshinweis: Löst ein neuer Service Worker einen vorhandenen ab (`controllerchange` bei bestehendem Controller), zeigt das HUD einmalig "Neue Version geladen."; läuft gerade eine Partie, wird der Hinweis über `muehle:newVersion` auf den nächsten Start verschoben. Escape schließt Regeln bzw. das Menü (nur bei laufender Partie). Unter dem Brett steht nur das HUD.
- Regel-Overlay (`#rules`): gleicher Stil, 8 kurze Absätze, "Schließen" oben rechts.
- Animationen, nur als Antwort auf Aktionen; `prefers-reduced-motion: reduce` schaltet alle ab (CSS) und entfernt geschlagene Steine sofort (JS `reduceMotion()`):
  - Steine sind `<g class="stone-g">` mit `style.transform=translate(x px, y px)`; `render()` verwendet Elemente je Feld wieder (`stoneEls`), Ziehen verschiebt nur das Element (Transition 180 ms ease-out), Setzen skaliert 0,6 -> 1 (120 ms, Klasse `pop`), Schlagen zerfällt (250 ms, Klasse `gone` + Elfenbein-Ring), Mühle blitzt zweimal 150 ms (Klasse `flash` auf Steinen und Mühlenlinie, `flashMill`). Rückgängig und Neustart rendern ohne Animation (`render({reset:true})`).
  - Computerzug mit Schlag: erst Zug und Mühle-Blitz, 320 ms später der Schlag; `thinking` bleibt solange gesetzt.
  - Sieg/Niederlage/Remis: HUD-Rand pulsiert dreimal (Klasse `pulse`, Farbe über `--pc`).
  - Fortschrittsleiste `#bar` im HUD während der Computer rechnet: Animation nur auf `transform` (läuft auf dem Compositor, obwohl die KI den Hauptthread blockiert), Dauer 380 ms plus Zeitbudget bei Schwer.
- Vibration (`buzz`, `navigator.vibrate`, stumm ignoriert wenn nicht vorhanden): Setzen/Ziehen 10, Mühle 30-40-30, Schlagen 60, Sieg 40-60-40-60, Niederlage 120, Remis 30-30. Folgt der Ton-Einstellung.
- Ton auf iOS: AudioContext beim ersten touchstart/pointerdown/keydown erzeugen, `resume()` und einen stummen 1-Sample-Puffer abspielen; bei `visibilitychange` und in `tone()` erneut `resume()`, wenn der Zustand nicht `running` ist.

## Umgesetzt
- Remisregeln, Remis-Spalte in der Bilanz, KI-Malus für Stellungswiederholung (Änderungsauftrag 1).
- Stärkestufen spürbar getrennt (Änderungsauftrag 1).
- Startmenü, Animationen (Gleiten, Mühle-Blitz, Zerfall beim Schlag), Vibration, Regel-Overlay (Änderungsauftrag 2).
- Spielesammlung: Hülle und Module, Spielauswahl, Vier gewinnt, erweiterte Palette, iPhone-Ton (Änderungsauftrag 3).
- Umbenennung in "Konsole", neues Icon, Rückfrage beim Spielwechsel, Versionshinweis (Änderungsauftrag 4).
- Dame als drittes Modul (Änderungsauftrag 5).

## Offene Punkte (Reihenfolge)
1. Zugvorschlag (Regelerklärung als Overlay ist mit Auftrag 2 umgesetzt).
2. Spielauswahl als Liste (Auftrag 6); Dame ist mit Auftrag 5 umgesetzt.
- Online-Spiel ist ohne Server nicht vorgesehen.
