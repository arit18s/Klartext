"""Run the inbox watcher standalone (plan B26). Ctrl-C stops it.

Usage (from backend/): python scripts/watch_inbox.py [--inbox ../inbox]
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.init import init_db  # noqa: E402
from app.services.watcher import InboxWatcher  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--inbox", type=Path, help="Folder to watch (default INBOX_DIR)")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx2").setLevel(logging.WARNING)
    init_db()
    w = InboxWatcher(args.inbox)
    w.start()
    print(f"Watching {w.inbox} (every {w.poll_interval_s:.0f} s). Drop WAV files there. Ctrl-C to stop.", flush=True)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        w.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
