import { seedEntries, type Entry } from "./data";

export type PersistKind = "clear" | "save" | "load";

export type StoredMarker = { id: string; name: string; date: string; end?: string; color?: string };

export type StoredView = {
  px: number;
  scrollLeft: number;
};

export type CalendarSnapshot = {
  entries: Entry[];
  markers: StoredMarker[];
  rangeFrom: number;
  rangeTo: number;
  view: StoredView | null;
};

export type ProjectInfo = {
  id: string;
  name: string;
  created: string;
};

export type ProjectIndex = {
  currentId: string;
  projects: ProjectInfo[];
};

const INDEX_LS = "plannr.projects";
const INDEX_URL = "/api/calendars/index.json";
const DEFAULT_PROJECT_ID = "calendar";
const DEFAULT_PROJECT_NAME = "Unnamed Calendar";

let currentProjectId = DEFAULT_PROJECT_ID;
const gone = new Set<string>();

function projectUid() {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function workingLs(id: string) {
  return id === "lab" ? "plannr.calendar.working" : `plannr.calendar.${id}.working`;
}

function savedLs(id: string) {
  return id === "lab" ? "plannr.calendar.saved" : `plannr.calendar.${id}.saved`;
}

function workingUrl(id: string) {
  return `/api/calendars/${id}/working`;
}

function savedUrl(id: string) {
  return `/api/calendars/${id}/saved`;
}

export function getCurrentProjectId() {
  return currentProjectId;
}

export function setCurrentProjectId(id: string) {
  currentProjectId = id;
}

function cloneSeed(): CalendarSnapshot {
  return {
    entries: structuredClone(seedEntries),
    markers: [],
    rangeFrom: 2024,
    rangeTo: 2029,
    view: null,
  };
}

export function defaultProjectYears() {
  const year = new Date().getFullYear();
  return { rangeFrom: year, rangeTo: year + 1 };
}

export function emptyCalendar(
  rangeFrom?: number,
  rangeTo?: number,
  view: StoredView | null = null,
): CalendarSnapshot {
  const years = defaultProjectYears();
  return {
    entries: [],
    markers: [],
    rangeFrom: rangeFrom ?? years.rangeFrom,
    rangeTo: rangeTo ?? years.rangeTo,
    view,
  };
}

function fallbackCalendar(id: string): CalendarSnapshot {
  return id === "lab" ? cloneSeed() : emptyCalendar();
}

function normalizeView(view: StoredView | null | undefined): StoredView | null {
  if (!view || typeof view !== "object") return null;
  if (typeof view.px !== "number" || !Number.isFinite(view.px)) return null;
  if (typeof view.scrollLeft !== "number" || !Number.isFinite(view.scrollLeft)) return null;
  return { px: view.px, scrollLeft: Math.max(0, view.scrollLeft) };
}

export function parseCalendarSnapshot(data: unknown): CalendarSnapshot | null {
  if (!data || typeof data !== "object") return null;
  return normalize(data as Partial<CalendarSnapshot>);
}

function normalize(data: Partial<CalendarSnapshot> | null): CalendarSnapshot | null {
  if (!data || typeof data !== "object") return null;
  const entries = Array.isArray(data.entries) ? data.entries : [];
  const markers = Array.isArray(data.markers) ? data.markers : [];
  const rangeFrom = typeof data.rangeFrom === "number" && Number.isInteger(data.rangeFrom) ? data.rangeFrom : 2024;
  const rangeTo = typeof data.rangeTo === "number" && Number.isInteger(data.rangeTo) ? data.rangeTo : 2029;
  return {
    entries,
    markers,
    rangeFrom,
    rangeTo,
    view: normalizeView(data.view),
  };
}

function normalizeIndex(data: Partial<ProjectIndex> | null): ProjectIndex | null {
  if (!data || !Array.isArray(data.projects) || data.projects.length === 0) return null;
  const projects: ProjectInfo[] = [];
  for (const item of data.projects) {
    if (!item || typeof item.id !== "string" || !item.id.trim()) continue;
    const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : "Untitled";
    const created = typeof item.created === "string" && item.created ? item.created : "2026-09-12";
    projects.push({ id: item.id, name, created });
  }
  if (!projects.length) return null;
  const currentId =
    typeof data.currentId === "string" && projects.some((item) => item.id === data.currentId)
      ? data.currentId
      : projects[0].id;
  return { currentId, projects };
}

function defaultProject(): ProjectInfo {
  return {
    id: DEFAULT_PROJECT_ID,
    name: DEFAULT_PROJECT_NAME,
    created: new Date().toISOString().slice(0, 10),
  };
}

function defaultIndex(): ProjectIndex {
  const project = defaultProject();
  return { currentId: project.id, projects: [project] };
}

function readLocal(key: string): CalendarSnapshot | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return normalize(JSON.parse(raw) as Partial<CalendarSnapshot>);
  } catch {
    return null;
  }
}

function writeLocal(key: string, state: CalendarSnapshot) {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Quota or private mode — server copy is the source of truth.
  }
}

function readIndexLocal(): ProjectIndex | null {
  try {
    const raw = localStorage.getItem(INDEX_LS);
    if (!raw) return null;
    return normalizeIndex(JSON.parse(raw) as Partial<ProjectIndex>);
  } catch {
    return null;
  }
}

function writeIndexLocal(index: ProjectIndex) {
  try {
    localStorage.setItem(INDEX_LS, JSON.stringify(index));
  } catch {
    /* ignore */
  }
}

function fingerprint(state: CalendarSnapshot) {
  return JSON.stringify({
    entries: state.entries,
    markers: state.markers,
    rangeFrom: state.rangeFrom,
    rangeTo: state.rangeTo,
    view: state.view,
  });
}

export function calendarFingerprint(state: CalendarSnapshot) {
  return fingerprint(state);
}

async function getRemote(url: string): Promise<CalendarSnapshot | null> {
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`persist GET ${url} (${res.status})`);
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    return normalize(JSON.parse(text) as Partial<CalendarSnapshot>);
  } catch {
    return null;
  }
}

async function putRemote(url: string, state: CalendarSnapshot) {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: `${JSON.stringify(state)}\n`,
  });
  if (!res.ok) throw new Error(`persist PUT ${url} (${res.status})`);
}

async function deleteRemote(url: string) {
  const res = await fetch(url, { method: "DELETE" });
  if (res.ok || res.status === 404) return;
  throw new Error(`persist DELETE ${url} (${res.status})`);
}

async function getIndexRemote(): Promise<ProjectIndex | null> {
  const res = await fetch(INDEX_URL, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`persist GET ${INDEX_URL} (${res.status})`);
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    return normalizeIndex(JSON.parse(text) as Partial<ProjectIndex>);
  } catch {
    return null;
  }
}

async function putIndexRemote(index: ProjectIndex) {
  const res = await fetch(INDEX_URL, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: `${JSON.stringify(index)}\n`,
  });
  if (!res.ok) throw new Error(`persist PUT ${INDEX_URL} (${res.status})`);
}

function applyIndex(index: ProjectIndex, adopt = false) {
  writeIndexLocal(index);
  if (adopt) currentProjectId = index.currentId;
  return index;
}

export function bootProjects(): ProjectIndex {
  const index = readIndexLocal() ?? defaultIndex();
  currentProjectId = index.currentId;
  return index;
}

export async function hydrateProjects(): Promise<ProjectIndex> {
  const local = readIndexLocal() ?? defaultIndex();
  try {
    const remote = await getIndexRemote();
    if (remote) return applyIndex(remote);
    await putIndexRemote(local);
    return applyIndex(local);
  } catch {
    return applyIndex(local);
  }
}

export async function persistProjects(index: ProjectIndex) {
  applyIndex(index);
  await putIndexRemote(index);
}

export function bootCalendar(): CalendarSnapshot {
  const id = currentProjectId;
  return readLocal(workingLs(id)) ?? readLocal(savedLs(id)) ?? fallbackCalendar(id);
}

export async function hydrateCalendar(): Promise<CalendarSnapshot> {
  const id = currentProjectId;
  const seed = fallbackCalendar(id);
  const seedFp = fingerprint(seed);
  let remoteWorking: CalendarSnapshot | null = null;
  let remoteSaved: CalendarSnapshot | null = null;
  try {
    remoteWorking = await getRemote(workingUrl(id));
    remoteSaved = await getRemote(savedUrl(id));
  } catch {
    const local = readLocal(workingLs(id)) ?? readLocal(savedLs(id)) ?? seed;
    return local;
  }

  const localWorking = readLocal(workingLs(id));
  const localSaved = readLocal(savedLs(id));
  const saved = remoteSaved ?? localSaved ?? seed;
  if (!remoteSaved) {
    try {
      await putRemote(savedUrl(id), saved);
    } catch {
      /* keep going — LOAD can retry */
    }
  }

  const migrateWorking =
    !!localWorking &&
    fingerprint(localWorking) !== seedFp &&
    (!remoteWorking || fingerprint(remoteWorking) === seedFp);
  const working = migrateWorking ? localWorking! : (remoteWorking ?? localWorking ?? saved);
  if (migrateWorking) {
    try {
      await putRemote(workingUrl(id), working);
    } catch {
      /* keep going — autosave can retry */
    }
  }

  writeLocal(workingLs(id), working);
  writeLocal(savedLs(id), saved);
  return working;
}

export function peekCalendar(id: string): CalendarSnapshot | null {
  return readLocal(workingLs(id)) ?? readLocal(savedLs(id));
}

export async function readProjectCalendar(id: string): Promise<CalendarSnapshot> {
  try {
    const remote = await getRemote(workingUrl(id));
    if (remote) return remote;
  } catch {
    /* fall through */
  }
  return readLocal(workingLs(id)) ?? readLocal(savedLs(id)) ?? fallbackCalendar(id);
}

export async function persistWorking(
  state: CalendarSnapshot,
  id = currentProjectId,
  baseFp?: string | null,
): Promise<"ok" | "conflict" | "skipped"> {
  if (gone.has(id)) return "skipped";
  const nextFp = fingerprint(state);
  if (baseFp) {
    try {
      const remote = await getRemote(workingUrl(id));
      if (remote) {
        const remoteFp = fingerprint(remote);
        if (remoteFp !== baseFp && remoteFp !== nextFp) return "conflict";
      }
    } catch {
      /* write anyway if we cannot read */
    }
  }
  writeLocal(workingLs(id), state);
  writeLocal(savedLs(id), state);
  await putRemote(workingUrl(id), state);
  try {
    await putRemote(savedUrl(id), state);
  } catch {
    /* working is the live project */
  }
  return "ok";
}

export async function persistSaved(state: CalendarSnapshot, id = currentProjectId) {
  writeLocal(savedLs(id), state);
  await putRemote(savedUrl(id), state);
}

export async function loadSaved(id = currentProjectId): Promise<CalendarSnapshot> {
  const remote = await getRemote(savedUrl(id));
  if (remote) {
    writeLocal(savedLs(id), remote);
    return remote;
  }
  const local = readLocal(savedLs(id)) ?? fallbackCalendar(id);
  await putRemote(savedUrl(id), local);
  return local;
}

export async function overwriteProject(id: string, snapshot: CalendarSnapshot): Promise<ProjectIndex> {
  const index = await hydrateProjects();
  const existing = index.projects.find((item) => item.id === id);
  if (!existing) return createProject("Untitled", snapshot);
  gone.delete(id);
  await persistWorking(snapshot, id);
  const next = { currentId: id, projects: index.projects };
  await persistProjects(next);
  return next;
}

export async function createProject(name: string, snapshot?: CalendarSnapshot): Promise<ProjectIndex> {
  const index = await hydrateProjects();
  const id = projectUid();
  const blank = snapshot ?? emptyCalendar();
  await putRemote(workingUrl(id), blank);
  await putRemote(savedUrl(id), blank);
  writeLocal(workingLs(id), blank);
  writeLocal(savedLs(id), blank);
  const next: ProjectIndex = {
    currentId: id,
    projects: [...index.projects, { id, name: name.trim() || "Untitled", created: new Date().toISOString().slice(0, 10) }],
  };
  await persistProjects(next);
  return next;
}

export async function deleteProject(id: string): Promise<ProjectIndex> {
  const index = await hydrateProjects();
  if (index.projects.length <= 1) return index;
  gone.add(id);
  try {
    await deleteRemote(workingUrl(id));
  } catch {
    /* index is source of truth */
  }
  try {
    await deleteRemote(savedUrl(id));
  } catch {
    /* index is source of truth */
  }
  try {
    localStorage.removeItem(workingLs(id));
    localStorage.removeItem(savedLs(id));
  } catch {
    /* ignore */
  }
  const projects = index.projects.filter((item) => item.id !== id);
  const currentId = index.currentId === id ? projects[0].id : index.currentId;
  const next = { currentId, projects };
  await persistProjects(next);
  return next;
}

export async function renameProject(id: string, name: string): Promise<ProjectIndex> {
  const index = await hydrateProjects();
  const trimmed = name.trim() || "Untitled";
  const next: ProjectIndex = {
    ...index,
    projects: index.projects.map((item) => (item.id === id ? { ...item, name: trimmed } : item)),
  };
  await persistProjects(next);
  return next;
}

export async function selectProject(id: string): Promise<ProjectIndex> {
  const index = await hydrateProjects();
  if (!index.projects.some((item) => item.id === id)) return index;
  const next = { ...index, currentId: id };
  await persistProjects(next);
  return next;
}
