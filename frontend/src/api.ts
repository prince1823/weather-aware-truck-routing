import axios from "axios";
import type { GeoJSONLineGeometry, HeatmapResponse, PlanResponse, Place } from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

const client = axios.create({ baseURL: API_BASE_URL });

export async function geocode(query: string): Promise<Place> {
  const res = await client.get("/api/geocode/", { params: { query } });
  return res.data;
}

export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const res = await client.get("/api/reverse-geocode/", { params: { lat, lon } });
  return res.data.label;
}

export interface PlanRequest {
  origin: Place;
  destination: Place;
  departure_time: string;
  load_weight_lb: number;
}

export async function planRoutes(req: PlanRequest): Promise<PlanResponse> {
  const res = await client.post("/api/plan/", req);
  return res.data;
}

export interface HeatmapRequest {
  geometry: GeoJSONLineGeometry;
  distances_m: number[];
  durations_s: number[];
  departure_time: string;
  load_weight_lb: number;
}

export async function fetchHeatmap(req: HeatmapRequest): Promise<HeatmapResponse> {
  const res = await client.post("/api/heatmap/", req);
  return res.data;
}

export function apiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data;
    if (data?.error) return data.error;
    if (typeof data === "object" && data) {
      const firstKey = Object.keys(data)[0];
      const val = data[firstKey];
      if (Array.isArray(val)) return `${firstKey}: ${val[0]}`;
    }
    return err.message;
  }
  return String(err);
}
