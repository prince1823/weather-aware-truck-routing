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
        <h1>Weather-Aware Truck Routing</h1>
        <RouteForm onSubmit={handleSubmit} loading={planLoading} />
        {planError && <p className="field-error">{planError}</p>}
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
