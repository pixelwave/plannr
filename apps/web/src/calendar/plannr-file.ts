import { emptyCalendar, parseCalendarSnapshot, type CalendarSnapshot } from "./persist";

/** Versioned JSON envelope. Extension `.plannr`. v1 is one project; v2 is a list. Both stay readable. */
export const PLANNR_FORMAT = "plannr";
export const PLANNR_VERSION = 1;
export const PLANNR_BUNDLE_VERSION = 2;
export const PLANNR_EXT = ".plannr";
export const PLANNR_MIME = "application/vnd.plannr.project+json";

export type PlannrPack = {
  name: string;
  created?: string;
  calendar: CalendarSnapshot;
};

export type PlannrDocument = {
  format: typeof PLANNR_FORMAT;
  version: number;
  exportedAt: string;
  packs: PlannrPack[];
};

export class PlannrFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlannrFileError";
  }
}

export function isPlannrFilename(name: string) {
  return name.trim().toLowerCase().endsWith(PLANNR_EXT);
}

export function plannrFilename(name: string) {
  const slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project";
  return `${slug}${PLANNR_EXT}`;
}

export function plannrBundleFilename(names: string[], total: number) {
  if (names.length <= 1) return plannrFilename(names[0] ?? "project");
  if (names.length === total) return `all-projects${PLANNR_EXT}`;
  return `${names.length}-projects${PLANNR_EXT}`;
}

export function uniqueProjectName(name: string, taken: string[]) {
  const base = name.trim() || "Untitled";
  const lower = new Set(taken.map((item) => item.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  let n = 2;
  while (lower.has(`${base} ${n}`.toLowerCase())) n += 1;
  return `${base} ${n}`;
}

function packFromUnknown(raw: unknown): PlannrPack | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Untitled";
  const created = typeof data.created === "string" && data.created ? data.created : undefined;
  const calendar = parseCalendarSnapshot(data.calendar);
  if (!calendar) return null;
  return { name, created, calendar };
}

function plainCalendar(calendar: CalendarSnapshot): CalendarSnapshot {
  try {
    return parseCalendarSnapshot(JSON.parse(JSON.stringify(calendar))) ?? emptyCalendar();
  } catch {
    return parseCalendarSnapshot(calendar) ?? emptyCalendar();
  }
}

export function encodePlannrFile(packs: PlannrPack[]): string {
  const clean: PlannrPack[] = packs.map((pack) => ({
    name: pack.name.trim() || "Untitled",
    created: pack.created,
    calendar: plainCalendar(pack.calendar),
  }));
  if (!clean.length) {
    clean.push({ name: "Untitled", calendar: emptyCalendar() });
  }
  const exportedAt = new Date().toISOString();
  if (clean.length === 1) {
    const pack = clean[0];
    return `${JSON.stringify(
      {
        format: PLANNR_FORMAT,
        version: PLANNR_VERSION,
        exportedAt,
        project: { name: pack.name, created: pack.created },
        calendar: pack.calendar,
      },
      null,
      2,
    )}\n`;
  }
  return `${JSON.stringify(
    {
      format: PLANNR_FORMAT,
      version: PLANNR_BUNDLE_VERSION,
      exportedAt,
      projects: clean,
    },
    null,
    2,
  )}\n`;
}

export function decodePlannrFile(text: string): PlannrDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PlannrFileError("Not a valid PLANNR file.");
  }
  if (!raw || typeof raw !== "object") throw new PlannrFileError("Not a valid PLANNR file.");
  const data = raw as Record<string, unknown>;
  if (data.format !== PLANNR_FORMAT) throw new PlannrFileError("Not a PLANNR project file.");
  if (typeof data.version !== "number" || !Number.isInteger(data.version) || data.version < 1) {
    throw new PlannrFileError("Unsupported PLANNR file version.");
  }
  const exportedAt = typeof data.exportedAt === "string" ? data.exportedAt : new Date().toISOString();
  if (Array.isArray(data.projects) && data.projects.length) {
    const packs = data.projects.map(packFromUnknown).filter((item): item is PlannrPack => Boolean(item));
    if (!packs.length) throw new PlannrFileError("PLANNR file is missing a calendar.");
    return { format: PLANNR_FORMAT, version: data.version, exportedAt, packs };
  }
  const projectRaw = data.project && typeof data.project === "object" ? (data.project as Record<string, unknown>) : {};
  const name = typeof projectRaw.name === "string" && projectRaw.name.trim() ? projectRaw.name.trim() : "Untitled";
  const created = typeof projectRaw.created === "string" && projectRaw.created ? projectRaw.created : undefined;
  const calendar = parseCalendarSnapshot(data.calendar);
  if (!calendar) throw new PlannrFileError("PLANNR file is missing a calendar.");
  return {
    format: PLANNR_FORMAT,
    version: data.version,
    exportedAt,
    packs: [{ name, created, calendar }],
  };
}

export function downloadPlannrFile(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
