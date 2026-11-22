# Klartext

**Jedes Bankgespräch gehört. Jeder Alarm erklärt.**

*[English version](README.md)*

Klartext prüft jedes aufgezeichnete Gespräch zwischen Bankkundinnen und -kunden und ihren Beratern auf Schweizerdeutsch. Es erkennt Insiderhandel, weitergegebene Zugangscodes, Informationen an Dritte und weitere Compliance-Risiken. Für jedes auffällige Gespräch zeigt es der Compliance-Fachperson genau die Stelle, die sie anhören sollte, mit Zeitangabe und einer verständlichen Begründung. Enthält das Gespräch nicht genug Fakten für einen Entscheid, sagt Klartext, was fehlt, und gibt das Gespräch an einen Menschen weiter.

Entwickelt für den Inventx × Outcept Case am sprintd Innovation Sprint Zürich, Oktober 2026.

**Unsere ganze Video-Präsentation:** [youtu.be/NVrGVU0pd80](https://youtu.be/NVrGVU0pd80) · **Folien:** [docs/pitch/klartext-pitch_final.pdf](docs/pitch/klartext-pitch_final.pdf)

## Das Problem

- Banken zeichnen jedes Beratungsgespräch auf, prüfen aber nur Stichproben. Fehlverhalten bleibt auf beiden Seiten der Leitung unentdeckt.
- Die Gespräche sind auf Schweizerdeutsch, und damit haben handelsübliche Spracherkennungs-Tools Mühe.
- Stichwortfilter funktionieren nicht. „Ich lese Ihnen die sechs Ziffern vor" ist harmlos, wenn eine Kundin ein abgelaufenes Beispiel aus einer Anleitung vorliest. Es ist ein ernster Vorfall, wenn die Kundin gerade ein Login gestartet hat und einen gültigen Code vorliest. Der Unterschied steckt im Kontext, oft Minuten früher im Gespräch.

## So löst Klartext das Problem

```
WAV im Eingangsordner
  → Spracherkennung (Schweizerdeutsch, Zeitstempel pro Wort)
  → Sprechertrennung (Berater / Kunde)
  → Zahlen vereinheitlichen
  → Stichwort-Hinweise
  → eine kontextbezogene Prüfung pro Risikokategorie
  → Entscheid: Alarm / Prüfung / kein Alarm
  → Belegstellen + ähnliches Gespräch
  → Alarm an Outcept mit direktem Link zur Stelle
```

**1. Audio rein, kein manueller Schritt.** Eine Ordnerüberwachung erkennt jede neue Aufnahme und schickt sie vollständig durch die Pipeline. Auf demselben Weg lässt sich ein ganzer Ordner auf einmal verarbeiten.

**2. Spracherkennung für Dialekt.** Open-Weight-Whisper-Modelle (auch für Schweizerdeutsch nachtrainierte Varianten) laufen auf unserer eigenen GPU. Wir wählen das Modell danach, wie zuverlässig es die entscheidenden Wörter erfasst (Ziffern, Firmennamen, Schlüsselbegriffe), nicht nach der allgemeinen Wortfehlerrate. Die Sprechertrennung ordnet jede Zeile dem Berater oder der Kundin zu.

**3. Stichwörter sind Hinweise, keine Urteile.** Eine anpassbare Stichwortliste (Standarddeutsch und Schweizerdeutsch) lenkt die Prüfungen auf die richtigen Stellen. Ein Stichwort allein löst nie einen Alarm aus.

**4. Eine Prüfung pro Risikokategorie, die den ganzen Kontext liest.** Jede Kategorie hat ihre eigene Prüfung durch ein Open-Weight-Sprachmodell:

| Kategorie | Worauf sie achtet |
|---|---|
| Handel mit nicht öffentlichen Informationen | Aufträge oder Empfehlungen auf Basis von Nachrichten, die noch nicht öffentlich sind |
| Aufteilen, um eine Freigabe zu umgehen | Zahlungen werden so aufgeteilt, dass kein Teil eine Freigabe braucht |
| Zugangscode weitergegeben | Ein gültiger Login-Code, ein Einmalpasswort oder eine PIN wird jemandem vorgelesen |
| Informationen an Dritte | Kontodaten werden ohne Einverständnis der Inhaberin oder des Inhabers weitergegeben |
| Relevante Informationen weggelassen | Risiken oder Aussagen der Kundschaft werden absichtlich nicht dokumentiert |

Jede Prüfung muss zuerst die plausibelste harmlose Lesart nennen, die genauen Stellen zitieren, auf die sie sich stützt, und sagen, wenn das Gespräch die Frage nicht klärt. Jede Prüfung läuft mehrmals, und die Übereinstimmung zwischen den Durchläufen fliesst in die Sicherheit ein.

**5. Der Code entscheidet, nicht das Modell.** Das Sprachmodell liefert strukturierte Befunde. Eine kleine, nachvollziehbare Regel macht daraus den Entscheid:

- **Alarm**, wenn die Belege stark sind.
- **Prüfung**, wenn der Score im mittleren Bereich liegt, wenn die Fakten für einen Entscheid fehlen (die offene Frage wird ausgeschrieben), wenn das Transkript an der entscheidenden Stelle unklar ist oder wenn eine Prüfung fehlschlägt.
- **Kein Alarm** in allen anderen Fällen.

Fehler führen immer zu einer Prüfung, nie zu Stillschweigen. Ein echter Fall, der zur Prüfung geht, gilt trotzdem als erkannt.

**6. Jeder Alarm ist nachvollziehbar.** Zu jedem auffälligen Gespräch gibt es:
- die verdächtigen Stellen als Audioausschnitte (mit 10 Sekunden Kontext davor und danach), Zeitangaben und Sprecher
- die Begründung in verständlicher Sprache und das Kriterium, das sie stützt
- ein **ähnliches Gespräch**, falls es eines gibt: ein vergleichbares Gespräch *ohne* Alarm und den Unterschied zwischen beiden in einem Satz

**7. Compliance behält die Kontrolle.** Die Compliance-Fachperson stellt mit zwei Schwellenwerten ein, wie streng Klartext ist, und sieht sofort die Wirkung auf Treffer, Präzision und Trefferquote. Sie kann Kategorien ein- und ausschalten und Regeln und Stichwörter in normaler Sprache bearbeiten, ohne Code. Jede Änderung wird versioniert und im Audit-Log festgehalten.

**8. Ehrlich gemessen.** Die Erkennungsqualität wird auf zurückgehaltenen Gesprächen gemessen, die nie zum Abstimmen verwendet wurden. Wir berichten Präzision, Trefferquote, die vollständige Wahrheitsmatrix, Ergebnisse für saubere und verrauschte Aufnahmen und wie oft die zitierte Stelle mit der erwarteten Belegstelle übereinstimmt. Ausserdem vergleichen wir mit einem reinen Stichwortfilter.

## Gebaut für das Umfeld einer Bank

- **Nur Open-Weight-Modelle.** Die Modelle für Spracherkennung und Textanalyse können auf GPUs innerhalb der Bank laufen. Das Sprachmodell ist über eine OpenAI-kompatible Adresse angebunden. Der Wechsel von einem gehosteten Dienst zu einem selbst betriebenen vLLM-Server ist daher eine einzige Konfigurationsänderung.
- **Transkripte gelten als nicht vertrauenswürdig.** Gesprächsinhalte werden als Daten behandelt. Die Prompts ignorieren Anweisungen, die im Gespräch gesprochen werden, die Ausgaben werden gegen ein striktes Schema geprüft, und jede zitierte Stelle muss im Transkript vorkommen.
- **Audit-Trail.** Zu jedem Entscheid werden das Modell, die Konfigurationsversionen und die Rohausgaben der Prüfungen gespeichert. So lässt er sich reproduzieren und einer Prüfstelle erklären.
- **Keine echten Daten.** Der Prototyp verwendet nur die fiktiven Case-Daten von Inventx und Outcept.

## Technologie

Python 3.11 · FastAPI · SQLite (SQLModel) · faster-whisper (Whisper large-v3) · pyannote community-1 · Open-Weight-LLM (Qwen3.6 27B) über eine OpenAI-kompatible API · React + TypeScript (Vite, Tailwind) · wavesurfer.js

## Mit eigenen Aufnahmen ausprobieren

Schritt-für-Schritt-Anleitung für Case-Partner und Testpersonen: einmal einrichten, dann neue Aufnahmen mit einem Befehl transkribieren und in der App prüfen, in 5–10 Minuten: [`docs/GUIDE_PARTNERS.md`](docs/GUIDE_PARTNERS.md) (auf Englisch).

## Starten

Ausgehend von einem frischen Klon. Voraussetzungen: macOS oder Linux mit [uv](https://docs.astral.sh/uv/), ffmpeg, Docker, Node 22+, ein OpenAI-kompatibler Zugang zu einem Open-Weight-Modell (während des Sprints OpenRouter) und für die Spracherkennung ein GPU-Rechner mit NVIDIA-Karte und ein Hugging-Face-Token.

### 1. Backend einrichten

```bash
git clone https://github.com/Dinesh18S/Klartext.git && cd Klartext
uv venv --python 3.11 .venv
uv pip install --python .venv/bin/python -r backend/requirements.txt
cp .env.example .env        # danach LLM_API_KEY, LLM_MODEL (z. B. qwen/qwen3.6-27b) und HF_TOKEN eintragen
```

`LLM_SAMPLES=5` und `LLM_REASONING=off` so lassen: Das ist die evaluierte Konfiguration. Schlüssel bleiben in `.env`, die git ignoriert.

### 2. Case-Daten und Datenbank

```bash
git clone --depth 1 https://github.com/Outcept/inventx-case-study /tmp/inventx-case-study
mkdir -p case-data && cp -R /tmp/inventx-case-study/data/. case-data/
cd backend && ../.venv/bin/python -m app.db.init && cd ..   # legt data/klartext.db mit den Startkonfigurationen an
```

`case-data/`, `data/` und `inbox/` werden von git ignoriert: Im Repository liegen weder Audio noch Ergebnisse.

### 3. Outcept-Trigger-API

```bash
docker compose up -d trigger-api    # Liste unter http://localhost:8080, nur lokal erreichbar
```

### 4. Spracherkennung (GPU-Rechner)

Klartext transkribiert auf seiner eigenen GPU. Die Pipeline auf dem Laptop liest die Transkripte aus `data/transcripts/<call_id>.json`.

```bash
scp backend/scripts/run_asr.py backend/scripts/setup_gpu.sh <user>@<gpu-host>:~/
ssh <user>@<gpu-host>
read -s HF_TOKEN && export HF_TOKEN          # vorher die Bedingungen von pyannote/speaker-diarization-community-1 akzeptieren
bash ~/setup_gpu.sh && source ~/klartext-gpu/env.sh
python ~/run_asr.py --in ~/klartext-gpu/case-data/Audio --out ~/klartext-gpu/out/large-v3 --model large-v3 --diarize
```

Zurück auf dem Laptop: `scp "<user>@<gpu-host>:~/klartext-gpu/out/large-v3/*.json" data/transcripts/`, danach den GPU-Rechner stoppen.

### 5. Alle Gespräche verarbeiten

```bash
cd backend && ../.venv/bin/python scripts/process_all.py && cd ..
```

Führt alle Schritte für die 60 Aufnahmen aus (Rollen, Zahlen, Stichwörter, Kategorie-Prüfungen, Entscheid, Audioausschnitte, ähnliche Gespräche, Outcept-Trigger) und gibt die Anzahlen aus. Bei einem erneuten Lauf werden gespeicherte Ergebnisse wiederverwendet. `--from <stage>` startet ab einem bestimmten Schritt neu, `--list` zeigt jeden Entscheid.

### 6. API-Server mit Ordnerüberwachung

```bash
cd backend && ../.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

API-Dokumentation unter http://127.0.0.1:8000/docs. Die Ordnerüberwachung startet mit dem Server: Eine WAV-Datei in `inbox/` wird ohne Klick verarbeitet (ihr Transkript muss in `data/transcripts/` liegen). `WATCHER_ENABLED=false` schaltet sie aus.

### 7. Frontend

```bash
cd frontend && npm install && npm run dev       # http://127.0.0.1:5173, leitet /api an Port 8000 weiter
```

Ohne Backend: `VITE_USE_FIXTURES=true` in `frontend/.env.development` setzen (Beispieldaten mit simulierter Pipeline).

### 8. Evaluation

```bash
cd backend
../.venv/bin/python scripts/evaluate.py --split dev --source asr     # Präzision, Trefferquote, Wahrheitsmatrix, Paare, Übereinstimmung der Belegstellen
../.venv/bin/python scripts/asr_benchmark.py                         # Spracherkennungsmodelle nach Erkennung der kritischen Wörter (dev)
../.venv/bin/python scripts/injection_test.py                        # Prompt-Injection darf keinen Entscheid ändern
```

Der Holdout-Teil wird einmal mit eingefrorenen Prompts und Schwellenwerten evaluiert (`--split holdout --holdout`). Die Ergebnisse stehen auf der Seite „Quality".

### 9. Ein neuer Ordner mit Aufnahmen (versteckter Testsatz) und Export

```bash
.venv/bin/python backend/scripts/prepare_hidden_set.py --in <folder> --out data/hidden-test-set
# data/hidden-test-set/*.wav auf dem GPU-Rechner transkribieren (Schritt 4), Ergebnis nach data/transcripts/
cd backend && ../.venv/bin/python scripts/process_all.py --folder ../data/hidden-test-set
../.venv/bin/python scripts/export_results.py --folder ../data/hidden-test-set --out ../data/export/hidden_results
```

Vollständige Anleitung Schritt für Schritt: [`docs/RUNBOOK_HIDDEN_SET.md`](docs/RUNBOOK_HIDDEN_SET.md) (auf Englisch). Alle Gespräche auf einmal: `GET /api/pipeline/export?format=json` oder `format=csv`.

### Tests

```bash
cd backend && ../.venv/bin/python -m pytest -q        # API, Pipeline, gemeinsame Entscheid-Testfälle
cd frontend && npm test                               # decide.ts gegen dieselbe shared/decision_cases.json
```
