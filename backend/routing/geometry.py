"""
Route geometry helpers: cumulative distance/duration along a route and
tiered checkpoint sampling.

Sampling rule (interpretation of the brief's "sample weather every
10 / 25 / 50 miles"): resolution decreases with distance from the origin,
since near-term weather matters most for routing decisions and far-out
checkpoints are coarser estimates anyway:
    - 0-100 miles from origin  -> checkpoint every 10 miles
    - 100-300 miles from origin -> checkpoint every 25 miles
    - beyond 300 miles          -> checkpoint every 50 miles
This keeps the number of weather API calls bounded on long-haul routes
while giving fine-grained risk detection close to departure.
"""
from __future__ import annotations

from dataclasses import dataclass

METERS_PER_MILE = 1609.344

TIER_1_END_MI = 100
TIER_1_STEP_MI = 10
TIER_2_END_MI = 300
TIER_2_STEP_MI = 25
TIER_3_STEP_MI = 50


@dataclass
class RoutePoint:
    lat: float
    lon: float
    distance_mi: float  # cumulative distance from route start
    duration_s: float  # cumulative duration from route start


def build_cumulative_points(coordinates: list[list[float]], distances_m: list[float], durations_s: list[float]) -> list[RoutePoint]:
    """
    coordinates: [[lon, lat], ...] for the full route geometry
    distances_m / durations_s: per-segment annotations, length == len(coordinates) - 1
    """
    points: list[RoutePoint] = []
    cum_dist_mi = 0.0
    cum_dur_s = 0.0
    lon, lat = coordinates[0]
    points.append(RoutePoint(lat=lat, lon=lon, distance_mi=0.0, duration_s=0.0))
    for i in range(1, len(coordinates)):
        seg_dist_mi = distances_m[i - 1] / METERS_PER_MILE
        seg_dur_s = durations_s[i - 1]
        cum_dist_mi += seg_dist_mi
        cum_dur_s += seg_dur_s
        lon, lat = coordinates[i]
        points.append(RoutePoint(lat=lat, lon=lon, distance_mi=cum_dist_mi, duration_s=cum_dur_s))
    return points


def _checkpoint_targets(total_mi: float) -> list[float]:
    targets: list[float] = []
    d = 0.0
    while d < total_mi:
        targets.append(d)
        if d < TIER_1_END_MI:
            d += TIER_1_STEP_MI
        elif d < TIER_2_END_MI:
            d += TIER_2_STEP_MI
        else:
            d += TIER_3_STEP_MI
    if not targets or targets[-1] < total_mi:
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
        duration_s=a.duration_s + (b.duration_s - a.duration_s) * frac,
    )


def sample_checkpoints(points: list[RoutePoint]) -> list[RoutePoint]:
    total_mi = points[-1].distance_mi
    targets = _checkpoint_targets(total_mi)
    return [_interpolate(points, t) for t in targets]
