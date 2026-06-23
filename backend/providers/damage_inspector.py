"""Damage inspection AI abstraction.

Current impl: `StubInspector` — deterministic-ish score based on photo
count and notes length. Future impl: real CV model API (Tata Elxsi
DamagePro, AWS Rekognition Custom, …).
"""

from __future__ import annotations

import os
import random
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Optional


@dataclass
class InspectionInput:
    photos: List[str]
    video: Optional[str]
    odometer: float
    fuel_level: str
    notes: str = ""
    previous_input: Optional["InspectionInput"] = None  # set for 'after' phase


@dataclass
class InspectionResult:
    ai_score: float                # 0 = pristine, 1 = severe damage
    findings: list[dict]            # bounding-box stubs
    comparison: dict | None         # only for 'after' phase
    provider: str


class DamageInspector(ABC):
    name: str = "abstract"

    @abstractmethod
    async def score(self, inp: InspectionInput) -> InspectionResult: ...


class StubInspector(DamageInspector):
    name = "stub"

    async def score(self, inp: InspectionInput) -> InspectionResult:
        photo_count = sum(1 for p in inp.photos if p)
        completeness = min(1.0, photo_count / 6.0)
        base = round(random.uniform(0.02, 0.18), 3)
        # If 'after' phase and notes mention damage keywords, bump score.
        bumps = 0.0
        for kw in ("scratch", "dent", "crack", "broken", "damage"):
            if kw in inp.notes.lower():
                bumps += 0.15
        score = min(1.0, base + bumps)
        findings = []
        if bumps > 0:
            findings.append({"label": "user-reported damage", "confidence": 0.99, "bbox": None})
        comparison = None
        if inp.previous_input is not None:
            km_delta = max(0.0, inp.odometer - inp.previous_input.odometer)
            comparison = {
                "km_traveled": km_delta,
                "fuel_before": inp.previous_input.fuel_level,
                "fuel_after": inp.fuel_level,
                "damage_delta": round(score - 0.05, 3),
                "verdict": "clean" if score < 0.25 else "review_required",
            }
        return InspectionResult(
            ai_score=score,
            findings=findings,
            comparison=comparison,
            provider=self.name,
        )


_singleton: DamageInspector | None = None


def get_damage_inspector() -> DamageInspector:
    global _singleton
    if _singleton is None:
        provider = os.getenv("DAMAGE_AI_PROVIDER", "stub").lower()
        if provider == "stub":
            _singleton = StubInspector()
        else:
            _singleton = StubInspector()
    return _singleton
