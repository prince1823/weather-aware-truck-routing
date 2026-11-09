"""
Open-Meteo client: free, no API key required. Hourly forecast with wind,
rain and snowfall, batched across many locations in a single request.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime, timezone

import requests

from .risk import WeatherSample

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
MAX_FORECAST_DAYS = 16

# Open-Meteo's free tier enforces a per-minute rate limit; under bursty
# traffic a 429 is transient, not a permanent failure, so we back off and
# retry a couple of times before giving up.
RETRY_STATUS_CODES = {429, 502, 503, 504}
MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = 2.0


class WeatherServiceError(Exception):
    """Raised when Open-Meteo is unavailable after retries."""


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
    resp = None
    last_error: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.get(FORECAST_URL, params=params, timeout=timeout)
            if resp.status_code in RETRY_STATUS_CODES and attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_BACKOFF_SECONDS * (attempt + 1))
                continue
            resp.raise_for_status()
            break
        except requests.RequestException as exc:
            last_error = exc
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_BACKOFF_SECONDS * (attempt + 1))
                continue
            raise WeatherServiceError(f"Weather service unavailable after {MAX_RETRIES} attempts: {exc}") from exc
    else:
        raise WeatherServiceError("Weather service unavailable")

    if resp is None or not resp.ok:
        raise WeatherServiceError(f"Weather service returned {resp.status_code if resp else 'no response'} after {MAX_RETRIES} attempts")

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
