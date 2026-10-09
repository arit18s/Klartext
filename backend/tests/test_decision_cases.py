"""Runs shared/decision_cases.json against app.pipeline.decide (the frontend runs the same file against decide.ts).

Run from backend/: python -m unittest tests.test_decision_cases   (pytest also collects it)
"""

from __future__ import annotations

import json
import math
import unittest
from pathlib import Path

from app.pipeline.decide import DecisionInput, decide

CASES = json.loads((Path(__file__).resolve().parents[2] / "shared" / "decision_cases.json").read_text(encoding="utf-8"))["cases"]


class DecisionCases(unittest.TestCase):
    def test_cases(self) -> None:
        self.assertGreaterEqual(len(CASES), 12)
        for case in CASES:
            with self.subTest(case["name"]):
                out = decide(DecisionInput(**case["input"])).model_dump()
                for key, want in case["expected"].items():
                    if key == "score":
                        self.assertTrue(math.isclose(out[key], want, abs_tol=1e-9), f"score {out[key]} != {want}")
                    else:
                        self.assertEqual(out[key], want, key)


if __name__ == "__main__":
    unittest.main()
