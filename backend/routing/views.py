from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timedelta, timezone

from rest_framework.decorators import api_view
from rest_framework.response import Response

from . import mapbox_client
from .geometry import build_cumulative_points, sample_checkpoints
from .heatmap import build_corridor_heatmap
from .recommendation import CheckpointResult, rank_routes, summarize_route
from .risk import WeatherSample, classify_checkpoint_risk
from .serializers import (
    GeocodeRequestSerializer,
    GeocodeSuggestRequestSerializer,
    HeatmapRequestSerializer,
    PlanRequestSerializer,
    ReverseGeocodeRequestSerializer,
)
from .weather_client import WeatherServiceError, fetch_hourly_batch


@api_view(["GET"])
def health(request):
    return Response({"status": "ok"})


@api_view(["GET"])
def geocode(request):
    serializer = GeocodeRequestSerializer(data=request.query_params)
    serializer.is_valid(raise_exception=True)
    try:
        lat, lon, place_name = mapbox_client.geocode(serializer.validated_data["query"])
    except mapbox_client.MapboxError as exc:
        return Response({"error": str(exc)}, status=400)
    return Response({"lat": lat, "lon": lon, "label": place_name})


@api_view(["GET"])
def geocode_suggest(request):
    serializer = GeocodeSuggestRequestSerializer(data=request.query_params)
    serializer.is_valid(raise_exception=True)
    try:
        suggestions = mapbox_client.geocode_suggestions(
            serializer.validated_data["query"], limit=serializer.validated_data["limit"]
        )
    except mapbox_client.MapboxError as exc:
        return Response({"error": str(exc)}, status=400)
    return Response({"suggestions": suggestions})


@api_view(["GET"])
def reverse_geocode(request):
    serializer = ReverseGeocodeRequestSerializer(data=request.query_params)
    serializer.is_valid(raise_exception=True)
    try:
        label = mapbox_client.reverse_geocode(serializer.validated_data["lat"], serializer.validated_data["lon"])
    except mapbox_client.MapboxError as exc:
        return Response({"error": str(exc)}, status=400)
    return Response({"label": label})


@api_view(["POST"])
def plan(request):
    serializer = PlanRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    origin = data["origin"]
    destination = data["destination"]
    departure_time = data["departure_time"]
    load_weight_lb = data["load_weight_lb"]

    if departure_time < datetime.now(timezone.utc):
        return Response({"error": "Departure time cannot be in the past"}, status=400)

    try:
        raw_routes = mapbox_client.get_routes((origin["lat"], origin["lon"]), (destination["lat"], destination["lon"]))
    except mapbox_client.MapboxError as exc:
        return Response({"error": str(exc)}, status=400)

    if not raw_routes:
        return Response({"error": "No routes found between the given locations"}, status=404)

    # Build cumulative geometry + checkpoints for every route first, then
    # batch ALL checkpoints across ALL routes into a single weather call.
    per_route_points = []
    per_route_checkpoints_raw = []
    for raw in raw_routes:
        coords = raw["geometry"]["coordinates"]
        leg = raw["legs"][0]
        annotation = leg["annotation"]
        points = build_cumulative_points(coords, annotation["distance"], annotation["duration"])
        checkpoints = sample_checkpoints(points)
        per_route_points.append(points)
        per_route_checkpoints_raw.append(checkpoints)

    all_checkpoints_flat = [cp for route_cps in per_route_checkpoints_raw for cp in route_cps]
    try:
        series_flat = fetch_hourly_batch([(cp.lat, cp.lon) for cp in all_checkpoints_flat])
    except WeatherServiceError as exc:
        return Response({"error": f"Weather service is temporarily unavailable, please try again shortly ({exc})"}, status=503)

    series_iter = iter(series_flat)
    routes_payload = []
    summaries = []

    for route_idx, raw in enumerate(raw_routes):
        checkpoints_raw = per_route_checkpoints_raw[route_idx]
        checkpoint_results: list[CheckpointResult] = []

        for cp in checkpoints_raw:
            series = next(series_iter)
            eta = departure_time + timedelta(seconds=cp.duration_s)
            sample = series.sample_at(eta)
            if sample is None:
                if series.times and eta > series.times[-1]:
                    reason = "forecast unavailable beyond 16-day window; treated as Low"
                else:
                    reason = "no forecast data for this time; treated as Low"
                checkpoint_results.append(
                    CheckpointResult(
                        lat=cp.lat,
                        lon=cp.lon,
                        distance_mi=round(cp.distance_mi, 1),
                        eta=eta.isoformat(),
                        risk_level="Low",
                        reason=reason,
                        wind_mph=None,
                        rain_in_hr=None,
                        snow_in_hr=None,
                        forecast_available=False,
                    )
                )
                continue

            risk_result = classify_checkpoint_risk(sample, load_weight_lb)
            checkpoint_results.append(
                CheckpointResult(
                    lat=cp.lat,
                    lon=cp.lon,
                    distance_mi=round(cp.distance_mi, 1),
                    eta=eta.isoformat(),
                    risk_level=risk_result.level.label,
                    reason=risk_result.reason,
                    wind_mph=round(sample.wind_mph, 1),
                    rain_in_hr=round(sample.rain_in_hr, 3),
                    snow_in_hr=round(sample.snow_in_hr, 3),
                    forecast_available=True,
                )
            )

        total_distance_mi = per_route_points[route_idx][-1].distance_mi
        total_duration_s = per_route_points[route_idx][-1].duration_s
        summary = summarize_route(checkpoint_results, total_distance_mi, total_duration_s)
        summaries.append(summary)

        routes_payload.append(
            {
                "id": route_idx,
                "geometry": raw["geometry"],
                "distance_mi": round(total_distance_mi, 1),
                "duration_s": total_duration_s,
                "distances_m": raw["legs"][0]["annotation"]["distance"],
                "durations_s": raw["legs"][0]["annotation"]["duration"],
                "checkpoints": [asdict(cp) for cp in checkpoint_results],
                "summary": asdict(summary),
            }
        )

    ranking = rank_routes(summaries)
    for rank_position, route_idx in enumerate(ranking):
        routes_payload[route_idx]["rank"] = rank_position
        routes_payload[route_idx]["recommended"] = rank_position == 0

    return Response(
        {
            "origin": origin,
            "destination": destination,
            "departure_time": departure_time.isoformat(),
            "load_weight_lb": load_weight_lb,
            "routes": routes_payload,
            "recommended_route_id": ranking[0],
        }
    )


@api_view(["POST"])
def heatmap(request):
    serializer = HeatmapRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    coordinates = data["geometry"].get("coordinates")
    if not coordinates:
        return Response({"error": "geometry.coordinates is required"}, status=400)

    try:
        points = build_corridor_heatmap(
            coordinates,
            data["distances_m"],
            data["durations_s"],
            data["departure_time"],
            data["load_weight_lb"],
        )
    except WeatherServiceError as exc:
        return Response({"error": f"Weather service is temporarily unavailable, please try again shortly ({exc})"}, status=503)
    return Response({"points": points, "max_hour_offset": 48})
