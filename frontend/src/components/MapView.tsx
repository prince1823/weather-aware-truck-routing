import { useMemo, useRef, useState } from "react";
import Map, { Layer, Marker, Popup, Source, type MapRef } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Checkpoint, HeatmapPoint, PlanResponse } from "../types";
import { riskColor, ROUTE_COLORS } from "../riskColors";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || "";

interface Props {
  plan: PlanResponse;
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

export default function MapView({ plan, selectedRouteId, onSelectRoute, heatmapPoints, heatmapHour, showHeatmap }: Props) {
  const mapRef = useRef<MapRef | null>(null);
  const [activeCheckpoint, setActiveCheckpoint] = useState<Checkpoint | null>(null);
  const initialBounds = useMemo(() => boundsFromRoutes(plan), [plan]);

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

  const orderedRoutes = [...plan.routes].sort((a, b) => (a.id === selectedRouteId ? 1 : 0) - (b.id === selectedRouteId ? 1 : 0));

  return (
    <Map
      ref={mapRef}
      mapboxAccessToken={MAPBOX_TOKEN}
      initialViewState={{ bounds: initialBounds, fitBoundsOptions: { padding: 60 } }}
      style={{ width: "100%", height: "100%" }}
      mapStyle="mapbox://styles/mapbox/light-v11"
    >
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

      {plan.routes[selectedRouteId]?.checkpoints.map((cp, idx) => (
        <Marker key={idx} longitude={cp.lon} latitude={cp.lat} onClick={(e) => { e.originalEvent.stopPropagation(); setActiveCheckpoint(cp); }}>
          <div
            className="checkpoint-dot"
            style={{ background: riskColor(cp.risk_level), borderColor: idx === 0 ? "#111" : "#fff" }}
            title={`${cp.distance_mi} mi — ${cp.risk_level}`}
          />
        </Marker>
      ))}

      {activeCheckpoint && (
        <Popup
          longitude={activeCheckpoint.lon}
          latitude={activeCheckpoint.lat}
          onClose={() => setActiveCheckpoint(null)}
          closeOnClick={false}
          anchor="bottom"
        >
          <div className="checkpoint-popup">
            <strong>{activeCheckpoint.distance_mi} mi from origin</strong>
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

      <div className="route-picker">
        {plan.routes.map((route) => (
          <button
            key={route.id}
            className={route.id === selectedRouteId ? "route-chip active" : "route-chip"}
            onClick={() => onSelectRoute(route.id)}
            style={{ borderColor: route.recommended ? "#16a34a" : ROUTE_COLORS[route.id % ROUTE_COLORS.length] }}
          >
            {route.recommended ? "★ " : ""}Route {route.id + 1}
          </button>
        ))}
      </div>
    </Map>
  );
}
