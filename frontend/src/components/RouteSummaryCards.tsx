import type { RouteOption } from "../types";
import { riskColor, ROUTE_COLORS } from "../riskColors";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

interface Props {
  routes: RouteOption[];
  selectedRouteId: number;
  onSelectRoute: (id: number) => void;
}

export default function RouteSummaryCards({ routes, selectedRouteId, onSelectRoute }: Props) {
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
          <div className="route-card-stats">
            <span>{route.summary.distance_mi} mi</span>
            <span>{formatDuration(route.summary.duration_s)}</span>
            <span>{route.summary.severe_plus_miles} mi severe+</span>
            <span>{route.summary.high_miles} mi high</span>
          </div>
        </button>
      ))}
    </div>
  );
}
