# Video-Aufnahmen für die Präsentation

Zehn kurze Bildschirmvideos, eines pro Demo-Schritt, zum Einbetten in PowerPoint (Backup, falls die Live-Demo ausfällt). Reihenfolge und Inhalt folgen `demo-script.md` und den Backup-Folien 5–14 (`5-backup-a-pipeline.png` … `14-backup-j-outcept.png` zeigen jeweils, wie das Bild aussehen soll).

Die App ist englisch: Button- und Seitennamen unten stehen so, wie sie auf dem Bildschirm erscheinen.

## Vorher (Dinesh richtet ein)

- Backend läuft mit Watcher (Seitenleiste unten: *Pipeline watching*), Frontend auf `http://localhost:5173`, Outcept-Liste auf `http://localhost:8080` (35 Einträge).
- Demo zurückgesetzt: kein `demo_call` in der Inbox (Inbox zeigt 35), Ordner `inbox/` leer.
- Tuning auf **Balanced** (Review from 30, Alert from 70).

## Aufnahme-Einstellungen

- Chrome im Vollbild (`Cmd+Ctrl+F`), Zoom 100 % (`Cmd+0`), Lesezeichenleiste aus, keine anderen Tabs sichtbar.
- Aufnehmen mit `Cmd+Shift+5` → **Ausgewählten Bereich aufnehmen** → nur das Browserfenster. Oder OBS, wenn Ton gebraucht wird (siehe Clip 3).
- Maus langsam bewegen, vor jedem Klick kurz (1 s) auf dem Ziel stehen bleiben. Pro Clip 10–25 s, am Anfang und Ende je 1–2 s Standbild.
- Dateien speichern unter `docs/pitch/videos/` (ist in `.gitignore`, also nicht in git), Namen wie unten, z. B. `01-pipeline.mov`.
- Für PowerPoint unter Windows in MP4 umwandeln:
  `ffmpeg -i 01-pipeline.mov -vf scale=1920:-2 -c:v libx264 -crf 20 -pix_fmt yuv420p -an 01-pipeline.mp4`
  (`-an` entfernt den Ton; bei Clip 3 weglassen, wenn Ton aufgenommen wurde).

## Nicht klicken (alles bleibt nur zum Anschauen)

**Correct**, **False alert**, **Missed something**, **Escalate as alert**, **Close as no alert**, **Add note**, **Apply thresholds**, **Save rules**, **Save keywords**, **Run evaluation on dev**, **Retry**, **Process folder**, **Pause watching**. Diese Buttons ändern Daten, den Audit-Log oder den Quality-Lauf.

## Die Clips

### 01-pipeline · Ein Anruf kommt rein (ca. 20 s)
Seite: Seitenleiste → **Pipeline**.
1. Datei `data/demo/demo_call.wav` aus dem Finder auf **Drop a recording here** ziehen.
2. Laufen lassen: die Zeile `demo_call.wav` geht durch *Transcribing → Separating speakers → Checking → Deciding* bis *Done* mit rotem **Alert**.
3. Warten, bis der Hinweis **New alert** unten rechts erscheint. Stopp.

Dieser Clip startet die Demo. Er geht nur einmal pro Reset (danach ist `demo_call` schon da).

### 02-inbox · Der neue Alert oben in der Inbox (ca. 10 s)
1. Seitenleiste → **Inbox**. `demo_call` steht ganz oben mit rotem **Alert**.
2. Maus kurz über die Zeile `demo_call` und die Kacheln **Alerts** / **Reviews** führen. Nicht auf **A** oder **F** drücken (Tastenkürzel für Feedback).

### 03-demo-call · Der Alert, erklärt (ca. 25 s)
1. In der Inbox die Zeile `demo_call` anklicken.
2. Oben zeigen: **Alert**, **Access code shared**, Begründung, rechts daneben *Raised by: Customer*.
3. Langsam runterscrollen bis zur gelben Karte **Trigger** (die sechs Ziffern).
4. Auf der Trigger-Karte **Play passage** klicken und die Stelle abspielen lassen (10 s davor und danach).

Ton: Die macOS-Aufnahme nimmt keinen Systemton auf. Wenn der Ton ins Video soll, mit OBS aufnehmen (Quelle *macOS-Bildschirmaufnahme* mit Audio). Sonst stumm lassen; in der Folie steht dann: *Kundin liest den Login-Code vor, obwohl der Berater zweimal sagt, keine Zahlen vorzulesen.*

### 04-d06 · Keywords ohne Risiko (ca. 20 s)
1. Oben in der Suche `D06` tippen, Enter. In **All calls** die Zeile **Stufe1_D06** mit dem Chip **Clean** öffnen.
2. Oben **No alert** zeigen, dann rechts das Panel **Keyword hits** (7 Treffer: *Passwort*, *Kreditkarte*, *Prüfung umgehen*, *TAN*, *Bestätigungscode*).
3. In **Checks** auf **Access code shared** klicken: die Begründung klappt auf (Beispielbild aus einer Hilfeseite, abgelaufene Zahl, kein aktiver Code). 2 s stehen lassen.

### 05-c10 · Gleiche Ziffern, kein Alert (ca. 15 s)
1. Zurück zu `demo_call` (Browser zurück oder Inbox → `demo_call`), runterscrollen zum Kasten **Similar call without alert: Stufe2_C10**.
2. **Open Stufe2_C10** klicken.
3. **No alert** zeigen und die Karte **Exclusion** (*abgelaufenes Muster in der Anleitung*).

### 06-c17 · Wenn der Anruf es nicht klärt (ca. 20 s)
1. Inbox → **Stufe3_C17** (blaues **Review**) öffnen.
2. Den blauen Kasten **Missing to decide** zeigen (*war der Code noch gültig?*).
3. Rechts **Why the access check is unclear** und die Tabelle **Checks** zeigen.
4. Maus über **Escalate as alert** / **Close as no alert** führen, **nicht klicken**.

### 07-tuning · Compliance stellt ein, wie streng (ca. 20 s)
1. Seitenleiste → **Tuning**. Den Satz *At these settings Klartext catches …* zeigen.
2. Den Regler **Alert from** langsam von 70 nach links unter 50 ziehen: fünf Reviews werden zu Alerts, die Zahlen und Grafiken bewegen sich mit.
3. Zum Schluss **Reset to saved** klicken (setzt nur den Regler zurück, speichert nichts). **Nicht Apply thresholds.**

Hinweis: Die Buttons **Catch everything** / **Balanced** / **Fewer reviews** ändern bei unseren 60 Anrufen keine Zahl (die Scores liegen fast nur bei 0 oder 100). Deshalb im Video den Regler ziehen statt diese Buttons zu klicken.

### 08-rules · Regeln in Klartext (ca. 15 s)
1. Seitenleiste → **Rules**, Tab **Categories**: die fünf Kategorien mit ihrer Regel in normaler Sprache zeigen, langsam scrollen.
2. Tab **Keywords** kurz öffnen (Liste mit Standarddeutsch und Schweizerdeutsch).
3. Nichts umschalten, nichts speichern.

### 09-quality · Ehrlich gemessen (ca. 20 s)
1. Seitenleiste → **Quality**. Es ist **Holdout · final** gewählt: **Recall 1.00**, **Precision 0.91** zeigen.
2. Im Kasten **Breakdown** auf **Audio** klicken (clean vs. noisy).
3. Runterscrollen zu **Every mismatch**.
**Nicht Run evaluation on dev** klicken (sonst ist der Holdout-Lauf nicht mehr der neueste).

### 10-outcept · Jeder Alert landet bei Outcept (ca. 15 s)
**Nur auf Dinesh' Mac aufnehmen.** Die Outcept-Liste (`localhost:8080`) ist absichtlich nur auf seinem Mac erreichbar, und die Links darin zeigen auf `localhost:5173`. Von einem anderen Laptop aus (über die IP) öffnet sich weder die Liste noch der Link. Am besten direkt nach Clip 01 aufnehmen, dann steht `demo_call` oben.

1. Neuer Tab `http://localhost:8080`: die Outcept-Liste mit *Alert: …* und *Review: …*; ganz oben *Alert: Access code shared (demo_call)* aus Clip 01.
2. Auf den Titel dieses Eintrags klicken: Klartext öffnet sich in einem neuen Tab an der Stelle, die Karte ist markiert mit *Opened from Outcept link*. Mit dem neuen Tab weiter aufnehmen, 2 s stehen lassen.

## Danach (Dinesh setzt zurück)

Nach den Aufnahmen ist `demo_call` in der Datenbank und in der Outcept-Liste. Bitte Dinesh Bescheid geben, er setzt die Demo zurück:

1. Aus `backend/`: `python scripts/reset_demo.py` (löscht die Kopie in `inbox/`, entfernt `demo_call`, behält das Transkript und setzt die Outcept-Liste auf die 35 Batch-Einträge zurück).
2. Prüfen: Inbox zeigt 35, `http://localhost:8080` zeigt 35 Einträge, Tuning steht auf 30 / 70.

Wenn ein Clip misslingt: einfach den Clip neu aufnehmen. Nur Clip 01 braucht vorher den Reset (`python scripts/reset_demo.py`), weil `demo_call` sonst schon existiert.
