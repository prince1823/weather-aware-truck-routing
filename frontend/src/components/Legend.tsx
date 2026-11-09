import { RISK_COLORS } from "../riskColors";

export default function Legend() {
  return (
    <div className="legend">
      {Object.entries(RISK_COLORS).map(([label, color]) => (
        <span key={label} className="legend-item">
          <span className="legend-swatch" style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}
