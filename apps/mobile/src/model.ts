export type Milestone = {
  id: string;
  name: string;
  date: string;
  priority?: number;
};

export type Entry = {
  id: string;
  name: string;
  start: string;
  end: string;
  row: number;
  parentId?: string;
  parentMark?: { entryId: string; markId: string };
  icon?: string;
  iconColor?: string;
  color?: string;
  milestones: Milestone[];
};

export type Marker = {
  id: string;
  name: string;
  date: string;
  end?: string;
  color?: string;
};

export type Loaded = {
  projectId: string;
  projectName: string;
  entries: Entry[];
  markers: Marker[];
};

export type ProjectRef = { id: string; name: string };

export type Phase = "done" | "now" | "soon";

export type Beat =
  | { kind: "entry"; date: string; entry: Entry }
  | { kind: "milestone"; date: string; entry: Entry; milestone: Milestone }
  | { kind: "marker"; date: string; marker: Marker };

export type Span = { start: string; end: string; days: number };

export const NEXT_WINDOW_DAYS = 28;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_FULL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const PROJECT_NAME = "PLANNR Roadmap 2026";

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

export function toISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function dayNumber(date: Date): number {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

export function daysBetween(a: Date, b: Date): number {
  return dayNumber(b) - dayNumber(a);
}

export function phase(start: string, end: string, today: Date): Phase {
  const t = dayNumber(today);
  if (t < dayNumber(parseISO(start))) return "soon";
  if (t > dayNumber(parseISO(end))) return "done";
  return "now";
}

export function relative(iso: string, today: Date): string {
  const n = daysBetween(today, parseISO(iso));
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  if (n > 1) return `in ${n} days`;
  return `${-n} days ago`;
}

export function inclusiveDays(start: string, end: string): number {
  return daysBetween(parseISO(start), parseISO(end)) + 1;
}

export function durationLabel(start: string, end: string): string {
  const n = inclusiveDays(start, end);
  return n === 1 ? "1 day" : `${n} days`;
}

export function endsIn(end: string, today: Date): string {
  const n = daysBetween(today, parseISO(end));
  if (n < 0) return `ended ${relative(end, today)}`;
  if (n === 0) return "ends today";
  if (n === 1) return "ends tomorrow";
  return `ends in ${n} days`;
}

export function startsIn(start: string, today: Date): string {
  const n = daysBetween(today, parseISO(start));
  if (n <= 0) return "starts today";
  if (n === 1) return "starts tomorrow";
  return `starts in ${n} days`;
}

export function timing(start: string, end: string, today: Date): string {
  const status = phase(start, end, today);
  if (status === "now") return endsIn(end, today);
  if (status === "soon") return startsIn(start, today);
  const n = daysBetween(parseISO(end), today);
  if (n === 0) return "ended today";
  if (n === 1) return "ended yesterday";
  return `ended ${n} days ago`;
}

export function progress(start: string, end: string, today: Date): number {
  const span = daysBetween(parseISO(start), parseISO(end));
  if (span <= 0) return phase(start, end, today) === "soon" ? 0 : 1;
  const gone = daysBetween(parseISO(start), today);
  return Math.min(1, Math.max(0, gone / span));
}

export function formatDay(iso: string): string {
  const date = parseISO(iso);
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

export function formatWeekday(iso: string): string {
  const date = parseISO(iso);
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

export function formatMonth(iso: string): string {
  const date = parseISO(iso);
  return `${MONTHS_FULL[date.getMonth()]} ${date.getFullYear()}`;
}

export function weekdayName(date: Date): string {
  return WEEKDAYS_FULL[date.getDay()];
}

export function formatRange(start: string, end: string): string {
  if (start === end) return formatDay(start);
  const a = parseISO(start);
  const b = parseISO(end);
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    return `${a.getDate()} – ${b.getDate()} ${MONTHS[a.getMonth()]}`;
  }
  if (a.getFullYear() === b.getFullYear()) {
    return `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]}`;
  }
  return `${formatDay(start)} ${a.getFullYear()} – ${formatDay(end)} ${b.getFullYear()}`;
}

export function toneOf(entry: Entry): string {
  return entry.color || "#8a8f98";
}

export function markerTone(marker: Marker): string {
  return marker.color || "#cccccc";
}

export function inMotion(entries: Entry[], today: Date): Entry[] {
  return entries
    .filter((entry) => phase(entry.start, entry.end, today) === "now")
    .sort((a, b) => a.end.localeCompare(b.end) || a.row - b.row || a.name.localeCompare(b.name));
}

export function activeMarkers(markers: Marker[], today: Date): Marker[] {
  return markers.filter((marker) => phase(marker.date, marker.end || marker.date, today) === "now");
}

export function nextMilestone(entry: Entry, today: Date): Milestone | null {
  const t = dayNumber(today);
  const upcoming = entry.milestones
    .filter((mark) => dayNumber(parseISO(mark.date)) >= t)
    .sort((a, b) => a.date.localeCompare(b.date));
  return upcoming[0] ?? null;
}

export function parentOf(entry: Entry, byId: Map<string, Entry>): Entry | null {
  if (!entry.parentId) return null;
  return byId.get(entry.parentId) ?? null;
}

export function linkedMark(
  entry: Entry,
  byId: Map<string, Entry>,
): { host: Entry; milestone: Milestone } | null {
  const ref = entry.parentMark;
  if (!ref) return null;
  const host = byId.get(ref.entryId);
  const milestone = host?.milestones.find((mark) => mark.id === ref.markId);
  if (!host || !milestone) return null;
  return { host, milestone };
}

export function childrenOf(entry: Entry, entries: Entry[]): Entry[] {
  return entries
    .filter(
      (item) =>
        item.id !== entry.id && (item.parentId === entry.id || item.parentMark?.entryId === entry.id),
    )
    .sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
}

export function markersDuring(entry: Entry, markers: Marker[]): Marker[] {
  const a = dayNumber(parseISO(entry.start));
  const b = dayNumber(parseISO(entry.end));
  return markers.filter((marker) => {
    const start = dayNumber(parseISO(marker.date));
    const end = dayNumber(parseISO(marker.end || marker.date));
    return start <= b && end >= a;
  });
}

export function entriesDuring(marker: Marker, entries: Entry[]): Entry[] {
  const start = dayNumber(parseISO(marker.date));
  const end = dayNumber(parseISO(marker.end || marker.date));
  return entries
    .filter((entry) => {
      const a = dayNumber(parseISO(entry.start));
      const b = dayNumber(parseISO(entry.end));
      return a <= end && b >= start;
    })
    .sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
}

export function beatsOf(entries: Entry[], markers: Marker[]): Beat[] {
  const beats: Beat[] = [];
  for (const entry of entries) {
    beats.push({ kind: "entry", date: entry.start, entry });
    for (const milestone of entry.milestones) {
      beats.push({ kind: "milestone", date: milestone.date, entry, milestone });
    }
  }
  for (const marker of markers) beats.push({ kind: "marker", date: marker.date, marker });
  const rank = { entry: 0, milestone: 1, marker: 2 } as const;
  return beats.sort((a, b) => a.date.localeCompare(b.date) || rank[a.kind] - rank[b.kind] || beatLabel(a).localeCompare(beatLabel(b)));
}

export function beatLabel(beat: Beat): string {
  if (beat.kind === "entry") return beat.entry.name;
  if (beat.kind === "milestone") return beat.milestone.name;
  return beat.marker.name;
}

export function groupByDate<T extends { date: string }>(items: T[]): { date: string; items: T[] }[] {
  const groups: { date: string; items: T[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last?.date === item.date) last.items.push(item);
    else groups.push({ date: item.date, items: [item] });
  }
  return groups;
}

export type MonthGroup = {
  key: string;
  label: string;
  entries: Entry[];
  markers: Marker[];
};

export function monthGroups(entries: Entry[], markers: Marker[]): MonthGroup[] {
  const keys = new Set<string>();
  for (const entry of entries) keys.add(entry.start.slice(0, 7));
  for (const marker of markers) keys.add(marker.date.slice(0, 7));
  return [...keys].sort().map((key) => {
    const [year, month] = key.split("-").map(Number);
    return {
      key,
      label: `${MONTHS_FULL[(month || 1) - 1]} ${year}`,
      entries: entries
        .filter((entry) => entry.start.startsWith(key))
        .sort((a, b) => a.start.localeCompare(b.start) || a.row - b.row || a.name.localeCompare(b.name)),
      markers: markers
        .filter((marker) => marker.date.startsWith(key))
        .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name)),
    };
  });
}

export type Track = { row: number; entries: Entry[] };

export function tracksOf(entries: Entry[]): Track[] {
  const rows = new Map<number, Entry[]>();
  for (const entry of entries) {
    const list = rows.get(entry.row) ?? [];
    list.push(entry);
    rows.set(entry.row, list);
  }
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([row, list]) => ({
      row,
      entries: list.sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name)),
    }));
}

export function projectSpan(entries: Entry[], markers: Marker[]): Span {
  const isos: string[] = [];
  for (const entry of entries) isos.push(entry.start, entry.end);
  for (const marker of markers) {
    isos.push(marker.date);
    if (marker.end) isos.push(marker.end);
  }
  const sorted = isos.filter(Boolean).sort();
  const min = sorted[0] ?? toISO(new Date());
  const max = sorted[sorted.length - 1] ?? min;
  const startDate = parseISO(min);
  const endDate = parseISO(max);
  const start = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const end = new Date(endDate.getFullYear(), endDate.getMonth() + 1, 0);
  const startIso = toISO(start);
  const endIso = toISO(end);
  return { start: startIso, end: endIso, days: daysBetween(start, end) + 1 };
}

export type Tick = { iso: string; label: string; pct: number };

export function monthTicks(span: Span): Tick[] {
  const ticks: Tick[] = [];
  let cursor = parseISO(span.start);
  const end = parseISO(span.end);
  while (cursor <= end) {
    const iso = toISO(cursor);
    ticks.push({
      iso,
      label: MONTHS[cursor.getMonth()],
      pct: (daysBetween(parseISO(span.start), cursor) / span.days) * 100,
    });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return ticks;
}

export function pctAt(iso: string, span: Span): number {
  return (daysBetween(parseISO(span.start), parseISO(iso)) / span.days) * 100;
}

export function pctSpan(start: string, end: string, span: Span): { left: number; width: number } {
  const left = pctAt(start, span);
  const width = (inclusiveDays(start, end) / span.days) * 100;
  return { left, width };
}

function asEntry(raw: unknown): Entry | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<Entry>;
  if (typeof item.id !== "string" || typeof item.name !== "string") return null;
  if (typeof item.start !== "string" || typeof item.end !== "string") return null;
  const milestones = Array.isArray(item.milestones)
    ? item.milestones.flatMap((mark) => {
        if (!mark || typeof mark !== "object") return [];
        const milestone = mark as Partial<Milestone>;
        if (typeof milestone.id !== "string" || typeof milestone.name !== "string" || typeof milestone.date !== "string") {
          return [];
        }
        return [
          {
            id: milestone.id,
            name: milestone.name.trim() || "Milestone",
            date: milestone.date,
            priority: typeof milestone.priority === "number" ? milestone.priority : undefined,
          },
        ];
      })
    : [];
  const parentMark = item.parentMark;
  return {
    id: item.id,
    name: item.name.trim() || "Untitled",
    start: item.start,
    end: item.end,
    row: typeof item.row === "number" && Number.isFinite(item.row) ? item.row : 0,
    parentId: typeof item.parentId === "string" ? item.parentId : undefined,
    parentMark:
      parentMark && typeof parentMark.entryId === "string" && typeof parentMark.markId === "string"
        ? { entryId: parentMark.entryId, markId: parentMark.markId }
        : undefined,
    icon: typeof item.icon === "string" ? item.icon : undefined,
    iconColor: typeof item.iconColor === "string" ? item.iconColor : undefined,
    color: typeof item.color === "string" ? item.color : undefined,
    milestones,
  };
}

function asMarker(raw: unknown): Marker | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<Marker>;
  if (typeof item.id !== "string" || typeof item.name !== "string" || typeof item.date !== "string") return null;
  return {
    id: item.id,
    name: item.name.trim() || "Marker",
    date: item.date,
    end: typeof item.end === "string" ? item.end : undefined,
    color: typeof item.color === "string" ? item.color : undefined,
  };
}

export async function listProjects(signal?: AbortSignal): Promise<{ currentId?: string; projects: ProjectRef[] }> {
  const indexRes = await fetch("/api/calendars/index.json", { cache: "no-store", signal });
  if (!indexRes.ok) throw new Error(`Projects could not be read (${indexRes.status})`);
  const index = (await indexRes.json()) as {
    currentId?: string;
    projects?: { id?: string; name?: string }[];
  };
  const projects = (index.projects ?? []).flatMap((item) => {
    if (!item || typeof item.id !== "string" || !item.id) return [];
    return [{ id: item.id, name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : "Untitled" }];
  });
  return { currentId: index.currentId, projects };
}

export async function loadRoadmap(signal?: AbortSignal, projectId?: string): Promise<Loaded> {
  const { currentId, projects } = await listProjects(signal);
  const project =
    (projectId ? projects.find((item) => item.id === projectId) : undefined) ??
    projects.find((item) => item.name === PROJECT_NAME) ??
    projects.find((item) => item.id === currentId) ??
    projects[0];
  if (!project) throw new Error("No project");

  let lastStatus = "missing";
  for (const url of [`/api/calendars/${project.id}/working`, `/api/calendars/${project.id}/saved`]) {
    const res = await fetch(url, { cache: "no-store", signal });
    if (res.status === 404) continue;
    if (!res.ok) {
      lastStatus = String(res.status);
      continue;
    }
    const data = (await res.json()) as { entries?: unknown; markers?: unknown };
    const entries = Array.isArray(data.entries) ? data.entries.flatMap((item) => {
      const entry = asEntry(item);
      return entry ? [entry] : [];
    }) : [];
    const markers = Array.isArray(data.markers) ? data.markers.flatMap((item) => {
      const marker = asMarker(item);
      return marker ? [marker] : [];
    }) : [];
    return { projectId: project.id, projectName: project.name, entries, markers };
  }
  throw new Error(`Roadmap could not be read (${lastStatus})`);
}
