#!/usr/bin/env bash
# Transcribe new recordings on the GPU box in one go (runbook steps 2-5), for a live test or the hidden set.
#
#   backend/scripts/transcribe_on_gpu.sh <folder-with-recordings> <name>
#   e.g. backend/scripts/transcribe_on_gpu.sh ~/Downloads/new-calls test2
#
# 1. Prepares the recordings (WAV, MP3, M4A, MP4, FLAC, OGG) as 16 kHz mono WAV in data/<name>/ (prepare_hidden_set.py)
# 2. Checks that the GPU box answers
# 3. Uploads the WAVs, runs Whisper large-v3 + speaker separation on the box, fetches the transcripts into data/transcripts/
#
# HF_TOKEN (for the speaker separation model) comes from the environment, else from .env, else it is asked for
# (hidden). It goes to the box over the SSH connection's input: never on a command line, on screen or in a history.
# Afterwards: drop the WAVs from data/<name>/ in the app, or cp them into inbox/. Then stop the GPU box.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
# The GPU machine (user@host): from the environment, else GPU_HOST in .env (kept out of git).
if [ -z "${GPU_HOST:-}" ] && [ -f "$REPO/.env" ]; then
  GPU_HOST="$(grep -E '^GPU_HOST=' "$REPO/.env" | head -1 | cut -d= -f2- | tr -d '"'"'"' ')" || true
fi
if [ -z "${GPU_HOST:-}" ]; then
  echo "Set the GPU machine: add GPU_HOST=user@host to .env, or run with GPU_HOST=user@host in front."
  exit 2
fi
PY="$REPO/.venv/bin/python"

if [ $# -ne 2 ]; then
  echo "Usage: $0 <folder-with-recordings> <name>     (name: letters, digits, - or _; e.g. test2)"
  exit 2
fi
IN="$1"
NAME="$2"
if ! [[ "$NAME" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "The name may only contain letters, digits, - and _ (got: $NAME)."
  exit 2
fi
if [ ! -d "$IN" ]; then
  echo "Folder not found: $IN"
  exit 2
fi
OUT="$REPO/data/$NAME"
cd "$REPO"

echo "== 1/4 Preparing recordings from $IN"
"$PY" backend/scripts/prepare_hidden_set.py --in "$IN" --out "$OUT"
COUNT=$(find "$OUT" -maxdepth 1 -name '*.wav' | wc -l | tr -d ' ')
if [ "$COUNT" = "0" ]; then
  echo "No recordings found in $IN. Accepted: WAV, MP3, M4A, MP4, FLAC, OGG."
  exit 1
fi

echo "== 2/4 Checking the GPU machine ($GPU_HOST)"
if ! ssh -o ConnectTimeout=10 -o BatchMode=yes "$GPU_HOST" 'nvidia-smi --query-gpu=name --format=csv,noheader' ; then
  echo "The GPU machine does not answer. Start it (our setup: Exoscale console > Compute > Instances > klartext > Start),"
  echo "wait until it runs, then run this script again. If it runs and still does not answer: allow SSH from your"
  echo "current IP, and check that 'ssh $GPU_HOST' works without a password (SSH key). Other host: GPU_HOST=user@host"
  exit 1
fi

TOKEN="${HF_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f "$REPO/.env" ]; then
  TOKEN="$(grep -E '^HF_TOKEN=' "$REPO/.env" | head -1 | cut -d= -f2- | tr -d '"'"'"' ')" || true
fi
if [ -z "$TOKEN" ]; then
  read -r -s -p "Hugging Face token (not shown): " TOKEN
  echo
fi

echo "== 3/4 Uploading $COUNT recordings and transcribing (about 20 s per call, plus model loading)"
ssh "$GPU_HOST" "mkdir -p ~/klartext-gpu/$NAME ~/klartext-gpu/out/$NAME"
scp -q "$OUT"/*.wav "$GPU_HOST:~/klartext-gpu/$NAME/"
printf '%s\n' "$TOKEN" | ssh "$GPU_HOST" "read -r HF_TOKEN && export HF_TOKEN && source ~/klartext-gpu/env.sh && \
  python ~/run_asr.py --in ~/klartext-gpu/$NAME --out ~/klartext-gpu/out/$NAME --model large-v3 --diarize"
TOKEN=""

echo "== 4/4 Fetching the transcripts"
mkdir -p "$REPO/data/transcripts"
scp -q "$GPU_HOST:~/klartext-gpu/out/$NAME/*.json" "$REPO/data/transcripts/"
GOT=0
for wav in "$OUT"/*.wav; do
  id="$(basename "$wav" .wav)"
  if [ -f "$REPO/data/transcripts/$id.json" ]; then GOT=$((GOT + 1)); else echo "   missing transcript: $id"; fi
done
echo
echo "Done: $GOT of $COUNT transcripts in data/transcripts/."
echo "Next: drop the WAVs from data/$NAME/ on the Pipeline page, or:   cp data/$NAME/*.wav inbox/"
echo "Then stop the GPU machine if you pay for it by the hour (our setup: Exoscale console > klartext > Stop)."
