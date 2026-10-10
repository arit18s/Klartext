"""Background work started by write endpoints (recheck, retry, process-folder).

One worker thread, so API-started pipeline runs never overlap each other. Progress and results reach the
UI through the pipeline's own live updates (SSE `call_updated`, `pipeline_status`).
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor

log = logging.getLogger(__name__)
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="api-job")


def _run(name: str, fn: Callable[[], object]) -> None:
    try:
        fn()
    except Exception:  # the pipeline marks calls failed itself; this only keeps the worker alive
        log.exception("Background job %s failed", name)


def submit(name: str, fn: Callable[[], object]) -> Future:
    return _executor.submit(_run, name, fn)
