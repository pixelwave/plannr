import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";

const STORAGE = "plannr.mobile.dev";
const THEME_URL = "/api/theme/mobile";
const WIDTH = 252;

type Sliders = {
  fade: number;
  line: number;
  len: number;
  fill: number;
};

type Settings = Sliders & {
  open: boolean;
  x: number;
  y: number;
};

const SLIDER_DEFAULTS: Sliders = {
  fade: 100,
  line: 2,
  len: 16,
  fill: 10,
};

const DEFAULTS: Settings = {
  open: false,
  x: 16,
  y: 210,
  ...SLIDER_DEFAULTS,
};

function devEnabled() {
  if (import.meta.env.DEV) return true;
  const path = window.location.pathname;
  return path === "/app-mobile" || path.startsWith("/app-mobile/");
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function slidersFrom(raw: unknown): Sliders {
  const parsed = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const fade = typeof parsed.fade === "number" && Number.isFinite(parsed.fade) ? parsed.fade : SLIDER_DEFAULTS.fade;
  const line = typeof parsed.line === "number" && Number.isFinite(parsed.line) ? parsed.line : SLIDER_DEFAULTS.line;
  const len = typeof parsed.len === "number" && Number.isFinite(parsed.len) ? parsed.len : SLIDER_DEFAULTS.len;
  const fill = typeof parsed.fill === "number" && Number.isFinite(parsed.fill) ? parsed.fill : SLIDER_DEFAULTS.fill;
  return {
    fade: Math.round(clamp(fade, 0, 100)),
    line: Math.round(clamp(line, 0.5, 8) * 2) / 2,
    len: Math.round(clamp(len, 0, 100)),
    fill: Math.round(clamp(fill, 0, 100)),
  };
}

function slidersEqual(a: Sliders, b: Sliders) {
  return a.fade === b.fade && a.line === b.line && a.len === b.len && a.fill === b.fill;
}

function read(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...DEFAULTS,
      ...slidersFrom(parsed),
      open: parsed.open === true,
      x: typeof parsed.x === "number" && Number.isFinite(parsed.x) ? parsed.x : DEFAULTS.x,
      y: typeof parsed.y === "number" && Number.isFinite(parsed.y) ? parsed.y : DEFAULTS.y,
    };
  } catch {
    return DEFAULTS;
  }
}

function writeLocal(settings: Settings) {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(settings));
  } catch {
    /* private mode or quota */
  }
}

async function getTheme(): Promise<{ default: Sliders | null; user: Sliders | null }> {
  const res = await fetch(THEME_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`theme GET (${res.status})`);
  const data = (await res.json()) as { default?: unknown; user?: unknown };
  return {
    default: data.default ? slidersFrom(data.default) : null,
    user: data.user ? slidersFrom(data.user) : null,
  };
}

async function putThemeUser(sliders: Sliders) {
  const res = await fetch(THEME_URL, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: `${JSON.stringify(sliders)}\n`,
  });
  if (!res.ok) throw new Error(`theme PUT (${res.status})`);
}

async function ensureThemeDefault(sliders: Sliders): Promise<Sliders> {
  const res = await fetch(`${THEME_URL}/default`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: `${JSON.stringify(sliders)}\n`,
  });
  if (!res.ok) throw new Error(`theme default PUT (${res.status})`);
  return slidersFrom(await res.json());
}

async function clearThemeUser() {
  const res = await fetch(THEME_URL, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`theme DELETE (${res.status})`);
}

function apply(settings: Sliders) {
  const root = document.documentElement;
  root.style.setProperty("--motion-fade", String(settings.fade / 100));
  root.style.setProperty("--motion-line", `${settings.line}px`);
  root.style.setProperty("--motion-len", `${settings.len}%`);
  root.style.setProperty("--card-fill", String(settings.fill / 100));
}

function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="dev-slider">
      <span className="dev-slider-row">
        <span className="dev-slider-label" title={hint}>
          {label}
        </span>
        <span className="dev-slider-value">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function DevTools({ label }: { label: string }) {
  const enabled = devEnabled();
  const [settings, setSettings] = useState<Settings>(read);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const persistReady = useRef(false);
  const remoteRef = useRef<Sliders | null>(null);
  const defaultRef = useRef<Sliders>(SLIDER_DEFAULTS);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useLayoutEffect(() => {
    apply(settings);
    writeLocal(settings);
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const theme = await getTheme();
        if (cancelled) return;
        const base = theme.default ?? (await ensureThemeDefault(SLIDER_DEFAULTS));
        if (cancelled) return;
        const effective = theme.user ? slidersFrom({ ...base, ...theme.user }) : base;
        defaultRef.current = base;
        remoteRef.current = effective;
        setSettings((current) => ({ ...current, ...effective }));
      } catch {
        /* keep the local cache */
      } finally {
        if (!cancelled) persistReady.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!persistReady.current) return;
    const sliders = slidersFrom(settings);
    if (remoteRef.current && slidersEqual(sliders, remoteRef.current)) return;
    const timer = window.setTimeout(() => {
      putThemeUser(sliders)
        .then(() => {
          remoteRef.current = sliders;
        })
        .catch(() => {
          /* local cache still holds the change */
        });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [settings.fade, settings.line, settings.len, settings.fill]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSettings((current) => (current.open ? { ...current, open: false } : current));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);

  const place = (x: number, y: number, height: number) => {
    const width = Math.min(WIDTH, window.innerWidth - 16);
    const maxX = Math.max(8, window.innerWidth - width - 8);
    const maxY = Math.max(8, window.innerHeight - height - 8);
    return { x: clamp(x, 8, maxX), y: clamp(y, 8, maxY) };
  };

  const patch = (partial: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...partial }));
  };

  const onDragDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { dx: event.clientX - settings.x, dy: event.clientY - settings.y };
  };

  const onDragMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const height = panelRef.current?.offsetHeight ?? 48;
    patch(place(event.clientX - drag.current.dx, event.clientY - drag.current.dy, height));
  };

  const onDragUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <>
      {enabled ? (
        <button type="button" className="today-kicker" onClick={() => patch({ open: !settings.open })}>
          {label}
        </button>
      ) : (
        <p className="today-kicker">{label}</p>
      )}
      {enabled && settings.open
        ? createPortal(
            <div
              ref={panelRef}
              className="dev-panel"
              role="dialog"
              aria-label="Theme"
              style={{ left: settings.x, top: settings.y, width: Math.min(WIDTH, window.innerWidth - 16) }}
            >
              <div
                className="dev-panel-head"
                onPointerDown={onDragDown}
                onPointerMove={onDragMove}
                onPointerUp={onDragUp}
                onPointerCancel={onDragUp}
              >
                <span>Theme</span>
                <button
                  type="button"
                  className="dev-panel-close"
                  aria-label="Close theme"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => patch({ open: false })}
                >
                  ×
                </button>
              </div>
              <div className="dev-panel-body">
                <div className="dev-panel-group">
                  <Slider
                    label="Color Fade"
                    hint="Transparency of the fading left edge on in-motion cards. 100% is the current look."
                    value={settings.fade}
                    min={0}
                    max={100}
                    step={1}
                    display={`${settings.fade}%`}
                    onChange={(fade) => patch({ fade })}
                  />
                  <Slider
                    label="Fade length"
                    hint="How far the left edge fades across the card. 16% matches the previous 56px."
                    value={settings.len}
                    min={0}
                    max={100}
                    step={1}
                    display={`${settings.len}%`}
                    onChange={(len) => patch({ len })}
                  />
                  <Slider
                    label="Line thickness"
                    hint="Width of that edge. The current look is 2px."
                    value={settings.line}
                    min={0.5}
                    max={8}
                    step={0.5}
                    display={`${settings.line}px`}
                    onChange={(line) => patch({ line })}
                  />
                  <Slider
                    label="Fill opacity"
                    hint="Color wash behind the content of a colored card. Starts at 10%."
                    value={settings.fill}
                    min={0}
                    max={100}
                    step={1}
                    display={`${settings.fill}%`}
                    onChange={(fill) => patch({ fill })}
                  />
                </div>
              </div>
              <div className="dev-panel-foot">
                <button
                  type="button"
                  className="dev-panel-default"
                  disabled={slidersEqual(slidersFrom(settings), defaultRef.current)}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => {
                    const base = defaultRef.current;
                    remoteRef.current = base;
                    void clearThemeUser();
                    setSettings((current) => ({ ...current, ...base }));
                  }}
                >
                  Default
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
