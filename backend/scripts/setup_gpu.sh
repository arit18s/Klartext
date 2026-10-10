#!/usr/bin/env bash
# Klartext GPU box setup (plan B14). Exoscale Ubuntu instance with the NVIDIA driver already installed
# (driver 595 / CUDA 13.2: runs the CUDA 12 libraries that faster-whisper's CTranslate2 needs).
#
#   bash setup_gpu.sh            install, verify, fetch the case audio
#   bash setup_gpu.sh --convert  also convert the two Swiss German fine-tunes to CTranslate2
#
# Idempotent: safe to run again. Everything lives in ~/klartext-gpu. Needs HF_TOKEN in the environment
# for the gated pyannote model (accept its terms on huggingface.co first). The token is never printed.
set -euo pipefail

ROOT="$HOME/klartext-gpu"
VENV="$ROOT/.venv"
MODELS="$ROOT/models"
CASE_REPO="https://github.com/Outcept/inventx-case-study"
FINE_TUNES=("Flix-AI/flix-swissgerman-full" "gcoli/whisper-large-v3-turbo-swiss-german-mit")
mkdir -p "$ROOT" "$MODELS" "$ROOT/out"
cd "$ROOT"

echo "== System packages"
sudo apt-get update -qq
sudo apt-get install -y -qq ffmpeg git git-lfs >/dev/null
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader

echo "== uv and Python 3.11 venv"
if ! command -v uv >/dev/null; then curl -LsSf https://astral.sh/uv/install.sh | sh; fi
export PATH="$HOME/.local/bin:$PATH"
[ -d "$VENV" ] || uv venv --python 3.11 "$VENV"
# shellcheck disable=SC1091
source "$VENV/bin/activate"

echo "== Python packages"
# torch from PyPI ships CUDA on Linux (for pyannote). CTranslate2 (faster-whisper) needs CUDA 12 cuBLAS
# and cuDNN 9 as separate pip libraries, made visible through LD_LIBRARY_PATH in env.sh.
uv pip install -q torch
uv pip install -q "pyannote.audio>=4" faster-whisper soundfile numpy huggingface_hub \
  nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*" transformers
uv pip freeze > "$ROOT/requirements-gpu.lock.txt"
echo "   exact versions recorded in $ROOT/requirements-gpu.lock.txt"

echo "== env.sh (source it in every new shell)"
cat > "$ROOT/env.sh" <<'EOF'
source "$HOME/klartext-gpu/.venv/bin/activate"
export LD_LIBRARY_PATH="$(python -c 'import os, nvidia.cublas.lib, nvidia.cudnn.lib; print(os.path.dirname(nvidia.cublas.lib.__file__) + ":" + os.path.dirname(nvidia.cudnn.lib.__file__))'):${LD_LIBRARY_PATH:-}"
export HF_HOME="$HOME/klartext-gpu/hf-cache"
EOF
# shellcheck disable=SC1091
source "$ROOT/env.sh"

echo "== Verify GPU from both stacks"
python - <<'EOF'
import torch, ctranslate2
print("torch", torch.__version__, "| CUDA available:", torch.cuda.is_available(), "|", torch.cuda.get_device_name(0) if torch.cuda.is_available() else "-")
print("ctranslate2", ctranslate2.__version__, "| CUDA devices:", ctranslate2.get_cuda_device_count())
import faster_whisper, pyannote.audio
print("faster-whisper", faster_whisper.__version__, "| pyannote.audio", pyannote.audio.__version__)
assert torch.cuda.is_available() and ctranslate2.get_cuda_device_count() > 0, "GPU not visible"
EOF
if [ -n "${HF_TOKEN:-}" ]; then echo "   HF_TOKEN is set"; else echo "   WARNING: HF_TOKEN not set (needed for --diarize)"; fi

echo "== Case audio"
if [ ! -d "$ROOT/case-data/Audio" ]; then
  git clone -q --depth 1 "$CASE_REPO" "$ROOT/case-repo"
  mkdir -p "$ROOT/case-data" && cp -r "$ROOT/case-repo/data/Audio" "$ROOT/case-data/Audio"
fi
echo "   $(ls "$ROOT/case-data/Audio"/*.wav | wc -l) WAV files in $ROOT/case-data/Audio"

if [ "${1:-}" = "--convert" ]; then
  echo "== Convert Swiss German fine-tunes to CTranslate2 (float16)"
  for repo in "${FINE_TUNES[@]}"; do
    out="$MODELS/$(basename "$repo")"
    if [ -f "$out/model.bin" ]; then echo "   $repo: already converted"; continue; fi
    ct2-transformers-converter --model "$repo" --output_dir "$out" --quantization float16 --force
    # faster-whisper reads the mel settings from preprocessor_config.json. Without it, a large-v3
    # derivative (128 mel bins) is run with 80 and produces garbage. Copy it, else fall back to the base.
    python - "$repo" "$out" <<'EOF'
import shutil, sys
from huggingface_hub import hf_hub_download
repo, out = sys.argv[1], sys.argv[2]
for name in ("preprocessor_config.json", "tokenizer.json"):
    for source in (repo, "openai/whisper-large-v3"):
        try:
            shutil.copy(hf_hub_download(source, name), f"{out}/{name}")
            print(f"   {name} from {source}")
            break
        except Exception as exc:
            print(f"   {name} not in {source} ({type(exc).__name__})")
EOF
  done
fi

echo "== Ready. Next: source ~/klartext-gpu/env.sh, then run_asr.py (see its --help)."
