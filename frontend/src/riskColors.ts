import type { RiskLevel } from "./types";

export const RISK_COLORS: Record<RiskLevel, string> = {
  Low: "#2ea043",
  Moderate: "#d4a72c",
  High: "#e8742c",
  Severe: "#d9304f",
  "No Travel": "#6e2bd9",
};

export const ROUTE_COLORS = ["#2563eb", "#64748b", "#94a3b8"];

export function riskColor(level: RiskLevel | null | undefined): string {
  if (!level) return "#9ca3af";
  return RISK_COLORS[level] ?? "#9ca3af";
}
