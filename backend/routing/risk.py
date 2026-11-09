"""
Weather risk classification and load-adjusted escalation rules.

Risk levels, ordered from least to most severe:
    LOW < MODERATE < HIGH < SEVERE < NO_TRAVEL
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum


class RiskLevel(IntEnum):
    LOW = 0
    MODERATE = 1
    HIGH = 2
    SEVERE = 3
    NO_TRAVEL = 4

    @property
    def label(self) -> str:
        return {
            RiskLevel.LOW: "Low",
            RiskLevel.MODERATE: "Moderate",
            RiskLevel.HIGH: "High",
            RiskLevel.SEVERE: "Severe",
            RiskLevel.NO_TRAVEL: "No Travel",
        }[self]


# Base thresholds, as given in the assessment brief. Each tuple is the
# inclusive lower bound for (Moderate, High, Severe, No Travel); anything
# below the first bound is Low.
WIND_BOUNDS_MPH = (25, 35, 45, 55)
RAIN_BOUNDS_IN_HR = (0.10, 0.25, 0.50, 1.00)
SNOW_BOUNDS_IN_HR = (0.5, 1.0, 2.0, 3.0)


def _classify(value: float, bounds: tuple[float, float, float, float]) -> RiskLevel:
    low, high, severe, no_travel = bounds
    if value >= no_travel:
        return RiskLevel.NO_TRAVEL
    if value >= severe:
        return RiskLevel.SEVERE
    if value >= high:
        return RiskLevel.HIGH
    if value >= low:
        return RiskLevel.MODERATE
    return RiskLevel.LOW


@dataclass
class WeatherSample:
    wind_mph: float
    rain_in_hr: float
    snow_in_hr: float


@dataclass
class RiskResult:
    level: RiskLevel
    wind_level: RiskLevel
    rain_level: RiskLevel
    snow_level: RiskLevel
    reason: str


def classify_checkpoint_risk(weather: WeatherSample, load_lb: float) -> RiskResult:
    """
    Classify a single checkpoint's risk from its weather sample and the
    truck's load weight, applying the load-escalation rules on top of the
    base per-condition thresholds.
    """
    wind_level = _classify(weather.wind_mph, WIND_BOUNDS_MPH)
    rain_level = _classify(weather.rain_in_hr, RAIN_BOUNDS_IN_HR)
    snow_level = _classify(weather.snow_in_hr, SNOW_BOUNDS_IN_HR)

    level = max(wind_level, rain_level, snow_level)
    reason = f"base:{level.label}"

    # Load rules operate on wind specifically, as specified in the brief.
    if weather.wind_mph >= 55:
        level = RiskLevel.NO_TRAVEL
        reason = "wind>=55mph: No Travel for any load"
    elif weather.wind_mph >= 45 and load_lb > 30_000:
        level = RiskLevel.NO_TRAVEL
        reason = f"wind {weather.wind_mph:.0f}mph (45-54) + load {load_lb:.0f}lb > 30,000lb: No Travel"
    elif 35 <= weather.wind_mph < 45 and load_lb > 40_000:
        if level < RiskLevel.SEVERE:
            level = RiskLevel.SEVERE
            reason = f"wind {weather.wind_mph:.0f}mph (35-44) + load {load_lb:.0f}lb > 40,000lb: Severe"

    return RiskResult(
        level=level,
        wind_level=wind_level,
        rain_level=rain_level,
        snow_level=snow_level,
        reason=reason,
    )
