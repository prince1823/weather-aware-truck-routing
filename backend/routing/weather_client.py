"""
Open-Meteo client: free, no API key required. Hourly forecast with wind,
rain and snowfall, batched across many locations in a single request.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

import requests

from .risk import WeatherSample

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
MAX_FORECAST_DAYS = 16


@dataclass
class HourlySeries:
    times: list[datetime]  # UTC, hourly
    wind_mph: list[float]
    rain_in_hr: list[float]
    snow_in_hr: list[float]

    def sample_at(self, target: datetime) -> WeatherSample | None:
        """Nearest-hour lookup; returns None if target is outside the forecast window."""
        if not self.times:
            return None
        if target < self.times[0] or target > self.times[-1]:
            return None
        # binary search nearest index
        lo, hi = 0, len(self.times) - 1
        while lo < hi:
            mid = (lo + hi) // 2
            if self.times[mid] < target:
                lo = mid + 1
            else:
                hi = mid
        idx = lo
        if idx > 0 and abs((self.times[idx - 1] - target).total_seconds()) < abs((self.times[idx] - target).total_seconds()):
            idx -= 1
        return WeatherSample(
            wind_mph=self.wind_mph[idx],
            rain_in_hr=self.rain_in_hr[idx],
            snow_in_hr=self.snow_in_hr[idx],
        )


def fetch_hourly_batch(locations: list[tuple[float, float]], timeout: float = 20.0) -> list[HourlySeries]:
    """
    locations: list of (lat, lon). Returns one HourlySeries per location, same order.
    Deduplicates identical (rounded) coordinates to cut down on payload/API load.
    """
    if not locations:
        return []

    rounded = [(round(lat, 4), round(lon, 4)) for lat, lon in locations]
    unique_coords = sorted(set(rounded))
    index_of = {coord: i for i, coord in enumerate(unique_coords)}

    lats = ",".join(str(c[0]) for c in unique_coords)
    lons = ",".join(str(c[1]) for c in unique_coords)

    params = {
        "latitude": lats,
        "longitude": lons,
        "hourly": "wind_speed_10m,rain,snowfall",
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
        "timezone": "UTC",
        "forecast_days": MAX_FORECAST_DAYS,
    }
    resp = requests.get(FORECAST_URL, params=params, timeout=timeout)
    resp.raise_for_status()
    data = resp.json()

    # Open-Meteo returns a single object (not a list) when only one location is requested.
    results = data if isinstance(data, list) else [data]

    unique_series: list[HourlySeries] = []
    for entry in results:
        hourly = entry.get("hourly", {})
        times = [datetime.fromisoformat(t).replace(tzinfo=timezone.utc) for t in hourly.get("time", [])]
        unique_series.append(
            HourlySeries(
                times=times,
                wind_mph=hourly.get("wind_speed_10m", []),
                rain_in_hr=hourly.get("rain", []),
                snow_in_hr=hourly.get("snowfall", []),
            )
        )

    return [unique_series[index_of[coord]] for coord in rounded]
