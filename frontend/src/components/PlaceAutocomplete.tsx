import { useEffect, useRef, useState } from "react";
import { geocode } from "../api";
import type { Place } from "../types";

interface Props {
  label: string;
  placeholder: string;
  value: Place | null;
  onChange: (place: Place | null) => void;
}

export default function PlaceAutocomplete({ label, placeholder, value, onChange }: Props) {
  const [text, setText] = useState(value?.label ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setText(value?.label ?? "");
  }, [value]);

  function handleInput(next: string) {
    setText(next);
    onChange(null);
    setError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }

  async function resolve() {
    if (!text.trim() || value) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setLoading(true);
    setError(null);
    try {
      const place = await geocode(text.trim());
      onChange(place);
      setText(place.label);
    } catch {
      setError("Location not found");
    } finally {
      setLoading(false);
    }
  }

  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        type="text"
        placeholder={placeholder}
        value={text}
        onChange={(e) => handleInput(e.target.value)}
        onBlur={resolve}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            resolve();
          }
        }}
      />
      {loading && <span className="field-hint">Looking up…</span>}
      {!loading && value && <span className="field-hint field-ok">✓ {value.label}</span>}
      {!loading && error && <span className="field-hint field-error">{error}</span>}
    </label>
  );
}
