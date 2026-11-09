import { useState } from "react";
import RouteForm, { type FormValues } from "./components/RouteForm";
import MapView from "./components/MapView";
import RouteSummaryCards from "./components/RouteSummaryCards";
import HeatmapSlider from "./components/HeatmapSlider";
import Legend from "./components/Legend";
import { apiErrorMessage, fetchHeatmap, planRoutes } from "./api";
import type { HeatmapPoint, PlanResponse } from "./types";

export default function App() {
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState(0);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const [heatmapPoints, setHeatmapPoints] = useState<HeatmapPoint[] | null>(null);
  const [heatmapHour, setHeatmapHour] = useState(0);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [heatmapLoading, setHeatmapLoading] = useState(false);

  async function loadHeatmapFor(planData: PlanResponse, routeId: number) {
    const route = planData.routes.find((r) => r.id === routeId);
    if (!route) return;
    setHeatmapLoading(true);
    try {
      const res = await fetchHeatmap({
        geometry: route.geometry,
        distances_m: route.distances_m,
        durations_s: route.durations_s,
        departure_time: planData.departure_time,
        load_weight_lb: planData.load_weight_lb,
      });
      setHeatmapPoints(res.points);
    } catch {
      setHeatmapPoints(null);
    } finally {
      setHeatmapLoading(false);
    }
  }

  async function handleSubmit(values: FormValues) {
    setPlanLoading(true);
    setPlanError(null);
    setPlan(null);
    setHeatmapPoints(null);
    try {
      const departureIso = new Date(values.departureLocal).toISOString();
      const result = await planRoutes({
        origin: values.origin,
        destination: values.destination,
        departure_time: departureIso,
        load_weight_lb: values.loadWeightLb,
      });
      setPlan(result);
      setSelectedRouteId(result.recommended_route_id);
      setHeatmapHour(0);
      void loadHeatmapFor(result, result.recommended_route_id);
    } catch (err) {
      setPlanError(apiErrorMessage(err));
    } finally {
      setPlanLoading(false);
    }
  }

  function handleSelectRoute(routeId: number) {
    setSelectedRouteId(routeId);
    if (plan) void loadHeatmapFor(plan, routeId);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 16V6a1 1 0 0 1 1-1h9v11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M13 9h4.5L21 12.5V16h-8V9Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="7" cy="17.5" r="1.8" stroke="currentColor" strokeWidth="1.8" />
              <circle cx="17.5" cy="17.5" r="1.8" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </span>
          <div>
            <h1>Weather-Aware Routing</h1>
            <p className="brand-subtitle">Safer freight routes, forecast-driven</p>
          </div>
        </div>
        <RouteForm onSubmit={handleSubmit} loading={planLoading} />
        {planError && <p className="error-banner card-enter">{planError}</p>}
        {plan && (
          <RouteSummaryCards routes={plan.routes} selectedRouteId={selectedRouteId} onSelectRoute={handleSelectRoute} />
        )}
        <Legend />
      </aside>
      <main className="map-pane">
        {plan ? (
          <>
            <MapView
              plan={plan}
              selectedRouteId={selectedRouteId}
              onSelectRoute={handleSelectRoute}
              heatmapPoints={heatmapPoints}
              heatmapHour={heatmapHour}
              showHeatmap={showHeatmap}
            />
            <div className="heatmap-overlay">
              <HeatmapSlider
                hour={heatmapHour}
                maxHour={48}
                onChange={setHeatmapHour}
                show={showHeatmap}
                onToggle={setShowHeatmap}
                departureIso={plan.departure_time}
                loading={heatmapLoading}
              />
            </div>
          </>
        ) : (
          <div className="map-placeholder">
            {planLoading ? "Calculating routes and checkpoint weather…" : "Enter a trip to see routes on the map."}
          </div>
        )}
      </main>
    </div>
  );
}
