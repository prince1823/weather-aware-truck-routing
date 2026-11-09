"""
Per-route risk aggregation and route recommendation ranking.

Mileage-at-risk is attributed by treating each checkpoint's classified
risk as representative of the road segment running from that checkpoint
to the next one (i.e. "the weather you'll be driving through for the
next N miles looks like this"). This is a reasonable approximation given
checkpoints, not continuous sampling, are what the brief asks for.
"""
from __future__ import annotations

from dataclasses import dataclass

from .risk import RiskLevel


@dataclass
class CheckpointResult:
    lat: float
    lon: float
    distance_mi: float
    eta: str  # ISO 8601
    risk_level: str
    reason: str
    wind_mph: float | None
    rain_in_hr: float | None
    snow_in_hr: float | None
    forecast_available: bool


@dataclass
class RouteSummary:
    severe_plus_miles: float
    high_miles: float
    average_risk: float
    duration_s: float
    distance_mi: float
    overall_risk: str


def summarize_route(checkpoints: list[CheckpointResult], total_distance_mi: float, duration_s: float) -> RouteSummary:
    severe_plus_miles = 0.0
    high_miles = 0.0
    weighted_risk_sum = 0.0

    for i, cp in enumerate(checkpoints):
        if i == len(checkpoints) - 1:
            segment_mi = 0.0
        else:
            segment_mi = max(0.0, checkpoints[i + 1].distance_mi - cp.distance_mi)

        level = RiskLevel[cp.risk_level.upper().replace(" ", "_")]
        if level >= RiskLevel.SEVERE:
            severe_plus_miles += segment_mi
        if level == RiskLevel.HIGH:
            high_miles += segment_mi
        weighted_risk_sum += int(level) * segment_mi

    average_risk = weighted_risk_sum / total_distance_mi if total_distance_mi > 0 else 0.0
    overall = max((RiskLevel[cp.risk_level.upper().replace(" ", "_")] for cp in checkpoints), default=RiskLevel.LOW)

    return RouteSummary(
        severe_plus_miles=round(severe_plus_miles, 1),
        high_miles=round(high_miles, 1),
        average_risk=round(average_risk, 3),
        duration_s=duration_s,
        distance_mi=round(total_distance_mi, 1),
        overall_risk=overall.label,
    )


def rank_routes(summaries: list[RouteSummary]) -> list[int]:
    """
    Returns indices of `summaries` ordered best-first, applying the brief's
    tie-break priority: fewest severe+ miles, then fewest high miles,
    then lowest average risk, then shortest travel time.
    """
    indexed = list(enumerate(summaries))
    indexed.sort(key=lambda pair: (pair[1].severe_plus_miles, pair[1].high_miles, pair[1].average_risk, pair[1].duration_s))
    return [i for i, _ in indexed]
