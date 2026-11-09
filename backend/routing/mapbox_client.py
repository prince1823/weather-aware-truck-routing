"""Mapbox Directions + Geocoding client."""
from __future__ import annotations

import requests
from django.conf import settings

GEOCODE_URL = "https://api.mapbox.com/geocoding/v5/mapbox.places/{query}.json"
DIRECTIONS_URL = "https://api.mapbox.com/directions/v5/mapbox/driving/{coords}"

# Mapbox always returns its best fuzzy guess, even for gibberish queries, with
# a 'relevance' score (0-1) indicating how well the match fits. Below this
# threshold we treat it as "not found" rather than silently routing to a
# random real place on Earth.
MIN_GEOCODE_RELEVANCE = 0.5


class MapboxError(Exception):
    pass


def geocode(place: str) -> tuple[float, float, str]:
    """Returns (lat, lon, matched_place_name)."""
    token = settings.MAPBOX_TOKEN
    if not token:
        raise MapboxError("MAPBOX_TOKEN is not configured on the server")

    url = GEOCODE_URL.format(query=requests.utils.quote(place))
    resp = requests.get(url, params={"access_token": token, "limit": 1}, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    features = data.get("features", [])
    if not features:
        raise MapboxError(f"No location found for '{place}'")

    best = features[0]
    if best.get("relevance", 1.0) < MIN_GEOCODE_RELEVANCE:
        raise MapboxError(f"No confident location match for '{place}' — check the spelling")

    lon, lat = best["center"]
    return lat, lon, best.get("place_name", place)


def reverse_geocode(lat: float, lon: float) -> str:
    """Returns a short human-readable place label for a coordinate (e.g. 'Hays, Kansas')."""
    token = settings.MAPBOX_TOKEN
    if not token:
        raise MapboxError("MAPBOX_TOKEN is not configured on the server")

    url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{lon},{lat}.json"
    resp = requests.get(
        url,
        params={"access_token": token, "types": "place,locality,region", "limit": 1},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    features = data.get("features", [])
    if not features:
        return "Unnamed area"
    return features[0].get("place_name", "Unnamed area")


def get_routes(origin: tuple[float, float], destination: tuple[float, float]) -> list[dict]:
    """
    origin/destination: (lat, lon). Returns raw Mapbox route objects
    (up to 3), each with 'geometry.coordinates' and segment-level
    'legs[0].annotation.distance' / 'duration' arrays aligned to the geometry.
    """
    token = settings.MAPBOX_TOKEN
    if not token:
        raise MapboxError("MAPBOX_TOKEN is not configured on the server")

    coords = f"{origin[1]},{origin[0]};{destination[1]},{destination[0]}"
    url = DIRECTIONS_URL.format(coords=coords)
    params = {
        "alternatives": "true",
        "geometries": "geojson",
        "overview": "full",
        "annotations": "distance,duration",
        "access_token": token,
    }
    resp = requests.get(url, params=params, timeout=20)
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != "Ok":
        raise MapboxError(data.get("message", "Mapbox Directions request failed"))
    return data.get("routes", [])
