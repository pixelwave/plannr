import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Paintbrush } from "lucide-react";
import { desktopThemeDefaults, type DesktopTheme } from "./theme-defaults";

const STORAGE = "plannr.dev";
const LEGACY_STORAGE = ["plannr.dev.v2", "plannr.dev.v1"];
const THEME_URL = "/api/theme/desktop";
const WIDTH = 252;

type DevTab = "markers" | "header" | "calendar" | "entries";

type DevSettings = {
  open: boolean;
  x: number;
  y: number;
  tab: DevTab;
  markerText: number;
  markerLine: number;
  markerHatch: number;
  headBg: number;
  contentBg: number;
  weekend: number;
  weekendLine: number;
  editBgColor: string;
  editBg: number;
  headLine: number;
  yearSplit: number;
  contentLine: number;
  contentTick: number;
  yearEnd: number;
  entryFillA: number;
  entryColor: string;
  entryColorFillA: number;
  entryColorStrokeA: number;
  entrySelectedColor: string;
  entrySelectedA: number;
  entryHoverFill: number;
  entryGlowColor: string;
  entryGlow: number;
  entryStroke: number;
  entryLinkStroke: number;
  entryLinkColor: string;
  entryLinkA: number;
  entryGlowLen: number;
  entryLinkWidth: number;
  entryLinkRadius: number;
};

type DevSliders = DesktopTheme;

const TABS: { id: DevTab; label: string }[] = [
  { id: "markers", label: "Markers" },
  { id: "header", label: "Header" },
  { id: "calendar", label: "Calendar" },
  { id: "entries", label: "Entries" },
];

const SLIDER_DEFAULTS: DevSliders = desktopThemeDefaults;

const DEFAULTS: DevSettings = {
  open: false,
  x: 24,
  y: 64,
  tab: "markers",
  ...SLIDER_DEFAULTS,
};

const SLIDER_KEYS = Object.keys(SLIDER_DEFAULTS) as (keyof DevSliders)[];

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function parseColor(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
}

function slidersFrom(raw: unknown): DevSliders {
  const parsed = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const next = { ...SLIDER_DEFAULTS };
  for (const key of SLIDER_KEYS) {
    if (key === "entryColor") {
      next.entryColor = parseColor(parsed.entryColor, SLIDER_DEFAULTS.entryColor);
      continue;
    }
    if (key === "entrySelectedColor") {
      next.entrySelectedColor = parseColor(parsed.entrySelectedColor, SLIDER_DEFAULTS.entrySelectedColor);
      continue;
    }
    if (key === "entryGlowColor") {
      next.entryGlowColor = parseColor(parsed.entryGlowColor, SLIDER_DEFAULTS.entryGlowColor);
      continue;
    }
    if (key === "entryLinkColor") {
      next.entryLinkColor = parseColor(
        parsed.entryLinkColor ?? parsed.entryGlowColor,
        SLIDER_DEFAULTS.entryLinkColor,
      );
      continue;
    }
    if (key === "editBgColor") {
      next.editBgColor = parseColor(parsed.editBgColor, SLIDER_DEFAULTS.editBgColor);
      continue;
    }
    const value = parsed[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      if (key === "entryLinkWidth") {
        const snapped = Math.round(clamp(value, 0.5, 2) * 2) / 2;
        next.entryLinkWidth = snapped < 0.5 ? 0.5 : snapped;
        continue;
      }
      if (key === "entryLinkRadius") {
        next.entryLinkRadius = clamp(value, 0, 30);
        continue;
      }
      next[key] = clamp(value, 0, key === "entryGlowLen" ? 160 : 100) as never;
    }
  }
  const legacy = parsed.marker;
  if (typeof parsed.markerLine !== "number" && typeof legacy === "number" && Number.isFinite(legacy)) {
    next.markerLine = clamp(legacy, 0, 100);
  }
  if (typeof parsed.markerHatch !== "number" && typeof legacy === "number" && Number.isFinite(legacy)) {
    next.markerHatch = clamp(Math.round((20 * legacy) / 100), 0, 100);
  }
  return next;
}

function sliderPayload(settings: DevSettings): DevSliders {
  const payload = { ...SLIDER_DEFAULTS };
  for (const key of SLIDER_KEYS) payload[key] = settings[key];
  return payload;
}

function slidersEqual(a: DevSliders, b: DevSliders) {
  return SLIDER_KEYS.every((key) => a[key] === b[key]);
}

function applyVars(settings: DevSliders) {
  const root = document.documentElement;
  root.style.setProperty("--dev-marker-text", String(settings.markerText / 100));
  root.style.setProperty("--dev-marker-line", String(settings.markerLine / 100));
  root.style.setProperty("--dev-marker-hatch", String(settings.markerHatch / 100));
  root.style.setProperty("--dev-head-bg", String(settings.headBg / 100));
  root.style.setProperty("--dev-edit-bg", settings.editBgColor);
  root.style.setProperty("--dev-edit-bg-a", String(settings.editBg / 100));
  root.style.setProperty("--dev-content-bg", String(settings.contentBg / 100));
  root.style.setProperty("--dev-weekend", String(settings.weekend / 100));
  root.style.setProperty("--dev-weekend-line", String(settings.weekendLine / 100));
  root.style.setProperty("--dev-head-line", String(settings.headLine / 100));
  root.style.setProperty("--dev-year-split", String(settings.yearSplit / 100));
  root.style.setProperty("--dev-content-line", String(settings.contentLine / 100));
  root.style.setProperty("--dev-content-tick", String(settings.contentTick / 100));
  root.style.setProperty("--dev-year-end", String(settings.yearEnd / 100));
  root.style.setProperty("--entry-fill", settings.entryColor);
  root.style.setProperty("--entry-selected", settings.entrySelectedColor);
  root.style.setProperty("--entry-glow", settings.entryGlowColor);
  root.style.setProperty("--entry-fill-a", String(settings.entryFillA / 100));
  root.style.setProperty("--entry-color-fill-a", String(settings.entryColorFillA / 100));
  root.style.setProperty("--entry-color-stroke-a", String(settings.entryColorStrokeA / 100));
  root.style.setProperty("--entry-selected-a", String(settings.entrySelectedA / 100));
  root.style.setProperty("--entry-hover-fill", String(settings.entryHoverFill / 100));
  root.style.setProperty("--entry-glow-a", String(settings.entryGlow / 100));
  root.style.setProperty("--entry-stroke-a", String(settings.entryStroke / 100));
  root.style.setProperty("--entry-link-stroke-a", String(settings.entryLinkStroke / 100));
  root.style.setProperty("--entry-link", settings.entryLinkColor);
  root.style.setProperty("--entry-link-a", String(settings.entryLinkA / 100));
  root.style.setProperty("--entry-glow-len", `${settings.entryGlowLen}px`);
  root.style.setProperty("--entry-link-width", String(settings.entryLinkWidth));
  root.style.setProperty("--entry-link-radius", `${settings.entryLinkRadius}px`);
  window.dispatchEvent(new Event("plannr-dev-vars"));
}

function readLocal(): DevSettings {
  const keys = [STORAGE, ...LEGACY_STORAGE];
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Partial<DevSettings>;
      return {
        ...DEFAULTS,
        ...slidersFrom(parsed),
        open: parsed.open === true,
        x: typeof parsed.x === "number" && Number.isFinite(parsed.x) ? parsed.x : DEFAULTS.x,
        y: typeof parsed.y === "number" && Number.isFinite(parsed.y) ? parsed.y : DEFAULTS.y,
        tab: TABS.some((tab) => tab.id === parsed.tab) ? (parsed.tab as DevTab) : DEFAULTS.tab,
      };
    } catch {
      /* try next key */
    }
  }
  return { ...DEFAULTS };
}

function writeLocal(settings: DevSettings) {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(settings));
  } catch {
    /* quota or private mode */
  }
}

async function getTheme(): Promise<{ default: DevSliders | null; user: DevSliders | null }> {
  const res = await fetch(THEME_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`theme GET (${res.status})`);
  const data = (await res.json()) as { default?: unknown; user?: unknown };
  return {
    default: data.default ? slidersFrom(data.default) : null,
    user: data.user ? slidersFrom(data.user) : null,
  };
}

async function putThemeUser(sliders: DevSliders) {
  const res = await fetch(THEME_URL, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: `${JSON.stringify(sliders)}\n`,
  });
  if (!res.ok) throw new Error(`theme PUT (${res.status})`);
}

async function ensureThemeDefault(sliders: DevSliders): Promise<DevSliders> {
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

function Slider({
  label,
  hint,
  value,
  onChange,
  max = 100,
  min = 0,
  step = 1,
  unit = "%",
  display,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (value: number) => void;
  max?: number;
  min?: number;
  step?: number;
  unit?: string;
  display?: string;
}) {
  return (
    <label className="dev-slider">
      <span className="dev-slider-row">
        <span className="dev-slider-label" title={hint}>
          {label}
        </span>
        <span className="dev-slider-value">
          {display ?? `${value}${unit}`}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={hint}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export default function DevPanel({
  onOpenChange,
  hideTrigger = false,
  toggleAt = 0,
}: {
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
  toggleAt?: number;
}) {
  const [settings, setSettings] = useState<DevSettings>(() => {
    const initial = readLocal();
    applyVars(initial);
    return initial;
  });
  const [hexDraft, setHexDraft] = useState(() => settings.entryColor);
  const [selectedHexDraft, setSelectedHexDraft] = useState(() => settings.entrySelectedColor);
  const [glowHexDraft, setGlowHexDraft] = useState(() => settings.entryGlowColor);
  const [linkHexDraft, setLinkHexDraft] = useState(() => settings.entryLinkColor);
  const [editBgHexDraft, setEditBgHexDraft] = useState(() => settings.editBgColor);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const place = (x: number, y: number, height: number) => {
    const maxX = Math.max(8, window.innerWidth - WIDTH - 8);
    const maxY = Math.max(8, window.innerHeight - height - 8);
    return { x: clamp(x, 8, maxX), y: clamp(y, 8, maxY) };
  };
  const persistReady = useRef(false);
  const remoteRef = useRef<DevSliders | null>(null);
  const defaultRef = useRef<DevSliders>(SLIDER_DEFAULTS);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    applyVars(settings);
    writeLocal(settings);
  }, [settings]);

  useEffect(() => {
    setHexDraft(settings.entryColor);
  }, [settings.entryColor]);

  useEffect(() => {
    setSelectedHexDraft(settings.entrySelectedColor);
  }, [settings.entrySelectedColor]);

  useEffect(() => {
    setGlowHexDraft(settings.entryGlowColor);
  }, [settings.entryGlowColor]);

  useEffect(() => {
    setLinkHexDraft(settings.entryLinkColor);
  }, [settings.entryLinkColor]);

  useEffect(() => {
    setEditBgHexDraft(settings.editBgColor);
  }, [settings.editBgColor]);

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
        /* keep local cache */
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
    const sliders = sliderPayload(settings);
    if (remoteRef.current && slidersEqual(sliders, remoteRef.current)) return;
    const timer = window.setTimeout(() => {
      putThemeUser(sliders)
        .then(() => {
          remoteRef.current = sliders;
        })
        .catch(() => {
          /* local cache still holds */
        });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [
    settings.markerText,
    settings.markerLine,
    settings.markerHatch,
    settings.headBg,
    settings.editBgColor,
    settings.editBg,
    settings.contentBg,
    settings.weekend,
    settings.weekendLine,
    settings.headLine,
    settings.yearSplit,
    settings.contentLine,
    settings.contentTick,
    settings.yearEnd,
    settings.entryFillA,
    settings.entryColor,
    settings.entryColorFillA,
    settings.entryColorStrokeA,
    settings.entrySelectedColor,
    settings.entrySelectedA,
    settings.entryHoverFill,
    settings.entryGlowColor,
    settings.entryGlow,
    settings.entryStroke,
    settings.entryLinkStroke,
    settings.entryLinkColor,
    settings.entryLinkA,
    settings.entryGlowLen,
    settings.entryLinkWidth,
    settings.entryLinkRadius,
  ]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSettings((current) => (current.open ? { ...current, open: false } : current));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    onOpenChange?.(settings.open);
  }, [settings.open]);

  const toggleSeen = useRef(toggleAt);
  useEffect(() => {
    if (toggleAt === toggleSeen.current) return;
    toggleSeen.current = toggleAt;
    setSettings((current) => ({ ...current, open: !current.open }));
  }, [toggleAt]);

  useLayoutEffect(() => {
    if (!settings.open) return;
    const node = panelRef.current;
    if (!node) return;
    const fit = () => {
      const height = node.offsetHeight;
      setSettings((current) => {
        const next = place(current.x, current.y, height);
        if (next.x === current.x && next.y === current.y) return current;
        return { ...current, ...next };
      });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => observer.disconnect();
  }, [settings.open]);

  const patch = (partial: Partial<DevSettings>) => {
    setSettings((current) => ({ ...current, ...partial }));
  };

  const onDragDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const node = event.currentTarget;
    node.setPointerCapture(event.pointerId);
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
      {hideTrigger ? null : (
      <button
        type="button"
        className={`dev-launch${settings.open ? " is-open" : ""}`}
        aria-pressed={settings.open}
        aria-label="Theme"
        title="Theme"
        onClick={() => patch({ open: !settings.open })}
      >
        <Paintbrush size={14} strokeWidth={2} color="#fff" aria-hidden />
      </button>
      )}
      {settings.open
        ? createPortal(
        <div
          ref={panelRef}
          className="dev-panel"
          role="dialog"
          aria-label="Theme"
          style={{ left: settings.x, top: settings.y, width: WIDTH }}
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
          <div className="dev-panel-tabs" role="tablist" aria-label="Theme sections">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={settings.tab === tab.id}
                className={`dev-panel-tab${settings.tab === tab.id ? " is-on" : ""}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => patch({ tab: tab.id })}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="dev-panel-body">
            {settings.tab === "markers" ? (
              <div className="dev-panel-group">
                <Slider
                  label="Marker text"
                  hint="Custom marker title. Current look is 100%."
                  value={settings.markerText}
                  onChange={(markerText) => patch({ markerText })}
                />
                <Slider
                  label="Marker lines"
                  hint="Custom marker 1px start/end outlines. Current look is 100%."
                  value={settings.markerLine}
                  onChange={(markerLine) => patch({ markerLine })}
                />
                <Slider
                  label="Marker hatch"
                  hint="Diagonal fill between the outlines. Current look is 20%."
                  value={settings.markerHatch}
                  onChange={(markerHatch) => patch({ markerHatch })}
                />
              </div>
            ) : null}
            {settings.tab === "header" ? (
              <div className="dev-panel-group">
                <div className="dev-panel-title">Menu Bar</div>
                <label className="dev-color">
                  <span className="dev-slider-label">Color</span>
                  <span className="dev-color-row">
                    <input
                      type="color"
                      aria-label="Edit menu bar color"
                      value={settings.editBgColor}
                      onChange={(event) => patch({ editBgColor: event.target.value.toLowerCase() })}
                    />
                    <input
                      className="dev-hex"
                      spellCheck={false}
                      aria-label="Edit menu bar hex"
                      value={editBgHexDraft}
                      onChange={(event) => {
                        const raw = event.target.value;
                        setEditBgHexDraft(raw);
                        const hex = raw.trim().startsWith("#") ? raw.trim() : `#${raw.trim()}`;
                        if (/^#[0-9a-fA-F]{6}$/.test(hex)) patch({ editBgColor: hex.toLowerCase() });
                      }}
                      onBlur={() => {
                        const hex = editBgHexDraft.trim().startsWith("#")
                          ? editBgHexDraft.trim()
                          : `#${editBgHexDraft.trim()}`;
                        if (/^#[0-9a-fA-F]{6}$/.test(hex)) patch({ editBgColor: hex.toLowerCase() });
                        else setEditBgHexDraft(settings.editBgColor);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                      }}
                    />
                  </span>
                </label>
                <Slider
                  label="Edit BG"
                  hint="How much of that color mixes into the menu bar in EDIT. Current look is 16%."
                  value={settings.editBg}
                  onChange={(editBg) => patch({ editBg })}
                />
                <div className="dev-panel-rule" />
                <div className="dev-panel-title">Calendar Header</div>
                <Slider
                  label="Header bg"
                  hint="White mix on years + months, through the month baseline"
                  value={settings.headBg}
                  onChange={(headBg) => patch({ headBg })}
                />
                <Slider
                  label="Header lines"
                  hint="Year/month baselines and month verticals. Current look is 10%."
                  value={settings.headLine}
                  onChange={(headLine) => patch({ headLine })}
                />
                <Slider
                  label="Year split"
                  hint="Vertical year divider in the header. Current look is 20%."
                  value={settings.yearSplit}
                  onChange={(yearSplit) => patch({ yearSplit })}
                />
              </div>
            ) : null}
            {settings.tab === "calendar" ? (
              <div className="dev-panel-group">
                <Slider
                  label="Content bg"
                  hint="White mix on the content area"
                  value={settings.contentBg}
                  onChange={(contentBg) => patch({ contentBg })}
                />
                <Slider
                  label="Weekend"
                  hint="Saturday left line through Sunday right (Monday line). Current look is 0%."
                  value={settings.weekend}
                  onChange={(weekend) => patch({ weekend })}
                />
                <Slider
                  label="Weekend line"
                  hint="Vertical line between Saturday and Sunday. Current look is 8%."
                  value={settings.weekendLine}
                  onChange={(weekendLine) => patch({ weekendLine })}
                />
                <Slider
                  label="Content lines"
                  hint="Month/week/day verticals. Current look is 8%."
                  value={settings.contentLine}
                  onChange={(contentLine) => patch({ contentLine })}
                />
                <Slider
                  label="Ticks"
                  hint="2px week/day ticks. Current look is 30%."
                  value={settings.contentTick}
                  onChange={(contentTick) => patch({ contentTick })}
                />
                <Slider
                  label="Year end"
                  hint="Dotted year line in content. Current look is 18%."
                  value={settings.yearEnd}
                  onChange={(yearEnd) => patch({ yearEnd })}
                />
              </div>
            ) : null}
            {settings.tab === "entries" ? (
              <>
                <div className="dev-panel-group">
                  <label className="dev-color">
                    <span className="dev-slider-label">Fill color</span>
                    <span className="dev-color-row">
                      <input
                        type="color"
                        aria-label="Bar fill color"
                        value={settings.entryColor}
                        onChange={(event) => patch({ entryColor: event.target.value.toLowerCase() })}
                      />
                      <input
                        className="dev-hex"
                        spellCheck={false}
                        aria-label="Bar fill hex"
                        value={hexDraft}
                        onChange={(event) => {
                          const raw = event.target.value;
                          setHexDraft(raw);
                          const hex = raw.trim().startsWith("#") ? raw.trim() : `#${raw.trim()}`;
                          if (/^#[0-9a-fA-F]{6}$/.test(hex)) patch({ entryColor: hex.toLowerCase() });
                        }}
                        onBlur={() => {
                          const hex = hexDraft.trim().startsWith("#") ? hexDraft.trim() : `#${hexDraft.trim()}`;
                          if (/^#[0-9a-fA-F]{6}$/.test(hex)) patch({ entryColor: hex.toLowerCase() });
                          else setHexDraft(settings.entryColor);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                        }}
                      />
                    </span>
                  </label>
                  <Slider
                    label="Fill opacity"
                    hint="Opacity of the color layer over an opaque black base. Current look is 100%."
                    value={settings.entryFillA}
                    onChange={(entryFillA) => patch({ entryFillA })}
                  />
                  <Slider
                    label="Border"
                    hint="Inner 1px white outline. Current look is 12%."
                    value={settings.entryStroke}
                    onChange={(entryStroke) => patch({ entryStroke })}
                  />
                </div>
                <div className="dev-panel-rule" />
                <div className="dev-panel-group">
                  <div className="dev-panel-title">Colored</div>
                  <Slider
                    label="Fill opacity"
                    hint="Opacity of a colorized bar over the black base. Separate from the default white fill. Current look is 22%."
                    value={settings.entryColorFillA}
                    onChange={(entryColorFillA) => patch({ entryColorFillA })}
                  />
                  <Slider
                    label="Border opacity"
                    hint="Opacity of the brighter outline on a colorized bar. Selected colorized bars use 100%. Current look is 40%."
                    value={settings.entryColorStrokeA}
                    onChange={(entryColorStrokeA) => patch({ entryColorStrokeA })}
                  />
                </div>
                <div className="dev-panel-rule" />
                <div className="dev-panel-group">
                  <div className="dev-panel-title">Selected</div>
                  <label className="dev-color">
                    <span className="dev-slider-label">Border color</span>
                    <span className="dev-color-row">
                      <input
                        type="color"
                        aria-label="Selected border color"
                        value={settings.entrySelectedColor}
                        onChange={(event) => patch({ entrySelectedColor: event.target.value.toLowerCase() })}
                      />
                      <input
                        className="dev-hex"
                        spellCheck={false}
                        aria-label="Selected border hex"
                        value={selectedHexDraft}
                        onChange={(event) => {
                          const raw = event.target.value;
                          setSelectedHexDraft(raw);
                          const hex = raw.trim().startsWith("#") ? raw.trim() : `#${raw.trim()}`;
                          if (/^#[0-9a-fA-F]{6}$/.test(hex)) patch({ entrySelectedColor: hex.toLowerCase() });
                        }}
                        onBlur={() => {
                          const hex = selectedHexDraft.trim().startsWith("#")
                            ? selectedHexDraft.trim()
                            : `#${selectedHexDraft.trim()}`;
                          if (/^#[0-9a-fA-F]{6}$/.test(hex)) patch({ entrySelectedColor: hex.toLowerCase() });
                          else setSelectedHexDraft(settings.entrySelectedColor);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                        }}
                      />
                    </span>
                  </label>
                  <Slider
                    label="Border opacity"
                    hint="Inner 1px outline on a selected bar. Current look is 85%."
                    value={settings.entrySelectedA}
                    onChange={(entrySelectedA) => patch({ entrySelectedA })}
                  />
                  <Slider
                    label="Hover Fill"
                    hint="Lifts the painted fill while hovering in EDIT. 0 is off, 10 is a light lift, 100 is the full fill color."
                    value={settings.entryHoverFill}
                    onChange={(entryHoverFill) => patch({ entryHoverFill })}
                  />
                </div>
                <div className="dev-panel-rule" />
                <div className="dev-panel-group">
                  <div className="dev-panel-title">Connect</div>
                  <label className="dev-color">
                    <span className="dev-slider-label">Glow color</span>
                    <span className="dev-color-row">
                      <input
                        type="color"
                        aria-label="Glow color"
                        value={settings.entryGlowColor}
                        onChange={(event) => patch({ entryGlowColor: event.target.value.toLowerCase() })}
                      />
                      <input
                        className="dev-hex"
                        spellCheck={false}
                        aria-label="Glow hex"
                        value={glowHexDraft}
                        onChange={(event) => {
                          const raw = event.target.value;
                          setGlowHexDraft(raw);
                          const hex = raw.trim().startsWith("#") ? raw.trim() : `#${raw.trim()}`;
                          if (/^#[0-9a-fA-F]{6}$/.test(hex)) patch({ entryGlowColor: hex.toLowerCase() });
                        }}
                        onBlur={() => {
                          const hex = glowHexDraft.trim().startsWith("#") ? glowHexDraft.trim() : `#${glowHexDraft.trim()}`;
                          if (/^#[0-9a-fA-F]{6}$/.test(hex)) patch({ entryGlowColor: hex.toLowerCase() });
                          else setGlowHexDraft(settings.entryGlowColor);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                        }}
                      />
                    </span>
                  </label>
                  <Slider
                    label="Glow fill"
                    hint="Accent inner glow on the connected end. Current look is 22%."
                    value={settings.entryGlow}
                    onChange={(entryGlow) => patch({ entryGlow })}
                  />
                  <Slider
                    label="Glow border"
                    hint="Accent fade on the connected end of the inner outline. Current look is 100%."
                    value={settings.entryLinkStroke}
                    onChange={(entryLinkStroke) => patch({ entryLinkStroke })}
                  />
                  <Slider
                    label="Glow length"
                    hint="How far the connect glow and border fade into the bar. Current look is 56px."
                    value={settings.entryGlowLen}
                    onChange={(entryGlowLen) => patch({ entryGlowLen })}
                    max={160}
                    unit="px"
                  />
                  <label className="dev-color">
                    <span className="dev-slider-label">Line color</span>
                    <span className="dev-color-row">
                      <input
                        type="color"
                        aria-label="Connector line color"
                        value={settings.entryLinkColor}
                        onChange={(event) => patch({ entryLinkColor: event.target.value.toLowerCase() })}
                      />
                      <input
                        className="dev-hex"
                        spellCheck={false}
                        aria-label="Connector line hex"
                        value={linkHexDraft}
                        onChange={(event) => {
                          const raw = event.target.value;
                          setLinkHexDraft(raw);
                          const hex = raw.trim().startsWith("#") ? raw.trim() : `#${raw.trim()}`;
                          if (/^#[0-9a-fA-F]{6}$/.test(hex)) patch({ entryLinkColor: hex.toLowerCase() });
                        }}
                        onBlur={() => {
                          const hex = linkHexDraft.trim().startsWith("#") ? linkHexDraft.trim() : `#${linkHexDraft.trim()}`;
                          if (/^#[0-9a-fA-F]{6}$/.test(hex)) patch({ entryLinkColor: hex.toLowerCase() });
                          else setLinkHexDraft(settings.entryLinkColor);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                        }}
                      />
                    </span>
                  </label>
                  <Slider
                    label="Line opacity"
                    hint="Opacity of the weld line only. Milestone marks and labels stay on their own colors. Current look is 100%."
                    value={settings.entryLinkA}
                    onChange={(entryLinkA) => patch({ entryLinkA })}
                  />
                  <Slider
                    label="Line thickness"
                    hint="Weld line between connected entries. 0.5, 1.0, 1.5, or 2.0."
                    value={settings.entryLinkWidth}
                    onChange={(entryLinkWidth) => patch({ entryLinkWidth })}
                    min={0.5}
                    max={2}
                    step={0.5}
                    display={settings.entryLinkWidth.toFixed(1)}
                  />
                  <Slider
                    label="Corner radius"
                    hint="Round the 90° weld corners. 0 is sharp. Current look is 0px."
                    value={settings.entryLinkRadius}
                    onChange={(entryLinkRadius) => patch({ entryLinkRadius })}
                    max={30}
                    unit="px"
                  />
                </div>
              </>
            ) : null}
          </div>
          <div className="dev-panel-foot">
            <button
              type="button"
              className="dev-panel-default"
              disabled={slidersEqual(sliderPayload(settings), defaultRef.current)}
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
