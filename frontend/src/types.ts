export type RiskLevel = "Low" | "Moderate" | "High" | "Severe" | "No Travel";

export interface Place {
  lat: number;
  lon: number;
  label: string;
}

export interface Checkpoint {
  lat: number;
  lon: number;
  distance_mi: number;
  eta: string;
  risk_level: RiskLevel;
  reason: string;
  wind_mph: number | null;
  rain_in_hr: number | null;
  snow_in_hr: number | null;
  forecast_available: boolean;
}

export interface RouteSummary {
  no_travel_miles: number;
  severe_miles: number;
  high_miles: number;
  average_risk: number;
  duration_s: number;
  distance_mi: number;
  overall_risk: RiskLevel;
}

export interface GeoJSONLineGeometry {
  type: "LineString";
  coordinates: [number, number][];
}

export interface RouteOption {
  id: number;
  geometry: GeoJSONLineGeometry;
  distance_mi: number;
  duration_s: number;
  distances_m: number[];
  durations_s: number[];
  checkpoints: Checkpoint[];
  summary: RouteSummary;
  rank: number;
  recommended: boolean;
}

export interface PlanResponse {
  origin: Place;
  destination: Place;
  departure_time: string;
  load_weight_lb: number;
  routes: RouteOption[];
  recommended_route_id: number;
}

export interface HeatmapHourSample {
  hour_offset: number;
  risk_level: RiskLevel | null;
  risk_score: number | null;
}

export interface HeatmapPoint {
  lat: number;
  lon: number;
  distance_mi: number;
  hours: HeatmapHourSample[];
}

export interface HeatmapResponse {
  points: HeatmapPoint[];
  max_hour_offset: number;
}
