"""Write real API responses into frontend/src/fixtures-real/ (plan B27), for a fixture fallback with
real numbers when the backend is down during the demo. Not frontend/src/fixtures/: those hand-made files
are also the expected values of the API contract tests (backend/tests/test_api_*.py).

Every file is fetched through the running app's own routes (FastAPI TestClient on the current
database, watcher off), so the fixtures are exactly what the live API returns:
  calls.json, call_detail_<id>.json (one per call), scores.json, families.json, keywords.json,
  eval.json (GET /eval/latest), settings.json
Old call_detail files without a call are removed.

Usage (from backend/): python scripts/export_fixtures.py [--out ../frontend/src/fixtures-real]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

os.environ["WATCHER_ENABLED"] = "false"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

FILES = {
    "calls.json": "/api/calls",
    "scores.json": "/api/scores",
    "families.json": "/api/config/families",
    "keywords.json": "/api/config/keywords",
    "eval.json": "/api/eval/latest",
    "settings.json": "/api/settings",
}


def write(path: Path, data: object) -> int:
    text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    path.write_text(text, encoding="utf-8")
    return len(text.encode("utf-8"))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[2] / "frontend" / "src" / "fixtures-real")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    total = 0
    with TestClient(app) as client:
        def get(url: str) -> object:
            r = client.get(url)
            if r.status_code != 200:
                raise SystemExit(f"GET {url} -> {r.status_code}: {r.text[:200]}")
            return r.json()

        for name, url in FILES.items():
            total += write(args.out / name, get(url))
        calls = get("/api/calls")["items"]
        keep = set()
        for item in calls:
            name = f"call_detail_{item['call_id']}.json"
            total += write(args.out / name, get(f"/api/calls/{item['call_id']}"))
            keep.add(name)
    removed = [p.name for p in args.out.glob("call_detail_*.json") if p.name not in keep]
    for name in removed:
        (args.out / name).unlink()
    print(f"Wrote {len(FILES) + len(keep)} fixtures ({total / 1024:.0f} KB) to {args.out}: {len(calls)} calls"
          + (f"; removed {len(removed)} old detail files" if removed else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
