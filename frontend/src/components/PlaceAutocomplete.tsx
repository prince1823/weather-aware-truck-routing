import { useEffect, useRef, useState } from "react";
import { geocode, geocodeSuggest } from "../api";
import type { Place } from "../types";

interface Props {
  label: string;
  placeholder: string;
  value: Place | null;
  onChange: (place: Place | null) => void;
}

const DEBOUNCE_MS = 250;

export default function PlaceAutocomplete({ label, placeholder, value, onChange }: Props) {
  const [text, setText] = useState(value?.label ?? "");
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    setText(value?.label ?? "");
  }, [value]);

  function handleInput(next: string) {
    setText(next);
    onChange(null);
    setError(null);
    setHighlightIndex(-1);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    const query = next.trim();
    if (query.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      try {
        const results = await geocodeSuggest(query, 6);
        if (requestId !== requestIdRef.current) return; // a newer keystroke superseded this request
        setSuggestions(results);
        setOpen(results.length > 0);
      } catch {
        if (requestId !== requestIdRef.current) return;
        setSuggestions([]);
        setOpen(false);
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
  }

  function selectPlace(place: Place) {
    onChange(place);
    setText(place.label);
    setSuggestions([]);
    setOpen(false);
    setHighlightIndex(-1);
  }

  async function resolveFreeText() {
    if (!text.trim() || value) return;
    setLoading(true);
    setError(null);
    try {
      const place = await geocode(text.trim());
      selectPlace(place);
    } catch {
      setError("Location not found");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (open && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIndex((i) => Math.min(i + 1, suggestions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const chosen = highlightIndex >= 0 ? suggestions[highlightIndex] : suggestions[0];
        selectPlace(chosen);
        return;
      }
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key === "Tab") {
        // Don't preventDefault -- let focus continue moving to the next
        // field natively, but commit the top/highlighted suggestion first
        // so Tab both confirms the pick and advances, like a real
        // autocomplete should.
        const chosen = highlightIndex >= 0 ? suggestions[highlightIndex] : suggestions[0];
        selectPlace(chosen);
        return;
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      void resolveFreeText();
    }
  }

  function handleBlur() {
    // Delay so a mousedown on a dropdown item (below) can register before we close it.
    setTimeout(() => {
      setOpen(false);
      if (!value) void resolveFreeText();
    }, 120);
  }

  return (
    <label className="field place-autocomplete">
      <span className="field-label">{label}</span>
      <div className="place-autocomplete-input-wrap">
        <input
          type="text"
          placeholder={placeholder}
          value={text}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          autoComplete="off"
        />
        {open && suggestions.length > 0 && (
          <ul className="place-suggestions" role="listbox">
            {suggestions.map((s, idx) => (
              <li
                key={`${s.lat},${s.lon}`}
                role="option"
                aria-selected={idx === highlightIndex}
                className={idx === highlightIndex ? "place-suggestion active" : "place-suggestion"}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep input focus / fire before blur
                  selectPlace(s);
                }}
                onMouseEnter={() => setHighlightIndex(idx)}
              >
                {s.label}
              </li>
            ))}
          </ul>
        )}
      </div>
      {loading && <span className="field-hint">Looking up…</span>}
      {!loading && value && <span className="field-hint field-ok">✓ {value.label}</span>}
      {!loading && error && <span className="field-hint field-error">{error}</span>}
    </label>
  );
}
