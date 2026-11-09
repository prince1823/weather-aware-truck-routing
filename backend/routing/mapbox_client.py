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


def geocode_suggestions(query: str, limit: int = 5) -> list[dict]:
    """
    Returns up to `limit` candidate matches for a partial/in-progress query,
    for a live typeahead dropdown. Unlike geocode(), this does not raise on
    a low-relevance top match -- the user picks from the list themselves, so
    weak matches are fine to show (just not auto-selected).
    """
    token = settings.MAPBOX_TOKEN
    if not token:
        raise MapboxError("MAPBOX_TOKEN is not configured on the server")

    url = GEOCODE_URL.format(query=requests.utils.quote(query))
    resp = requests.get(url, params={"access_token": token, "limit": limit}, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    features = data.get("features", [])
    results = []
    for f in features:
        lon, lat = f["center"]
        results.append({"lat": lat, "lon": lon, "label": f.get("place_name", query)})
    return results


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


TARGET_ROUTE_COUNT = 3

# Two routes are treated as "the same route" for de-duplication if both
# their distance and duration are within this fraction of each other.
DEDUP_TOLERANCE = 0.02


def _request_directions(origin: tuple[float, float], destination: tuple[float, float], **extra_params: str) -> list[dict]:
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
        **extra_params,
    }
    resp = requests.get(url, params=params, timeout=20)
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != "Ok":
        raise MapboxError(data.get("message", "Mapbox Directions request failed"))
    return data.get("routes", [])


def _is_duplicate(candidate: dict, existing: list[dict]) -> bool:
    for route in existing:
        dist_close = abs(candidate["distance"] - route["distance"]) <= DEDUP_TOLERANCE * route["distance"]
        dur_close = abs(candidate["duration"] - route["duration"]) <= DEDUP_TOLERANCE * route["duration"]
        if dist_close and dur_close:
            return True
    return False


def get_routes(origin: tuple[float, float], destination: tuple[float, float]) -> list[dict]:
    """
    origin/destination: (lat, lon). Returns up to 3 distinct raw Mapbox route
    objects, each with 'geometry.coordinates' and segment-level
    'legs[0].annotation.distance' / 'duration' arrays aligned to the geometry.

    Mapbox's `alternatives=true` is documented as returning "up to two"
    alternates, but in practice a simple intercity pair (e.g. one dominant
    interstate corridor) often yields only one alternate -- two routes
    total. When that happens, we make a second request excluding motorways
    to find a genuinely different third route (e.g. a state-highway path)
    and merge in the first one that isn't a near-duplicate of what we
    already have. If the road network truly offers no third distinct path
    (e.g. a short local trip), we return what's available rather than
    fabricate a route.
    """
    routes = _request_directions(origin, destination)

    if len(routes) < TARGET_ROUTE_COUNT:
        try:
            alt_routes = _request_directions(origin, destination, exclude="motorway")
        except MapboxError:
            alt_routes = []
        for candidate in sorted(alt_routes, key=lambda r: r["distance"]):
            if len(routes) >= TARGET_ROUTE_COUNT:
                break
            if not _is_duplicate(candidate, routes):
                routes.append(candidate)

    return routes[:TARGET_ROUTE_COUNT]
