#!/usr/bin/env bash
# Hidden test set (or any new batch) from recordings to results in one command, for the 09:00 window.
#
#   backend/scripts/run_hidden_set.sh <folder-or-zip-from-the-organisers> [name]   (name default: hidden-test-set)
#
# A .zip is unpacked into data/incoming/<name>/ first; recordings are found in subfolders too.
#
# 1. transcribe_on_gpu.sh: prepare (any audio format), upload, Whisper + speaker separation, transcripts back
# 2. process_all.py on the folder, checks at LLM_CONCURRENCY=16 (not the watcher: that does one call at a time)
# 3. export_results.py: data/export/<name>_results.csv and .json, with the original file names
# 4. summary: calls per verdict and the time each step took
#
# Safe to run again: prepared files and transcripts are reused, finished calls are kept, failed ones retried.
# Needs: GPU machine running, backend running (for the app and Outcept), .env with the keys.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PY="$REPO/.venv/bin/python"
IN="${1:-}"
NAME="${2:-hidden-test-set}"
if [ -z "$IN" ]; then
  echo "Usage: $0 <folder-or-zip-with-recordings> [name]"
  exit 2
fi
case "$IN" in
  *.zip|*.ZIP)
    [ -f "$IN" ] || { echo "ZIP not found: $IN"; exit 2; }
    UNZIP_DIR="$REPO/data/incoming/$NAME"
    echo "== Unpacking $IN into data/incoming/$NAME"
    rm -rf "$UNZIP_DIR" && mkdir -p "$UNZIP_DIR"
    unzip -q -o "$IN" -d "$UNZIP_DIR"
    IN="$UNZIP_DIR"
    ;;
esac
START=$(date +%s)
stamp() { echo "   [$(( $(date +%s) - START )) s]"; }

echo "== Speech to text on the GPU"
"$REPO/backend/scripts/transcribe_on_gpu.sh" "$IN" "$NAME"
stamp

echo "== Checks and decisions (LLM_CONCURRENCY=${LLM_CONCURRENCY:-16})"
cd "$REPO/backend"
LLM_CONCURRENCY="${LLM_CONCURRENCY:-16}" "$PY" scripts/process_all.py --folder "../data/$NAME"
stamp

echo "== Export"
mkdir -p "$REPO/data/export"
"$PY" scripts/export_results.py --folder "../data/$NAME" --out "../data/export/${NAME}_results"
stamp

echo
echo "== Summary"
"$PY" - "$REPO/data/export/${NAME}_results.csv" <<'EOF'
import csv, sys
from collections import Counter
rows = list(csv.DictReader(open(sys.argv[1], encoding="utf-8")))
calls = {r["call_id"]: r for r in rows}
label = {"alarm": "Alert", "review": "Review", "no_alert": "No alert", "": "not decided"}
counts = Counter(label.get(r.get("verdict") or "", r.get("verdict")) for r in calls.values())
print(f"{len(calls)} calls: " + ", ".join(f"{n} {v}" for v, n in counts.most_common()))
EOF
echo "Results: data/export/${NAME}_results.csv (and .json). In the app: All calls."
echo "Total: $(( $(date +%s) - START )) s. Then stop the GPU machine."
