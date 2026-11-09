import { useEffect, useMemo, useRef, useState } from "react";
import Map, { Layer, Marker, NavigationControl, Popup, ScaleControl, Source, type MapRef } from "react-map-gl/mapbox";
import type { Map as MapboxMap } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Checkpoint, HeatmapPoint, PlanResponse } from "../types";
import { riskColor, ROUTE_COLORS } from "../riskColors";
import { reverseGeocode } from "../api";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || "";

const MAP_STYLES: { key: string; label: string; url: string }[] = [
  { key: "satellite", label: "Satellite", url: "mapbox://styles/mapbox/satellite-streets-v12" },
  { key: "streets", label: "Streets", url: "mapbox://styles/mapbox/streets-v12" },
  { key: "light", label: "Light", url: "mapbox://styles/mapbox/light-v11" },
  { key: "outdoors", label: "Terrain", url: "mapbox://styles/mapbox/outdoors-v12" },
  { key: "dark", label: "Dark", url: "mapbox://styles/mapbox/dark-v11" },
];

const GLOBE_IDLE_CENTER: [number, number] = [10, 25];
const GLOBE_IDLE_ZOOM = 1.15;
const GLOBE_SPIN_DEG_PER_SEC = 3;

interface Props {
  plan: PlanResponse | null;
  selectedRouteId: number;
  onSelectRoute: (id: number) => void;
  heatmapPoints: HeatmapPoint[] | null;
  heatmapHour: number;
  showHeatmap: boolean;
}

function boundsFromRoutes(plan: PlanResponse): [[number, number], [number, number]] {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const route of plan.routes) {
    for (const [lon, lat] of route.geometry.coordinates) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return [[minLon, minLat], [maxLon, maxLat]];
}

function placeKey(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function MapView({ plan, selectedRouteId, onSelectRoute, heatmapPoints, heatmapHour, showHeatmap }: Props) {
  const mapRef = useRef<MapRef | null>(null);
  const spinFrameRef = useRef<number | null>(null);
  const spinningRef = useRef(true);
  const [mapInstance, setMapInstance] = useState<MapboxMap | null>(null);
  const [activeCheckpoint, setActiveCheckpoint] = useState<Checkpoint | null>(null);
  const [mapStyleKey, setMapStyleKey] = useState("satellite");
  const [placeNames, setPlaceNames] = useState<Record<string, string>>({});
  const [placeLoadingKey, setPlaceLoadingKey] = useState<string | null>(null);
  const targetBounds = useMemo(() => (plan ? boundsFromRoutes(plan) : null), [plan]);
  const mapStyleUrl = MAP_STYLES.find((s) => s.key === mapStyleKey)?.url ?? MAP_STYLES[0].url;

  // react-map-gl's onLoad can be missed (e.g. a recycled map instance under
  // React StrictMode's double-mount in dev), so poll for the underlying
  // mapboxgl.Map instance directly instead of relying on that event.
  useEffect(() => {
    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | null = null;

    function check() {
      const map = mapRef.current?.getMap();
      if (map && !cancelled) {
        setMapInstance(map);
        if (pollId) clearInterval(pollId);
      }
    }
    check();
    if (!mapInstance) pollId = setInterval(check, 50);

    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Idle globe auto-rotation, stopped permanently once a plan is loaded or the user interacts.
  useEffect(() => {
    if (!mapInstance || plan) return;
    const map = mapInstance;

    spinningRef.current = true;
    let last = performance.now();

    function frame(now: number) {
      if (!spinningRef.current) return;
      const dt = (now - last) / 1000;
      last = now;
      const center = map!.getCenter();
      center.lng += GLOBE_SPIN_DEG_PER_SEC * dt;
      map!.setCenter(center);
      spinFrameRef.current = requestAnimationFrame(frame);
    }

    function stopSpin() {
      spinningRef.current = false;
      if (spinFrameRef.current) cancelAnimationFrame(spinFrameRef.current);
    }

    map.on("dragstart", stopSpin);
    map.on("zoomstart", stopSpin);
    spinFrameRef.current = requestAnimationFrame(frame);

    return () => {
      stopSpin();
      map.off("dragstart", stopSpin);
      map.off("zoomstart", stopSpin);
    };
  }, [mapInstance, plan]);

  // Smooth cinematic zoom from the idle globe into the route corridor once a plan loads.
  useEffect(() => {
    if (!mapInstance || !targetBounds) return;
    spinningRef.current = false;
    if (spinFrameRef.current) cancelAnimationFrame(spinFrameRef.current);

    mapInstance.fitBounds(targetBounds, {
      padding: 70,
      duration: 3200,
      essential: true,
      curve: 1.42,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapInstance, targetBounds]);

  useEffect(() => {
    if (!activeCheckpoint) return;
    const key = placeKey(activeCheckpoint.lat, activeCheckpoint.lon);
    if (placeNames[key] || placeLoadingKey === key) return;
    setPlaceLoadingKey(key);
    reverseGeocode(activeCheckpoint.lat, activeCheckpoint.lon)
      .then((label) => setPlaceNames((prev) => ({ ...prev, [key]: label })))
      .catch(() => setPlaceNames((prev) => ({ ...prev, [key]: "Unknown area" })))
      .finally(() => setPlaceLoadingKey(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCheckpoint]);

  const heatmapGeoJSON = useMemo(() => {
    if (!heatmapPoints) return null;
    return {
      type: "FeatureCollection" as const,
      features: heatmapPoints
        .map((p) => {
          const sample = p.hours.find((h) => h.hour_offset === heatmapHour);
          if (!sample || sample.risk_score === null) return null;
          return {
            type: "Feature" as const,
            properties: { weight: sample.risk_score },
            geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] },
          };
        })
        .filter((f): f is NonNullable<typeof f> => f !== null),
    };
  }, [heatmapPoints, heatmapHour]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="map-missing-token">
        Set VITE_MAPBOX_TOKEN in frontend/.env to display the map.
      </div>
    );
  }

  const orderedRoutes = plan ? [...plan.routes].sort((a, b) => (a.id === selectedRouteId ? 1 : 0) - (b.id === selectedRouteId ? 1 : 0)) : [];
  const activeKey = activeCheckpoint ? placeKey(activeCheckpoint.lat, activeCheckpoint.lon) : null;
  const activePlaceName = activeKey ? placeNames[activeKey] : null;

  return (
    <Map
      ref={mapRef}
      mapboxAccessToken={MAPBOX_TOKEN}
      initialViewState={{ longitude: GLOBE_IDLE_CENTER[0], latitude: GLOBE_IDLE_CENTER[1], zoom: GLOBE_IDLE_ZOOM }}
      style={{ width: "100%", height: "100%" }}
      mapStyle={mapStyleUrl}
      projection="globe"
      fog={{}}
    >
      <NavigationControl position="top-right" visualizePitch />
      <ScaleControl position="bottom-right" unit="imperial" />

      {showHeatmap && heatmapGeoJSON && (
        <Source id="corridor-heatmap" type="geojson" data={heatmapGeoJSON}>
          <Layer
            id="corridor-heatmap-layer"
            type="heatmap"
            paint={{
              "heatmap-weight": ["get", "weight"],
              "heatmap-intensity": 1.1,
              "heatmap-radius": 36,
              "heatmap-opacity": 0.65,
              "heatmap-color": [
                "interpolate",
                ["linear"],
                ["heatmap-density"],
                0, "rgba(46,160,67,0)",
                0.25, "#2ea043",
                0.5, "#d4a72c",
                0.75, "#e8742c",
                1, "#d9304f",
              ],
            }}
          />
        </Source>
      )}

      {orderedRoutes.map((route) => {
        const isSelected = route.id === selectedRouteId;
        const color = route.recommended ? "#16a34a" : ROUTE_COLORS[route.id % ROUTE_COLORS.length];
        return (
          <Source key={route.id} id={`route-${route.id}`} type="geojson" data={{ type: "Feature", properties: {}, geometry: route.geometry }}>
            <Layer
              id={`route-${route.id}-line`}
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-color": color,
                "line-width": isSelected ? 6 : 3,
                "line-opacity": isSelected ? 0.95 : 0.45,
              }}
            />
          </Source>
        );
      })}

      {plan?.routes[selectedRouteId]?.checkpoints.map((cp, idx, arr) => {
        const isEndpoint = idx === 0 || idx === arr.length - 1;
        return (
          <Marker key={idx} longitude={cp.lon} latitude={cp.lat}>
            {isEndpoint ? (
              <div
                className={idx === 0 ? "endpoint-pin endpoint-origin" : "endpoint-pin endpoint-destination"}
                onMouseEnter={() => setActiveCheckpoint(cp)}
                onMouseLeave={() => setActiveCheckpoint((cur) => (cur === cp ? null : cur))}
              >
                <span className="endpoint-pin-icon">{idx === 0 ? "A" : "B"}</span>
                <span className="endpoint-pin-label">{idx === 0 ? plan!.origin.label : plan!.destination.label}</span>
              </div>
            ) : (
              <div
                className="checkpoint-dot"
                style={{ background: riskColor(cp.risk_level) }}
                title={`${cp.distance_mi} mi — ${cp.risk_level}`}
                onMouseEnter={() => setActiveCheckpoint(cp)}
                onMouseLeave={() => setActiveCheckpoint((cur) => (cur === cp ? null : cur))}
              >
                {activeCheckpoint === cp && <span className="checkpoint-dot-label">{cp.distance_mi} mi</span>}
              </div>
            )}
          </Marker>
        );
      })}

      {activeCheckpoint && (
        <Popup
          longitude={activeCheckpoint.lon}
          latitude={activeCheckpoint.lat}
          onClose={() => setActiveCheckpoint(null)}
          closeOnClick={false}
          anchor="bottom"
        >
          <div className="checkpoint-popup">
            <strong className="checkpoint-popup-place">
              {activePlaceName ?? (placeLoadingKey === activeKey ? "Locating…" : "")}
            </strong>
            <div>{activeCheckpoint.distance_mi} mi from origin</div>
            <div>ETA: {new Date(activeCheckpoint.eta).toLocaleString()}</div>
            <div style={{ color: riskColor(activeCheckpoint.risk_level), fontWeight: 600 }}>
              {activeCheckpoint.risk_level}
            </div>
            {activeCheckpoint.forecast_available ? (
              <div className="checkpoint-weather">
                Wind {activeCheckpoint.wind_mph} mph · Rain {activeCheckpoint.rain_in_hr} in/hr · Snow {activeCheckpoint.snow_in_hr} in/hr
              </div>
            ) : (
              <div className="checkpoint-weather">Forecast unavailable this far out</div>
            )}
            <div className="checkpoint-reason">{activeCheckpoint.reason}</div>
          </div>
        </Popup>
      )}

      {plan && (
        <div className="route-picker">
          {plan.routes.map((route) => (
            <button
              key={route.id}
              className={route.id === selectedRouteId ? "route-chip active" : "route-chip"}
              onClick={() => onSelectRoute(route.id)}
              style={{ borderColor: route.recommended ? "#16a34a" : ROUTE_COLORS[route.id % ROUTE_COLORS.length] }}
            >
              <span className="route-chip-title">
                {route.recommended ? "★ " : ""}Route {route.id + 1}
              </span>
              <span className="route-chip-summary">
                {route.summary.distance_mi} mi · {formatDuration(route.summary.duration_s)} ·{" "}
                <span style={{ color: riskColor(route.summary.overall_risk) }}>{route.summary.overall_risk}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="style-switcher">
        {MAP_STYLES.map((s) => (
          <button
            key={s.key}
            className={s.key === mapStyleKey ? "style-chip active" : "style-chip"}
            onClick={() => setMapStyleKey(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </Map>
  );
}
