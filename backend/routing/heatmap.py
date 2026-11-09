"""
Corridor weather-risk heatmap: samples points along a route geometry and
returns, for each, a risk score at every hour offset 0-48h from departure
so the frontend can drive a forecast-hour slider without refetching.
"""
from __future__ import annotations

from datetime import timedelta

from .geometry import RoutePoint, build_cumulative_points
from .risk import RiskLevel, WeatherSample, classify_checkpoint_risk
from .weather_client import fetch_hourly_batch

HEATMAP_SPACING_MI = 20
MAX_HOUR_OFFSET = 48


def _heatmap_targets(total_mi: float) -> list[float]:
    targets = []
    d = 0.0
    while d < total_mi:
        targets.append(d)
        d += HEATMAP_SPACING_MI
    targets.append(total_mi)
    return targets


def _interpolate(points: list[RoutePoint], target_mi: float) -> RoutePoint:
    if target_mi <= points[0].distance_mi:
        return points[0]
    if target_mi >= points[-1].distance_mi:
        return points[-1]
    lo, hi = 0, len(points) - 1
    while lo < hi - 1:
        mid = (lo + hi) // 2
        if points[mid].distance_mi <= target_mi:
            lo = mid
        else:
            hi = mid
    a, b = points[lo], points[hi]
    span = b.distance_mi - a.distance_mi
    frac = 0.0 if span <= 0 else (target_mi - a.distance_mi) / span
    return RoutePoint(
        lat=a.lat + (b.lat - a.lat) * frac,
        lon=a.lon + (b.lon - a.lon) * frac,
        distance_mi=target_mi,
        duration_s=0.0,
    )


def build_corridor_heatmap(coordinates: list[list[float]], distances_m: list[float], durations_s: list[float], departure_time, load_weight_lb: float) -> list[dict]:
    points = build_cumulative_points(coordinates, distances_m, durations_s)
    total_mi = points[-1].distance_mi
    targets = _heatmap_targets(total_mi)
    samples = [_interpolate(points, t) for t in targets]

    series_list = fetch_hourly_batch([(p.lat, p.lon) for p in samples])

    result = []
    for point, series in zip(samples, series_list):
        hours = []
        for offset in range(0, MAX_HOUR_OFFSET + 1):
            target_time = departure_time + timedelta(hours=offset)
            sample = series.sample_at(target_time)
            if sample is None:
                hours.append({"hour_offset": offset, "risk_level": None, "risk_score": None})
                continue
            result_risk = classify_checkpoint_risk(sample, load_weight_lb)
            hours.append(
                {
                    "hour_offset": offset,
                    "risk_level": result_risk.level.label,
                    "risk_score": round(int(result_risk.level) / int(RiskLevel.NO_TRAVEL), 3),
                }
            )
        result.append({"lat": point.lat, "lon": point.lon, "distance_mi": round(point.distance_mi, 1), "hours": hours})

    return result
