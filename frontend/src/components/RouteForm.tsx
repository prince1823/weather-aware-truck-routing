import { useState } from "react";
import PlaceAutocomplete from "./PlaceAutocomplete";
import type { Place } from "../types";

export interface FormValues {
  origin: Place;
  destination: Place;
  departureLocal: string; // datetime-local input value
  loadWeightLb: number;
}

interface Props {
  onSubmit: (values: FormValues) => void;
  loading: boolean;
}

function defaultDepartureLocal(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function RouteForm({ onSubmit, loading }: Props) {
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [departureLocal, setDepartureLocal] = useState(defaultDepartureLocal());
  const [loadWeight, setLoadWeight] = useState(34000);
  const [touched, setTouched] = useState(false);

  const canSubmit = Boolean(origin && destination && departureLocal && loadWeight > 0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!origin || !destination) return;
    onSubmit({ origin, destination, departureLocal, loadWeightLb: loadWeight });
  }

  return (
    <form className="route-form" onSubmit={handleSubmit}>
      <h2>Plan a trip</h2>
      <PlaceAutocomplete label="Origin" placeholder="e.g. Kansas City, MO" value={origin} onChange={setOrigin} />
      <PlaceAutocomplete label="Destination" placeholder="e.g. Denver, CO" value={destination} onChange={setDestination} />

      <label className="field">
        <span className="field-label">Departure date &amp; time</span>
        <input
          type="datetime-local"
          value={departureLocal}
          onChange={(e) => setDepartureLocal(e.target.value)}
          required
        />
      </label>

      <label className="field">
        <span className="field-label">Load weight (lb)</span>
        <input
          type="number"
          min={0}
          step={500}
          value={loadWeight}
          onChange={(e) => setLoadWeight(Number(e.target.value))}
          required
        />
      </label>

      {touched && !canSubmit && (
        <p className="field-error">Pick a valid origin and destination before planning.</p>
      )}

      <button type="submit" disabled={loading}>
        {loading ? "Planning route…" : "Find safest route"}
      </button>
    </form>
  );
}
