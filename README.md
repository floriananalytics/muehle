# Konsole

Spielesammlung unter https://floriananalytics.github.io/muehle/ mit Mühle und Vier gewinnt, als installierbare Web-App (PWA) - gegen den Computer oder zu zweit am selben Handy.

**Spielen:** https://floriananalytics.github.io/muehle/  
Auf dem Handy öffnen und über "Zum Startbildschirm hinzufügen" installieren. Läuft danach auch offline.

## Dateien
- `index.html` - Hülle: Startmenü, Kopfzeile, HUD, Ton, Bilanz
- `games/muehle.js`, `games/vier-gewinnt.js` - je ein Spielmodul (Regeln, KI, Brett)
- `manifest.json` - App-Name, Icon, Vollbild
- `sw.js` - Service Worker für Offline-Betrieb
- `icon-*.png` - App-Icons

## Aktualisieren
Nach jeder Änderung in `sw.js` die Zeile `const CACHE = 'muehle-v1'` auf `v2`, `v3` … hochzählen. Sonst behalten bereits installierte Geräte die alte Version.
