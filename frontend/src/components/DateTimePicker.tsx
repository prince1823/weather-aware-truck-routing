import { useEffect, useRef, useState } from "react";

interface Props {
  value: string; // "YYYY-MM-DDTHH:mm" local, same shape the native input used
  onChange: (value: string) => void;
  min?: string; // "YYYY-MM-DDTHH:mm"
}

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, i) => i * 5);

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toLocalValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export default function DateTimePicker({ value, onChange, min }: Props) {
  const current = value ? new Date(value) : new Date();
  const minDate = min ? new Date(min) : null;

  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(current.getFullYear());
  const [viewMonth, setViewMonth] = useState(current.getMonth());
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  function toggleOpen() {
    if (!open) {
      setViewYear(current.getFullYear());
      setViewMonth(current.getMonth());
    }
    setOpen((o) => !o);
  }

  function updateDate(day: number) {
    const next = new Date(current);
    next.setFullYear(viewYear, viewMonth, day);
    onChange(toLocalValue(next));
  }

  function updateHour12(hour12: number) {
    const next = new Date(current);
    const isPM = current.getHours() >= 12;
    let hour24 = hour12 % 12;
    if (isPM) hour24 += 12;
    next.setHours(hour24);
    onChange(toLocalValue(next));
  }

  function updateMinute(minute: number) {
    const next = new Date(current);
    next.setMinutes(minute);
    onChange(toLocalValue(next));
  }

  function toggleAmPm(pm: boolean) {
    const next = new Date(current);
    const hour24 = current.getHours();
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    next.setHours(pm ? (hour12 % 12) + 12 : hour12 % 12);
    onChange(toLocalValue(next));
  }

  const hour24 = current.getHours();
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const isPM = hour24 >= 12;
  const nearestMinute = MINUTE_OPTIONS.reduce((best, m) => (Math.abs(m - current.getMinutes()) < Math.abs(best - current.getMinutes()) ? m : best), 0);

  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const totalDays = daysInMonth(viewYear, viewMonth);
  const cells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: totalDays }, (_, i) => i + 1)];

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
  const displayLabel = value
    ? current.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "Select date & time";

  function isPastDay(day: number): boolean {
    if (!minDate) return false;
    return startOfDay(new Date(viewYear, viewMonth, day)) < startOfDay(minDate);
  }

  function goToMonth(delta: number) {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setViewMonth(m);
    setViewYear(y);
  }

  return (
    <div className="datetime-picker" ref={containerRef}>
      <button type="button" className="datetime-picker-trigger" onClick={toggleOpen}>
        <svg viewBox="0 0 24 24" fill="none" className="datetime-picker-icon">
          <rect x="3.5" y="5" width="17" height="15.5" rx="3" stroke="currentColor" strokeWidth="1.6" />
          <path d="M3.5 9.5h17" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 3v3.5M16 3v3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span>{displayLabel}</span>
      </button>

      {open && (
        <div className="datetime-picker-popover" role="dialog">
          <div className="datetime-picker-calendar-header">
            <button type="button" className="datetime-picker-nav" onClick={() => goToMonth(-1)} aria-label="Previous month">
              ‹
            </button>
            <span className="datetime-picker-month-label">{monthLabel}</span>
            <button type="button" className="datetime-picker-nav" onClick={() => goToMonth(1)} aria-label="Next month">
              ›
            </button>
          </div>

          <div className="datetime-picker-weekdays">
            {WEEKDAY_LABELS.map((w, i) => (
              <span key={`${w}-${i}`}>{w}</span>
            ))}
          </div>

          <div className="datetime-picker-grid">
            {cells.map((day, idx) => {
              if (day === null) return <span key={`blank-${idx}`} />;
              const selected = current.getFullYear() === viewYear && current.getMonth() === viewMonth && current.getDate() === day;
              const disabled = isPastDay(day);
              return (
                <button
                  key={day}
                  type="button"
                  disabled={disabled}
                  className={selected ? "datetime-picker-day selected" : "datetime-picker-day"}
                  onClick={() => updateDate(day)}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <div className="datetime-picker-time-row">
            <select className="datetime-picker-select" value={hour12} onChange={(e) => updateHour12(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
            <span className="datetime-picker-colon">:</span>
            <select className="datetime-picker-select" value={nearestMinute} onChange={(e) => updateMinute(Number(e.target.value))}>
              {MINUTE_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {pad(m)}
                </option>
              ))}
            </select>
            <div className="datetime-picker-ampm">
              <button type="button" className={!isPM ? "active" : ""} onClick={() => toggleAmPm(false)}>
                AM
              </button>
              <button type="button" className={isPM ? "active" : ""} onClick={() => toggleAmPm(true)}>
                PM
              </button>
            </div>
          </div>

          <button type="button" className="datetime-picker-done" onClick={() => setOpen(false)}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}
