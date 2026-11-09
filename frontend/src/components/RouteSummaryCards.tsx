import type { RouteOption } from "../types";
import { riskColor, ROUTE_COLORS } from "../riskColors";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatArrival(departureIso: string, durationS: number): string {
  const arrival = new Date(new Date(departureIso).getTime() + durationS * 1000);
  return arrival.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function describeRoute(route: RouteOption, allRoutes: RouteOption[]): string {
  const fastestDuration = Math.min(...allRoutes.map((r) => r.summary.duration_s));
  const extraMinutes = Math.round((route.summary.duration_s - fastestDuration) / 60);
  const extra = extraMinutes > 0 ? ` (+${extraMinutes}m vs fastest)` : " — fastest option";
  const { no_travel_miles, severe_miles, high_miles, overall_risk } = route.summary;

  if (no_travel_miles > 0) {
    return `Passes through ${no_travel_miles} mi of No Travel conditions — avoid`;
  }
  if (severe_miles > 0) {
    return `${severe_miles} mi of Severe weather exposure along the way`;
  }
  if (high_miles > 0) {
    return `${high_miles} mi of High-risk weather exposure`;
  }
  if (overall_risk === "Moderate") {
    return `Brief patches of Moderate weather${extra}`;
  }
  return `Clear conditions the whole way${extra}`;
}

interface Props {
  routes: RouteOption[];
  selectedRouteId: number;
  onSelectRoute: (id: number) => void;
  departureIso: string;
}

export default function RouteSummaryCards({ routes, selectedRouteId, onSelectRoute, departureIso }: Props) {
  const sorted = [...routes].sort((a, b) => a.rank - b.rank);

  return (
    <div className="route-cards">
      {sorted.map((route, idx) => (
        <button
          key={route.id}
          className={route.id === selectedRouteId ? "route-card active card-enter" : "route-card card-enter"}
          onClick={() => onSelectRoute(route.id)}
          style={{
            borderLeftColor: route.recommended ? "#16a34a" : ROUTE_COLORS[route.id % ROUTE_COLORS.length],
            animationDelay: `${idx * 70}ms`,
          }}
        >
          <div className="route-card-header">
            <span className="route-card-title">
              {route.recommended && <span className="badge-recommended">Recommended</span>}
              Route {route.id + 1}
            </span>
            <span className="route-card-overall" style={{ color: riskColor(route.summary.overall_risk) }}>
              {route.summary.overall_risk}
            </span>
          </div>

          <p className="route-card-description">{describeRoute(route, routes)}</p>

          <div className="route-card-stats">
            <span>{route.summary.distance_mi} mi</span>
            <span>{formatDuration(route.summary.duration_s)}</span>
            <span>Arrives {formatArrival(departureIso, route.summary.duration_s)}</span>
          </div>

          <div className="route-card-stats route-card-stats-risk">
            {route.summary.no_travel_miles > 0 && (
              <span className="stat-no-travel">{route.summary.no_travel_miles} mi no-travel</span>
            )}
            <span>{route.summary.severe_miles} mi severe</span>
            <span>{route.summary.high_miles} mi high</span>
          </div>
        </button>
      ))}
    </div>
  );
}
