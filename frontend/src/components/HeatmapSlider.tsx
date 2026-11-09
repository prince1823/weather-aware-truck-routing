interface Props {
  hour: number;
  maxHour: number;
  onChange: (hour: number) => void;
  show: boolean;
  onToggle: (show: boolean) => void;
  departureIso: string;
  loading: boolean;
}

export default function HeatmapSlider({ hour, maxHour, onChange, show, onToggle, departureIso, loading }: Props) {
  const forecastTime = new Date(new Date(departureIso).getTime() + hour * 3600 * 1000);

  return (
    <div className="heatmap-slider">
      <label className="heatmap-toggle">
        <input type="checkbox" checked={show} onChange={(e) => onToggle(e.target.checked)} />
        Weather heatmap
      </label>
      {show && (
        <div className="heatmap-slider-row">
          <span className="heatmap-slider-time">
            {loading ? "Loading forecast…" : `+${hour}h — ${forecastTime.toLocaleString()}`}
          </span>
          <input
            type="range"
            min={0}
            max={maxHour}
            step={1}
            value={hour}
            disabled={loading}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        </div>
      )}
    </div>
  );
}
