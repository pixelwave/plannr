import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarCog } from "lucide-react";

export const RANGE_YEAR_MIN = 2020;

export function rangeYearMax(now = new Date().getFullYear()) {
  return now + 10;
}

function yearsForRange(from: number, to: number) {
  const min = Math.min(RANGE_YEAR_MIN, from, to);
  const max = Math.max(rangeYearMax(), from, to);
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

function YearList({
  years,
  value,
  min,
  max,
  onPick,
}: {
  years: number[];
  value: number;
  min: number;
  max: number;
  onPick: (year: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const first = years[0];
  const last = years[years.length - 1];

  useEffect(() => {
    const wrap = root.current;
    const on = wrap?.querySelector<HTMLElement>(".is-on");
    if (!wrap || !on) return;
    const wrapRect = wrap.getBoundingClientRect();
    const onRect = on.getBoundingClientRect();
    wrap.scrollTop += onRect.top - wrapRect.top - (wrap.clientHeight - on.clientHeight) / 2;
  }, [first, last]);

  return (
    <div className="range-years" ref={root}>
      {years.map((year) => (
        <button
          key={year}
          type="button"
          className={`range-year${year === value ? " is-on" : ""}`}
          disabled={year < min || year > max}
          onClick={() => onPick(year)}
        >
          {year}
        </button>
      ))}
    </div>
  );
}

function RangeColumns({
  years,
  from,
  to,
  onFrom,
  onTo,
}: {
  years: number[];
  from: number;
  to: number;
  onFrom: (year: number) => void;
  onTo: (year: number) => void;
}) {
  const min = years[0] ?? RANGE_YEAR_MIN;
  const max = years[years.length - 1] ?? rangeYearMax();
  return (
    <>
      <div className="range-pop-col">
        <div className="range-pop-label">From</div>
        <YearList years={years} value={from} min={min} max={to} onPick={onFrom} />
      </div>
      <div className="range-pop-col">
        <div className="range-pop-label">To</div>
        <YearList years={years} value={to} min={from} max={max} onPick={onTo} />
      </div>
    </>
  );
}

export default function RangeChip({
  from,
  to,
  onChange,
  variant = "chip",
  open: openProp,
  onOpenChange,
  hideTrigger = false,
}: {
  from: number;
  to: number;
  onChange: (from: number, to: number) => void;
  variant?: "chip" | "inline";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = openProp ?? uncontrolled;
  const setOpen = (value: boolean | ((current: boolean) => boolean)) => {
    const next = typeof value === "function" ? value(open) : value;
    onOpenChange?.(next);
    if (openProp === undefined) setUncontrolled(next);
  };
  const root = useRef<HTMLDivElement>(null);
  const years = useMemo(() => yearsForRange(from, to), [from, to]);

  useEffect(() => {
    if (!open || variant === "inline") return;
    const onDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open, variant]);

  const setFrom = (year: number) => {
    onChange(year, year > to ? year : to);
  };
  const setTo = (year: number) => {
    onChange(year < from ? year : from, year);
  };

  if (variant === "inline") {
    return (
      <div className="range-inline" role="group" aria-label="Visible calendar range">
        <RangeColumns years={years} from={from} to={to} onFrom={setFrom} onTo={setTo} />
      </div>
    );
  }

  return (
    <div className="range-anchor" ref={root}>
      {hideTrigger ? null : (
      <button
        type="button"
        className={`range-chip${open ? " is-open" : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Calendar range, ${from} to ${to}`}
        title={`${from} – ${to}`}
        onClick={() => setOpen((value) => !value)}
      >
        <CalendarCog size={14} strokeWidth={2} color="#fff" aria-hidden />
      </button>
      )}
      {open ? (
        <div className="range-pop" role="dialog" aria-label="Visible calendar range">
          <RangeColumns years={years} from={from} to={to} onFrom={setFrom} onTo={setTo} />
        </div>
      ) : null}
    </div>
  );
}
