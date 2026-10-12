import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  AlignEndVertical,
  AlignStartVertical,
  Calendar,
  CalendarDays,
  CalendarRange,
  Copy,
  Crosshair,
  Flag,
  Link2,
  MapPin,
  Minimize2,
  Palette,
  Merge,
  Pencil,
  Plus,
  Split,
  Sun,
  Trash2,
  Unlink,
  X,
  type LucideIcon,
} from "lucide-react";
import { type Entry, type Milestone } from "./data";
import { EntryIcon, IconPicker } from "../icons/IconPicker";
import { DEFAULT_ENTRY_ICON, DEFAULT_ENTRY_ICON_COLOR } from "../icons/lucide";
import {
  bootCalendar,
  calendarFingerprint,
  emptyCalendar,
  getCurrentProjectId,
  hydrateCalendar,
  persistWorking,
  setCurrentProjectId,
  type CalendarSnapshot,
  type PersistKind,
  type StoredMarker,
} from "./persist";
import "./year.css";

const HISTORY_LIMIT = 10;

type HistoryDoc = {
  entries: Entry[];
  markers: StoredMarker[];
  rangeFrom: number;
  rangeTo: number;
};

function cloneHistory(doc: HistoryDoc): HistoryDoc {
  return {
    entries: structuredClone(doc.entries),
    markers: structuredClone(doc.markers),
    rangeFrom: doc.rangeFrom,
    rangeTo: doc.rangeTo,
  };
}

function historyKey(doc: HistoryDoc) {
  return JSON.stringify({
    entries: doc.entries,
    markers: doc.markers,
    rangeFrom: doc.rangeFrom,
    rangeTo: doc.rangeTo,
  });
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const RANGE = {
  start: new Date(2024, 0, 1),
  end: new Date(2030, 0, 1),
};
const PAD = 16;
const ZOOM_STEP = 1.12;
/** Original zoom-out floor. Month labels stay at and above this px. */
const MONTH_MIN_PX = 0.9;
/** Extra zoom-out steps below the old floor. Those steps use quarter labels. */
const QUARTER_STEPS = 6;
const MIN_PX = MONTH_MIN_PX / ZOOM_STEP ** QUARTER_STEPS;
const WEEK_PX = 32 / 7;
const DAY_PX = 16 * ZOOM_STEP;
const MAX_PX = 16 * ZOOM_STEP ** 3;
const MONTH_ZOOM = WEEK_PX / ZOOM_STEP ** 2;
const WEEK_ZOOM = Math.sqrt(WEEK_PX * DAY_PX);
const DAY_ZOOM = 16 * ZOOM_STEP ** 2;
const HEAD_H = 100;
const ROW_TOP = 52;
const ROW_H = 78;
const TITLE_H = 18;
const BAR_GAP = 8;
const BAR_H = 28;
const HANDLE = 8;
const DEFAULT_SPAN = 13;
const COLLIDE_PAD = 8;
const MARK_HIT = 10;

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dayIndex(d: Date) {
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}

function daysBetween(a: Date, b: Date) {
  return dayIndex(b) - dayIndex(a);
}

function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function parseISO(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function xAt(d: Date, px: number) {
  return PAD + daysBetween(RANGE.start, d) * px;
}

function xDayStart(d: Date, px: number) {
  return xAt(d, px);
}

function xDayEnd(d: Date, px: number) {
  return xAt(d, px) + px;
}

function xDayMid(d: Date, px: number) {
  return xAt(d, px) + px / 2;
}

function xPoint(d: Date, px: number) {
  return px >= DAY_PX ? xDayMid(d, px) : xAt(d, px);
}

function isWeekend(d: Date) {
  const weekday = d.getDay();
  return weekday === 0 || weekday === 6;
}

function trackWidth(px: number) {
  return xAt(RANGE.end, px);
}

function zoomScroll(scale: number, next: number, cursorX: number, scroll: number, viewW: number) {
  const day = (scroll + cursorX - PAD) / scale;
  const nextScroll = day * next + PAD - cursorX;
  const max = Math.max(0, trackWidth(next) - viewW);
  return Math.min(max, Math.max(0, nextScroll));
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function zoomBandAt(px: number): "month" | "week" | "day" {
  if (px >= DAY_PX) return "day";
  if (px >= WEEK_PX) return "week";
  return "month";
}

function viewportFillPx(viewW: number) {
  if (!(viewW > PAD)) return MONTH_MIN_PX;
  const days = Math.max(1, daysBetween(RANGE.start, RANGE.end));
  return (viewW - PAD) / days;
}

function monthZoomFloor(viewW: number) {
  if (!(viewW > PAD)) return MONTH_MIN_PX;
  return Math.min(MAX_PX, Math.max(MONTH_MIN_PX, viewportFillPx(viewW)));
}

/** Quarter zoom never shrinks the range narrower than the viewport. */
function quarterMinPx(viewW: number) {
  return viewportFillPx(viewW);
}

function isQuarterZoom(px: number, viewW: number) {
  return px < monthZoomFloor(viewW) - 0.001;
}

function zoomPxFor(band: "month" | "week" | "day", viewW: number) {
  const days = Math.max(1, daysBetween(RANGE.start, RANGE.end));
  const fillPx = Math.max(MONTH_MIN_PX, (viewW - PAD) / days);
  const canonical = band === "day" ? DAY_ZOOM : band === "week" ? WEEK_ZOOM : MONTH_ZOOM;
  return clamp(canonical, fillPx, MAX_PX);
}

function animateZoomTo(
  fromPx: number,
  toPx: number,
  viewW: number,
  scroll: number,
  anim: { id: number | null },
  apply: (px: number, scroll: number) => void,
  targetScroll?: number,
) {
  if (anim.id != null) {
    cancelAnimationFrame(anim.id);
    anim.id = null;
  }
  if (!(fromPx > 0) || !(toPx > 0)) return;
  const fromCenter = (scroll + viewW / 2 - PAD) / fromPx;
  const toCenter =
    targetScroll == null ? fromCenter : (targetScroll + viewW / 2 - PAD) / toPx;
  if (Math.abs(toPx - fromPx) < 0.001 && Math.abs(toCenter - fromCenter) < 0.01) return;
  const scrollFor = (px: number, center: number) => {
    const max = Math.max(0, trackWidth(px) - viewW);
    return Math.min(max, Math.max(0, center * px + PAD - viewW / 2));
  };
  const endScroll = targetScroll ?? scrollFor(toPx, toCenter);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    apply(toPx, endScroll);
    return;
  }
  const ticks = Math.abs(Math.log(toPx / fromPx) / Math.log(ZOOM_STEP));
  const dayDist = Math.abs(toCenter - fromCenter);
  const duration = Math.min(720, Math.max(320, 240 + ticks * 70 + dayDist * 0.35));
  const start = performance.now();
  let lastCommit = 0;
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = easeInOutCubic(t);
    const px = fromPx * (toPx / fromPx) ** eased;
    const center = fromCenter + (toCenter - fromCenter) * eased;
    if (t >= 1 || now - lastCommit >= 32) {
      lastCommit = now;
      apply(t >= 1 ? toPx : px, t >= 1 ? endScroll : scrollFor(px, center));
    }
    if (t < 1) anim.id = requestAnimationFrame(tick);
    else anim.id = null;
  };
  anim.id = requestAnimationFrame(tick);
}

function layoutScrollOf(el: { scrollLeft: number } | null | undefined, zoom: number) {
  const raw = el?.scrollLeft ?? 0;
  const scale = zoom > 0 ? zoom : 1;
  return scale === 1 ? raw : raw / scale;
}

function scrollToX(el: HTMLElement, target: number, anim: { id: number | null }, zoom = 1) {
  if (anim.id != null) {
    cancelAnimationFrame(anim.id);
    anim.id = null;
  }
  // target is a layout pixel. CSS zoom keeps scrollLeft in visual pixels.
  const scale = zoom > 0 ? zoom : 1;
  const max = Math.max(0, el.scrollWidth - el.clientWidth);
  const to = Math.min(max, Math.max(0, target * scale));
  const from = el.scrollLeft;
  const dist = to - from;
  if (Math.abs(dist) < 1) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.scrollLeft = to;
    return;
  }
  const duration = Math.min(720, Math.max(340, 260 + Math.abs(dist) * 0.28));
  const start = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    el.scrollLeft = from + dist * easeInOutCubic(t);
    if (t < 1) anim.id = requestAnimationFrame(tick);
    else anim.id = null;
  };
  anim.id = requestAnimationFrame(tick);
}

function viewForEntries(entries: Entry[], viewW: number) {
  if (!entries.length || viewW <= 0) return null;
  let min = parseISO(entries[0].start);
  let max = parseISO(entries[0].end);
  for (const entry of entries) {
    const start = parseISO(entry.start);
    const end = parseISO(entry.end);
    if (start < min) min = start;
    if (end > max) max = end;
  }
  if (min < RANGE.start) min = new Date(RANGE.start);
  if (max >= RANGE.end) max = addDays(RANGE.end, -1);
  if (min > max) return null;
  const spanDays = Math.max(1, daysBetween(min, max) + 1);
  const side = 0.08;
  const nextPx = clamp((viewW * (1 - side * 2)) / spanDays, MONTH_MIN_PX, MAX_PX);
  const contentW = spanDays * nextPx;
  const leftPad = contentW <= viewW ? Math.max((viewW - contentW) / 2, viewW * side) : (viewW - contentW) / 2;
  const maxScroll = Math.max(0, trackWidth(nextPx) - viewW);
  const scrollLeft = Math.min(maxScroll, Math.max(0, xAt(min, nextPx) - leftPad));
  return { px: nextPx, scrollLeft };
}

function scrollForDate(date: Date, px: number, viewW: number) {
  const target = xPoint(date, px) - viewW / 2;
  const max = Math.max(0, trackWidth(px) - viewW);
  return Math.min(max, Math.max(0, target));
}

function viewForMonthToday(viewW: number) {
  if (!(viewW > 0)) return null;
  const px = zoomPxFor("month", viewW);
  return { px, scrollLeft: scrollForDate(startOfDay(new Date()), px, viewW) };
}

function eachMonth() {
  const out: { start: Date; days: number; year: number; month: number; name: string }[] = [];
  const cursor = new Date(RANGE.start);
  while (cursor < RANGE.end) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    out.push({
      start: new Date(cursor),
      days: new Date(year, month + 1, 0).getDate(),
      year,
      month,
      name: MONTHS[month],
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

function eachQuarter() {
  const out: { start: Date; days: number; year: number; quarter: number; name: string; key: string }[] = [];
  const cursor = new Date(RANGE.start.getFullYear(), Math.floor(RANGE.start.getMonth() / 3) * 3, 1);
  while (cursor < RANGE.end) {
    const year = cursor.getFullYear();
    const quarter = Math.floor(cursor.getMonth() / 3) + 1;
    const start = new Date(cursor);
    const next = new Date(year, cursor.getMonth() + 3, 1);
    const end = next < RANGE.end ? next : new Date(RANGE.end);
    const begin = start < RANGE.start ? new Date(RANGE.start) : start;
    out.push({
      start: begin,
      days: Math.max(1, daysBetween(begin, end)),
      year,
      quarter,
      name: `Q${quarter}`,
      key: `${year}-Q${quarter}`,
    });
    cursor.setMonth(cursor.getMonth() + 3);
  }
  return out;
}

function eachYear() {
  const years: number[] = [];
  for (let y = RANGE.start.getFullYear(); y < RANGE.end.getFullYear(); y++) years.push(y);
  return years;
}

function eachMonday() {
  const out: Date[] = [];
  const cursor = mondayOf(RANGE.start);
  while (cursor < RANGE.end) {
    out.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }
  return out;
}

function eachDay() {
  const out: Date[] = [];
  const cursor = new Date(RANGE.start);
  while (cursor < RANGE.end) {
    out.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function clampDate(d: Date) {
  if (d < RANGE.start) return new Date(RANGE.start);
  const last = addDays(RANGE.end, -1);
  if (d > last) return last;
  return d;
}

function dateAtX(x: number, px: number) {
  const days = Math.floor((x - PAD) / px);
  if (days < 0) return null;
  const date = addDays(RANGE.start, days);
  if (date < RANGE.start || date >= RANGE.end) return null;
  return date;
}

function monthKeyAt(x: number, px: number) {
  const date = dateAtX(x, px);
  if (!date) return null;
  return `${date.getFullYear()}-${date.getMonth()}`;
}

function quarterKeyAt(x: number, px: number) {
  const date = dateAtX(x, px);
  if (!date) return null;
  return `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`;
}

function mondayOf(date: Date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = monday.getDay();
  monday.setDate(monday.getDate() + (day === 0 ? -6 : 1 - day));
  return monday;
}

function weekKey(monday: Date) {
  return `w-${monday.getFullYear()}-${monday.getMonth()}-${monday.getDate()}`;
}

function weekKeyAt(x: number, px: number) {
  const date = dateAtX(x, px);
  if (!date) return null;
  return weekKey(mondayOf(date));
}

function isoWeek(date: Date) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function dayKey(date: Date) {
  return `d-${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayKeyAt(x: number, px: number) {
  const date = dateAtX(x, px);
  if (!date) return null;
  return dayKey(date);
}

function formatDay(d: Date) {
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

function formatCardDate(d: Date) {
  return `${WEEKDAYS_SHORT[d.getDay()]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

/** Rounded tips land 11 px apart, then the width is scaled to 10 px. */
const MARK_HEIGHT = 11;
const MARK_WIDTH = 10;
const MARK_RADIUS = 1.5;
const MARK_STROKE = 1;
const MARK_SQUARE = (MARK_HEIGHT / 2 + MARK_RADIUS * (Math.SQRT2 - 1)) * Math.SQRT2;
/** Count circle that replaces diamonds once their centers are closer than the diamond is wide. */
const MARK_CIRCLE = 16;
/** Outer tip of an end diamond, or the edge of a count circle, stays this far inside the bar. */
const MARK_EDGE = 6;

type MarkGlyph = { key: string; x: number; marks: Milestone[] };

function markGlyphs(
  entry: Entry,
  box: { start: Date; end: Date; left: number; width: number },
  px: number,
): MarkGlyph[] {
  const visible = entry.milestones
    .filter((mark) => {
      const date = parseISO(mark.date);
      return date >= box.start && date <= box.end;
    })
    .map((mark) => ({ mark, x: nudgeMarkX(xDayMid(parseISO(mark.date), px) - box.left, MARK_WIDTH / 2, box.width) }))
    .sort((a, b) => a.x - b.x);
  const runs: { mark: Milestone; x: number }[][] = [];
  for (const item of visible) {
    const run = runs[runs.length - 1];
    if (run && item.x - run[run.length - 1].x < MARK_WIDTH - 0.05) run.push(item);
    else runs.push([item]);
  }
  return runs.map((run) => {
    if (run.length === 1) return { key: run[0].mark.id, x: run[0].x, marks: [run[0].mark] };
    const mid = run.reduce((sum, item) => sum + item.x, 0) / run.length;
    return {
      key: run.map((item) => item.mark.id).join("+"),
      x: nudgeMarkX(mid, MARK_CIRCLE / 2, box.width),
      marks: run.map((item) => item.mark),
    };
  });
}

/** Pull a mark inward only when its outer edge would be closer than MARK_EDGE to the bar. */
function nudgeMarkX(x: number, half: number, width: number) {
  const inset = half + MARK_EDGE;
  const minX = inset;
  const maxX = width - inset;
  if (minX <= maxX) {
    if (x < minX) return minX;
    if (x > maxX) return maxX;
    return x;
  }
  const lo = Math.min(half, width / 2);
  const hi = Math.max(width - half, width / 2);
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

function markNameSlots(glyphs: MarkGlyph[]) {
  return glyphs.map((glyph, index) => {
    const prev = index > 0 ? glyphs[index - 1].x : -Infinity;
    const next = index < glyphs.length - 1 ? glyphs[index + 1].x : Infinity;
    const leftRoom = Number.isFinite(prev) ? (glyph.x - prev) / 2 - 4 : 120;
    const rightRoom = Number.isFinite(next) ? (next - glyph.x) / 2 - 4 : 120;
    return {
      key: glyph.key,
      marks: glyph.marks,
      x: glyph.x,
      maxWidth: Math.max(12, Math.min(leftRoom, rightRoom) * 2),
      name: glyph.marks.map((mark) => mark.name).join(" · "),
    };
  });
}

function CountCircle({
  x,
  count,
  hot,
  picked,
  hub,
  connect,
}: {
  x: number;
  count: number;
  hot: boolean;
  picked: boolean;
  hub: boolean;
  connect: boolean;
}) {
  const id = `cal-cut-${useId().replace(/:/g, "")}`;
  return (
    <svg
      className={`cal-entry-count${hot ? " is-hot" : ""}${picked ? " is-on" : ""}${hub ? " is-hub" : ""}${connect ? " is-connect-from" : ""}`}
      style={{ left: x }}
      width={MARK_CIRCLE}
      height={MARK_CIRCLE}
      viewBox={`0 0 ${MARK_CIRCLE} ${MARK_CIRCLE}`}
      aria-hidden="true"
    >
      <mask id={id} maskUnits="userSpaceOnUse">
        <rect width={MARK_CIRCLE} height={MARK_CIRCLE} fill="#fff" />
        <text
          x={MARK_CIRCLE / 2}
          y={MARK_CIRCLE / 2 - 1}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#000"
          fontSize="11"
          fontWeight="600"
          fontFamily="Inter Variable, Inter, sans-serif"
        >
          {count}
        </text>
      </mask>
      <circle cx={MARK_CIRCLE / 2} cy={MARK_CIRCLE / 2} r={MARK_CIRCLE / 2} fill="#fff" mask={`url(#${id})`} />
    </svg>
  );
}

function formatMarkDate(d: Date) {
  return {
    weekday: WEEKDAYS_SHORT[d.getDay()],
    day: String(d.getDate()),
    month: MONTHS_SHORT[d.getMonth()],
  };
}

function DateGlyph({ date, left }: { date: Date; left: number }) {
  const parts = formatMarkDate(date);
  return (
    <span className="cal-guide-date" style={{ left }}>
      <span className="cal-entry-mark-date-dow">{parts.weekday},</span>
      <span className="cal-entry-mark-date-day">{parts.day}</span>
      <span className="cal-entry-mark-date-mon">{parts.month}</span>
    </span>
  );
}

function GuideClusterChip({
  count,
  left,
  open,
  dim,
  members,
  editing,
  onOpen,
  onClose,
  onEdit,
}: {
  count: number;
  left: number;
  open: boolean;
  dim?: boolean;
  members: { id: string; name: string; color: string; when: string; editable: boolean }[];
  editing: boolean;
  onOpen: () => void;
  onClose: () => void;
  onEdit: (id: string) => void;
}) {
  return (
    <div
      className={`cal-guide-cluster${open ? " is-open" : ""}${dim && !open ? " is-dim" : ""}`}
      style={{ left }}
      onMouseEnter={onOpen}
      onMouseLeave={onClose}
    >
      <span className="cal-guide-count">{count}</span>
      <div className="cal-guide-cluster-hit" />
      {open ? (
        <div className="cal-guide-pop" onPointerDown={(event) => event.stopPropagation()}>
          {members.map((member) =>
            editing && member.editable ? (
              <button
                key={member.id}
                type="button"
                className="cal-guide-pop-row"
                onClick={() => onEdit(member.id)}
              >
                <span className="cal-guide-pop-swatch" style={{ background: member.color }} />
                <span className="cal-guide-pop-name">{member.name}</span>
                <span className="cal-guide-pop-when">{member.when}</span>
              </button>
            ) : (
              <div key={member.id} className="cal-guide-pop-row is-static">
                <span className="cal-guide-pop-swatch" style={{ background: member.color }} />
                <span className="cal-guide-pop-name">{member.name}</span>
                <span className="cal-guide-pop-when">{member.when}</span>
              </div>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

function DateRangeGlyph({ start, end, left }: { start: Date; end: Date; left: number }) {
  const a = formatMarkDate(start);
  const b = formatMarkDate(end);
  return (
    <span className="cal-guide-date is-range" style={{ left }}>
      <span className="cal-entry-mark-date-dow">{a.weekday},</span>
      <span className="cal-entry-mark-date-day">{a.day}</span>
      <span className="cal-entry-mark-date-mon">{a.month}</span>
      <span className="cal-guide-date-sep">–</span>
      <span className="cal-entry-mark-date-dow">{b.weekday},</span>
      <span className="cal-entry-mark-date-day">{b.day}</span>
      <span className="cal-entry-mark-date-mon">{b.month}</span>
    </span>
  );
}

function formatRange(start: Date, end: Date) {
  if (toISO(start) === toISO(end)) return `${formatDay(start)} ${start.getFullYear()}`;
  const a = formatDay(start);
  const b = `${formatDay(end)} ${end.getFullYear()}`;
  if (start.getFullYear() !== end.getFullYear()) return `${a} ${start.getFullYear()} – ${b}`;
  return `${a} – ${b}`;
}

function uid() {
  return `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextMilestoneName(entry: Entry) {
  let max = 0;
  for (const mark of entry.milestones) {
    if (mark.name === "Milestone") max = Math.max(max, 1);
    const match = /^Milestone (\d+)$/.exec(mark.name);
    if (match) max = Math.max(max, Number(match[1]));
  }
  const n = max + 1;
  return n === 1 ? "Milestone" : `Milestone ${n}`;
}

function nextMarkerName(markers: TimeMarker[]) {
  let max = 0;
  for (const marker of markers) {
    if (marker.name === "Marker") max = Math.max(max, 1);
    const match = /^Marker (\d+)$/.exec(marker.name);
    if (match) max = Math.max(max, Number(match[1]));
  }
  const n = max + 1;
  return n === 1 ? "Marker" : `Marker ${n}`;
}

function nextEntryName(entries: Entry[]) {
  let max = 0;
  for (const entry of entries) {
    if (entry.name === "New Entry") max = Math.max(max, 1);
    const match = /^New Entry (\d+)$/.exec(entry.name);
    if (match) max = Math.max(max, Number(match[1]));
  }
  const n = max + 1;
  return n === 1 ? "New Entry" : `New Entry ${n}`;
}

function rowAtY(y: number, headH: number) {
  return Math.max(0, Math.floor((y - headH - ROW_TOP) / ROW_H));
}

function entryTitleMax(entries: Entry[], px: number) {
  const items = entries
    .map((entry) => {
      const box = layoutEntry(entry, px);
      return { id: entry.id, row: entry.row, left: box.left };
    })
    .sort((a, b) => a.row - b.row || a.left - b.left);
  const widths = new Map<string, number>();
  items.forEach((item, index) => {
    let nextLeft = Infinity;
    for (let i = index + 1; i < items.length; i++) {
      if (items[i].row !== item.row) break;
      nextLeft = items[i].left;
      break;
    }
    widths.set(item.id, Number.isFinite(nextLeft) ? Math.max(28, nextLeft - item.left - 8) : 400);
  });
  return widths;
}

type WeldBox = { left: number; width: number; barTop: number; top: number };

const MARK_NAME_TOP = 60;
const MARK_NAME_H = 12;
const MARK_STEM_GAP = 6;

function isFlushChild(parent: Entry, child: Entry) {
  return child.start === toISO(addDays(parseISO(parent.end), 1));
}

function weldGroupPaths(
  parent: Entry,
  children: Entry[],
  boxOf: (id: string) => WeldBox | null,
  radius: number,
) {
  const from = boxOf(parent.id);
  if (!from) return [] as { key: string; d: string }[];
  const x0 = from.left + from.width;
  const y0 = from.barTop + BAR_H / 2;
  const items = children
    .map((child) => ({ child, box: boxOf(child.id), flush: isFlushChild(parent, child) }))
    .filter((item): item is { child: Entry; box: WeldBox; flush: boolean } => !!item.box);
  if (!items.length) return [];
  const gap = Math.min(...items.map((item) => item.box.left - x0));
  const half = Number.isFinite(gap) ? Math.max(0, gap / 2) : 0;
  const stub = Math.min(half, Math.max(radius, Math.min(10, half)));
  const hubX = x0 + stub;
  const below = items.filter((item) => item.flush && item.box.barTop > from.barTop + 1);
  const above = items.filter((item) => item.flush && item.box.barTop < from.barTop - 1);
  const lastBelow = below.length
    ? below.reduce((best, item) => (item.box.barTop > best.box.barTop ? item : best))
    : null;
  const lastAbove = above.length
    ? above.reduce((best, item) => (item.box.barTop < best.box.barTop ? item : best))
    : null;
  return items.map((item) => {
    const box = item.box;
    const x1 = box.left;
    const lastBelowHere = lastBelow?.child.id === item.child.id;
    const lastAboveHere = lastAbove?.child.id === item.child.id;
    let y1 = box.barTop + BAR_H / 2;
    if (lastBelowHere) y1 = box.barTop + BAR_H - 1;
    else if (lastAboveHere) y1 = box.barTop + 1;
    let d = weldForkPath(x0, y0, hubX, y1, x1, radius);
    if (lastBelowHere) d += ` M ${x1} ${box.barTop} V ${box.barTop + BAR_H - 1}`;
    else if (lastAboveHere) d += ` M ${x1} ${box.barTop + 1} V ${box.barTop + BAR_H}`;
    return { key: `${parent.id}-${item.child.id}`, d };
  });
}

function weldMarkGroupPaths(
  host: Entry,
  mark: Milestone,
  children: Entry[],
  boxOf: (id: string) => WeldBox | null,
  px: number,
  radius: number,
) {
  const hostBox = boxOf(host.id);
  if (!hostBox) return [] as { key: string; d: string }[];
  const visual = markGlyphs(host, { start: parseISO(host.start), end: parseISO(host.end), left: hostBox.left, width: hostBox.width }, px)
    .find((glyph) => glyph.marks.some((item) => item.id === mark.id));
  const x0 = visual ? hostBox.left + visual.x : xDayMid(parseISO(mark.date), px);
  const y0 = hostBox.top + MARK_NAME_TOP + MARK_NAME_H + MARK_STEM_GAP;
  const items = children
    .map((child) => ({ child, box: boxOf(child.id) }))
    .filter((item): item is { child: Entry; box: WeldBox } => !!item.box);
  if (!items.length) return [];
  return items.map((item) => ({
    key: `mark-${mark.id}-${item.child.id}`,
    d: weldForkPath(x0, y0, x0, item.box.barTop + BAR_H / 2, item.box.left, radius),
  }));
}

function paintWeldLinks(
  root: HTMLElement,
  svg: SVGSVGElement,
  list: Entry[],
  px: number,
  radius: number,
  zoom = 1,
) {
  const origin = root.getBoundingClientRect();
  // Rects are visual. The link SVG lives inside the zoomed sheet, so its
  // path units are layout pixels. Dividing keeps a ctrl+wheel repaint aligned.
  const scale = zoom > 0 ? zoom : 1;
  const geom = (id: string): WeldBox | null => {
    const el = root.querySelector(`[data-entry-id="${CSS.escape(id)}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const top = (r.top - origin.top) / scale;
    return {
      left: (r.left - origin.left) / scale,
      width: r.width / scale,
      barTop: top + TITLE_H + BAR_GAP,
      top,
    };
  };
  const groups = new Map<string, Entry[]>();
  for (const child of list) {
    if (!child.parentId) continue;
    const pack = groups.get(child.parentId) ?? [];
    pack.push(child);
    groups.set(child.parentId, pack);
  }
  for (const [parentId, children] of groups) {
    const parent = list.find((entry) => entry.id === parentId);
    if (!parent) continue;
    for (const { key, d } of weldGroupPaths(parent, children, geom, radius)) {
      const path = svg.querySelector(`[data-link="${CSS.escape(key)}"]`);
      if (path) path.setAttribute("d", d);
    }
  }
  const markGroups = new Map<string, { host: Entry; mark: Milestone; children: Entry[] }>();
  for (const child of list) {
    const ref = child.parentMark;
    if (!ref) continue;
    const host = list.find((entry) => entry.id === ref.entryId);
    const mark = host?.milestones.find((item) => item.id === ref.markId);
    if (!host || !mark) continue;
    const key = `${ref.entryId}:${ref.markId}`;
    const pack = markGroups.get(key) ?? { host, mark, children: [] };
    pack.children.push(child);
    markGroups.set(key, pack);
  }
  for (const { host, mark, children } of markGroups.values()) {
    for (const { key, d } of weldMarkGroupPaths(host, mark, children, geom, px, radius)) {
      const path = svg.querySelector(`[data-link="${CSS.escape(key)}"]`);
      if (path) path.setAttribute("d", d);
    }
  }
}

function weldForkPath(x0: number, y0: number, hubX: number, y1: number, x1: number, radius: number) {
  const v = y1 - y0;
  if (Math.abs(v) < 0.5) {
    if (Math.abs(x1 - x0) < 2) {
      const half = BAR_H / 2;
      return `M ${x0} ${y0 - half} V ${y0 + half}`;
    }
    return `M ${x0} ${y0} H ${x1}`;
  }
  const sy = v > 0 ? 1 : -1;
  const h1 = hubX - x0;
  const h2 = x1 - hubX;
  const sx2 = h2 >= 0 ? 1 : -1;
  if (Math.abs(h1) < 0.5) {
    const r = Math.min(Math.max(0, radius), Math.abs(v) / 2, Math.abs(h2));
    if (r < 0.5) return `M ${x0} ${y0} V ${y1} H ${x1}`;
    return `M ${x0} ${y0} V ${y1 - sy * r} Q ${x0} ${y1} ${x0 + sx2 * r} ${y1} H ${x1}`;
  }
  const sx1 = h1 >= 0 ? 1 : -1;
  const r = Math.min(Math.max(0, radius), Math.abs(v) / 2, Math.abs(h1), Math.abs(h2));
  if (r < 0.5) return `M ${x0} ${y0} H ${hubX} V ${y1} H ${x1}`;
  return `M ${x0} ${y0} H ${hubX - sx1 * r} Q ${hubX} ${y0} ${hubX} ${y0 + sy * r} V ${y1 - sy * r} Q ${hubX} ${y1} ${hubX + sx2 * r} ${y1} H ${x1}`;
}

function layoutEntry(entry: Entry, px: number) {
  const start = parseISO(entry.start);
  const end = parseISO(entry.end);
  const left = xAt(start, px);
  const width = Math.max((daysBetween(start, end) + 1) * px, 8);
  const top = ROW_TOP + entry.row * ROW_H;
  const barTop = top + TITLE_H + BAR_GAP;
  return { start, end, left, width, top, barTop };
}

function marksInBar(entry: Entry) {
  return entry.milestones.filter((mark) => mark.date >= entry.start && mark.date <= entry.end);
}

function markDateBounds(entry: Entry) {
  const marks = marksInBar(entry);
  if (!marks.length) return null;
  let min = marks[0].date;
  let max = marks[0].date;
  for (const mark of marks) {
    if (mark.date < min) min = mark.date;
    if (mark.date > max) max = mark.date;
  }
  return { min: parseISO(min), max: parseISO(max) };
}

function scaleMilestones(origin: Entry, nextStart: Date, nextEnd: Date): Milestone[] {
  const start0 = parseISO(origin.start);
  const end0 = parseISO(origin.end);
  const span0 = daysBetween(start0, end0);
  const span1 = daysBetween(nextStart, nextEnd);
  return origin.milestones.map((mark) => {
    const t = span0 === 0 ? 0 : daysBetween(start0, parseISO(mark.date)) / span0;
    let date = addDays(nextStart, Math.round(t * span1));
    if (date < nextStart) date = nextStart;
    if (date > nextEnd) date = nextEnd;
    return { ...mark, date: toISO(date) };
  });
}

type TimeMarker = { id: string; name: string; date: string; end?: string; color?: string };

const COLOR_SWATCH_KEY = "plannr.colorSwatches";
const MAX_COLOR_SWATCHES = 10;
const STARTER_COLOR_SWATCHES = ["#f34e52", "#3ddc84", "#e1ba2f", "#cccccc"];

function normalizeHex(raw: string) {
  const trimmed = raw.trim();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return /^#[0-9a-fA-F]{6}$/.test(withHash) ? withHash.toLowerCase() : null;
}

function brighterHex(hex: string, amount = 0.38) {
  const value = Number.parseInt(hex.slice(1), 16);
  const mix = (channel: number) => Math.round(channel + (255 - channel) * amount);
  const red = mix((value >> 16) & 255);
  const green = mix((value >> 8) & 255);
  const blue = mix(value & 255);
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function loadColorSwatches() {
  try {
    const raw = JSON.parse(localStorage.getItem(COLOR_SWATCH_KEY) || "null");
    if (!Array.isArray(raw)) return STARTER_COLOR_SWATCHES;
    return raw.filter((item): item is string => typeof item === "string" && normalizeHex(item) != null).slice(0, MAX_COLOR_SWATCHES);
  } catch {
    return STARTER_COLOR_SWATCHES;
  }
}

function saveColorSwatches(list: string[]) {
  try {
    localStorage.setItem(COLOR_SWATCH_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

function EntryColorField({
  color,
  swatches,
  onColor,
  onSwatches,
}: {
  color?: string;
  swatches: string[];
  onColor: (color: string) => void;
  onSwatches: (list: string[]) => void;
}) {
  const shown = (color ?? "#ffffff").toLowerCase();
  const [draft, setDraft] = useState(shown.toUpperCase());
  useEffect(() => {
    setDraft(shown.toUpperCase());
  }, [shown]);

  const apply = (hex: string) => onColor(hex.toLowerCase());
  const commitDraft = () => {
    const next = normalizeHex(draft);
    if (next) apply(next);
    else setDraft(shown.toUpperCase());
  };
  const saved = swatches.map((swatch) => swatch.toLowerCase());
  const canAdd = saved.length < MAX_COLOR_SWATCHES && !saved.includes(shown);
  const add = () => {
    if (!canAdd) return;
    onSwatches([...saved, shown]);
  };
  const removeAt = (index: number) => onSwatches(saved.filter((_, item) => item !== index));

  return (
    <div className="cal-mark-edit-label">
      Color
      <div className="cal-color-row">
        <span className="cal-color-chip">
          <input
            type="color"
            aria-label="Color"
            value={shown}
            onChange={(event) => apply(event.target.value)}
          />
        </span>
        <input
          className="cal-icon-hex"
          spellCheck={false}
          aria-label="Color hex"
          value={draft}
          onChange={(event) => {
            const raw = event.target.value.toUpperCase();
            setDraft(raw);
            const next = normalizeHex(raw);
            if (next) apply(next);
          }}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          }}
        />
      </div>
      <div className="cal-color-swatches">
        {saved.map((swatch, index) => (
          <span key={`${swatch}-${index}`} className="cal-color-slot">
            <button
              type="button"
              className={`cal-color-swatch${shown === swatch ? " is-on" : ""}`}
              style={{ background: swatch }}
              aria-label={`Use ${swatch.toUpperCase()}`}
              aria-pressed={shown === swatch}
              onClick={() => apply(swatch)}
            />
            <button type="button" className="cal-color-x" aria-label={`Delete ${swatch.toUpperCase()}`} onClick={() => removeAt(index)}>
              <X size={10} strokeWidth={2} aria-hidden />
            </button>
          </span>
        ))}
        {saved.length < MAX_COLOR_SWATCHES ? (
          <button type="button" className="cal-color-add" aria-label="Save current color" disabled={!canAdd} onClick={add}>
            <Plus size={12} strokeWidth={2} aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function EditAction({
  icon: Icon,
  danger,
  children,
  onClick,
}: {
  icon: LucideIcon;
  danger?: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`cal-entry-edit-link${danger ? " is-danger" : ""}`} onClick={onClick}>
      <Icon size={14} strokeWidth={2} aria-hidden />
      {children}
    </button>
  );
}

function markerColor(marker: TimeMarker) {
  return marker.color ?? "#ffffff";
}

function markerSpan(marker: TimeMarker) {
  const start = parseISO(marker.date);
  const end = marker.end ? parseISO(marker.end) : start;
  return end < start ? { start: end, end: start } : { start, end };
}

function markerExtended(marker: TimeMarker) {
  const span = markerSpan(marker);
  return daysBetween(span.start, span.end) > 0;
}

function markerLayout(marker: TimeMarker, px: number) {
  const span = markerSpan(marker);
  const extended = daysBetween(span.start, span.end) > 0;
  const pointX = xPoint(span.start, px);
  const startX = extended ? xDayStart(span.start, px) : pointX;
  const endX = extended ? xDayEnd(span.end, px) : pointX;
  return { span, extended, startX, endX, midX: (startX + endX) / 2 };
}

const TODAY_HALF = 20;

const guideLabelWidthCache = new Map<string, number>();

function measureGuideLabel(name: string) {
  const key = name.toUpperCase();
  const cached = guideLabelWidthCache.get(key);
  if (cached != null) return cached;
  let width = key.length * 6.2 + Math.max(0, key.length - 1) * 0.4;
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.font = "700 10px Inter, system-ui, sans-serif";
      if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0.4px";
      width = ctx.measureText(key).width;
    }
  }
  guideLabelWidthCache.set(key, width);
  return width;
}

function hoverDateBox(marker: TimeMarker, px: number) {
  const { extended, startX, midX } = markerLayout(marker, px);
  if (extended) return { left: midX - 110, right: midX + 110 };
  return { left: startX - 80, right: startX + 80 };
}

function countHitsDate(cx: number, box: { left: number; right: number }) {
  return cx - 14 < box.right && box.left < cx + 14;
}

function guideLabelsOverlap(
  list: TimeMarker[],
  px: number,
  hoverId: string,
  slots: Map<string, number>,
  todayX?: number,
) {
  const hovered = hoverId === "__today__" ? null : list.find((marker) => marker.id === hoverId);
  if (hoverId !== "__today__" && !hovered) return new Set<string>();
  const hx = hoverId === "__today__" ? (todayX ?? 0) : markerLayout(hovered!, px).midX;
  const hw = measureGuideLabel(hoverId === "__today__" ? "TODAY" : hovered!.name);
  const hL = hx - hw / 2;
  const hR = hx + hw / 2;
  const hits = new Set<string>();
  for (const marker of list) {
    if (marker.id === hoverId) continue;
    const x = markerLayout(marker, px).midX;
    const full = measureGuideLabel(marker.name);
    const cap = slots.get(marker.id) ?? full;
    const w = Math.min(full, cap);
    const left = x - w / 2;
    const right = x + w / 2;
    if (left < hR + 4 && hL < right + 4) hits.add(marker.id);
  }
  if (todayX != null && hoverId !== "__today__") {
    const tw = measureGuideLabel("TODAY");
    const left = todayX - tw / 2;
    const right = todayX + tw / 2;
    if (left < hR + 4 && hL < right + 4) hits.add("__today__");
  }
  return hits;
}

const CLUSTER_PX = 8;

type MarkerCluster = {
  key: string;
  x: number;
  ids: string[];
  hasToday: boolean;
  hostId: string;
};

function markerClusters(list: TimeMarker[], px: number, todayX: number): MarkerCluster[] {
  type Item = { id: string; x: number };
  const items: Item[] = [];
  for (const marker of list) {
    const { startX, endX, extended } = markerLayout(marker, px);
    items.push({ id: marker.id, x: startX });
    if (extended && Math.abs(endX - startX) > CLUSTER_PX) items.push({ id: marker.id, x: endX });
  }
  items.push({ id: "__today__", x: todayX });
  items.sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
  const groups: Item[][] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(item.x - last[last.length - 1].x) <= CLUSTER_PX) last.push(item);
    else groups.push([item]);
  }
  const clusters: MarkerCluster[] = [];
  for (const group of groups) {
    const ids = [...new Set(group.map((item) => item.id))];
    if (ids.length < 2) continue;
    const hasToday = ids.includes("__today__");
    let hostId = hasToday ? "__today__" : ids[0];
    if (!hasToday) {
      for (let i = list.length - 1; i >= 0; i--) {
        if (ids.includes(list[i].id)) {
          hostId = list[i].id;
          break;
        }
      }
    }
    clusters.push({
      key: ids.slice().sort().join("|"),
      x: group.reduce((sum, item) => sum + item.x, 0) / group.length,
      ids,
      hasToday,
      hostId,
    });
  }
  return clusters;
}

function clusterPopupIds(cluster: MarkerCluster, list: TimeMarker[]) {
  const ids: string[] = [];
  if (cluster.hasToday) ids.push("__today__");
  for (let i = list.length - 1; i >= 0; i--) {
    if (cluster.ids.includes(list[i].id)) ids.push(list[i].id);
  }
  return ids;
}

function markerWhen(start: Date, end: Date) {
  const a = formatMarkDate(start);
  if (toISO(start) === toISO(end)) return `${a.weekday}, ${a.day} ${a.month}`;
  const b = formatMarkDate(end);
  return `${a.weekday}, ${a.day} ${a.month} – ${b.weekday}, ${b.day} ${b.month}`;
}

function guideLabelSlots(list: TimeMarker[], px: number, todayX: number) {
  const items = [
    ...list.map((marker) => ({
      id: marker.id,
      x: markerLayout(marker, px).midX,
      reserved: 0,
    })),
    { id: "__today__", x: todayX, reserved: TODAY_HALF },
  ].sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
  const slots = new Map<string, number>();
  items.forEach((item, index) => {
    if (item.id === "__today__") return;
    const prev = index > 0 ? items[index - 1] : null;
    const next = index < items.length - 1 ? items[index + 1] : null;
    const leftRoom = prev
      ? prev.reserved
        ? item.x - prev.x - prev.reserved - 4
        : (item.x - prev.x) / 2 - 4
      : 80;
    const rightRoom = next
      ? next.reserved
        ? next.x - next.reserved - item.x - 4
        : (next.x - item.x) / 2 - 4
      : 80;
    slots.set(item.id, Math.max(12, Math.min(leftRoom, rightRoom) * 2));
  });
  return slots;
}

function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
}

/** Menu and editor split: day view +7 days, week view +2 weeks, month view +2 months. */
function splitBounds(anchor: Date, px: number, sign: 1 | -1) {
  const band = zoomBandAt(px);
  const other =
    band === "day"
      ? addDays(anchor, 7 * sign)
      : band === "week"
        ? addDays(anchor, 14 * sign)
        : addMonths(anchor, 2 * sign);
  const a = clampDate(anchor);
  const b = clampDate(other);
  return b < a ? { start: b, end: a } : { start: a, end: b };
}

/** Shift-drag split. The start stays on the marker. The end follows the cursor forward
 *  and is at least one day once the pointer is to the right of the marker point.
 *  On or left of that point the marker is single again.
 */
function pointSplitBounds(anchor: Date, px: number, pointerX: number, cursor: Date | null) {
  const start = clampDate(anchor);
  if (pointerX <= xPoint(start, px)) return { start, end: start };
  if (cursor && cursor > start) return { start, end: clampDate(cursor) };
  const next = clampDate(addDays(start, 1));
  if (next.getTime() <= start.getTime()) return { start, end: start };
  return { start, end: next };
}

function markerWithSpan(marker: TimeMarker, start: Date, end: Date): TimeMarker {
  return {
    ...marker,
    date: toISO(start),
    end: daysBetween(start, end) > 0 ? toISO(end) : undefined,
  };
}

type HitPart = "body" | "title" | "start" | "end" | "mark";
type Hit = { entry: Entry; part: HitPart; markId?: string };

function hitTest(x: number, y: number, entries: Entry[], px: number, headH: number): Hit | null {
  if (y < headH) return null;
  const gy = y - headH;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    const box = layoutEntry(entry, px);
    const inBar = gy >= box.barTop && gy <= box.barTop + BAR_H && x >= box.left && x <= box.left + box.width;
    const inName = gy >= box.top && gy < box.barTop && x >= box.left && x <= box.left + Math.max(box.width, 120);
    if (!inBar && !inName) continue;
    if (inBar) {
      let best: { id: string; dist: number } | null = null;
      for (const glyph of markGlyphs(entry, box, px)) {
        const reach = glyph.marks.length > 1 ? Math.max(MARK_CIRCLE / 2, MARK_HIT) : MARK_HIT;
        const dist = Math.abs(box.left + glyph.x - x);
        if (dist > reach || (best && dist >= best.dist)) continue;
        let mark = glyph.marks[0];
        let markDist = Infinity;
        for (const item of glyph.marks) {
          const next = Math.abs(xDayMid(parseISO(item.date), px) - x);
          if (next < markDist) {
            mark = item;
            markDist = next;
          }
        }
        best = { id: mark.id, dist };
      }
      if (best) return { entry, part: "mark", markId: best.id };
      if (box.width >= 20) {
        if (x <= box.left + HANDLE) return { entry, part: "start" };
        if (x >= box.left + box.width - HANDLE) return { entry, part: "end" };
      }
    }
    if (inName && !inBar) return { entry, part: "title" };
    return { entry, part: "body" };
  }
  return null;
}

function hitTestToday(x: number, y: number, px: number, headH: number, today: Date) {
  const dist = Math.abs(xPoint(today, px) - x);
  const inLabel = y < 78 && dist <= 40;
  const inHeadLine = y >= 70 && y < headH && dist <= 8;
  return inLabel || inHeadLine;
}

function hitTestMarker(
  x: number, y: number, markers: TimeMarker[], px: number, headH: number,
): { marker: TimeMarker; part: "start" | "end" | "body" } | null {
  let best: { marker: TimeMarker; part: "start" | "end" | "body"; dist: number } | null = null;
  for (const marker of markers) {
    const { span, extended, startX, endX, midX } = markerLayout(marker, px);
    const inHead = y < headH;
    if (!inHead) continue;
    const onStart = Math.abs(x - startX) <= 8;
    const onEnd = extended && Math.abs(x - endX) <= 8;
    const inBand = x >= startX - 8 && x <= endX + 8;
    const onLabel = y < 78 && Math.abs(x - midX) <= Math.max(40, (endX - startX) / 2);
    if (!onStart && !onEnd && !inBand && !onLabel) continue;
    let part: "start" | "end" | "body" = "body";
    let dist = Math.abs(x - midX);
    if (extended && onStart && (!onEnd || Math.abs(x - startX) <= Math.abs(x - endX))) {
      part = "start";
      dist = Math.abs(x - startX);
    } else if (extended && onEnd) {
      part = "end";
      dist = Math.abs(x - endX);
    }
    if (!best || dist < best.dist - 1 || Math.abs(dist - best.dist) <= CLUSTER_PX) {
      best = { marker, part, dist };
    }
  }
  return best ? { marker: best.marker, part: best.part } : null;
}

type CalendarSelection = {
  entries: string[];
  marks: { entryId: string; markId: string }[];
  markers: string[];
};

const EMPTY_SELECTION: CalendarSelection = { entries: [], marks: [], markers: [] };

function markKey(entryId: string, markId: string) {
  return `${entryId}:${markId}`;
}

function rectsOverlap(
  a: { left: number; right: number; top: number; bottom: number },
  b: { left: number; right: number; top: number; bottom: number },
) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function selectionInRect(
  left: number,
  top: number,
  right: number,
  bottom: number,
  entries: Entry[],
  markers: TimeMarker[],
  px: number,
  headH: number,
): CalendarSelection {
  const rect = { left, right, top, bottom };
  const entryIds: string[] = [];
  const marks: { entryId: string; markId: string }[] = [];
  const markerIds: string[] = [];
  for (const entry of entries) {
    const box = layoutEntry(entry, px);
    if (
      rectsOverlap(rect, {
        left: box.left,
        right: box.left + box.width,
        top: headH + box.top,
        bottom: headH + box.barTop + BAR_H,
      })
    ) {
      entryIds.push(entry.id);
    }
    for (const glyph of markGlyphs(entry, box, px)) {
      const half = glyph.marks.length > 1 ? MARK_CIRCLE / 2 : 6;
      const mx = box.left + glyph.x;
      const my = headH + box.barTop + BAR_H / 2;
      if (
        rectsOverlap(rect, {
          left: mx - half,
          right: mx + half,
          top: my - half,
          bottom: my + half,
        })
      ) {
        for (const mark of glyph.marks) marks.push({ entryId: entry.id, markId: mark.id });
      }
    }
  }
  for (const marker of markers) {
    const { startX, endX } = markerLayout(marker, px);
    if (
      rectsOverlap(rect, {
        left: Math.min(startX, endX) - 8,
        right: Math.max(startX, endX) + 8,
        top: 0,
        bottom: headH,
      })
    ) {
      markerIds.push(marker.id);
    }
  }
  return { entries: entryIds, marks, markers: markerIds };
}

function deleteSelected(
  list: Entry[],
  markers: TimeMarker[],
  selection: CalendarSelection,
): { entries: Entry[]; markers: TimeMarker[] } {
  const entryIds = new Set(selection.entries);
  const dyingMarks = new Set(
    selection.marks
      .filter((mark) => !entryIds.has(mark.entryId))
      .map((mark) => markKey(mark.entryId, mark.markId)),
  );
  const markerIds = new Set(selection.markers);
  const nextEntries = list
    .filter((entry) => !entryIds.has(entry.id))
    .map((entry) => {
      let parentId = entry.parentId;
      let parentMark = entry.parentMark;
      if (parentId && entryIds.has(parentId)) parentId = undefined;
      if (
        parentMark &&
        (entryIds.has(parentMark.entryId) ||
          dyingMarks.has(markKey(parentMark.entryId, parentMark.markId)))
      ) {
        parentMark = undefined;
      }
      const milestones = entry.milestones.filter((mark) => !dyingMarks.has(markKey(entry.id, mark.id)));
      if (parentId === entry.parentId && parentMark === entry.parentMark && milestones.length === entry.milestones.length) {
        return entry;
      }
      return { ...entry, parentId, parentMark, milestones };
    });
  return {
    entries: nextEntries,
    markers: markers.filter((marker) => !markerIds.has(marker.id)),
  };
}

function selectionEmpty(selection: CalendarSelection) {
  return !selection.entries.length && !selection.marks.length && !selection.markers.length;
}

function cloneSelection(selection: CalendarSelection): CalendarSelection {
  return {
    entries: [...selection.entries],
    marks: selection.marks.map((mark) => ({ ...mark })),
    markers: [...selection.markers],
  };
}

function unionSelection(a: CalendarSelection, b: CalendarSelection): CalendarSelection {
  const entries = [...a.entries];
  for (const id of b.entries) if (!entries.includes(id)) entries.push(id);
  const marks = [...a.marks];
  for (const mark of b.marks) {
    if (!marks.some((item) => item.entryId === mark.entryId && item.markId === mark.markId)) marks.push(mark);
  }
  const markers = [...a.markers];
  for (const id of b.markers) if (!markers.includes(id)) markers.push(id);
  return { entries, marks, markers };
}

function toggleEntryInSelection(selection: CalendarSelection, id: string): CalendarSelection {
  const has = selection.entries.includes(id);
  return {
    ...selection,
    entries: has ? selection.entries.filter((item) => item !== id) : [...selection.entries, id],
  };
}

function toggleMarkInSelection(
  selection: CalendarSelection,
  entryId: string,
  markId: string,
): CalendarSelection {
  const has = selection.marks.some((item) => item.entryId === entryId && item.markId === markId);
  return {
    ...selection,
    marks: has
      ? selection.marks.filter((item) => !(item.entryId === entryId && item.markId === markId))
      : [...selection.marks, { entryId, markId }],
  };
}

function toggleMarkerInSelection(selection: CalendarSelection, id: string): CalendarSelection {
  const has = selection.markers.includes(id);
  return {
    ...selection,
    markers: has ? selection.markers.filter((item) => item !== id) : [...selection.markers, id],
  };
}

type Drag =
  | { kind: "pan"; x: number; scroll: number }
  | {
      kind: "marquee";
      originClientX: number;
      originClientY: number;
      originX: number;
      originY: number;
      armed: boolean;
      originSelection: CalendarSelection;
    }
  | {
      kind: "create";
      id: string;
      anchor: Date;
      moved: boolean;
      armed: boolean;
      originX: number;
      originY: number;
      originEntries: Entry[];
    }
  | {
      kind: "move";
      id: string;
      grabDays: number;
      duration: number;
      originStart: string;
      originRow: number;
      originMilestones: Milestone[];
      originEntries: Entry[];
      fromTitle: boolean;
      moved: boolean;
      armed: boolean;
      originX: number;
      originY: number;
      groupIds: string[];
    }
  | { kind: "resize"; id: string; part: "start" | "end"; originEntries: Entry[] }
  | {
      kind: "mark";
      entryId: string;
      markId: string;
      armed: boolean;
      moved: boolean;
      originX: number;
      originY: number;
      originDate: string;
      originEntries: Entry[];
    }
  | {
      kind: "guide";
      id: string;
      armed: boolean;
      originX: number;
      originY: number;
      part: "start" | "end" | "body";
      originDate: string;
      originEnd: string;
      originContentX: number;
      extending: boolean;
      shiftSplit: boolean;
    };

function cloneEntries(list: Entry[]): Entry[] {
  return list.map((entry) => ({
    ...entry,
    parentMark: entry.parentMark ? { ...entry.parentMark } : undefined,
    milestones: entry.milestones.map((mark) => ({ ...mark })),
  }));
}

function childIds(list: Entry[], rootId: string) {
  const out: string[] = [];
  const walk = (id: string) => {
    for (const entry of list) {
      const viaBar = entry.parentId === id;
      const viaMark = entry.parentMark?.entryId === id;
      if ((viaBar || viaMark) && !out.includes(entry.id)) {
        out.push(entry.id);
        walk(entry.id);
      }
    }
  };
  walk(rootId);
  return out;
}

function entryDisconnectable(list: Entry[], entry: Entry) {
  if (entry.parentId || entry.parentMark) return true;
  return list.some((item) => item.parentId === entry.id || item.parentMark?.entryId === entry.id);
}

function markDisconnectable(list: Entry[], entryId: string, markId: string) {
  return list.some((item) => item.parentMark?.entryId === entryId && item.parentMark.markId === markId);
}

function disconnectEntry(list: Entry[], id: string) {
  return list.map((entry) => {
    if (entry.id === id) return { ...entry, parentId: undefined, parentMark: undefined };
    if (entry.parentId === id) return { ...entry, parentId: undefined };
    if (entry.parentMark?.entryId === id) return { ...entry, parentMark: undefined };
    return entry;
  });
}

function disconnectMark(list: Entry[], entryId: string, markId: string) {
  return list.map((entry) =>
    entry.parentMark?.entryId === entryId && entry.parentMark.markId === markId
      ? { ...entry, parentMark: undefined }
      : entry,
  );
}

function minStartFor(list: Entry[], entry: Entry): Date | null {
  if (entry.parentId) {
    const parent = list.find((item) => item.id === entry.parentId);
    if (parent) return addDays(parseISO(parent.end), 1);
  }
  if (entry.parentMark) {
    const host = list.find((item) => item.id === entry.parentMark!.entryId);
    const mark = host?.milestones.find((item) => item.id === entry.parentMark!.markId);
    if (mark) return addDays(parseISO(mark.date), 1);
  }
  return null;
}

function shiftEntryDays(entry: Entry, delta: number): Entry {
  if (delta === 0) return entry;
  return {
    ...entry,
    start: toISO(addDays(parseISO(entry.start), delta)),
    end: toISO(addDays(parseISO(entry.end), delta)),
    milestones: entry.milestones.map((mark) => ({
      ...mark,
      date: toISO(addDays(parseISO(mark.date), delta)),
    })),
  };
}

function shiftSubtree(list: Entry[], rootId: string, delta: number) {
  if (delta === 0) return;
  const ids = [rootId, ...childIds(list, rootId)];
  for (const id of ids) {
    const index = list.findIndex((entry) => entry.id === id);
    if (index !== -1) list[index] = shiftEntryDays(list[index], delta);
  }
}

function applyLinkConstraints(list: Entry[], id: string, px: number): Entry[] {
  const next = cloneEntries(list);
  const src = next.find((entry) => entry.id === id);
  if (!src) return next;
  const ownMin = minStartFor(next, src);
  if (ownMin) {
    const start = parseISO(src.start);
    if (start < ownMin) shiftSubtree(next, src.id, daysBetween(start, ownMin));
  }
  const queue = [id];
  while (queue.length) {
    const parentId = queue.shift();
    if (!parentId) break;
    const parent = next.find((entry) => entry.id === parentId);
    if (!parent) continue;
    const barMin = addDays(parseISO(parent.end), 1);
    for (const child of next) {
      if (child.parentId !== parentId) continue;
      const start = parseISO(child.start);
      if (start < barMin) shiftSubtree(next, child.id, daysBetween(start, barMin));
      queue.push(child.id);
    }
    for (const mark of parent.milestones) {
      const markMin = addDays(parseISO(mark.date), 1);
      for (const child of next) {
        if (child.parentMark?.entryId !== parent.id || child.parentMark.markId !== mark.id) continue;
        const start = parseISO(child.start);
        if (start < markMin) shiftSubtree(next, child.id, daysBetween(start, markMin));
        queue.push(child.id);
      }
    }
  }
  const ids = [id, ...childIds(next, id)];
  let out = next;
  for (const eid of ids) out = resolveCollisions(out, eid, px, ids);
  return out;
}

function moveSubtree(
  origin: Entry[],
  id: string,
  nextStart: Date,
  nextRow: number,
  duration: number,
  px: number,
  solo = false,
) {
  const list = cloneEntries(origin);
  const src = list.find((entry) => entry.id === id);
  if (!src) return list;
  let start = nextStart;
  const minStart = minStartFor(list, src);
  if (minStart && start < minStart) start = minStart;
  let end = addDays(start, duration);
  if (end >= RANGE.end) {
    end = addDays(RANGE.end, -1);
    start = addDays(end, -duration);
    if (start < RANGE.start) start = new Date(RANGE.start);
    if (minStart && start < minStart) start = minStart;
  }
  if (start < RANGE.start) start = new Date(RANGE.start);
  let delta = daysBetween(parseISO(src.start), start);
  const ids = solo ? [id] : [id, ...childIds(list, id)];
  for (const eid of ids) {
    const entry = list.find((item) => item.id === eid);
    if (!entry) continue;
    const shiftedEnd = addDays(parseISO(entry.end), delta);
    if (shiftedEnd >= RANGE.end) {
      const maxEnd = addDays(RANGE.end, -1);
      delta -= daysBetween(maxEnd, shiftedEnd);
    }
  }
  for (const eid of ids) {
    const entry = list.find((item) => item.id === eid);
    if (!entry) continue;
    const shiftedStart = addDays(parseISO(entry.start), delta);
    if (shiftedStart < RANGE.start) delta += daysBetween(shiftedStart, RANGE.start);
  }
  if (solo) {
    const index = list.findIndex((entry) => entry.id === id);
    if (index === -1) return list;
    list[index] = { ...shiftEntryDays(list[index], delta), row: Math.max(0, nextRow) };
    return applyLinkConstraints(list, id, px);
  }
  shiftSubtree(list, id, delta);
  let rowDelta = nextRow - src.row;
  const minRow = Math.min(...ids.map((eid) => list.find((item) => item.id === eid)?.row ?? 0));
  if (minRow + rowDelta < 0) rowDelta = -minRow;
  for (const eid of ids) {
    const entry = list.find((item) => item.id === eid);
    if (entry) entry.row += rowDelta;
  }
  let out = list;
  for (const eid of ids) out = resolveCollisions(out, eid, px, ids);
  return out;
}

function externalMinStart(list: Entry[], entry: Entry, moving: Set<string>): Date | null {
  if (entry.parentId && !moving.has(entry.parentId)) {
    const parent = list.find((item) => item.id === entry.parentId);
    if (parent) return addDays(parseISO(parent.end), 1);
  }
  if (entry.parentMark && !moving.has(entry.parentMark.entryId)) {
    const host = list.find((item) => item.id === entry.parentMark!.entryId);
    const mark = host?.milestones.find((item) => item.id === entry.parentMark!.markId);
    if (mark) return addDays(parseISO(mark.date), 1);
  }
  return null;
}

function moveSelection(
  origin: Entry[],
  anchorId: string,
  groupIds: string[],
  nextStart: Date,
  nextRow: number,
  duration: number,
  px: number,
  solo = false,
) {
  const list = cloneEntries(origin);
  const src = list.find((entry) => entry.id === anchorId);
  if (!src) return list;
  const roots = [...new Set(groupIds.filter((id) => list.some((entry) => entry.id === id)))];
  if (!roots.includes(anchorId)) roots.unshift(anchorId);
  const movingIds: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    movingIds.push(id);
    if (!solo) for (const child of childIds(list, id)) add(child);
  };
  for (const id of roots) add(id);

  let start = nextStart;
  const anchorMin = externalMinStart(list, src, seen);
  if (anchorMin && start < anchorMin) start = anchorMin;
  let end = addDays(start, duration);
  if (end >= RANGE.end) {
    end = addDays(RANGE.end, -1);
    start = addDays(end, -duration);
    if (start < RANGE.start) start = new Date(RANGE.start);
    if (anchorMin && start < anchorMin) start = anchorMin;
  }
  if (start < RANGE.start) start = new Date(RANGE.start);
  let delta = daysBetween(parseISO(src.start), start);
  const clampEnds = () => {
    for (const id of movingIds) {
      const entry = list.find((item) => item.id === id);
      if (!entry) continue;
      const shiftedEnd = addDays(parseISO(entry.end), delta);
      if (shiftedEnd >= RANGE.end) delta -= daysBetween(addDays(RANGE.end, -1), shiftedEnd);
    }
  };
  clampEnds();
  for (const id of movingIds) {
    const entry = list.find((item) => item.id === id);
    if (!entry) continue;
    const shiftedStart = addDays(parseISO(entry.start), delta);
    if (shiftedStart < RANGE.start) delta += daysBetween(shiftedStart, RANGE.start);
    const min = externalMinStart(list, entry, seen);
    if (min && shiftedStart < min) {
      const need = daysBetween(parseISO(entry.start), min);
      if (delta < need) delta = need;
    }
  }
  clampEnds();

  for (const id of movingIds) {
    const index = list.findIndex((entry) => entry.id === id);
    if (index !== -1) list[index] = shiftEntryDays(list[index], delta);
  }
  let rowDelta = nextRow - src.row;
  const minRow = Math.min(...movingIds.map((id) => list.find((entry) => entry.id === id)?.row ?? 0));
  if (minRow + rowDelta < 0) rowDelta = -minRow;
  for (const id of movingIds) {
    const entry = list.find((item) => item.id === id);
    if (entry) entry.row += rowDelta;
  }
  if (solo) {
    for (const id of roots) {
      const parent = list.find((entry) => entry.id === id);
      if (!parent) continue;
      const barMin = addDays(parseISO(parent.end), 1);
      for (const child of list) {
        if (seen.has(child.id) || child.parentId !== id) continue;
        const childStart = parseISO(child.start);
        if (childStart < barMin) shiftSubtree(list, child.id, daysBetween(childStart, barMin));
      }
      for (const mark of parent.milestones) {
        const markMin = addDays(parseISO(mark.date), 1);
        for (const child of list) {
          if (seen.has(child.id)) continue;
          if (child.parentMark?.entryId !== id || child.parentMark.markId !== mark.id) continue;
          const childStart = parseISO(child.start);
          if (childStart < markMin) shiftSubtree(list, child.id, daysBetween(childStart, markMin));
        }
      }
    }
  }
  let out = list;
  for (const id of movingIds) out = resolveCollisions(out, id, px, movingIds);
  return out;
}

function linkEntries(list: Entry[], parentId: string, childId: string, px: number) {
  if (parentId === childId) return list;
  if (childIds(list, childId).includes(parentId)) return list;
  const next = cloneEntries(list);
  const child = next.find((entry) => entry.id === childId);
  const parent = next.find((entry) => entry.id === parentId);
  if (!child || !parent) return list;
  child.parentId = parentId;
  child.parentMark = undefined;
  return applyLinkConstraints(next, childId, px);
}

function linkToMark(list: Entry[], hostId: string, markId: string, childId: string, px: number) {
  if (hostId === childId) return list;
  if (childIds(list, childId).includes(hostId)) return list;
  const next = cloneEntries(list);
  const child = next.find((entry) => entry.id === childId);
  const host = next.find((entry) => entry.id === hostId);
  const mark = host?.milestones.find((item) => item.id === markId);
  if (!child || !host || !mark) return list;
  child.parentId = undefined;
  child.parentMark = { entryId: hostId, markId };
  return applyLinkConstraints(next, childId, px);
}

function rangesOverlap(a: Entry, b: Entry, px: number, pad: number) {
  const A = layoutEntry(a, px);
  const B = layoutEntry(b, px);
  return A.left < B.left + B.width + pad && B.left < A.left + A.width + pad;
}

function linkedPair(a: Entry, b: Entry) {
  return a.parentId === b.id || b.parentId === a.id;
}

function datesOverlap(a: Entry, b: Entry) {
  return a.start <= b.end && b.start <= a.end;
}

function entriesCollide(a: Entry, b: Entry, px: number, pad: number) {
  if (a.id === b.id || a.row !== b.row) return false;
  if (linkedPair(a, b)) return datesOverlap(a, b);
  return rangesOverlap(a, b, px, pad);
}

function resolveCollisions(list: Entry[], sourceId: string, px: number, skipIds?: Iterable<string>): Entry[] {
  const skip = new Set(skipIds);
  const next = cloneEntries(list);
  const queue = [sourceId];
  let steps = 0;
  while (queue.length && steps++ < 200) {
    const id = queue.shift();
    if (!id) break;
    const src = next.find((entry) => entry.id === id);
    if (!src) continue;
    for (const other of next) {
      if (other.id === src.id || skip.has(other.id)) continue;
      if (!entriesCollide(src, other, px, COLLIDE_PAD)) continue;
      other.row += 1;
      queue.push(other.id);
    }
  }
  return next;
}

function upsertAndResolve(origin: Entry[], entry: Entry, px: number): Entry[] {
  const list = cloneEntries(origin);
  const index = list.findIndex((item) => item.id === entry.id);
  if (index === -1) list.push(entry);
  else list[index] = entry;
  return resolveCollisions(list, entry.id, px);
}

function duplicateEntry(origin: Entry[], source: Entry, px: number) {
  const copy: Entry = {
    id: uid(),
    name: source.name,
    start: source.start,
    end: source.end,
    row: source.row + 1,
    icon: source.icon,
    iconColor: source.iconColor,
    color: source.color,
    milestones: source.milestones.map((mark) => ({ ...mark, id: uid() })),
  };
  return { list: upsertAndResolve(origin, copy, px), copy };
}

type SnapRole = "start" | "end" | "mark";
type SnapPart = { role: SnapRole; iso: string };

function snapX(part: SnapPart, px: number) {
  const date = parseISO(part.iso);
  if (part.role === "start") return xDayStart(date, px);
  if (part.role === "end") return xDayEnd(date, px);
  return xDayMid(date, px);
}

function entrySnapParts(entry: Entry): SnapPart[] {
  return [
    { role: "start", iso: entry.start },
    { role: "end", iso: entry.end },
    ...entry.milestones.map((mark) => ({ role: "mark" as const, iso: mark.date })),
  ];
}

function pushSnapX(xs: number[], x: number) {
  if (!xs.some((value) => Math.abs(value - x) < 0.01)) xs.push(x);
}

function poolSnapXs(live: Entry, list: Entry[], px: number) {
  const xs: number[] = [];
  for (const other of list) {
    if (other.id === live.id || other.row === live.row) continue;
    pushSnapX(xs, xDayStart(parseISO(other.start), px));
    pushSnapX(xs, xDayEnd(parseISO(other.end), px));
    for (const mark of other.milestones) {
      const date = parseISO(mark.date);
      pushSnapX(xs, xDayStart(date, px));
      pushSnapX(xs, xDayEnd(date, px));
      pushSnapX(xs, xDayMid(date, px));
    }
  }
  return xs;
}

function movingSnapXs(parts: SnapPart[], px: number) {
  const xs: number[] = [];
  for (const part of parts) {
    if (part.role === "mark") {
      const date = parseISO(part.iso);
      pushSnapX(xs, xDayMid(date, px));
      pushSnapX(xs, xDayStart(date, px));
      pushSnapX(xs, xDayEnd(date, px));
    } else {
      pushSnapX(xs, snapX(part, px));
    }
  }
  return xs;
}

function alignXs(parts: SnapPart[], live: Entry, list: Entry[], px: number) {
  const pool = poolSnapXs(live, list, px);
  const hits: number[] = [];
  for (const x of movingSnapXs(parts, px)) {
    if (pool.some((value) => Math.abs(value - x) < 0.01)) pushSnapX(hits, x);
  }
  return hits;
}

function dragDateAnchors(drag: Drag | null, entries: Entry[], px: number, held: boolean) {
  if (!drag) return [] as { key: string; date: Date; x: number }[];
  if (drag.kind === "move" && (drag.armed || held)) {
    const entry = entries.find((item) => item.id === drag.id);
    if (!entry) return [];
    return [
      { key: "start", date: parseISO(entry.start), x: xDayStart(parseISO(entry.start), px) },
      { key: "end", date: parseISO(entry.end), x: xDayEnd(parseISO(entry.end), px) },
    ];
  }
  if (drag.kind === "resize") {
    const entry = entries.find((item) => item.id === drag.id);
    if (!entry) return [];
    const date = parseISO(drag.part === "start" ? entry.start : entry.end);
    return [
      {
        key: drag.part,
        date,
        x: drag.part === "start" ? xDayStart(date, px) : xDayEnd(date, px),
      },
    ];
  }
  if (drag.kind === "mark" && (drag.armed || held)) {
    const entry = entries.find((item) => item.id === drag.entryId);
    const mark = entry?.milestones.find((item) => item.id === drag.markId);
    if (!mark) return [];
    return [{ key: mark.id, date: parseISO(mark.date), x: xDayMid(parseISO(mark.date), px) }];
  }
  if (drag.kind === "create" && drag.armed) {
    const entry = entries.find((item) => item.id === drag.id);
    if (!entry) return [];
    return [
      { key: "start", date: parseISO(entry.start), x: xDayStart(parseISO(entry.start), px) },
      { key: "end", date: parseISO(entry.end), x: xDayEnd(parseISO(entry.end), px) },
    ];
  }
  return [];
}

function alignSelectedEdges(list: Entry[], ids: string[], px: number, edge: "start" | "end"): Entry[] {
  const selected = list.filter((entry) => ids.includes(entry.id));
  if (selected.length < 2) return list;
  let targetIso = selected[0][edge];
  for (const entry of selected) {
    if (edge === "start" ? entry.start < targetIso : entry.end > targetIso) targetIso = entry[edge];
  }
  const target = parseISO(targetIso);
  const next = cloneEntries(list);
  for (const id of ids) {
    const index = next.findIndex((entry) => entry.id === id);
    if (index === -1) continue;
    const delta = daysBetween(parseISO(next[index][edge]), target);
    if (delta !== 0) next[index] = shiftEntryDays(next[index], delta);
  }
  let out = next;
  const order = ids
    .map((id) => out.find((entry) => entry.id === id))
    .filter((entry): entry is Entry => Boolean(entry))
    .sort((a, b) => a.row - b.row || a.id.localeCompare(b.id));
  for (const entry of order) out = applyLinkConstraints(out, entry.id, px);
  for (const entry of order) out = resolveCollisions(out, entry.id, px);
  return out;
}

function compactEntries(list: Entry[], px: number): Entry[] {
  const next = cloneEntries(list);
  const ordered = [...next].sort(
    (a, b) => a.row - b.row || a.start.localeCompare(b.start) || a.id.localeCompare(b.id),
  );
  const placed: Entry[] = [];
  for (const entry of ordered) {
    let row = 0;
    while (row < 500) {
      entry.row = row;
      if (!placed.some((other) => entriesCollide(entry, other, px, COLLIDE_PAD))) break;
      row += 1;
    }
    placed.push(entry);
  }
  return next;
}

function closestMarkId(entry: Entry, x: number, px: number) {
  const box = layoutEntry(entry, px);
  const glyphs = markGlyphs(entry, box, px);
  if (!glyphs.length) return null;
  let bestId: string | null = null;
  let bestDist = Infinity;
  for (const glyph of glyphs) {
    const dist = Math.abs(box.left + glyph.x - x);
    if (dist >= bestDist) continue;
    let mark = glyph.marks[0];
    let markDist = Infinity;
    for (const item of glyph.marks) {
      const next = Math.abs(xDayMid(parseISO(item.date), px) - x);
      if (next < markDist) {
        mark = item;
        markDist = next;
      }
    }
    bestDist = dist;
    bestId = mark.id;
  }
  return bestId;
}



function selectRenameText(input: HTMLInputElement) {
  input.focus({ preventScroll: true });
  input.setSelectionRange(0, input.value.length);
  input.scrollLeft = 0;
}



type MenuState = {
  x: number;
  y: number;
  kind: "entry" | "entries" | "empty" | "mark" | "guide";
  entryId: string | null;
  markId: string | null;
  markerId: string | null;
  date: string;
  row: number;
};

const MENU_ICONS: Record<string, LucideIcon> = {
  Center: Crosshair,
  Today: Sun,
  Month: Calendar,
  Week: CalendarRange,
  Day: CalendarDays,
  Compact: Minimize2,
  Edit: Pencil,
  Split: Split,
  "Delete marker": Trash2,
  Connect: Link2,
  Disconnect: Unlink,
  "Delete milestone": Trash2,
  "Align Start": AlignStartVertical,
  "Align End": AlignEndVertical,
  Colorize: Palette,
  "Delete entries": Trash2,
  Milestone: Flag,
  Duplicate: Copy,
  "Delete entry": Trash2,
  "Add entry": Plus,
  "Add marker": MapPin,
};

function MenuItem({
  children,
  danger,
  muted,
  on,
  disabled,
  onClick,
}: {
  children: ReactNode;
  danger?: boolean;
  muted?: boolean;
  on?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const Icon = typeof children === "string" ? MENU_ICONS[children] : undefined;
  return (
    <button
      type="button"
      className={`cal-menu-item${danger ? " is-danger" : ""}${muted || disabled ? " is-muted" : ""}${on ? " is-on" : ""}`}
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onClick?.();
      }}
    >
      {Icon ? <Icon className="cal-menu-ico" strokeWidth={2} aria-hidden /> : null}
      <span>{children}</span>
    </button>
  );
}

function placeEditPanel(rawTop: number) {
  const margin = 8;
  const minHeight = 160;
  const limit = Math.max(margin, window.innerHeight - margin - minHeight);
  const top = Math.min(Math.max(margin, rawTop), limit);
  return { top, maxHeight: Math.max(minHeight, window.innerHeight - top - margin) };
}

export default function YearView({
  mode,
  compactAt = 0,
  centerAt = 0,
  todayAt = 0,
  zoomAt = 0,
  zoomTarget = "month",
  onZoomBand,
  persistAt = 0,
  persistKind = "save",
  projectId = "lab",
  rangeFrom = 2024,
  rangeTo = 2029,
  onRangeChange,
  onPersistStatus,
  onToday,
  onCenter,
  onCompact,
  onZoomTo,
  revertAt = 0,
  redoAt = 0,
  onCanRevert,
  onCanRedo,
  reloadAt = 0,
  liveRef,
  exportAt = 0,
  onExportSnapshot,
  contentLines = true,
  contentMarkers = true,
  contentZoom = 1,
}: {
  mode: "edit" | "view";
  compactAt?: number;
  centerAt?: number;
  todayAt?: number;
  zoomAt?: number;
  zoomTarget?: "month" | "week" | "day";
  onZoomBand?: (band: "month" | "week" | "day") => void;
  persistAt?: number;
  persistKind?: PersistKind;
  projectId?: string;
  rangeFrom?: number;
  rangeTo?: number;
  onRangeChange?: (from: number, to: number) => void;
  onPersistStatus?: (status: "sync" | "saved" | "error") => void;
  onToday?: () => void;
  onCenter?: () => void;
  onCompact?: () => void;
  onZoomTo?: (band: "month" | "week" | "day") => void;
  revertAt?: number;
  redoAt?: number;
  onCanRevert?: (can: boolean) => void;
  onCanRedo?: (can: boolean) => void;
  reloadAt?: number;
  liveRef?: MutableRefObject<CalendarSnapshot | null>;
  exportAt?: number;
  onExportSnapshot?: (calendar: CalendarSnapshot) => void;
  contentLines?: boolean;
  contentMarkers?: boolean;
  contentZoom?: number;
}) {
  RANGE.start = new Date(rangeFrom, 0, 1);
  RANGE.end = new Date(rangeTo + 1, 0, 1);
  const scroller = useRef<HTMLDivElement>(null);
  const contentZoomRef = useRef(contentZoom > 0 ? contentZoom : 1);
  const appliedContentZoom = useRef(contentZoom > 0 ? contentZoom : 1);
  const zoomAnchor = useRef<number | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const entriesBox = useRef<HTMLDivElement>(null);
  const linksSvg = useRef<SVGSVGElement>(null);
  const pendingScroll = useRef<number | null>(null);
  const pendingCenter = useRef(false);
  const scrollAnim = useRef<{ id: number | null }>({ id: null });
  const didInit = useRef(false);
  const persistReady = useRef(false);
  const skipPersistToast = useRef(true);
  const persistGen = useRef(0);
  const hydratedId = useRef<string | null>(null);
  const hydratedFp = useRef<string | null>(null);
  const historyPast = useRef<HistoryDoc[]>([]);
  const historyFuture = useRef<HistoryDoc[]>([]);
  const historyNow = useRef<HistoryDoc | null>(null);
  const historySkip = useRef(true);
  const historyBusy = useRef(false);
  const rangeFromRef = useRef(rangeFrom);
  const rangeToRef = useRef(rangeTo);
  const onCanRevertRef = useRef(onCanRevert);
  const onCanRedoRef = useRef(onCanRedo);
  const recordHistoryRef = useRef<(snap: HistoryDoc) => void>(() => {});
  const bootRef = useRef(bootCalendar());
  const drag = useRef<Drag | null>(null);
  const modeRef = useRef(mode);
  const pxRef = useRef(1.65);
  const quarterZoom = useRef(false);
  const [px, setPx] = useState(MONTH_ZOOM);
  const [quarterOn, setQuarterOn] = useState(false);
  const [viewH, setViewH] = useState(0);
  const [viewW, setViewW] = useState(0);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [hoverMonthKey, setHoverMonthKey] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>(() => bootRef.current.entries);
  const [colorSwatches, setColorSwatches] = useState<string[]>(loadColorSwatches);
  const menuDrag = useRef<{ id: string; ox: number; oy: number } | null>(null);
  const [menuPlace, setMenuPlace] = useState<{ id: string; left: number; top: number } | null>(null);
  const [menuDragging, setMenuDragging] = useState(false);
  const commitSwatches = (list: string[]) => {
    setColorSwatches(list);
    saveColorSwatches(list);
  };
  const bindMenu = (id: string, anchorLeft: number, anchorTop: number) => {
    const moved = menuPlace?.id === id ? menuPlace : null;
    const top = moved?.top ?? anchorTop;
    return {
      dragging: menuDragging && menuDrag.current?.id === id,
      style: {
        left: moved?.left ?? anchorLeft,
        top,
        maxHeight: Math.max(160, window.innerHeight - top - 8),
      },
      onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
        event.stopPropagation();
        const target = event.target as HTMLElement;
        if (target.closest("input, button, textarea, a, .cal-icon-grid")) return;
        const rect = event.currentTarget.getBoundingClientRect();
        menuDrag.current = { id, ox: event.clientX - rect.left, oy: event.clientY - rect.top };
        setMenuDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      },
      onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
        const current = menuDrag.current;
        if (!current || current.id !== id) return;
        const node = event.currentTarget;
        const width = node.offsetWidth;
        const nextLeft = event.clientX - current.ox + width / 2;
        const nextTop = event.clientY - current.oy;
        const minLeft = width / 2 + 8;
        const maxLeft = Math.max(minLeft, window.innerWidth - width / 2 - 8);
        setMenuPlace({
          id,
          left: Math.min(maxLeft, Math.max(minLeft, nextLeft)),
          top: Math.min(Math.max(8, window.innerHeight - 48), Math.max(8, nextTop)),
        });
      },
      onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => {
        if (menuDrag.current?.id !== id) return;
        menuDrag.current = null;
        setMenuDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      },
    };
  };
  const [colorizeIds, setColorizeIds] = useState<string[] | null>(null);
  const [hoverEntryId, setHoverEntryId] = useState<string | null>(null);
  const [hoverMarkId, setHoverMarkId] = useState<string | null>(null);
  const [hoverClientX, setHoverClientX] = useState(0);
  const [selection, setSelection] = useState<CalendarSelection>(EMPTY_SELECTION);
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingDraft, setRenamingDraft] = useState("");
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [editingMark, setEditingMark] = useState<{ entryId: string; markId: string } | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editingIconId, setEditingIconId] = useState<string | null>(null);
  const [iconFromIcon, setIconFromIcon] = useState(false);
  const [editFocus, setEditFocus] = useState<"name" | "icon">("name");
  const [spanDraft, setSpanDraft] = useState<{ start: string; end: string } | null>(null);
  const [markers, setMarkers] = useState<TimeMarker[]>(() => bootRef.current.markers);
  const [hoverGuideId, setHoverGuideId] = useState<string | null>(null);
  const [hoverToday, setHoverToday] = useState(false);
  const [hoverClusterKey, setHoverClusterKey] = useState<string | null>(null);
  const hoverClusterKeyRef = useRef<string | null>(null);
  const clustersRef = useRef<MarkerCluster[]>([]);
  const [editingGuideId, setEditingGuideId] = useState<string | null>(null);
  const [guideDateDraft, setGuideDateDraft] = useState<{ start: string; end: string } | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [moreBelow, setMoreBelow] = useState(false);
  const [vMetrics, setVMetrics] = useState({ scroll: 0, view: 0, content: 0 });
  const railWindowRef = useRef<HTMLSpanElement>(null);
  const [snapXs, setSnapXs] = useState<number[]>([]);
  const [dragHold, setDragHold] = useState(false);
  const [connectFrom, setConnectFrom] = useState<
    { kind: "entry"; id: string } | { kind: "mark"; entryId: string; markId: string } | null
  >(null);
  const [linkRadius, setLinkRadius] = useState(0);
  const [treeDragId, setTreeDragId] = useState<string | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTitleClick = useRef<{ id: string; at: number } | null>(null);
  const lastMarkClick = useRef<{ id: string; at: number } | null>(null);
  const lastBarClick = useRef<{ id: string; at: number } | null>(null);
  const lastGuideClick = useRef<{ id: string; at: number } | null>(null);
  const editingGuideRef = useRef<string | null>(null);
  const renamingIdRef = useRef<string | null>(null);
  const editingMarkRef = useRef<{ entryId: string; markId: string } | null>(null);
  const editingEntryRef = useRef<string | null>(null);
  const editingIconRef = useRef<string | null>(null);
  const ignoreRenameBlur = useRef(false);
  const renameSelectAll = useRef(false);
  const beginRenameRef = useRef<(id: string, name: string) => void>(() => {});
  const entriesRef = useRef(entries);
  const markersRef = useRef(markers);
  const contentMarkersRef = useRef(contentMarkers);
  const selectionRef = useRef(selection);
  const connectFromRef = useRef<
    { kind: "entry"; id: string } | { kind: "mark"; entryId: string; markId: string } | null
  >(null);
  const menuRef = useRef<MenuState | null>(null);
  const cardListRef = useRef<HTMLUListElement | null>(null);
  const headHRef = useRef(HEAD_H);
  useEffect(() => {
    const list = cardListRef.current;
    if (!list) return;
    if (!hoverMarkId) {
      list.scrollTop = 0;
      return;
    }
    const row = list.querySelector<HTMLElement>(".is-hot");
    if (!row) return;
    const listBox = list.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    if (rowBox.top >= listBox.top && rowBox.bottom <= listBox.bottom) return;
    const delta = rowBox.top - listBox.top - (list.clientHeight - rowBox.height) / 2;
    list.scrollTo({ top: list.scrollTop + delta, behavior: "smooth" });
  }, [hoverMarkId, hoverEntryId]);
  renamingIdRef.current = renamingId;
  editingMarkRef.current = editingMark;
  editingEntryRef.current = editingEntryId;
  editingIconRef.current = editingIconId;
  editingGuideRef.current = editingGuideId;
  const MONTHS_META = useMemo(() => eachMonth(), [rangeFrom, rangeTo]);
  const QUARTERS = useMemo(() => eachQuarter(), [rangeFrom, rangeTo]);
  const YEARS = useMemo(() => eachYear(), [rangeFrom, rangeTo]);
  const MONDAYS = useMemo(() => eachMonday(), [rangeFrom, rangeTo]);
  const DAYS = useMemo(() => eachDay(), [rangeFrom, rangeTo]);
  const today = useMemo(() => startOfDay(new Date()), []);
  const showDays = px >= DAY_PX;
  const showWeeks = px >= WEEK_PX && !showDays;
  const showFine = showWeeks || showDays;
  const showQuarters = quarterOn;
  modeRef.current = mode;
  pxRef.current = px;
  connectFromRef.current = connectFrom;
  entriesRef.current = entries;
  markersRef.current = markers;
  contentMarkersRef.current = contentMarkers;
  selectionRef.current = selection;
  menuRef.current = menu;
  headHRef.current = HEAD_H;
  contentZoomRef.current = contentZoom > 0 ? contentZoom : 1;
  rangeFromRef.current = rangeFrom;
  rangeToRef.current = rangeTo;
  if (liveRef) {
    liveRef.current = {
      entries,
      markers,
      rangeFrom,
      rangeTo,
      view: { px: pxRef.current, scrollLeft: layoutScrollOf(scroller.current, contentZoomRef.current) },
    };
  }
  onCanRevertRef.current = onCanRevert;
  onCanRedoRef.current = onCanRedo;

  recordHistoryRef.current = (snap: HistoryDoc) => {
    if (!persistReady.current || historySkip.current) return;
    const prev = historyNow.current;
    if (prev && historyKey(prev) === historyKey(snap)) return;
    if (prev) {
      historyPast.current = [...historyPast.current, cloneHistory(prev)].slice(-HISTORY_LIMIT);
      historyFuture.current = [];
      onCanRevertRef.current?.(true);
      onCanRedoRef.current?.(false);
    }
    historyNow.current = cloneHistory(snap);
  };

  useEffect(() => {
    const read = () => {
      const raw = document.documentElement.style.getPropertyValue("--entry-link-radius");
      const next = parseFloat(raw);
      setLinkRadius(Number.isFinite(next) ? next : 0);
    };
    read();
    window.addEventListener("plannr-dev-vars", read);
    return () => window.removeEventListener("plannr-dev-vars", read);
  }, []);

  useLayoutEffect(() => {
    const root = entriesBox.current;
    const svg = linksSvg.current;
    if (!root || !svg) return;
    const paint = () => paintWeldLinks(root, svg, entries, px, linkRadius, contentZoomRef.current);
    paint();
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      paint();
      if (now - start < 240) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [entries, px, linkRadius, contentZoom]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      setViewW(w);
      setViewH(el.clientHeight);
      if (!didInit.current && w > 0) {
        didInit.current = true;
        const saved = bootRef.current.view;
        if (saved) {
          const next = clamp(saved.px, MIN_PX, MAX_PX);
          const quarters = isQuarterZoom(next, w);
          quarterZoom.current = quarters;
          setQuarterOn(quarters);
          setPx(next);
          pendingScroll.current = saved.scrollLeft;
        } else {
          const layoutW = w / (contentZoomRef.current || 1);
          const framed = viewForEntries(entriesRef.current, layoutW) ?? viewForMonthToday(layoutW);
          if (framed) {
            setPx(framed.px);
            pendingScroll.current = framed.scrollLeft;
          }
        }
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const fillPx = viewportFillPx(el.clientWidth);
    const floor = monthZoomFloor(el.clientWidth);
    if (px > floor + 0.001 && quarterZoom.current) {
      quarterZoom.current = false;
      setQuarterOn(false);
    }
    if (scrollAnim.current.id == null && quarterZoom.current && px < fillPx - 0.001) {
      setPx(Math.min(MAX_PX, fillPx));
      return;
    }
    if (scrollAnim.current.id == null && !quarterZoom.current && fillPx > px + 0.001) {
      setPx(clamp(fillPx, MONTH_MIN_PX, MAX_PX));
      return;
    }
    const z = contentZoomRef.current || 1;
    if (pendingScroll.current != null) {
      el.scrollLeft = pendingScroll.current * z;
      pendingScroll.current = null;
    }
    const max = Math.max(0, trackWidth(px) * z - el.clientWidth);
    if (el.scrollLeft > max) el.scrollLeft = max;
  }, [rangeFrom, rangeTo, px]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || pendingScroll.current == null) return;
    el.scrollLeft = pendingScroll.current * (contentZoomRef.current || 1);
    pendingScroll.current = null;
  });

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const next = contentZoomRef.current || 1;
    const prev = appliedContentZoom.current;
    appliedContentZoom.current = next;
    if (prev === next) return;
    // Chrome clamps scrollLeft as soon as zoom shrinks the sheet, so the
    // layout anchor is captured during render, before that clamp.
    const layout = zoomAnchor.current ?? layoutScrollOf(el, prev);
    zoomAnchor.current = null;
    const max = Math.max(0, trackWidth(pxRef.current) * next - el.clientWidth);
    el.scrollLeft = Math.min(max, Math.max(0, layout * next));
  }, [contentZoom]);

  useLayoutEffect(() => {
    if (!pendingCenter.current) return;
    const el = scroller.current;
    if (!el || el.clientWidth <= 0) return;
    pendingCenter.current = false;
    const layoutW = el.clientWidth / (contentZoomRef.current || 1);
    const framed = viewForEntries(entriesRef.current, layoutW) ?? viewForMonthToday(layoutW);
    if (!framed) return;
    pendingScroll.current = framed.scrollLeft;
    if (Math.abs(framed.px - px) > 0.0001) setPx(framed.px);
    else {
      el.scrollLeft = framed.scrollLeft * (contentZoomRef.current || 1);
      pendingScroll.current = null;
    }
  });

  useEffect(() => {
    drag.current = null;
    const el = scroller.current;
    if (el) {
      el.classList.remove("is-panning", "is-moving", "is-selecting");
      el.style.cursor = "";
    }
    setHoverKey(null);
    setHoverMonthKey(null);
    setHoverEntryId(null);
    setHoverMarkId(null);
    setHoverGuideId(null);
    setHoverToday(false);
    selectOnlyEntry(null);
    setMarquee(null);
    if (mode !== "edit") setRenamingId(null);
    setEditingMark(null);
    setEditingEntryId(null);
    setEditingIconId(null);
    setEditingGuideId(null);
    setColorizeIds(null);
    setMenu(null);
    setSnapXs([]);
  }, [mode]);

  const commitPersist = (write: () => void | Promise<void>, toast: boolean) => {
    const id = ++persistGen.current;
    if (toast) onPersistStatus?.("sync");
    Promise.resolve(write())
      .then(() => {
        if (!toast) return;
        window.setTimeout(() => {
          if (id === persistGen.current) onPersistStatus?.("saved");
        }, 360);
      })
      .catch(() => {
        if (id === persistGen.current) onPersistStatus?.("error");
      });
  };

  useEffect(() => {
    let cancelled = false;
    const prev = getCurrentProjectId();
    const flushPrev =
      persistReady.current && hydratedId.current === prev
        ? {
            id: prev,
            baseFp: hydratedFp.current,
            snapshot: {
              entries: entriesRef.current,
              markers: markersRef.current,
              rangeFrom,
              rangeTo,
              view: { px: pxRef.current, scrollLeft: layoutScrollOf(scroller.current, contentZoomRef.current) },
            } satisfies CalendarSnapshot,
          }
        : null;
    persistReady.current = false;
    hydratedId.current = null;
    skipPersistToast.current = true;
    historySkip.current = true;
    historyBusy.current = false;
    historyPast.current = [];
    historyFuture.current = [];
    onCanRevert?.(false);
    onCanRedo?.(false);
    (async () => {
      if (flushPrev && flushPrev.id !== projectId) {
        try {
          await persistWorking(flushPrev.snapshot, flushPrev.id, flushPrev.baseFp);
        } catch {
          /* switch anyway */
        }
      }
      setCurrentProjectId(projectId);
      try {
        const state = await hydrateCalendar();
        if (cancelled) return;
        bootRef.current = state;
        setEntries(state.entries);
        setMarkers(state.markers);
        selectOnlyEntry(null);
        setEditingMark(null);
        setEditingEntryId(null);
        setEditingGuideId(null);
        setRenamingId(null);
        setConnectFrom(null);
        onRangeChange?.(state.rangeFrom, state.rangeTo);
        if (state.view) {
          const next = clamp(state.view.px, MIN_PX, MAX_PX);
          const quarters = isQuarterZoom(next, scroller.current?.clientWidth ?? 0);
          quarterZoom.current = quarters;
          setQuarterOn(quarters);
          pendingScroll.current = state.view.scrollLeft;
          if (Math.abs(next - pxRef.current) > 0.0001) setPx(next);
          else if (scroller.current) scroller.current.scrollLeft = state.view.scrollLeft * (contentZoomRef.current || 1);
        } else {
          pendingCenter.current = true;
        }
        hydratedId.current = projectId;
        hydratedFp.current = calendarFingerprint(state);
        persistReady.current = true;
        skipPersistToast.current = true;
      } catch {
        if (!cancelled) {
          historySkip.current = false;
          onPersistStatus?.("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, reloadAt]);

  useEffect(() => {
    if (!compactAt) return;
    setEntries((list) => compactEntries(list, pxRef.current));
  }, [compactAt]);

  useEffect(() => {
    if (contentMarkers) return;
    setHoverGuideId(null);
    setHoverClusterKey(null);
    setEditingGuideId(null);
    editingGuideRef.current = null;
    setMenu((current) => (current?.kind === "guide" ? null : current));
    setSelection((current) => (current.markers.length ? { ...current, markers: [] } : current));
  }, [contentMarkers]);

  useEffect(() => {
    const snap: HistoryDoc = { entries, markers, rangeFrom, rangeTo };
    if (!persistReady.current) {
      historyNow.current = cloneHistory(snap);
      return;
    }
    if (historySkip.current) {
      historyNow.current = cloneHistory(snap);
      historySkip.current = false;
      return;
    }
    if (historyBusy.current) return;
    recordHistoryRef.current(snap);
  }, [entries, markers, rangeFrom, rangeTo]);

  useEffect(() => {
    if (!persistReady.current || hydratedId.current !== projectId) return;
    const id = projectId;
    const timer = window.setTimeout(() => {
      if (!persistReady.current || hydratedId.current !== id || getCurrentProjectId() !== id) return;
      const snapshot: CalendarSnapshot = {
        entries,
        markers,
        rangeFrom,
        rangeTo,
        view: { px, scrollLeft: layoutScrollOf(scroller.current, contentZoomRef.current) },
      };
      const nextFp = calendarFingerprint(snapshot);
      if (nextFp === hydratedFp.current) return;
      const write = async () => {
        const result = await persistWorking(snapshot, id, hydratedFp.current);
        if (result === "conflict") {
          persistReady.current = false;
          hydratedId.current = null;
          const state = await hydrateCalendar();
          if (hydratedId.current != null) return;
          bootRef.current = state;
          setEntries(state.entries);
          setMarkers(state.markers);
          onRangeChange?.(state.rangeFrom, state.rangeTo);
          hydratedId.current = id;
          hydratedFp.current = calendarFingerprint(state);
          persistReady.current = true;
          skipPersistToast.current = true;
          return;
        }
        if (result === "ok") hydratedFp.current = nextFp;
      };
      if (skipPersistToast.current) {
        skipPersistToast.current = false;
        commitPersist(write, false);
        return;
      }
      commitPersist(write, true);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [entries, markers, rangeFrom, rangeTo, px, projectId]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let timer = 0;
    const onScroll = () => {
      if (!persistReady.current) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!persistReady.current || hydratedId.current !== projectId) return;
        const snapshot: CalendarSnapshot = {
          entries: entriesRef.current,
          markers: markersRef.current,
          rangeFrom,
          rangeTo,
          view: { px: pxRef.current, scrollLeft: layoutScrollOf(el, contentZoomRef.current) },
        };
        persistWorking(snapshot, projectId, hydratedFp.current)
          .then((result) => {
            if (result === "ok") hydratedFp.current = calendarFingerprint(snapshot);
          })
          .catch(() => onPersistStatus?.("error"));
      }, 200);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.clearTimeout(timer);
    };
  }, [rangeFrom, rangeTo, projectId]);

  useEffect(() => {
    if (!persistAt) return;
    const currentView = {
      px: pxRef.current,
      scrollLeft: layoutScrollOf(scroller.current, contentZoomRef.current),
    };
    const empty = emptyCalendar(rangeFrom, rangeTo, currentView);
    setEntries(empty.entries);
    setMarkers(empty.markers);
    commitPersist(() => persistWorking(empty), true);
    setEditingMark(null);
    setEditingEntryId(null);
    setEditingGuideId(null);
    selectOnlyEntry(null);
  }, [persistAt]);

  useEffect(() => {
    if (!exportAt) return;
    const calendar: CalendarSnapshot = {
      entries,
      markers,
      rangeFrom,
      rangeTo,
      view: { px: pxRef.current, scrollLeft: layoutScrollOf(scroller.current, contentZoomRef.current) },
    };
    persistWorking(calendar, projectId).catch(() => {
      /* export should not surface a persist error */
    });
    onExportSnapshot?.(calendar);
  }, [exportAt]);

  const applyHistory = (doc: HistoryDoc) => {
    historySkip.current = true;
    setEntries(structuredClone(doc.entries));
    setMarkers(structuredClone(doc.markers));
    onRangeChange?.(doc.rangeFrom, doc.rangeTo);
    setEditingMark(null);
    setEditingEntryId(null);
    setEditingGuideId(null);
    setRenamingId(null);
    selectOnlyEntry(null);
    setConnectFrom(null);
  };

  useEffect(() => {
    if (!revertAt) return;
    const now = historyNow.current;
    const prev = historyPast.current.pop();
    if (!prev || !now) {
      onCanRevert?.(historyPast.current.length > 0);
      return;
    }
    historyFuture.current = [...historyFuture.current, cloneHistory(now)].slice(-HISTORY_LIMIT);
    applyHistory(prev);
    historyNow.current = prev;
    onCanRevert?.(historyPast.current.length > 0);
    onCanRedo?.(true);
  }, [revertAt]);

  useEffect(() => {
    if (!redoAt) return;
    const now = historyNow.current;
    const next = historyFuture.current.pop();
    if (!next || !now) {
      onCanRedo?.(historyFuture.current.length > 0);
      return;
    }
    historyPast.current = [...historyPast.current, cloneHistory(now)].slice(-HISTORY_LIMIT);
    applyHistory(next);
    historyNow.current = next;
    onCanRevert?.(true);
    onCanRedo?.(historyFuture.current.length > 0);
  }, [redoAt]);

  useLayoutEffect(() => {
    if (!centerAt) return;
    const el = scroller.current;
    if (!el) return;
    quarterZoom.current = false;
    setQuarterOn(false);
    const z = contentZoomRef.current || 1;
    const layoutW = el.clientWidth / z;
    const framed = viewForEntries(entriesRef.current, layoutW);
    if (!framed) return;
    const fromPx = pxRef.current;
    const fromScroll = pendingScroll.current ?? el.scrollLeft / z;
    if (Math.abs(framed.px - fromPx) < 0.001) {
      pendingScroll.current = null;
      scrollToX(el, framed.scrollLeft, scrollAnim.current, z);
    } else {
      animateZoomTo(
        fromPx,
        framed.px,
        layoutW,
        fromScroll,
        scrollAnim.current,
        (nextPx, nextScroll) => {
          pxRef.current = nextPx;
          pendingScroll.current = nextScroll;
          setPx(nextPx);
        },
        framed.scrollLeft,
      );
    }
    return () => {
      if (scrollAnim.current.id != null) {
        cancelAnimationFrame(scrollAnim.current.id);
        scrollAnim.current.id = null;
      }
    };
  }, [centerAt]);

  useLayoutEffect(() => {
    if (!todayAt) return;
    const el = scroller.current;
    if (!el) return;
    const scale = pxRef.current;
    const z = contentZoomRef.current || 1;
    const target = xPoint(today, scale) - el.clientWidth / (2 * z);
    pendingScroll.current = null;
    scrollToX(el, target, scrollAnim.current, z);
    return () => {
      if (scrollAnim.current.id != null) {
        cancelAnimationFrame(scrollAnim.current.id);
        scrollAnim.current.id = null;
      }
    };
  }, [todayAt, today]);

  useLayoutEffect(() => {
    if (!zoomAt) return;
    const el = scroller.current;
    if (!el) return;
    quarterZoom.current = false;
    setQuarterOn(false);
    const z = contentZoomRef.current || 1;
    const fromPx = pxRef.current;
    const toPx = zoomPxFor(zoomTarget, el.clientWidth);
    const scroll = pendingScroll.current ?? el.scrollLeft / z;
    animateZoomTo(fromPx, toPx, el.clientWidth / z, scroll, scrollAnim.current, (nextPx, nextScroll) => {
      pxRef.current = nextPx;
      pendingScroll.current = nextScroll;
      setPx(nextPx);
    });
    return () => {
      if (scrollAnim.current.id != null) {
        cancelAnimationFrame(scrollAnim.current.id);
        scrollAnim.current.id = null;
      }
    };
  }, [zoomAt, zoomTarget]);

  useLayoutEffect(() => {
    onZoomBand?.(zoomBandAt(px));
  }, [px, onZoomBand]);

  useLayoutEffect(() => {
    if (!renamingId) return;
    const input = scroller.current?.querySelector<HTMLInputElement>(".cal-entry-rename");
    if (!input) return;
    const selectAll = () => {
      if (!renameSelectAll.current) return;
      selectRenameText(input);
    };
    selectAll();
    const frame = requestAnimationFrame(selectAll);
    const onUp = () => requestAnimationFrame(selectAll);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("mouseup", onUp, true);
    const timeout = window.setTimeout(selectAll, 0);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("mouseup", onUp, true);
      window.clearTimeout(timeout);
    };
  }, [renamingId]);

  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const read = () => {
      const scroll = el.scrollTop;
      const view = el.clientHeight;
      const content = Math.max(el.scrollHeight, entriesBox.current?.offsetHeight ?? 0);
      setScrolled(scroll > 2);
      setMoreBelow(content - scroll - view > 2);
      setVMetrics({ scroll, view, content });
      const railH = Math.max(1, view - 16);
      const max = Math.max(1, content - view);
      const windowH = Math.max(16, Math.min(railH, (view / Math.max(content, 1)) * railH));
      const windowTop = (scroll / max) * (railH - windowH);
      const win = railWindowRef.current;
      if (win) {
        win.style.height = `${windowH}px`;
        win.style.transform = `translateY(${windowTop}px)`;
      }
    };
    read();
    el.addEventListener("scroll", read, { passive: true });
    const observer = new ResizeObserver(read);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", read);
      observer.disconnect();
    };
  }, [entries, px, rangeFrom, rangeTo]);

  useLayoutEffect(() => {
    const el = body.current;
    const win = railWindowRef.current;
    if (!el || !win) return;
    const scroll = el.scrollTop;
    const view = el.clientHeight;
    const content = Math.max(el.scrollHeight, entriesBox.current?.offsetHeight ?? 0);
    const railH = Math.max(1, view - 16);
    const max = Math.max(1, content - view);
    const windowH = Math.max(16, Math.min(railH, (view / Math.max(content, 1)) * railH));
    const windowTop = (scroll / max) * (railH - windowH);
    win.style.height = `${windowH}px`;
    win.style.transform = `translateY(${windowTop}px)`;
  }, [vMetrics, entries]);

  const selectOnlyEntry = (id: string | null) => {
    setSelection(id ? { entries: [id], marks: [], markers: [] } : EMPTY_SELECTION);
  };

  const saveRename = (id: string, value: string) => {
    const name = value.trim();
    setEntries((list) => list.map((entry) => (entry.id === id ? { ...entry, name: name || entry.name } : entry)));
    setRenamingId(null);
  };

  const dismissOpenEditors = () => {
    editingMarkRef.current = null;
    editingEntryRef.current = null;
    editingIconRef.current = null;
    editingGuideRef.current = null;
    setEditingMark(null);
    setEditingEntryId(null);
    setEditingIconId(null);
    setEditingGuideId(null);
    setColorizeIds(null);
    setRenamingId(null);
    setMenu(null);
    setMenuPlace(null);
  };

  const beginRename = (id: string, name: string) => {
    ignoreRenameBlur.current = true;
    renameSelectAll.current = true;
    lastTitleClick.current = null;
    drag.current = null;
    selectOnlyEntry(id);
    dismissOpenEditors();
    setRenamingId(id);
    setRenamingDraft(name);
    setTimeout(() => {
      ignoreRenameBlur.current = false;
    }, 0);
  };
  beginRenameRef.current = beginRename;

  const beginEditMark = (entryId: string, markId: string) => {
    lastMarkClick.current = null;
    drag.current = null;
    dismissOpenEditors();
    editingMarkRef.current = { entryId, markId };
    selectOnlyEntry(entryId);
    setEditingMark({ entryId, markId });
    setHoverMarkId(markId);
    setTimeout(() => {
      const input = scroller.current?.querySelector<HTMLInputElement>(".cal-mark-edit-name");
      input?.focus();
      input?.select();
    }, 0);
  };

  const beginEditGuide = (id: string) => {
    lastGuideClick.current = null;
    drag.current = null;
    dismissOpenEditors();
    editingGuideRef.current = id;
    setEditingGuideId(id);
    setHoverGuideId(id);
    const marker = markersRef.current.find((item) => item.id === id);
    if (marker) {
      const span = markerSpan(marker);
      setGuideDateDraft({ start: toISO(span.start), end: toISO(span.end) });
    } else setGuideDateDraft(null);
    setTimeout(() => {
      const input = scroller.current?.querySelector<HTMLInputElement>(".cal-guide-edit-name");
      input?.focus();
      input?.select();
    }, 0);
  };

  const beginEditEntry = (id: string, focus: "name" | "icon" = "name") => {
    lastBarClick.current = null;
    drag.current = null;
    dismissOpenEditors();
    editingEntryRef.current = id;
    selectOnlyEntry(id);
    setEditingEntryId(id);
    setEditFocus(focus);
    const entry = entriesRef.current.find((item) => item.id === id);
    if (entry) setSpanDraft({ start: entry.start, end: entry.end });
    setTimeout(() => {
      const selector = focus === "icon" ? ".cal-icon-search" : ".cal-entry-edit-name";
      const input = scroller.current?.querySelector<HTMLInputElement>(selector);
      input?.focus();
      if (focus !== "icon") input?.select();
    }, 0);
  };

  const beginEditIcon = (id: string, fromIcon = false) => {
    lastBarClick.current = null;
    drag.current = null;
    dismissOpenEditors();
    editingIconRef.current = id;
    selectOnlyEntry(id);
    setEditingIconId(id);
    setIconFromIcon(fromIcon);
    setTimeout(() => {
      document.querySelector<HTMLInputElement>(".cal-icon-only .cal-icon-search")?.focus();
    }, 0);
  };

  const beginColorize = (ids: string[]) => {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return;
    drag.current = null;
    dismissOpenEditors();
    setColorizeIds(unique);
  };

  const paintEntryColor = (ids: string[], color: string) => {
    const picked = new Set(ids);
    setEntries((list) => list.map((item) => (picked.has(item.id) ? { ...item, color, iconColor: color } : item)));
  };

  const applyEntryDates = (entry: Entry, nextStart: string, nextEnd: string) => {
    let start = parseISO(nextStart);
    let end = parseISO(nextEnd);
    if (start > end) end = start;
    const bounds = markDateBounds(entry);
    if (bounds) {
      if (start > bounds.min) start = bounds.min;
      if (end < bounds.max) end = bounds.max;
    }
    start = clampDate(start);
    end = clampDate(end);
    if (start > end) end = start;
    const next = { start: toISO(start), end: toISO(end) };
    const draft: Entry = { ...entry, start: next.start, end: next.end };
    setEntries((list) => upsertAndResolve(list, draft, pxRef.current));
    setSpanDraft(next);
  };

  const commitSpanDraft = (entry: Entry) => {
    const root = document.querySelector(".cal-entry-edit");
    const dates = root ? [...root.querySelectorAll<HTMLInputElement>('input[type="date"]')] : [];
    const start = dates[0]?.value || spanDraft?.start || entry.start;
    const end = dates[1]?.value || spanDraft?.end || entry.end;
    applyEntryDates(entry, start, end);
  };

  const patchMark = (entryId: string, markId: string, patch: Partial<Milestone>) => {
    setEntries((list) =>
      list.map((entry) =>
        entry.id !== entryId
          ? entry
          : {
              ...entry,
              milestones: entry.milestones.map((mark) => (mark.id !== markId ? mark : { ...mark, ...patch })),
            },
      ),
    );
  };

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;

    const point = (event: { clientX: number; clientY: number }) => {
      const rect = el.getBoundingClientRect();
      const headH = headHRef.current;
      const z = contentZoomRef.current || 1;
      const yInView = (event.clientY - rect.top) / z;
      const scrolled = yInView >= headH ? (body.current?.scrollTop ?? 0) : 0;
      return {
        x: (event.clientX - rect.left + el.scrollLeft) / z,
        y: yInView + scrolled,
      };
    };

    const setCursor = (value: string) => {
      el.style.cursor = value;
    };

    const clearDateHold = () => {
      if (holdTimer.current != null) {
        clearTimeout(holdTimer.current);
        holdTimer.current = null;
      }
      setDragHold(false);
    };

    const beginDateHold = () => {
      clearDateHold();
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        setDragHold(true);
        const current = drag.current;
        const scale = pxRef.current;
        const list = entriesRef.current;
        if (current?.kind === "move") {
          const entry = list.find((item) => item.id === current.id);
          if (entry) setSnapXs(alignXs(entrySnapParts(entry), entry, list, scale));
        } else if (current?.kind === "mark") {
          const entry = list.find((item) => item.id === current.entryId);
          const mark = entry?.milestones.find((item) => item.id === current.markId);
          if (entry && mark) setSnapXs(alignXs([{ role: "mark", iso: mark.date }], entry, list, scale));
        } else if (current?.kind === "resize") {
          const entry = list.find((item) => item.id === current.id);
          if (entry) {
            const iso = current.part === "start" ? entry.start : entry.end;
            setSnapXs(alignXs([{ role: current.part, iso }], entry, list, scale));
          }
        }
      }, 100);
    };

    const clearHover = () => {
      setHoverKey(null);
      setHoverMonthKey(null);
      setHoverEntryId(null);
      setHoverMarkId(null);
      setHoverGuideId(null);
      setHoverToday(false);
      setHoverClusterKey(null);
      if (modeRef.current === "edit") el.style.cursor = "crosshair";
      else el.style.cursor = "";
    };

    const pointerInside = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      return (
        event.clientX >= rect.left &&
        event.clientX < rect.right &&
        event.clientY >= rect.top &&
        event.clientY < rect.bottom
      );
    };

    const setPeriodHover = (x: number, scale: number) => {
      const periodKey =
        quarterZoom.current || isQuarterZoom(scale, el.clientWidth) ? quarterKeyAt(x, scale) : monthKeyAt(x, scale);
      setHoverMonthKey(periodKey);
      setHoverKey(
        scale >= DAY_PX ? dayKeyAt(x, scale) : scale >= WEEK_PX ? weekKeyAt(x, scale) : periodKey,
      );
    };

    const applyHover = (event: PointerEvent) => {
      if (!pointerInside(event)) {
        clearHover();
        return;
      }
      const { x, y } = point(event);
      const scale = pxRef.current;
      setPeriodHover(x, scale);
      const node = event.target as HTMLElement | null;
      const onClusterUi = Boolean(node?.closest(".cal-guide-cluster, .cal-guide-pop"));
      const hit = hitTest(x, y, entriesRef.current, scale, headHRef.current);
      const guide = hitTestMarker(x, y, contentMarkersRef.current ? markersRef.current : [], scale, headHRef.current);
      const todayDate = startOfDay(new Date());
      const todayHit = hitTestToday(x, y, scale, headHRef.current, todayDate);
      const clustered =
        clustersRef.current.find(
          (cluster) =>
            cluster.ids.length >= 2 &&
            ((guide && cluster.ids.includes(guide.marker.id)) || (todayHit && cluster.hasToday)),
        ) ?? null;
      const otherMarker = Boolean(guide && !clustered);
      if (otherMarker) {
        setHoverClusterKey(null);
      } else if (clustered) {
        setHoverClusterKey(clustered.key);
        setHoverGuideId(null);
        setHoverToday(false);
        if (modeRef.current === "edit" && !node?.closest(".cal-guide-pop")) setCursor("grab");
        else setCursor("default");
        return;
      } else if (onClusterUi) {
        setHoverGuideId(null);
        setHoverToday(false);
        if (modeRef.current === "edit" && !node?.closest(".cal-guide-pop")) setCursor("grab");
        else setCursor("default");
        return;
      } else {
        setHoverClusterKey(null);
      }
      const todayDist = Math.abs(xPoint(todayDate, scale) - x);
      const guideDist = guide
        ? Math.min(
            Math.abs(markerLayout(guide.marker, scale).startX - x),
            Math.abs(markerLayout(guide.marker, scale).endX - x),
          )
        : Infinity;
      const preferToday = todayHit && todayDist <= guideDist;
      setHoverEntryId(hit?.entry.id ?? null);
      setHoverMarkId(
        modeRef.current === "view" && hit
          ? closestMarkId(hit.entry, x, scale)
          : hit?.part === "mark"
            ? (hit.markId ?? null)
            : null,
      );
      setHoverToday(preferToday);
      setHoverGuideId(preferToday ? null : (guide?.marker.id ?? null));
      if (hit) setHoverClientX(event.clientX);
      if (modeRef.current === "edit") {
        if (guide?.part === "start" || guide?.part === "end") setCursor("ew-resize");
        else if (guide) setCursor("grab");
        else if (hit?.part === "mark") setCursor("grab");
        else if (hit?.part === "start" || hit?.part === "end") setCursor("ew-resize");
        else if (hit) setCursor("grab");
        else if (y >= headHRef.current) setCursor("crosshair");
        else setCursor("grab");
      } else {
        setCursor(y < headHRef.current || hit ? "default" : "grab");
      }
    };

    const onWheel = (event: WheelEvent) => {
      const cardList = cardListRef.current;
      if (cardList?.isConnected && cardList.scrollHeight > cardList.clientHeight + 1) {
        event.preventDefault();
        cardList.scrollTop += event.deltaY;
        return;
      }
      event.preventDefault();
      setMenu(null);
      if (scrollAnim.current.id != null) {
        cancelAnimationFrame(scrollAnim.current.id);
        scrollAnim.current.id = null;
      }
      if (event.ctrlKey || event.metaKey) {
        const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
        if (delta === 0) return;
        // Use live pxRef + pending scroll, not the closed-over px. Fast wheel
        // events otherwise mix a new scrollLeft with the previous scale and the
        // date under the cursor jumps by ~one month per tick.
        const scale = pxRef.current;
        const z = contentZoomRef.current || 1;
        const rect = el.getBoundingClientRect();
        const cursorX = (event.clientX - rect.left) / z;
        const scroll = pendingScroll.current ?? el.scrollLeft / z;
        const factor = delta < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        const floor = monthZoomFloor(el.clientWidth);
        const minQuarter = quarterMinPx(el.clientWidth);
        const layoutW = el.clientWidth / z;
        const inQuarter = quarterZoom.current || scale < floor - 0.001;
        let next: number;
        let quarters: boolean;
        if (factor < 1) {
          const stepped = scale * factor;
          if (inQuarter) {
            next = Math.max(minQuarter, stepped);
            quarters = true;
          } else if (scale <= floor + 0.001 && stepped < floor) {
            // One more step past the month stop. On a range that already fills
            // the viewport this only switches the labels; the width stays put.
            next = Math.max(minQuarter, floor / ZOOM_STEP);
            quarters = true;
          } else {
            next = stepped < floor ? floor : Math.min(MAX_PX, stepped);
            quarters = false;
          }
        } else {
          const stepped = Math.min(MAX_PX, scale * factor);
          if (inQuarter && scale >= floor - 0.001) {
            next = Math.min(MAX_PX, floor * ZOOM_STEP);
            quarters = false;
          } else if (inQuarter && stepped >= floor - 0.02) {
            next = floor;
            quarters = false;
          } else {
            next = stepped;
            quarters = next < floor - 0.001;
          }
        }
        quarterZoom.current = quarters;
        setQuarterOn(quarters);
        if (Math.abs(next - scale) < 0.0001) return;
        pxRef.current = next;
        pendingScroll.current = zoomScroll(scale, next, cursorX, scroll, layoutW);
        setPx(next);
        return;
      }
      if (event.shiftKey) {
        el.scrollLeft += event.deltaY + event.deltaX;
        return;
      }
      if (body.current) body.current.scrollTop += event.deltaY / (contentZoomRef.current || 1);
      el.scrollLeft += event.deltaX;
    };

    const onPointerDown = (event: PointerEvent) => {
      const node = event.target as HTMLElement | null;
      if (node?.closest(".cal-menu")) return;
      if (scrollAnim.current.id != null) {
        cancelAnimationFrame(scrollAnim.current.id);
        scrollAnim.current.id = null;
      }
      if (menuRef.current && event.button === 0) {
        setMenu(null);
        return;
      }
      if (event.button !== 0) return;
      if (node?.closest(".cal-entry-del, .cal-entry-rename, .cal-mark-edit, .cal-entry-edit, .cal-guide-edit, .cal-guide-pop, .cal-guide-pop-layer")) return;
      if (connectFromRef.current) {
        event.preventDefault();
        const from = connectFromRef.current;
        const { x, y } = point(event);
        const hit = hitTest(x, y, entriesRef.current, pxRef.current, headHRef.current);
        if (hit) {
          if (from.kind === "entry" && hit.entry.id !== from.id) {
            setEntries((list) => linkEntries(list, from.id, hit.entry.id, pxRef.current));
            selectOnlyEntry(hit.entry.id);
          } else if (from.kind === "mark" && hit.entry.id !== from.entryId) {
            setEntries((list) => linkToMark(list, from.entryId, from.markId, hit.entry.id, pxRef.current));
            selectOnlyEntry(hit.entry.id);
          }
        }
        setConnectFrom(null);
        connectFromRef.current = null;
        return;
      }
      if (renamingIdRef.current) {
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }
      const { x, y } = point(event);
      const scale = pxRef.current;
      const list = entriesRef.current;
      const headH = headHRef.current;

      if (modeRef.current === "edit") {
        setColorizeIds(null);
        if (event.shiftKey) {
          const guideHit = hitTestMarker(x, y, contentMarkersRef.current ? markersRef.current : [], scale, headH);
          const entryHit = hitTest(x, y, list, scale, headH);
          event.preventDefault();
          setMenu(null);
          setEditingMark(null);
          editingMarkRef.current = null;
          setEditingEntryId(null);
          editingEntryRef.current = null;
          setEditingIconId(null);
          editingIconRef.current = null;
          setEditingGuideId(null);
          editingGuideRef.current = null;
          if (!guideHit && !entryHit) {
            drag.current = {
              kind: "marquee",
              originClientX: event.clientX,
              originClientY: event.clientY,
              originX: x,
              originY: y,
              armed: false,
              originSelection: cloneSelection(selectionRef.current),
            };
            if (el.setPointerCapture) el.setPointerCapture(event.pointerId);
            return;
          }
          if (guideHit) {
            const span = markerSpan(guideHit.marker);
            if (daysBetween(span.start, span.end) === 0) {
              historyBusy.current = true;
              drag.current = {
                kind: "guide",
                id: guideHit.marker.id,
                armed: false,
                originX: event.clientX,
                originY: event.clientY,
                part: "body",
                originDate: toISO(span.start),
                originEnd: toISO(span.end),
                originContentX: x,
                extending: false,
                shiftSplit: true,
              };
              setHoverGuideId(guideHit.marker.id);
              if (el.setPointerCapture) el.setPointerCapture(event.pointerId);
              return;
            }
            setSelection((current) => toggleMarkerInSelection(current, guideHit.marker.id));
            return;
          }
          if (entryHit?.part === "mark" && entryHit.markId) {
            setSelection((current) => toggleMarkInSelection(current, entryHit.entry.id, entryHit.markId));
            return;
          }
          if (entryHit) {
            setSelection((current) => toggleEntryInSelection(current, entryHit.entry.id));
          }
          return;
        }
        const guide = hitTestMarker(x, y, contentMarkersRef.current ? markersRef.current : [], scale, headH);
        if (guide) {
          const prev = lastGuideClick.current;
          lastGuideClick.current = { id: guide.marker.id, at: performance.now() };
          if (prev && prev.id === guide.marker.id && performance.now() - prev.at < 500) {
            beginEditGuide(guide.marker.id);
            event.stopPropagation();
            return;
          }
          if (editingGuideRef.current && editingGuideRef.current !== guide.marker.id) {
            setEditingGuideId(null);
            editingGuideRef.current = null;
          }
          const span = markerSpan(guide.marker);
          historyBusy.current = true;
          drag.current = {
            kind: "guide",
            id: guide.marker.id,
            armed: false,
            originX: event.clientX,
            originY: event.clientY,
            part: guide.part,
            originDate: toISO(span.start),
            originEnd: toISO(span.end),
            originContentX: x,
            extending: false,
            shiftSplit: false,
          };
          setHoverGuideId(guide.marker.id);
          return;
        }
        if (editingGuideRef.current) {
          setEditingGuideId(null);
          editingGuideRef.current = null;
        }
        const hit = hitTest(x, y, list, scale, headH);
        if (hit) {
          if (hit.part === "title") {
            const prev = lastTitleClick.current;
            if (prev && prev.id === hit.entry.id && performance.now() - prev.at < 500) {
              beginRename(hit.entry.id, hit.entry.name);
              return;
            }
          }
          if (hit.part === "mark" && hit.markId) {
            const prev = lastMarkClick.current;
            lastMarkClick.current = { id: hit.markId, at: performance.now() };
            if (prev && prev.id === hit.markId && performance.now() - prev.at < 500) {
              beginEditMark(hit.entry.id, hit.markId);
              event.stopPropagation();
              return;
            }
            if (editingMarkRef.current) {
              setEditingMark(null);
              editingMarkRef.current = null;
            }
            historyBusy.current = true;
            drag.current = {
              kind: "mark",
              entryId: hit.entry.id,
              markId: hit.markId,
              armed: false,
              moved: false,
              originX: event.clientX,
              originY: event.clientY,
              originDate: hit.entry.milestones.find((mark) => mark.id === hit.markId)?.date ?? hit.entry.start,
              originEntries: cloneEntries(list),
            };
            selectOnlyEntry(hit.entry.id);
            setHoverMarkId(hit.markId);
            beginDateHold();
            return;
          }
          const start = parseISO(hit.entry.start);
          const end = parseISO(hit.entry.end);
          if (hit.part === "body") {
            const prev = lastBarClick.current;
            lastBarClick.current = { id: hit.entry.id, at: performance.now() };
            if (prev && prev.id === hit.entry.id && performance.now() - prev.at < 500) {
              beginEditEntry(hit.entry.id);
              event.stopPropagation();
              return;
            }
          }
          if (hit.part === "body" || hit.part === "title") {
            if (editingEntryRef.current && editingEntryRef.current !== hit.entry.id) {
              setEditingEntryId(null);
              editingEntryRef.current = null;
            }
            if (editingIconRef.current && editingIconRef.current !== hit.entry.id) {
              setEditingIconId(null);
              editingIconRef.current = null;
            }
            const picked = selectionRef.current.entries;
            const groupIds =
              picked.length >= 2 && picked.includes(hit.entry.id) ? [...picked] : [hit.entry.id];
            historyBusy.current = true;
            drag.current = {
              kind: "move",
              id: hit.entry.id,
              grabDays: (x - xAt(start, scale)) / scale,
              duration: daysBetween(start, end),
              originStart: hit.entry.start,
              originRow: hit.entry.row,
              originMilestones: hit.entry.milestones,
              originEntries: cloneEntries(list),
              fromTitle: hit.part === "title",
              moved: false,
              armed: false,
              originX: event.clientX,
              originY: event.clientY,
              groupIds,
            };
          } else {
            historyBusy.current = true;
            drag.current = {
              kind: "resize",
              id: hit.entry.id,
              part: hit.part === "end" ? "end" : "start",
              originEntries: cloneEntries(list),
            };
          }
          if (editingMarkRef.current) {
            setEditingMark(null);
            editingMarkRef.current = null;
          }
          if ((hit.part === "start" || hit.part === "end") && editingEntryRef.current) {
            setEditingEntryId(null);
            editingEntryRef.current = null;
          }
          if ((hit.part === "start" || hit.part === "end") && editingIconRef.current) {
            setEditingIconId(null);
            editingIconRef.current = null;
          }
          if (!(drag.current?.kind === "move" && drag.current.groupIds.length >= 2)) {
            selectOnlyEntry(hit.entry.id);
          }
          if (hit.part !== "title" && hit.part !== "body") {
            el.classList.add("is-moving");
            if (el.setPointerCapture) el.setPointerCapture(event.pointerId);
            setSnapXs(
              alignXs(
                hit.part === "mark" && hit.markId
                  ? [{ role: "mark", iso: hit.entry.milestones.find((mark) => mark.id === hit.markId)?.date ?? hit.entry.start }]
                  : hit.part === "start" || hit.part === "end"
                    ? [{ role: hit.part, iso: hit.part === "start" ? hit.entry.start : hit.entry.end }]
                    : entrySnapParts(hit.entry),
                hit.entry,
                list,
                scale,
              ),
            );
          }
          beginDateHold();
          return;
        }
        if (editingMarkRef.current) {
          setEditingMark(null);
          editingMarkRef.current = null;
        }
        if (editingEntryRef.current) {
          setEditingEntryId(null);
          editingEntryRef.current = null;
        }
        if (editingIconRef.current) {
          setEditingIconId(null);
          editingIconRef.current = null;
        }
        if (y >= headH) {
          const date = dateAtX(x, scale);
          if (date) {
            historyBusy.current = true;
            drag.current = {
              kind: "create",
              id: uid(),
              anchor: date,
              moved: false,
              armed: false,
              originX: event.clientX,
              originY: event.clientY,
              originEntries: cloneEntries(list),
            };
            return;
          }
        }
      }

      drag.current = { kind: "pan", x: event.clientX, scroll: el.scrollLeft };
      el.classList.add("is-panning");
      el.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      const { x, y } = point(event);
      const scale = pxRef.current;
      const current = drag.current;

      if (current?.kind === "guide") {
        if (!current.armed) {
          const dist = Math.hypot(event.clientX - current.originX, event.clientY - current.originY);
          if (dist < 5) return;
          current.armed = true;
          lastGuideClick.current = null;
          if (editingGuideRef.current) {
            setEditingGuideId(null);
            editingGuideRef.current = null;
          }
          el.classList.add("is-moving");
          if (el.setPointerCapture) el.setPointerCapture(event.pointerId);
        }
        const originStart = parseISO(current.originDate);
        const originEnd = parseISO(current.originEnd);
        const wasPoint = daysBetween(originStart, originEnd) === 0;
        if (wasPoint && (current.shiftSplit || event.shiftKey || current.extending)) {
          current.extending = true;
          const cursorDate = dateAtX(x, scale);
          const bounds = pointSplitBounds(
            originStart,
            scale,
            x,
            cursorDate ? clampDate(cursorDate) : null,
          );
          setHoverGuideId(current.id);
          setMarkers((list) =>
            list.map((marker) => (marker.id === current.id ? markerWithSpan(marker, bounds.start, bounds.end) : marker)),
          );
          return;
        }
        const date = dateAtX(x, scale);
        if (!date) return;
        const cursor = clampDate(date);
        if (!wasPoint && event.shiftKey) {
          current.extending = true;
          const anchor = originStart;
          const end = cursor > anchor ? cursor : anchor;
          setHoverGuideId(current.id);
          setMarkers((list) =>
            list.map((marker) => (marker.id === current.id ? markerWithSpan(marker, anchor, end) : marker)),
          );
          return;
        }
        if (current.part === "start") {
          const end = originEnd;
          let start = cursor > end ? end : cursor;
          if (start < originStart) start = originStart;
          setHoverGuideId(current.id);
          setMarkers((list) =>
            list.map((marker) => (marker.id === current.id ? markerWithSpan(marker, start, end) : marker)),
          );
          return;
        }
        if (current.part === "end") {
          const start = originStart;
          const inclusive = addDays(cursor, -1);
          const end = inclusive < start ? start : inclusive;
          setHoverGuideId(current.id);
          setMarkers((list) =>
            list.map((marker) => (marker.id === current.id ? markerWithSpan(marker, start, end) : marker)),
          );
          return;
        }
        const grab = dateAtX(current.originContentX, scale);
        const delta = grab ? daysBetween(grab, cursor) : 0;
        let start = addDays(originStart, delta);
        let end = addDays(originEnd, delta);
        const span = daysBetween(originStart, originEnd);
        start = clampDate(start);
        end = clampDate(end);
        if (daysBetween(start, end) !== span) {
          if (start.getTime() === RANGE.start.getTime()) end = addDays(start, span);
          if (end.getTime() === addDays(RANGE.end, -1).getTime()) start = addDays(end, -span);
          start = clampDate(start);
          end = clampDate(end);
        }
        setHoverGuideId(current.id);
        setMarkers((list) =>
          list.map((marker) =>
            marker.id === current.id
              ? { ...marker, date: toISO(start), end: daysBetween(start, end) > 0 ? toISO(end) : undefined }
              : marker,
          ),
        );
        return;
      }

      if (current?.kind === "marquee") {
        const dist = Math.hypot(event.clientX - current.originClientX, event.clientY - current.originClientY);
        if (!current.armed) {
          if (dist < 4) return;
          current.armed = true;
          el.classList.add("is-selecting");
        }
        const x0 = Math.min(current.originX, x);
        const x1 = Math.max(current.originX, x);
        const y0 = Math.min(current.originY, y);
        const y1 = Math.max(current.originY, y);
        const clip = el.getBoundingClientRect();
        const left = Math.max(Math.min(current.originClientX, event.clientX), clip.left);
        const right = Math.min(Math.max(current.originClientX, event.clientX), clip.right);
        const top = Math.max(Math.min(current.originClientY, event.clientY), clip.top);
        const bottom = Math.min(Math.max(current.originClientY, event.clientY), clip.bottom);
        setMarquee(
          right > left && bottom > top
            ? { left, top, width: right - left, height: bottom - top }
            : null,
        );
        const live = selectionInRect(
          x0,
          y0,
          x1,
          y1,
          entriesRef.current,
          contentMarkersRef.current ? markersRef.current : [],
          scale,
          headHRef.current,
        );
        setSelection(unionSelection(current.originSelection, live));
        return;
      }

      if (current?.kind === "pan") {
        el.scrollLeft = current.scroll - (event.clientX - current.x);
        setHoverEntryId(null);
        setHoverMarkId(null);
        setHoverGuideId(null);
        setHoverToday(false);
        setPeriodHover(point(event).x, scale);
        return;
      }

      if (current) setPeriodHover(x, scale);

      if (current?.kind === "create") {
        if (!current.armed) {
          const dist = Math.hypot(event.clientX - current.originX, event.clientY - current.originY);
          if (dist < 5) return;
          current.armed = true;
          current.moved = true;
          el.classList.add("is-moving");
          if (el.setPointerCapture) el.setPointerCapture(event.pointerId);
        }
        const date = dateAtX(x, scale);
        if (date) {
          const start = date < current.anchor ? date : current.anchor;
          const end = date < current.anchor ? current.anchor : date;
          current.moved = true;
          const headH = headHRef.current;
          const existing = current.originEntries.find((entry) => entry.id === current.id);
          const draft: Entry = {
            id: current.id,
            name: existing?.name ?? nextEntryName(current.originEntries),
            start: toISO(start),
            end: toISO(end),
            row: y >= headH ? rowAtY(y, headH) : (entriesRef.current.find((entry) => entry.id === current.id)?.row ?? 0),
            milestones: [],
            icon: existing?.icon ?? DEFAULT_ENTRY_ICON,
            iconColor: existing?.iconColor ?? DEFAULT_ENTRY_ICON_COLOR,
            color: existing?.color,
          };
          const next = upsertAndResolve(current.originEntries, draft, scale);
          setEntries(next);
          selectOnlyEntry(current.id);
          setSnapXs(alignXs(entrySnapParts(draft), draft, next, scale));
        }
        return;
      }

      if (current?.kind === "move") {
        if (!current.armed) {
          const dist = Math.hypot(event.clientX - current.originX, event.clientY - current.originY);
          if (dist < 5) return;
          current.armed = true;
          current.moved = true;
          lastBarClick.current = null;
          if (editingEntryRef.current) {
            setEditingEntryId(null);
            editingEntryRef.current = null;
          }
          if (editingIconRef.current) {
            setEditingIconId(null);
            editingIconRef.current = null;
          }
          el.classList.add("is-moving");
          if (el.setPointerCapture) el.setPointerCapture(event.pointerId);
          setDragHold(true);
          if (!event.shiftKey) {
            setTreeDragId(current.id);
            const ids = new Set<string>(current.groupIds);
            for (const id of current.groupIds) {
              ids.add(id);
              for (const child of childIds(entriesRef.current, id)) ids.add(child);
            }
            for (const id of ids) {
              scroller.current
                ?.querySelector(`[data-entry-id="${CSS.escape(id)}"]`)
                ?.classList.add("is-tree-drag");
            }
          }
        }
        const pointerDays = (x - PAD) / scale - current.grabDays;
        let start = clampDate(addDays(RANGE.start, Math.round(pointerDays)));
        let end = addDays(start, current.duration);
        if (end >= RANGE.end) {
          end = addDays(RANGE.end, -1);
          start = addDays(end, -current.duration);
          if (start < RANGE.start) start = new Date(RANGE.start);
        }
        const delta = daysBetween(parseISO(current.originStart), start);
        const liveRow = entriesRef.current.find((entry) => entry.id === current.id)?.row ?? current.originRow;
        const headH = headHRef.current;
        const targetRow = y >= headH ? rowAtY(y, headH) : liveRow;
        if (toISO(start) !== current.originStart || targetRow !== current.originRow) current.moved = true;
        const next =
          current.groupIds.length >= 2
            ? moveSelection(
                current.originEntries,
                current.id,
                current.groupIds,
                start,
                targetRow,
                current.duration,
                scale,
                event.shiftKey,
              )
            : moveSubtree(
                current.originEntries,
                current.id,
                start,
                targetRow,
                current.duration,
                scale,
                event.shiftKey,
              );
        const live = next.find((entry) => entry.id === current.id);
        setEntries(next);
        if (live) setSnapXs(alignXs(entrySnapParts(live), live, next, scale));
        return;
      }

      if (current?.kind === "mark") {
        if (!current.armed) {
          const dist = Math.hypot(event.clientX - current.originX, event.clientY - current.originY);
          if (dist < 5) return;
          current.armed = true;
          current.moved = true;
          lastMarkClick.current = null;
          setEditingMark(null);
          el.classList.add("is-moving");
          if (el.setPointerCapture) el.setPointerCapture(event.pointerId);
          setDragHold(true);
        }
        const live = entriesRef.current.find((entry) => entry.id === current.entryId);
        if (!live) return;
        const start = parseISO(live.start);
        const end = parseISO(live.end);
        const raw = dateAtX(x, scale);
        if (!raw) return;
        const nextDate = raw < start ? start : raw > end ? end : raw;
        const iso = toISO(nextDate);
        setHoverMarkId(current.markId);
        const delta = daysBetween(parseISO(current.originDate), nextDate);
        const list = cloneEntries(current.originEntries);
        const host = list.find((entry) => entry.id === current.entryId);
        if (host) {
          host.milestones = host.milestones.map((mark) =>
            mark.id === current.markId ? { ...mark, date: iso } : mark,
          );
        }
        if (delta !== 0) {
          for (const child of list) {
            if (child.parentMark?.entryId === current.entryId && child.parentMark.markId === current.markId) {
              shiftSubtree(list, child.id, delta);
            }
          }
        }
        const next = applyLinkConstraints(list, current.entryId, scale);
        const updated = next.find((entry) => entry.id === current.entryId) ?? live;
        setEntries(next);
        setSnapXs(alignXs([{ role: "mark", iso }], updated, next, scale));
        return;
      }

      if (current?.kind === "resize") {
        const date = dateAtX(x, scale);
        if (!date) return;
        const origin = current.originEntries.find((entry) => entry.id === current.id);
        if (!origin) return;
        const start = parseISO(origin.start);
        const end = parseISO(origin.end);
        let nextStart = current.part === "start" ? (date < end ? date : addDays(end, -1)) : start;
        let nextEnd = current.part === "end" ? (date > start ? date : start) : end;
        nextStart = clampDate(nextStart);
        nextEnd = clampDate(nextEnd);
        const scaleMarks = event.shiftKey;
        if (!scaleMarks) {
          const bounds = markDateBounds(origin);
          if (bounds) {
            if (current.part === "start" && nextStart > bounds.min) nextStart = bounds.min;
            if (current.part === "end" && nextEnd < bounds.max) nextEnd = bounds.max;
          }
        }
        const draft: Entry = {
          ...origin,
          start: toISO(nextStart),
          end: toISO(nextEnd),
          milestones: scaleMarks ? scaleMilestones(origin, nextStart, nextEnd) : origin.milestones,
        };
        let next: Entry[];
        if (current.part === "end") {
          const delta = daysBetween(parseISO(origin.end), nextEnd);
          const list = cloneEntries(current.originEntries);
          const index = list.findIndex((entry) => entry.id === draft.id);
          if (index !== -1) list[index] = draft;
          if (delta !== 0) {
            for (const child of list) {
              if (child.parentId === draft.id) shiftSubtree(list, child.id, delta);
            }
          }
          next = applyLinkConstraints(list, draft.id, scale);
        } else {
          next = applyLinkConstraints(upsertAndResolve(current.originEntries, draft, scale), draft.id, scale);
        }
        setEntries(next);
        setSnapXs(
          alignXs(
            [{ role: current.part, iso: current.part === "start" ? draft.start : draft.end }],
            draft,
            next,
            scale,
          ),
        );
        return;
      }

      applyHover(event);
    };

    const onPointerUp = (event: PointerEvent) => {
      const current = drag.current;
      historyBusy.current = false;
      recordHistoryRef.current({
        entries: entriesRef.current,
        markers: markersRef.current,
        rangeFrom: rangeFromRef.current,
        rangeTo: rangeToRef.current,
      });
      if (current?.kind === "marquee") {
        setMarquee(null);
        el.classList.remove("is-selecting");
      }
      if (current?.kind === "create" && !current.moved) {
        drag.current = null;
        el.classList.remove("is-panning", "is-moving", "is-selecting");
        if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
        setSnapXs([]);
        clearDateHold();
        setSelection(EMPTY_SELECTION);
        applyHover(event);
        return;
      }
      setSnapXs([]);
      clearDateHold();
      if (current?.kind === "guide" && current.shiftSplit && !current.armed) {
        setSelection((sel) => toggleMarkerInSelection(sel, current.id));
      }
      if (current?.kind === "move" && current.fromTitle && !current.armed) {
        if (modeRef.current === "edit") {
          const entry = entriesRef.current.find((item) => item.id === current.id);
          if (entry) beginRenameRef.current(entry.id, entry.name);
        } else {
          lastTitleClick.current = { id: current.id, at: performance.now() };
        }
      } else if (current?.kind === "mark" && !current.armed) {
        lastMarkClick.current = { id: current.markId, at: performance.now() };
      } else if (current) {
        lastTitleClick.current = null;
        lastMarkClick.current = null;
      }
      drag.current = null;
      el.classList.remove("is-panning", "is-moving", "is-selecting");
      setTreeDragId(null);
      if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
      applyHover(event);
    };

    const onPointerLeave = () => {
      if (!drag.current) clearHover();
    };

    const onDblClick = (event: MouseEvent) => {
      if (modeRef.current !== "edit") return;
      const { x, y } = point(event as PointerEvent);
      const guide = hitTestMarker(x, y, contentMarkersRef.current ? markersRef.current : [], pxRef.current, headHRef.current);
      if (guide) {
        event.preventDefault();
        el.classList.remove("is-moving", "is-panning");
        beginEditGuide(guide.marker.id);
        return;
      }
      const hit = hitTest(x, y, entriesRef.current, pxRef.current, headHRef.current);
      if (hit?.part === "mark" && hit.markId) {
        event.preventDefault();
        el.classList.remove("is-moving", "is-panning");
        beginEditMark(hit.entry.id, hit.markId);
        return;
      }
      if (hit?.part === "body") {
        event.preventDefault();
        el.classList.remove("is-moving", "is-panning");
        beginEditEntry(hit.entry.id);
        return;
      }
      if (hit?.part !== "title") return;
      event.preventDefault();
      el.classList.remove("is-moving", "is-panning");
      beginRename(hit.entry.id, hit.entry.name);
    };

    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      const { x, y } = point(event);
      const headH = headHRef.current;
      const scale = pxRef.current;
      const pad = 8;
      const width = 200;
      let mx = event.clientX;
      let my = event.clientY;
      const place = (height: number) => {
        if (mx + width > window.innerWidth - pad) mx = window.innerWidth - width - pad;
        if (my + height > window.innerHeight - pad) my = window.innerHeight - height - pad;
        return { x: Math.max(pad, mx), y: Math.max(pad, my) };
      };
      if (modeRef.current === "view") {
        const date = dateAtX(x, scale);
        const pos = place(236);
        setMenu({
          ...pos,
          kind: "empty",
          entryId: null,
          markId: null,
          markerId: null,
          date: toISO(date ?? RANGE.start),
          row: 0,
        });
        return;
      }
      const guide = hitTestMarker(x, y, contentMarkersRef.current ? markersRef.current : [], scale, headH);
      if (guide) {
        const pos = place(120);
        setMenu({
          ...pos,
          kind: "guide",
          entryId: null,
          markId: null,
          markerId: guide.marker.id,
          date: guide.marker.date,
          row: 0,
        });
        return;
      }
      if (y < headH) {
        setMenu(null);
        return;
      }
      const date = dateAtX(x, scale);
      if (!date) {
        setMenu(null);
        return;
      }
      const hit = hitTest(x, y, entriesRef.current, scale, headH);
      const selectedIds = selectionRef.current.entries;
      if (selectedIds.length >= 2 && (!hit || selectedIds.includes(hit.entry.id))) {
        const pos = place(168);
        setMenu({
          ...pos,
          kind: "entries",
          entryId: hit?.entry.id ?? null,
          markId: null,
          markerId: null,
          date: toISO(date),
          row: rowAtY(y, headH),
        });
        return;
      }
      const height = hit?.part === "mark" ? 148 : hit ? 252 : 80;
      const pos = place(height);
      setMenu({
        ...pos,
        kind: hit?.part === "mark" ? "mark" : hit ? "entry" : "empty",
        entryId: hit?.entry.id ?? null,
        markId: hit?.markId ?? null,
        markerId: null,
        date: toISO(date),
        row: rowAtY(y, headH),
      });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (event.key === "Escape") {
        setMenu(null);
        setEditingMark(null);
        setEditingEntryId(null);
        setEditingIconId(null);
        setEditingGuideId(null);
        setColorizeIds(null);
        setConnectFrom(null);
        connectFromRef.current = null;
        setSelection(EMPTY_SELECTION);
        setMarquee(null);
        return;
      }
      if (modeRef.current !== "edit" || typing) return;
      const del =
        event.key === "Delete" ||
        ((event.metaKey || event.ctrlKey) && event.key === "Backspace");
      if (!del) return;
      const current = selectionRef.current;
      if (selectionEmpty(current)) return;
      event.preventDefault();
      const next = deleteSelected(entriesRef.current, markersRef.current, current);
      setEntries(next.entries);
      setMarkers(next.markers);
      setSelection(EMPTY_SELECTION);
      setEditingMark(null);
      setEditingEntryId(null);
      setEditingIconId(null);
      setEditingGuideId(null);
      setColorizeIds(null);
      setRenamingId(null);
      setMenu(null);
      setConnectFrom(null);
      connectFromRef.current = null;
    };

    const onWinPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const node = event.target as HTMLElement | null;
      if (node?.closest(".cal-menu, .cal-mark-edit, .cal-entry-edit, .cal-guide-edit, .cal-guide-pop, .cal-guide-pop-layer")) return;
      if (menuRef.current) setMenu(null);
      if (connectFromRef.current && !node?.closest(".cal")) {
        setConnectFrom(null);
        connectFromRef.current = null;
      }
      if (!node?.closest(".cal")) {
        if (editingMarkRef.current) {
          setEditingMark(null);
          editingMarkRef.current = null;
        }
        if (editingEntryRef.current) {
          setEditingEntryId(null);
          editingEntryRef.current = null;
        }
        if (editingIconRef.current) {
          setEditingIconId(null);
          editingIconRef.current = null;
        }
        if (editingGuideRef.current) {
          setEditingGuideId(null);
          editingGuideRef.current = null;
        }
        setColorizeIds(null);
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onWinPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    el.addEventListener("pointerleave", onPointerLeave);
    el.addEventListener("mouseleave", onPointerLeave);
    el.addEventListener("dblclick", onDblClick);
    return () => {
      el.removeEventListener("wheel", onWheel, { capture: true });
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      el.removeEventListener("pointerleave", onPointerLeave);
      el.removeEventListener("mouseleave", onPointerLeave);
      el.removeEventListener("dblclick", onDblClick);
      el.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onWinPointerDown);
      if (holdTimer.current != null) {
        clearTimeout(holdTimer.current);
        holdTimer.current = null;
      }
      if (scrollAnim.current.id != null) {
        cancelAnimationFrame(scrollAnim.current.id);
        scrollAnim.current.id = null;
      }
    };
  }, []);

  const addEntryAt = (date: Date, row: number) => {
    const iso = toISO(date);
    setEntries((current) =>
      upsertAndResolve(
        current,
        {
          id: uid(),
          name: nextEntryName(current),
          start: iso,
          end: toISO(clampDate(addDays(date, DEFAULT_SPAN))),
          row,
          milestones: [],
          icon: DEFAULT_ENTRY_ICON,
          iconColor: DEFAULT_ENTRY_ICON_COLOR,
        },
        px,
      ),
    );
  };

  const addMarkerAt = (date: Date) => {
    const id = uid();
    const iso = toISO(clampDate(date));
    setMarkers((list) => [...list, { id, name: nextMarkerName(list), date: iso, color: "#cccccc" }]);
    setHoverGuideId(id);
  };

  const closeMenu = () => setMenu(null);
  const menuEntry = menu?.entryId ? entries.find((entry) => entry.id === menu.entryId) : null;
  const maxRow = entries.reduce((max, entry) => Math.max(max, entry.row), 0);
  const contentH = ROW_TOP + (maxRow + 1) * ROW_H + 64;
  const editRoom = mode === "edit" ? Math.max(vMetrics.view, Math.max(0, viewH - HEAD_H)) : 0;
  const fillH = contentH + editRoom;

  const width = trackWidth(px);
  const todayX = xPoint(today, px);
  const periods = showQuarters
    ? QUARTERS.map((quarter) => ({
        key: quarter.key,
        start: quarter.start,
        days: quarter.days,
        name: quarter.name,
        tail: quarter.quarter === 4,
        yearStart: quarter.quarter === 1,
      }))
    : MONTHS_META.map((month) => ({
        key: `${month.year}-${month.month}`,
        start: month.start,
        days: month.days,
        name: month.name,
        tail: month.month === 11,
        yearStart: month.month === 0,
      }));
  const visibleMarkers = contentMarkers ? markers : [];
  const clusters = markerClusters(visibleMarkers, px, todayX);
  const clusterById = new Map<string, MarkerCluster>();
  for (const cluster of clusters) {
    for (const id of cluster.ids) {
      if (id !== "__today__") clusterById.set(id, cluster);
    }
  }
  const todayCluster = clusters.find((cluster) => cluster.hasToday);
  clustersRef.current = clusters;
  hoverClusterKeyRef.current = hoverClusterKey;
  const hiddenLabelIds = new Set<string>();
  for (const cluster of clusters) {
    for (const id of cluster.ids) {
      if (id === "__today__") continue;
      if (cluster.hostId !== id) hiddenLabelIds.add(id);
    }
  }
  const labeledMarkers = visibleMarkers.filter((marker) => !hiddenLabelIds.has(marker.id));
  const guideSlots = guideLabelSlots(labeledMarkers, px, todayX);
  const todayLabelVisible = !(todayCluster && todayCluster.hostId !== "__today__");
  const guideDimIds =
    hoverGuideId && !hiddenLabelIds.has(hoverGuideId)
      ? guideLabelsOverlap(labeledMarkers, px, hoverGuideId, guideSlots, todayLabelVisible ? todayX : undefined)
      : hoverToday && todayLabelVisible
        ? guideLabelsOverlap(labeledMarkers, px, "__today__", guideSlots, todayX)
        : null;
  const dimToday = Boolean(guideDimIds?.has("__today__"));
  const dimClusterKeys = new Set<string>();
  if (!hoverClusterKey) {
    const dateBoxes: { left: number; right: number }[] = [];
    if (hoverGuideId && !hiddenLabelIds.has(hoverGuideId)) {
      const hovered = markers.find((marker) => marker.id === hoverGuideId);
      if (hovered) dateBoxes.push(hoverDateBox(hovered, px));
    }
    if (hoverToday && !todayCluster) dateBoxes.push({ left: todayX - 80, right: todayX + 80 });
    for (const box of dateBoxes) {
      for (const cluster of clusters) {
        if (hoverGuideId && cluster.ids.includes(hoverGuideId)) continue;
        const host = cluster.hasToday ? null : markers.find((marker) => marker.id === cluster.hostId);
        const cx = cluster.hasToday ? todayX : host ? markerLayout(host, px).midX : cluster.x;
        if (countHitsDate(cx, box)) dimClusterKeys.add(cluster.key);
      }
    }
  }
  const titleMax = entryTitleMax(entries, px);
  const draggingTree = treeDragId
    ? new Set([
        treeDragId,
        ...childIds(entries, treeDragId),
        ...(drag.current?.kind === "move" ? drag.current.groupIds : []),
        ...(drag.current?.kind === "move"
          ? drag.current.groupIds.flatMap((id) => childIds(entries, id))
          : []),
      ])
    : null;
  const weldInIds = new Set<string>();
  const weldOutIds = new Set<string>();
  for (const child of entries) {
    if (!child.parentId) continue;
    const parent = entries.find((entry) => entry.id === child.parentId);
    if (parent && child.start === toISO(addDays(parseISO(parent.end), 1))) {
      weldInIds.add(child.id);
      weldOutIds.add(parent.id);
    }
  }
  const todayYear = today.getFullYear();
  const lineW = showFine ? 2 : 1;
  const hoverEntry = hoverEntryId ? entries.find((entry) => entry.id === hoverEntryId) : null;
  const dateAnchors = mode === "edit" ? dragDateAnchors(drag.current, entries, px, dragHold) : [];
  const sheetZoom = contentZoom > 0 ? contentZoom : 1;
  const sheetWidth = viewW > 0 ? Math.max(width, viewW / sheetZoom) : width;
  const nextYear = RANGE.end.getFullYear();
  const showNextYear = sheetWidth > width + 24;
  if (scroller.current && appliedContentZoom.current !== sheetZoom) {
    zoomAnchor.current = layoutScrollOf(scroller.current, appliedContentZoom.current);
  }
  const screenX = (layoutX: number) => {
    const el = scroller.current;
    if (!el) return layoutX;
    return el.getBoundingClientRect().left + layoutX * sheetZoom - el.scrollLeft;
  };
  const screenY = (layoutY: number) => {
    const el = scroller.current;
    if (!el) return layoutY;
    return el.getBoundingClientRect().top + (layoutY - (body.current?.scrollTop ?? 0)) * sheetZoom;
  };

  return (
    <section
      className={`cal${mode === "edit" ? " is-edit" : " is-view"}${showWeeks ? " is-weeks" : ""}${showDays ? " is-days" : ""}${showQuarters ? " is-quarters" : ""}${scrolled ? " is-scrolled" : ""}${moreBelow ? " is-more" : ""}${vMetrics.content > vMetrics.view + 2 ? " is-vscroll" : ""}${connectFrom ? " is-connecting" : ""}${contentLines ? "" : " is-nolines"}`}
      style={{ ["--content-zoom" as string]: sheetZoom }}
    >
      <div className="cal-scroller" ref={scroller}>
        <div
          className="cal-track"
          style={{
            width: sheetWidth,
            height: viewH ? viewH / sheetZoom : undefined,
            maxHeight: viewH ? viewH / sheetZoom : undefined,
            zoom: sheetZoom,
          }}
        >
          <div className="cal-head">
          <div className="cal-years" style={{ width: sheetWidth }}>
            <div className="cal-year-mask" />
            {YEARS.map((year, i) => {
              const start = xAt(new Date(year, 0, 1), px);
              const end =
                year + 1 < RANGE.end.getFullYear()
                  ? xAt(new Date(year + 1, 0, 1), px)
                  : width;
              return (
                <div
                  key={year}
                  className="cal-year-slot"
                  style={{ marginLeft: i === 0 ? start : 0, width: end - start, zIndex: i }}
                >
                  <span className={`cal-year${year === todayYear ? " is-now" : ""}`}>{year}</span>
                </div>
              );
            })}
            {showNextYear ? (
              <div className="cal-year-slot" style={{ width: sheetWidth - width, zIndex: YEARS.length }}>
                <span className={`cal-year${nextYear === todayYear ? " is-now" : ""}`}>{nextYear}</span>
              </div>
            ) : null}
          </div>
          <div className={`cal-months${showFine ? " is-fine" : ""}`}>
            {!(todayCluster && todayCluster.hostId !== "__today__") ? (
              <span className={`cal-today-label${dimToday ? " is-dim" : ""}`} style={{ left: todayX }}>
                TODAY
              </span>
            ) : null}
            {todayCluster && todayCluster.ids.length >= 2 && todayCluster.hostId === "__today__" ? (
              <GuideClusterChip
                count={todayCluster.ids.length}
                left={todayX}
                open={hoverClusterKey === todayCluster.key}
                dim={dimClusterKeys.has(todayCluster.key)}
                members={clusterPopupIds(todayCluster, markers).flatMap((id) => {
                  if (id === "__today__") {
                    return [
                      {
                        id: "__today__",
                        name: "TODAY",
                        color: "var(--accent)",
                        when: markerWhen(today, today),
                        editable: false,
                      },
                    ];
                  }
                  const marker = markers.find((item) => item.id === id);
                  if (!marker) return [];
                  const span = markerSpan(marker);
                  return [
                    {
                      id: marker.id,
                      name: marker.name,
                      color: markerColor(marker),
                      when: markerWhen(span.start, span.end),
                      editable: true,
                    },
                  ];
                })}
                editing={mode === "edit"}
                onOpen={() => {
                  setHoverClusterKey(todayCluster.key);
                  setHoverGuideId(null);
                  setHoverToday(false);
                }}
                onClose={() => setHoverClusterKey(null)}
                onEdit={(id) => {
                  setHoverClusterKey(null);
                  beginEditGuide(id);
                }}
              />
            ) : null}
            {hoverToday && !todayCluster ? <DateGlyph date={today} left={todayX} /> : null}
            {dateAnchors.map((anchor) => (
              <DateGlyph key={`anchor-${anchor.key}`} date={anchor.date} left={anchor.x} />
            ))}
            {visibleMarkers.map((marker) => {
              const { span, extended, startX, endX, midX: mid } = markerLayout(marker, px);
              const cluster = clusterById.get(marker.id);
              const stacked = Boolean(cluster && cluster.ids.length >= 2);
              const hideLabel = stacked && (cluster!.hasToday || cluster!.hostId !== marker.id);
              if (hideLabel) return null;
              const hot = hoverGuideId === marker.id;
              const picked = selection.markers.includes(marker.id);
              const dragging = drag.current?.kind === "guide" && drag.current.id === marker.id;
              const guideDrag = dragging && drag.current?.kind === "guide" ? drag.current : null;
              const movingSpan = Boolean(guideDrag && extended && guideDrag.part === "body" && !guideDrag.extending);
              const dateAt = !extended
                ? span.start
                : guideDrag && (guideDrag.extending || guideDrag.part === "end")
                  ? span.end
                  : guideDrag && guideDrag.part === "start"
                    ? span.start
                    : null;
              const dateX =
                dateAt === span.end ? endX : dateAt === span.start ? startX : mid;
              const dim = Boolean(guideDimIds?.has(marker.id));
              return (
                <div
                  key={marker.id}
                  className={`cal-guide${hot ? " is-hot" : ""}${picked ? " is-on" : ""}${extended ? " is-span" : ""}${dim ? " is-dim" : ""}`}
                  style={{ ["--guide-color" as string]: markerColor(marker) }}
                >
                  {hot && !stacked && editingGuideId !== marker.id && movingSpan ? (
                    <>
                      <DateGlyph date={span.start} left={startX} />
                      <DateGlyph date={span.end} left={endX} />
                    </>
                  ) : null}
                  {hot && !stacked && editingGuideId !== marker.id && !movingSpan && dateAt ? (
                    <DateGlyph date={dateAt} left={dateX} />
                  ) : null}
                  {hot && !stacked && editingGuideId !== marker.id && extended && !dragging ? (
                    <DateRangeGlyph start={span.start} end={span.end} left={mid} />
                  ) : null}
                  <span
                    className="cal-guide-label"
                    style={{ left: mid, maxWidth: hot ? undefined : guideSlots.get(marker.id) }}
                    title={marker.name}
                  >
                    {marker.name}
                  </span>
                  {stacked && cluster && cluster.hostId === marker.id ? (
                    <GuideClusterChip
                      count={cluster.ids.length}
                      left={mid}
                      open={hoverClusterKey === cluster.key}
                      dim={dimClusterKeys.has(cluster.key)}
                      members={clusterPopupIds(cluster, markers).flatMap((id) => {
                        if (id === "__today__") {
                          return [
                            {
                              id: "__today__",
                              name: "TODAY",
                              color: "var(--accent)",
                              when: markerWhen(today, today),
                              editable: false,
                            },
                          ];
                        }
                        const item = markers.find((entry) => entry.id === id);
                        if (!item) return [];
                        const itemSpan = markerSpan(item);
                        return [
                          {
                            id: item.id,
                            name: item.name,
                            color: markerColor(item),
                            when: markerWhen(itemSpan.start, itemSpan.end),
                            editable: true,
                          },
                        ];
                      })}
                      editing={mode === "edit"}
                      onOpen={() => {
                        setHoverClusterKey(cluster.key);
                        setHoverGuideId(null);
                      }}
                      onClose={() => setHoverClusterKey(null)}
                      onEdit={(id) => {
                        setHoverClusterKey(null);
                        beginEditGuide(id);
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
            {periods.map((period) => {
              const left = xAt(period.start, px);
              const w = period.days * px;
              return (
                <div
                  key={period.key}
                  className={`cal-month${period.tail ? " is-year-tail" : ""}${hoverMonthKey === period.key ? " is-hover" : ""}`}
                  style={{ left, width: w }}
                >
                  <span className="cal-month-name">{period.name}</span>
                  {showFine ? null : <span className="cal-month-rule" />}
                </div>
              );
            })}
            {showWeeks
              ? MONDAYS.map((monday) => {
                  const left = xAt(monday, px);
                  const key = weekKey(monday);
                  return (
                    <div
                      key={key}
                      className={`cal-week-head${hoverKey === key ? " is-hover" : ""}`}
                      style={{ left, width: 7 * px }}
                    >
                      <span className="cal-month-rule" />
                    </div>
                  );
                })
              : null}
            {showDays
              ? DAYS.map((day) => {
                  const left = xAt(day, px);
                  const key = dayKey(day);
                  return (
                    <div
                      key={key}
                      className={`cal-day-head${hoverKey === key ? " is-hover" : ""}`}
                      style={{ left, width: px }}
                    >
                      <span className="cal-month-rule" />
                    </div>
                  );
                })
              : null}
          </div>
          </div>
          <div className="cal-stage">
          {showWeeks ? (
            <div className="cal-week-rail">
              {MONDAYS.map((monday) => {
                const left = xAt(monday, px);
                const key = weekKey(monday);
                return (
                  <span
                    key={key}
                    className={`cal-week-num${hoverKey === key ? " is-hover" : ""}`}
                    style={{ left, width: 7 * px }}
                  >
                    {isoWeek(monday)}
                  </span>
                );
              })}
            </div>
          ) : null}
          {showDays ? (
            <div className="cal-day-rail">
              {DAYS.map((day) => {
                const left = xAt(day, px);
                const key = dayKey(day);
                return (
                  <span
                    key={key}
                    className={`cal-day-num${hoverKey === key ? " is-hover" : ""}`}
                    style={{ left, width: px }}
                  >
                    {day.getDate()}
                  </span>
                );
              })}
            </div>
          ) : null}
          <div className="cal-grid">
            {periods.map((period) => {
              const left = xAt(period.start, px);
              const w = period.days * px;
              return (
                <div
                  key={`band-${period.key}`}
                  className={`cal-band${showFine ? " is-fine" : ""}${period.yearStart ? " is-year-start" : ""}`}
                  style={{ left, width: w }}
                />
              );
            })}
            {showWeeks
              ? MONDAYS.map((monday) => {
                  const left = xAt(monday, px);
                  const key = weekKey(monday);
                  return (
                    <div key={key} className="cal-week" style={{ left }}>
                      <span className="cal-week-tick" />
                    </div>
                  );
                })
              : null}
            {showDays
              ? DAYS.map((day) => {
                  const left = xAt(day, px);
                  const key = dayKey(day);
                  return (
                    <div
                      key={key}
                      className={`cal-day${isWeekend(day) ? " is-weekend" : ""}${day.getDay() === 0 ? " is-weekend-split" : ""}`}
                      style={{ left, width: px + (day.getDay() === 0 ? 1 : 0) }}
                    >
                      <span className="cal-day-tick" />
                    </div>
                  );
                })
              : null}
          </div>
          {snapXs.map((left) => (
            <div key={left} className="cal-snap-line" style={{ left }} />
          ))}
          <div className="cal-body" ref={body}>
          <div className="cal-entries" ref={entriesBox} style={{ minHeight: fillH }}>
            <svg className="cal-links" ref={linksSvg} width={width} height={fillH} aria-hidden="true">
              {(() => {
                const groups = new Map<string, Entry[]>();
                for (const child of entries) {
                  if (!child.parentId) continue;
                  const pack = groups.get(child.parentId) ?? [];
                  pack.push(child);
                  groups.set(child.parentId, pack);
                }
                const nodes: ReactNode[] = [];
                for (const [parentId, children] of groups) {
                  const parent = entries.find((entry) => entry.id === parentId);
                  if (!parent) continue;
                  for (const { key, d } of weldGroupPaths(
                    parent,
                    children,
                    (id) => {
                      const entry = entries.find((item) => item.id === id);
                      if (!entry) return null;
                      const box = layoutEntry(entry, px);
                      return { left: box.left, width: box.width, barTop: box.barTop, top: box.top };
                    },
                    linkRadius,
                  )) {
                    nodes.push(<path key={key} data-link={key} className="cal-link" d={d} />);
                  }
                }
                const markGroups = new Map<string, { host: Entry; mark: Milestone; children: Entry[] }>();
                for (const child of entries) {
                  const ref = child.parentMark;
                  if (!ref) continue;
                  const host = entries.find((entry) => entry.id === ref.entryId);
                  const mark = host?.milestones.find((item) => item.id === ref.markId);
                  if (!host || !mark) continue;
                  const key = `${ref.entryId}:${ref.markId}`;
                  const pack = markGroups.get(key) ?? { host, mark, children: [] };
                  pack.children.push(child);
                  markGroups.set(key, pack);
                }
                for (const { host, mark, children } of markGroups.values()) {
                  for (const { key, d } of weldMarkGroupPaths(
                    host,
                    mark,
                    children,
                    (id) => {
                      const entry = entries.find((item) => item.id === id);
                      if (!entry) return null;
                      const box = layoutEntry(entry, px);
                      return { left: box.left, width: box.width, barTop: box.barTop, top: box.top };
                    },
                    px,
                    linkRadius,
                  )) {
                    nodes.push(<path key={key} data-link={key} className="cal-link" d={d} />);
                  }
                }
                return nodes;
              })()}
            </svg>
            {entries.map((entry) => {
              const box = layoutEntry(entry, px);
              const glyphs = markGlyphs(entry, box, px);
              const hover = hoverEntryId === entry.id;
              const on = selection.entries.includes(entry.id);
              return (
                <div
                  key={entry.id}
                  data-entry-id={entry.id}
                  className={`cal-entry${hover ? " is-hover" : ""}${on ? " is-on" : ""}${connectFrom?.kind === "entry" && connectFrom.id === entry.id ? " is-connect-from" : ""}${connectFrom && hover && (connectFrom.kind === "entry" ? connectFrom.id !== entry.id : connectFrom.entryId !== entry.id) ? " is-connect-to" : ""}${entry.parentId || entry.parentMark ? " is-link-in" : ""}${entries.some((item) => item.parentId === entry.id) ? " is-link-out" : ""}${weldInIds.has(entry.id) ? " is-weld-in" : ""}${weldOutIds.has(entry.id) ? " is-weld-out" : ""}${draggingTree?.has(entry.id) ? " is-tree-drag" : ""}${renamingId === entry.id ? " is-renaming" : ""}`}
                  style={{ left: box.left, width: box.width, top: box.top, height: TITLE_H + BAR_GAP + BAR_H }}
                >
                  <div
                    className="cal-entry-name"
                    style={{ maxWidth: renamingId === entry.id ? undefined : titleMax.get(entry.id) }}
                  >
                    {mode === "edit" ? (
                      <button
                        type="button"
                        className="cal-entry-icon"
                        aria-label="Entry icon"
                        onPointerDown={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          beginEditIcon(entry.id, true);
                        }}
                      >
                        <EntryIcon name={entry.icon} color={entry.iconColor} className="cal-entry-spark" />
                      </button>
                    ) : (
                      <EntryIcon name={entry.icon} color={entry.iconColor} className="cal-entry-spark" />
                    )}
                    {renamingId === entry.id ? (
                      <div className="cal-entry-rename-slot">
                        <input
                          type="text"
                          className="cal-entry-rename"
                          defaultValue={renamingDraft}
                          aria-label="Entry name"
                          autoComplete="off"
                          spellCheck={false}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            if (!renameSelectAll.current) return;
                            event.preventDefault();
                            selectRenameText(event.currentTarget);
                          }}
                          onClick={(event) => {
                            if (!renameSelectAll.current) return;
                            selectRenameText(event.currentTarget);
                            renameSelectAll.current = false;
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              saveRename(entry.id, event.currentTarget.value);
                            } else if (event.key === "Escape") {
                              event.preventDefault();
                              ignoreRenameBlur.current = true;
                              setRenamingId(null);
                            }
                          }}
                          onBlur={(event) => {
                            if (ignoreRenameBlur.current) {
                              ignoreRenameBlur.current = false;
                              return;
                            }
                            saveRename(entry.id, event.currentTarget.value);
                          }}
                        />
                      </div>
                    ) : (
                      <span
                        title={entry.name}
                        onDoubleClick={(event) => {
                          if (mode !== "edit") return;
                          event.preventDefault();
                          event.stopPropagation();
                          beginRename(entry.id, entry.name);
                        }}
                      >
                        {entry.name}
                      </span>
                    )}
                  </div>
                  {mode === "edit" ? (
                    <button
                      type="button"
                      className="cal-entry-del"
                      aria-label={`Delete ${entry.name}`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        setEntries((list) =>
                          list
                            .filter((item) => item.id !== entry.id)
                            .map((item) =>
                              item.parentId === entry.id || item.parentMark?.entryId === entry.id
                                ? { ...item, parentId: undefined, parentMark: undefined }
                                : item,
                            ),
                        );
                        if (renamingId === entry.id) setRenamingId(null);
                        setSelection((current) => ({
                          entries: current.entries.filter((id) => id !== entry.id),
                          marks: current.marks.filter((mark) => mark.entryId !== entry.id),
                          markers: current.markers,
                        }));
                        if (editingMark?.entryId === entry.id) setEditingMark(null);
                        if (editingEntryId === entry.id) setEditingEntryId(null);
                        if (editingIconId === entry.id) setEditingIconId(null);
                      }}
                    >
                      <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
                        <path
                          d="M3 3l6 6M9 3l-6 6"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  ) : null}
                  <div
                    className={`cal-entry-bar${entry.color ? " is-colored" : ""}`}
                    style={
                      entry.color
                        ? ({
                            "--entry-own": entry.color,
                            "--entry-own-stroke": brighterHex(entry.color),
                          } as CSSProperties)
                        : undefined
                    }
                  >
                    <span className="cal-entry-stroke-link" aria-hidden="true" />
                    {glyphs.map((glyph) => {
                      const hot = glyph.marks.some(
                        (mark) => hoverMarkId === mark.id || editingMark?.markId === mark.id,
                      );
                      const picked = glyph.marks.some((mark) =>
                        selection.marks.some((item) => item.entryId === entry.id && item.markId === mark.id),
                      );
                      const hub = glyph.marks.some((mark) => markDisconnectable(entries, entry.id, mark.id));
                      const connectMark = glyph.marks.some(
                        (mark) =>
                          connectFrom?.kind === "mark" &&
                          connectFrom.entryId === entry.id &&
                          connectFrom.markId === mark.id,
                      );
                      if (glyph.marks.length > 1) {
                        return (
                          <CountCircle
                            key={glyph.key}
                            x={glyph.x}
                            count={glyph.marks.length}
                            hot={hot}
                            picked={picked}
                            hub={hub}
                            connect={connectMark}
                          />
                        );
                      }
                      const mark = glyph.marks[0];
                      return (
                        <svg
                          key={mark.id}
                          className={`cal-entry-mark${hot ? " is-hot" : ""}${picked ? " is-on" : ""}${hub ? " is-hub" : ""}${connectMark ? " is-connect-from" : ""}`}
                          style={{ left: glyph.x }}
                          width={MARK_WIDTH}
                          height={MARK_HEIGHT}
                          viewBox={`${-MARK_HEIGHT / 2} ${-MARK_HEIGHT / 2} ${MARK_HEIGHT} ${MARK_HEIGHT}`}
                          aria-hidden="true"
                        >
                          <title>{mark.name}</title>
                          <rect
                            x={-MARK_SQUARE / 2}
                            y={-MARK_SQUARE / 2}
                            width={MARK_SQUARE}
                            height={MARK_SQUARE}
                            rx={MARK_RADIUS}
                            ry={MARK_RADIUS}
                            transform="rotate(45)"
                            fill="#fff"
                            stroke="#fff"
                            strokeWidth={MARK_STROKE}
                            vectorEffect="non-scaling-stroke"
                          />
                        </svg>
                      );
                    })}
                  </div>
                  {markNameSlots(glyphs).map((slot) => {
                    if (slot.marks.length > 1) return null;
                    const showDate =
                      mode === "edit" &&
                      slot.marks.some((mark) => mark.id === hoverMarkId) &&
                      editingMark?.markId !== hoverMarkId;
                    if (showDate) return null;
                    const hub = slot.marks.some((mark) => markDisconnectable(entries, entry.id, mark.id));
                    return (
                      <span
                        key={`name-${slot.key}`}
                        className={`cal-entry-mark-name${hub ? " is-hub" : ""}`}
                        style={{ left: slot.x, maxWidth: slot.maxWidth }}
                        title={slot.name}
                      >
                        {slot.name}
                      </span>
                    );
                  })}
                  {mode === "edit" && hoverMarkId && editingMark?.markId !== hoverMarkId
                    ? entry.milestones.map((mark) => {
                        if (mark.id !== hoverMarkId) return null;
                        const date = parseISO(mark.date);
                        if (date < box.start || date > box.end) return null;
                        const glyph = glyphs.find((item) => item.marks.some((candidate) => candidate.id === mark.id));
                        const parts = formatMarkDate(date);
                        return (
                          <span
                            key={`date-${mark.id}`}
                            className="cal-entry-mark-date"
                            style={{ left: glyph ? glyph.x : xDayMid(date, px) - box.left }}
                          >
                            <span className="cal-entry-mark-date-dow">{parts.weekday},</span>
                            <span className="cal-entry-mark-date-day">{parts.day}</span>
                            <span className="cal-entry-mark-date-mon">{parts.month}</span>
                          </span>
                        );
                      })
                    : null}
                  {mode === "edit" &&
                  dateAnchors.length &&
                  (drag.current?.kind === "move" ||
                    drag.current?.kind === "resize" ||
                    drag.current?.kind === "create") &&
                  drag.current.id === entry.id
                    ? dateAnchors
                        .filter((anchor) => anchor.key === "start" || anchor.key === "end")
                        .map((anchor) => {
                          const parts = formatMarkDate(anchor.date);
                          return (
                            <span
                              key={`bar-date-${anchor.key}`}
                              className="cal-entry-mark-date"
                              style={{ left: anchor.key === "start" ? 0 : box.width }}
                            >
                              <span className="cal-entry-mark-date-dow">{parts.weekday},</span>
                              <span className="cal-entry-mark-date-day">{parts.day}</span>
                              <span className="cal-entry-mark-date-mon">{parts.month}</span>
                            </span>
                          );
                        })
                    : null}
                </div>
              );
            })}
          </div>
          </div>
          </div>
          {YEARS.map((year) => {
            const left = xAt(new Date(year, 0, 1), px);
            return (
              <div key={`ye-${year}`}>
                <div className="cal-year-split" style={{ left }} />
                <div className="cal-year-end" style={{ left }} />
              </div>
            );
          })}
          {showNextYear ? (
            <div key={`ye-${nextYear}`}>
              <div className="cal-year-split" style={{ left: width }} />
              <div className="cal-year-end" style={{ left: width }} />
            </div>
          ) : null}
          <div className="cal-today-head" style={{ left: todayX - lineW / 2, width: lineW }} />
          <div className="cal-today" style={{ left: todayX - lineW / 2, width: lineW }} />
          {dateAnchors.map((anchor) => (
            <div key={`drag-head-${anchor.key}`} className="cal-drag-head" style={{ left: anchor.x }} />
          ))}
          {visibleMarkers.map((marker) => {
            const { extended, startX, endX } = markerLayout(marker, px);
            const w = extended ? 1 : lineW;
            const lineLeft = extended ? startX : startX - w / 2;
            return (
              <div
                key={`line-${marker.id}`}
                className={selection.markers.includes(marker.id) ? "is-guide-on" : undefined}
                style={{ ["--guide-color" as string]: markerColor(marker) }}
              >
                {extended ? (
                  <div
                    className="cal-guide-hatch"
                    style={{ left: startX + w, width: Math.max(0, endX - startX - w - 1) }}
                  />
                ) : null}
                <div className="cal-guide-head" style={{ left: lineLeft, width: w }} />
                <div className="cal-guide-line" style={{ left: lineLeft, width: w }} />
                {extended ? (
                  <>
                    <div className="cal-guide-head" style={{ left: endX, width: 1 }} />
                    <div className="cal-guide-line" style={{ left: endX, width: 1 }} />
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <div className={`cal-edge-fade is-top${showWeeks || showDays ? " is-fine" : ""}`} />
      <div className="cal-edge-fade is-bottom" />
      {vMetrics.content > vMetrics.view + 2 ? (
        <div
          className="cal-row-rail"
          role="button"
          tabIndex={0}
          aria-label="Jump to entries"
          onClick={(event) => {
            const el = body.current;
            if (!el) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = (event.clientY - rect.top) / Math.max(1, rect.height);
            const top = ratio * el.scrollHeight - el.clientHeight / 2;
            el.scrollTo({
              top: Math.max(0, Math.min(el.scrollHeight - el.clientHeight, top)),
              behavior: "smooth",
            });
          }}
          onWheel={(event) => {
            event.preventDefault();
            body.current?.scrollBy({ top: event.deltaY });
          }}
        >
          <span ref={railWindowRef} className="cal-row-rail-window" />
          {[...new Set(entries.map((entry) => entry.row))]
            .sort((a, b) => a - b)
            .map((row) => (
              <span
                key={row}
                className="cal-row-tick"
                style={{
                  top: ((ROW_TOP + row * ROW_H + ROW_H / 2) / vMetrics.content) * Math.max(1, vMetrics.view - 16),
                }}
              />
            ))}
        </div>
      ) : null}
      {mode === "view" && hoverEntry
        ? (() => {
            const box = layoutEntry(hoverEntry, px);
            const barLeft = screenX(box.left);
            const barRight = barLeft + box.width * sheetZoom;
            const left = Math.min(barRight, Math.max(barLeft, hoverClientX));
            const top = screenY(HEAD_H + box.barTop) - 10;
            const maxHeight = Math.max(96, top - 12);
            return (
              <div className="cal-entry-card" style={{ left, top, maxHeight }}>
                <div className="cal-entry-card-title">{hoverEntry.name}</div>
                <div className="cal-entry-card-range">{formatRange(box.start, box.end)}</div>
                {hoverEntry.milestones.length ? (
                  <ul className="cal-entry-card-ms" ref={cardListRef}>
                    {[...hoverEntry.milestones]
                      .sort((a, b) => a.date.localeCompare(b.date))
                      .map((mark) => (
                      <li key={mark.id} className={hoverMarkId === mark.id ? "is-hot" : ""}>
                        <span>{mark.name}</span>
                        <span>{formatCardDate(parseISO(mark.date))}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="cal-entry-card-empty">No milestones</div>
                )}
              </div>
            );
          })()
        : null}
      {mode === "edit" && colorizeIds?.length
        ? (() => {
            const ids = colorizeIds;
            const anchor = entries.find((item) => item.id === ids[0]);
            if (!anchor) return null;
            const box = layoutEntry(anchor, px);
            const rawLeft = screenX(box.left + box.width / 2);
            const left = Math.min(window.innerWidth - 148, Math.max(148, rawLeft));
            const rawTop = screenY(HEAD_H + box.barTop + BAR_H) + 8;
            const placed = placeEditPanel(rawTop);
            const currentColor = entries.find((item) => item.id === ids[0])?.color;
            const motion = bindMenu(`color:${ids.join(",")}`, left, placed.top);
            return (
              <div
                className={`cal-mark-edit cal-colorize-edit${motion.dragging ? " is-dragging" : ""}`}
                style={motion.style}
                onPointerDown={motion.onPointerDown}
                onPointerMove={motion.onPointerMove}
                onPointerUp={motion.onPointerUp}
                onPointerCancel={motion.onPointerUp}
                onWheel={(event) => event.stopPropagation()}
              >
                <EntryColorField
                  color={currentColor}
                  swatches={colorSwatches}
                  onColor={(color) => paintEntryColor(ids, color)}
                  onSwatches={commitSwatches}
                />
              </div>
            );
          })()
        : null}
      {mode === "edit" && editingEntryId
        ? (() => {
            const entry = entries.find((item) => item.id === editingEntryId);
            if (!entry) return null;
            const box = layoutEntry(entry, px);
            const rawLeft = screenX(box.left + box.width / 2);
            const left = Math.min(window.innerWidth - 148, Math.max(148, rawLeft));
            const rawTop = screenY(HEAD_H + box.barTop + BAR_H) + 8;
            const placed = placeEditPanel(rawTop);
            const motion = bindMenu(`entry:${entry.id}`, left, placed.top);
            return (
              <div
                className={`cal-mark-edit cal-entry-edit${motion.dragging ? " is-dragging" : ""}`}
                style={motion.style}
                onPointerDown={motion.onPointerDown}
                onPointerMove={motion.onPointerMove}
                onPointerUp={motion.onPointerUp}
                onPointerCancel={motion.onPointerUp}
                onWheel={(event) => event.stopPropagation()}
              >
                <label className="cal-mark-edit-label">
                  Entry name
                  <input
                    className="cal-entry-edit-name"
                    type="text"
                    value={entry.name}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(event) => {
                      const name = event.target.value;
                      setEntries((list) => list.map((item) => (item.id === entry.id ? { ...item, name } : item)));
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        const name = entry.name.trim();
                        if (!name) {
                          setEntries((list) =>
                            list.map((item) => (item.id === entry.id ? { ...item, name: "New Entry" } : item)),
                          );
                        }
                        commitSpanDraft(entry);
                        setEditingEntryId(null);
                      }
                    }}
                  />
                </label>
                <div className="cal-mark-edit-label">
                  Duration
                  <div className="cal-entry-edit-dates">
                    <input
                      type="date"
                      aria-label="Start date"
                      value={spanDraft?.start ?? entry.start}
                      onChange={(event) => {
                        const raw = event.target.value;
                        if (!raw) return;
                        applyEntryDates(entry, raw, spanDraft?.end ?? entry.end);
                      }}
                    />
                    <span>–</span>
                    <input
                      type="date"
                      aria-label="End date"
                      value={spanDraft?.end ?? entry.end}
                      onChange={(event) => {
                        const raw = event.target.value;
                        if (!raw) return;
                        applyEntryDates(entry, spanDraft?.start ?? entry.start, raw);
                      }}
                    />
                  </div>
                </div>
                <EntryColorField
                  color={entry.color}
                  swatches={colorSwatches}
                  onColor={(color) => paintEntryColor([entry.id], color)}
                  onSwatches={commitSwatches}
                />
                <div className="cal-edit-sep" />
                <EditAction icon={Pencil} onClick={() => beginEditIcon(entry.id)}>
                  Edit icon
                </EditAction>
                <EditAction
                  icon={Trash2}
                  danger
                  onClick={() => {
                    setEntries((list) =>
                      list
                        .filter((item) => item.id !== entry.id)
                        .map((item) =>
                          item.parentId === entry.id || item.parentMark?.entryId === entry.id
                            ? { ...item, parentId: undefined, parentMark: undefined }
                            : item,
                        ),
                    );
                    setEditingEntryId(null);
                    editingEntryRef.current = null;
                    setEditingIconId(null);
                    editingIconRef.current = null;
                    setSelection((current) => ({
                      entries: current.entries.filter((id) => id !== entry.id),
                      marks: current.marks.filter((mark) => mark.entryId !== entry.id),
                      markers: current.markers,
                    }));
                    if (editingMark?.entryId === entry.id) setEditingMark(null);
                  }}
                >
                  Delete entry
                </EditAction>
              </div>
            );
          })()
        : null}
      {mode === "edit" && editingIconId
        ? (() => {
            const entry = entries.find((item) => item.id === editingIconId);
            if (!entry) return null;
            const box = layoutEntry(entry, px);
            const iconBottom = box.top + (TITLE_H + 14) / 2;
            const rawLeft = screenX(iconFromIcon ? box.left + 7 : box.left + box.width / 2);
            const left = Math.min(window.innerWidth - 148, Math.max(148, rawLeft));
            const rawTop = iconFromIcon
              ? screenY(HEAD_H + iconBottom) + 8
              : screenY(HEAD_H + box.barTop + BAR_H) + 8;
            const placed = placeEditPanel(rawTop);
            const iconName = entry.icon || DEFAULT_ENTRY_ICON;
            const motion = bindMenu(`icon:${entry.id}:${iconFromIcon ? "icon" : "bar"}`, left, placed.top);
            return (
              <div
                className={`cal-mark-edit cal-entry-edit cal-icon-only${motion.dragging ? " is-dragging" : ""}`}
                style={motion.style}
                onPointerDown={motion.onPointerDown}
                onPointerMove={motion.onPointerMove}
                onPointerUp={motion.onPointerUp}
                onPointerCancel={motion.onPointerUp}
                onWheel={(event) => event.stopPropagation()}
              >
                <div className="cal-mark-edit-label">
                  Icon
                  <IconPicker
                    value={entry.icon}
                    placeholder={iconName}
                    compact
                    autoFocus
                    onPick={(icon) => {
                      setEntries((list) => list.map((item) => (item.id === entry.id ? { ...item, icon } : item)));
                    }}
                  />
                </div>
                <EntryColorField
                  color={entry.iconColor || DEFAULT_ENTRY_ICON_COLOR}
                  swatches={colorSwatches}
                  onColor={(iconColor) => {
                    setEntries((list) => list.map((item) => (item.id === entry.id ? { ...item, iconColor } : item)));
                  }}
                  onSwatches={commitSwatches}
                />
              </div>
            );
          })()
        : null}
      {mode === "edit" && editingMark
        ? (() => {
            const entry = entries.find((item) => item.id === editingMark.entryId);
            const mark = entry?.milestones.find((item) => item.id === editingMark.markId);
            if (!entry || !mark) return null;
            const box = layoutEntry(entry, px);
            const date = parseISO(mark.date);
            if (date < box.start || date > box.end) return null;
            const rawLeft = screenX(xDayMid(date, px));
            const left = Math.min(window.innerWidth - 148, Math.max(148, rawLeft));
            const rawTop = screenY(HEAD_H + box.barTop + BAR_H) + 8;
            const placed = placeEditPanel(rawTop);
            const motion = bindMenu(`mark:${entry.id}:${mark.id}`, left, placed.top);
            return (
              <div
                className={`cal-mark-edit${motion.dragging ? " is-dragging" : ""}`}
                style={motion.style}
                onPointerDown={motion.onPointerDown}
                onPointerMove={motion.onPointerMove}
                onPointerUp={motion.onPointerUp}
                onPointerCancel={motion.onPointerUp}
                onWheel={(event) => event.stopPropagation()}
              >
                <label className="cal-mark-edit-label">
                  Milestone name
                  <input
                    className="cal-mark-edit-name"
                    type="text"
                    value={mark.name}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(event) => patchMark(entry.id, mark.id, { name: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        setEditingMark(null);
                      }
                    }}
                  />
                </label>
                <label className="cal-mark-edit-label">
                  Date
                  <input
                    type="date"
                    value={mark.date}
                    min={entry.start}
                    max={entry.end}
                    onChange={(event) => {
                      const raw = event.target.value;
                      if (!raw) return;
                      let next = parseISO(raw);
                      if (next < box.start) next = box.start;
                      if (next > box.end) next = box.end;
                      patchMark(entry.id, mark.id, { date: toISO(next) });
                    }}
                  />
                </label>
                <div className="cal-edit-sep" />
                <EditAction
                  icon={Trash2}
                  danger
                  onClick={() => {
                    setEntries((list) =>
                      list.map((item) => {
                        if (item.id === entry.id) {
                          return { ...item, milestones: item.milestones.filter((m) => m.id !== mark.id) };
                        }
                        if (item.parentMark?.entryId === entry.id && item.parentMark.markId === mark.id) {
                          return { ...item, parentMark: undefined };
                        }
                        return item;
                      }),
                    );
                    setEditingMark(null);
                  }}
                >
                  Delete
                </EditAction>
              </div>
            );
          })()
        : null}
      {mode === "edit" && editingGuideId
        ? (() => {
            const marker = markers.find((item) => item.id === editingGuideId);
            if (!marker) return null;
            const span = markerSpan(marker);
            const extended = daysBetween(span.start, span.end) > 0;
            const mid = markerLayout(marker, px).midX;
            const rawLeft = screenX(mid);
            const left = Math.min(window.innerWidth - 148, Math.max(148, rawLeft));
            const placed = placeEditPanel(screenY(HEAD_H) + 8);
            const motion = bindMenu(`guide:${marker.id}`, left, placed.top);
            const draft = guideDateDraft ?? { start: toISO(span.start), end: toISO(span.end) };
            const applyMarkerDates = (startRaw: string, endRaw: string) => {
              if (!startRaw || !endRaw) return;
              let start = clampDate(parseISO(startRaw));
              let end = clampDate(parseISO(endRaw));
              if (end < start) end = start;
              const nextEnd = daysBetween(start, end) > 0 ? toISO(end) : undefined;
              setMarkers((list) =>
                list.map((item) =>
                  item.id === marker.id ? { ...item, date: toISO(start), end: nextEnd } : item,
                ),
              );
              setGuideDateDraft({ start: toISO(start), end: toISO(end) });
            };
            const splitMarker = () => {
              const bounds = splitBounds(parseISO(marker.date), px, 1);
              setMarkers((list) =>
                list.map((item) => (item.id === marker.id ? markerWithSpan(item, bounds.start, bounds.end) : item)),
              );
              setGuideDateDraft({ start: toISO(bounds.start), end: toISO(bounds.end) });
            };
            const joinMarker = () => {
              setMarkers((list) =>
                list.map((item) => (item.id === marker.id ? { ...item, end: undefined } : item)),
              );
              setGuideDateDraft({ start: marker.date, end: marker.date });
            };
            const deleteMarker = () => {
              setMarkers((list) => list.filter((item) => item.id !== marker.id));
              setSelection((current) => ({
                ...current,
                markers: current.markers.filter((id) => id !== marker.id),
              }));
              setEditingGuideId(null);
              editingGuideRef.current = null;
            };
            return (
              <div
                className={`cal-mark-edit cal-guide-edit${motion.dragging ? " is-dragging" : ""}`}
                style={motion.style}
                onPointerDown={motion.onPointerDown}
                onPointerMove={motion.onPointerMove}
                onPointerUp={motion.onPointerUp}
                onPointerCancel={motion.onPointerUp}
                onWheel={(event) => event.stopPropagation()}
              >
                <label className="cal-mark-edit-label">
                  Marker name
                  <input
                    className="cal-guide-edit-name"
                    type="text"
                    value={marker.name}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(event) => {
                      const name = event.target.value;
                      setMarkers((list) =>
                        list.map((item) => (item.id === marker.id ? { ...item, name } : item)),
                      );
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        const name = marker.name.trim() || "Marker";
                        setMarkers((list) =>
                          list.map((item) => (item.id === marker.id ? { ...item, name } : item)),
                        );
                        applyMarkerDates(draft.start, draft.end);
                        setEditingGuideId(null);
                      }
                    }}
                  />
                </label>
                {extended ? (
                  <div className="cal-mark-edit-label">
                    Duration
                    <div className="cal-entry-edit-dates">
                      <input
                        type="date"
                        aria-label="Start date"
                        value={draft.start}
                        onChange={(event) => {
                          if (!event.target.value) return;
                          applyMarkerDates(event.target.value, draft.end);
                        }}
                      />
                      <span>–</span>
                      <input
                        type="date"
                        aria-label="End date"
                        value={draft.end}
                        onChange={(event) => {
                          if (!event.target.value) return;
                          applyMarkerDates(draft.start, event.target.value);
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <label className="cal-mark-edit-label">
                    Date
                    <input
                      className="cal-guide-edit-date"
                      type="date"
                      value={draft.start}
                      onChange={(event) => {
                        if (!event.target.value) return;
                        applyMarkerDates(event.target.value, event.target.value);
                      }}
                    />
                  </label>
                )}
                <EntryColorField
                  color={marker.color || "#ffffff"}
                  swatches={colorSwatches}
                  onColor={(color) =>
                    setMarkers((list) => list.map((item) => (item.id === marker.id ? { ...item, color } : item)))
                  }
                  onSwatches={commitSwatches}
                />
                <div className="cal-edit-sep" />
                {extended ? (
                  <EditAction icon={Merge} onClick={joinMarker}>
                    Join
                  </EditAction>
                ) : (
                  <EditAction icon={Split} onClick={splitMarker}>
                    Split
                  </EditAction>
                )}
                <EditAction icon={Trash2} danger onClick={deleteMarker}>
                  Delete
                </EditAction>
              </div>
            );
          })()
        : null}
      {menu ? (
        <div className="cal-menu" style={{ left: menu.x, top: menu.y }} role="menu">
          {mode === "view" ? (
            <>
              <MenuItem
                onClick={() => {
                  onCenter?.();
                  closeMenu();
                }}
              >
                Center
              </MenuItem>
              <MenuItem
                onClick={() => {
                  onToday?.();
                  closeMenu();
                }}
              >
                Today
              </MenuItem>
              <div className="cal-menu-sep" />
              {(["month", "week", "day"] as const).map((band) => (
                <MenuItem
                  key={band}
                  on={zoomBandAt(px) === band}
                  onClick={() => {
                    onZoomTo?.(band);
                    closeMenu();
                  }}
                >
                  {band === "month" ? "Month" : band === "week" ? "Week" : "Day"}
                </MenuItem>
              ))}
              <div className="cal-menu-sep" />
              <MenuItem
                onClick={() => {
                  onCompact?.();
                  closeMenu();
                }}
              >
                Compact
              </MenuItem>
            </>
          ) : menu.kind === "guide" && menu.markerId ? (
            <>
              <MenuItem onClick={() => beginEditGuide(menu.markerId!)}>Edit</MenuItem>
              {(() => {
                const marker = markers.find((item) => item.id === menu.markerId);
                if (!marker) return null;
                const canSplit = !markerExtended(marker);
                return (
                  <>
                    <MenuItem
                      disabled={!canSplit}
                      onClick={() => {
                        const bounds = splitBounds(parseISO(marker.date), px, 1);
                        setMarkers((list) =>
                          list.map((item) =>
                            item.id === marker.id ? markerWithSpan(item, bounds.start, bounds.end) : item,
                          ),
                        );
                        closeMenu();
                      }}
                    >
                      Split
                    </MenuItem>
                    <div className="cal-menu-sep" />
                    <MenuItem
                      danger
                      onClick={() => {
                        setMarkers((list) => list.filter((item) => item.id !== marker.id));
                        setSelection((current) => ({
                          ...current,
                          markers: current.markers.filter((id) => id !== marker.id),
                        }));
                        if (editingGuideId === marker.id) setEditingGuideId(null);
                        closeMenu();
                      }}
                    >
                      Delete marker
                    </MenuItem>
                  </>
                );
              })()}
            </>
          ) : menu.kind === "mark" && menuEntry && menu.markId ? (
            <>
              <MenuItem onClick={() => beginEditMark(menuEntry.id, menu.markId!)}>Edit</MenuItem>
              <MenuItem
                onClick={() => {
                  setConnectFrom({ kind: "mark", entryId: menuEntry.id, markId: menu.markId! });
                  closeMenu();
                }}
              >
                Connect
              </MenuItem>
              <MenuItem
                disabled={!markDisconnectable(entries, menuEntry.id, menu.markId)}
                onClick={() => {
                  setEntries((list) => disconnectMark(list, menuEntry.id, menu.markId!));
                  closeMenu();
                }}
              >
                Disconnect
              </MenuItem>
              <div className="cal-menu-sep" />
              <MenuItem
                danger
                onClick={() => {
                  const markId = menu.markId;
                  setEntries((list) =>
                    list.map((entry) => {
                      if (entry.id === menuEntry.id) {
                        return { ...entry, milestones: entry.milestones.filter((mark) => mark.id !== markId) };
                      }
                      if (entry.parentMark?.entryId === menuEntry.id && entry.parentMark.markId === markId) {
                        return { ...entry, parentMark: undefined };
                      }
                      return entry;
                    }),
                  );
                  if (editingMark?.markId === markId) setEditingMark(null);
                  setSelection((current) => ({
                    ...current,
                    marks: current.marks.filter(
                      (mark) => !(mark.entryId === menuEntry.id && mark.markId === markId),
                    ),
                  }));
                  closeMenu();
                }}
              >
                Delete milestone
              </MenuItem>
            </>
          ) : menu.kind === "entries" ? (
            <>
              <MenuItem
                onClick={() => {
                  setEntries((list) => alignSelectedEdges(list, selection.entries, pxRef.current, "start"));
                  closeMenu();
                }}
              >
                Align Start
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setEntries((list) => alignSelectedEdges(list, selection.entries, pxRef.current, "end"));
                  closeMenu();
                }}
              >
                Align End
              </MenuItem>
              <MenuItem
                onClick={() =>
                  beginColorize(
                    menu.entryId
                      ? [menu.entryId, ...selection.entries.filter((id) => id !== menu.entryId)]
                      : selection.entries,
                  )
                }
              >
                Colorize
              </MenuItem>
              <div className="cal-menu-sep" />
              <MenuItem
                danger
                onClick={() => {
                  const next = deleteSelected(entries, markers, {
                    entries: selection.entries,
                    marks: [],
                    markers: [],
                  });
                  setEntries(next.entries);
                  setSelection(EMPTY_SELECTION);
                  setEditingMark(null);
                  setEditingEntryId(null);
                  setRenamingId(null);
                  closeMenu();
                }}
              >
                Delete entries
              </MenuItem>
            </>
          ) : menu.kind === "entry" && menuEntry ? (
            <>
              <MenuItem onClick={() => beginEditEntry(menuEntry.id)}>Edit</MenuItem>
              <MenuItem
                onClick={() => {
                  const start = parseISO(menuEntry.start);
                  const end = parseISO(menuEntry.end);
                  let date = parseISO(menu.date);
                  if (date < start) date = start;
                  if (date > end) date = end;
                  const markId = uid();
                  setEntries((list) =>
                    list.map((entry) =>
                      entry.id !== menuEntry.id
                        ? entry
                        : {
                            ...entry,
                            milestones: [
                              ...entry.milestones,
                              { id: markId, name: nextMilestoneName(entry), date: toISO(date), priority: 1 },
                            ],
                          },
                    ),
                  );
                  selectOnlyEntry(menuEntry.id);
                  setHoverMarkId(markId);
                  beginEditMark(menuEntry.id, markId);
                }}
              >
                Milestone
              </MenuItem>
              <MenuItem onClick={() => beginColorize([menuEntry.id])}>Colorize</MenuItem>
              <MenuItem
                onClick={() => {
                  const source = menuEntry;
                  const { list, copy } = duplicateEntry(entries, source, pxRef.current);
                  setEntries(list);
                  selectOnlyEntry(copy.id);
                  closeMenu();
                }}
              >
                Duplicate
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setConnectFrom({ kind: "entry", id: menuEntry.id });
                  closeMenu();
                }}
              >
                Connect
              </MenuItem>
              <MenuItem
                disabled={!entryDisconnectable(entries, menuEntry)}
                onClick={() => {
                  setEntries((list) => disconnectEntry(list, menuEntry.id));
                  closeMenu();
                }}
              >
                Disconnect
              </MenuItem>
              <div className="cal-menu-sep" />
              <MenuItem
                danger
                onClick={() => {
                  const removed = menuEntry.id;
                  setEntries((list) =>
                    list
                      .filter((item) => item.id !== removed)
                      .map((item) =>
                        item.parentId === removed || item.parentMark?.entryId === removed
                          ? { ...item, parentId: undefined, parentMark: undefined }
                          : item,
                      ),
                  );
                  if (renamingId === menuEntry.id) setRenamingId(null);
                  setSelection((current) => ({
                    entries: current.entries.filter((id) => id !== removed),
                    marks: current.marks.filter((mark) => mark.entryId !== removed),
                    markers: current.markers,
                  }));
                  if (editingMark?.entryId === menuEntry.id) setEditingMark(null);
                  if (editingEntryId === menuEntry.id) setEditingEntryId(null);
                  closeMenu();
                }}
              >
                Delete entry
              </MenuItem>
            </>
          ) : (
            <>
              <MenuItem
                onClick={() => {
                  addEntryAt(parseISO(menu.date), menu.row);
                  closeMenu();
                }}
              >
                Add entry
              </MenuItem>
              <MenuItem
                onClick={() => {
                  addMarkerAt(parseISO(menu.date));
                  closeMenu();
                }}
              >
                Add marker
              </MenuItem>
            </>
          )}
        </div>
      ) : null}
      {marquee ? (
        <div
          className="cal-marquee"
          style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }}
        />
      ) : null}
    </section>
  );
}
