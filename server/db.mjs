import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created TEXT NOT NULL,
        position INTEGER NOT NULL
      );
      CREATE TABLE documents (
        project_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('working', 'saved')),
        body TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, kind),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE TABLE meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE theme_profiles (
        scope TEXT NOT NULL CHECK (scope IN ('desktop', 'mobile')),
        name TEXT NOT NULL CHECK (name IN ('default', 'user')),
        body TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope, name)
      );
    `,
  },
];

export const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;

export function openDatabase(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  const current = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get()?.v ?? 0;
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        migration.version,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

export function schemaVersion(db) {
  return db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get()?.v ?? 0;
}

export function projectCount(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM projects").get().n;
}

function cleanProject(item, index) {
  if (!item || typeof item !== "object") return null;
  const id = typeof item.id === "string" ? item.id.trim() : "";
  if (!PROJECT_ID.test(id)) return null;
  const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : "Untitled";
  const created = typeof item.created === "string" && item.created ? item.created : "2026-09-12";
  return { id, name, created, position: index };
}

export function parseIndex(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.projects)) return null;
  const projects = [];
  const seen = new Set();
  for (const item of data.projects) {
    const project = cleanProject(item, projects.length);
    if (!project || seen.has(project.id)) continue;
    seen.add(project.id);
    projects.push(project);
  }
  if (!projects.length) return null;
  const requested = typeof data.currentId === "string" ? data.currentId : "";
  const currentId = projects.some((item) => item.id === requested) ? requested : projects[0].id;
  return { currentId, projects };
}

export function getIndex(db) {
  const projects = db
    .prepare("SELECT id, name, created FROM projects ORDER BY position, id")
    .all();
  if (!projects.length) return null;
  const current = db.prepare("SELECT value FROM meta WHERE key = 'current_id'").get();
  const currentId = projects.some((item) => item.id === current?.value) ? current.value : projects[0].id;
  return { currentId, projects };
}

function writeIndex(db, parsed) {
  const upsert = db.prepare(`
    INSERT INTO projects (id, name, created, position)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      created = excluded.created,
      position = excluded.position
  `);
  const remove = db.prepare(`DELETE FROM projects WHERE id NOT IN (${parsed.projects.map(() => "?").join(", ")})`);
  const current = db.prepare(`
    INSERT INTO meta (key, value) VALUES ('current_id', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  remove.run(...parsed.projects.map((item) => item.id));
  for (const project of parsed.projects) upsert.run(project.id, project.name, project.created, project.position);
  current.run(parsed.currentId);
}

export function putIndex(db, index) {
  const parsed = parseIndex(index);
  if (!parsed) throw new Error("Invalid project index");
  withTransaction(db, () => writeIndex(db, parsed));
  return parsed;
}

function ensureProject(db, id) {
  db.prepare(`
    INSERT INTO projects (id, name, created, position)
    VALUES (?, 'Untitled', ?, COALESCE((SELECT MAX(position) + 1 FROM projects), 0))
    ON CONFLICT(id) DO NOTHING
  `).run(id, new Date().toISOString().slice(0, 10));
}

export function getDocument(db, id, kind) {
  if (!PROJECT_ID.test(id) || (kind !== "working" && kind !== "saved")) return null;
  const row = db.prepare("SELECT body FROM documents WHERE project_id = ? AND kind = ?").get(id, kind);
  return row?.body ?? null;
}

function calendarBody(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) throw new Error("Empty calendar");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Calendar is not JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Calendar must be an object");
  return `${text}\n`;
}

function writeDocument(db, id, kind, body) {
  ensureProject(db, id);
  db.prepare(`
    INSERT INTO documents (project_id, kind, body, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(project_id, kind) DO UPDATE SET
      body = excluded.body,
      updated_at = excluded.updated_at
  `).run(id, kind, body, new Date().toISOString());
}

export function putDocument(db, id, kind, raw) {
  if (!PROJECT_ID.test(id) || (kind !== "working" && kind !== "saved")) throw new Error("Invalid calendar path");
  const body = calendarBody(raw);
  withTransaction(db, () => writeDocument(db, id, kind, body));
}

export function deleteDocument(db, id, kind) {
  if (!PROJECT_ID.test(id) || (kind !== "working" && kind !== "saved")) return false;
  const result = db.prepare("DELETE FROM documents WHERE project_id = ? AND kind = ?").run(id, kind);
  return result.changes > 0;
}

function withTransaction(db, fn) {
  db.exec("BEGIN");
  try {
    fn();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

const THEME_SCOPE = new Set(["desktop", "mobile"]);

function themeJson(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Theme settings must be an object");
  return `${JSON.stringify(raw)}\n`;
}

export function getTheme(db, scope) {
  if (!THEME_SCOPE.has(scope)) return null;
  const rows = db.prepare("SELECT name, body FROM theme_profiles WHERE scope = ?").all(scope);
  const theme = { default: null, user: null };
  for (const row of rows) {
    if (row.name !== "default" && row.name !== "user") continue;
    try {
      theme[row.name] = JSON.parse(row.body);
    } catch {
      theme[row.name] = null;
    }
  }
  return theme;
}

export function putThemeUser(db, scope, raw) {
  if (!THEME_SCOPE.has(scope)) throw new Error("Invalid theme");
  const body = themeJson(raw);
  db.prepare(`
    INSERT INTO theme_profiles (scope, name, body, updated_at)
    VALUES (?, 'user', ?, ?)
    ON CONFLICT(scope, name) DO UPDATE SET
      body = excluded.body,
      updated_at = excluded.updated_at
  `).run(scope, body, new Date().toISOString());
}

export function ensureThemeDefault(db, scope, raw) {
  if (!THEME_SCOPE.has(scope)) throw new Error("Invalid theme");
  const existing = db.prepare("SELECT body FROM theme_profiles WHERE scope = ? AND name = 'default'").get(scope);
  if (existing) {
    try {
      return JSON.parse(existing.body);
    } catch {
      return null;
    }
  }
  const body = themeJson(raw);
  db.prepare(`
    INSERT INTO theme_profiles (scope, name, body, updated_at)
    VALUES (?, 'default', ?, ?)
  `).run(scope, body, new Date().toISOString());
  return JSON.parse(body);
}

export function clearThemeUser(db, scope) {
  if (!THEME_SCOPE.has(scope)) return false;
  const result = db.prepare("DELETE FROM theme_profiles WHERE scope = ? AND name = 'user'").run(scope);
  return result.changes > 0;
}

export function seedThemeFile(db, scope, file) {
  if (!file || !fs.existsSync(file)) return false;
  const existing = db.prepare("SELECT 1 AS ok FROM theme_profiles WHERE scope = ? AND name = 'default'").get(scope);
  if (existing) return false;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  ensureThemeDefault(db, scope, parsed);
  return true;
}

export function importFileStore(db, dir) {
  if (projectCount(db) > 0) return 0;
  const indexPath = path.join(dir, "index.json");
  if (!fs.existsSync(indexPath)) return 0;
  const index = parseIndex(JSON.parse(fs.readFileSync(indexPath, "utf8")));
  if (!index) return 0;
  withTransaction(db, () => {
    writeIndex(db, index);
    for (const project of index.projects) {
      for (const kind of ["working", "saved"]) {
        const file = path.join(dir, project.id, kind);
        if (!fs.existsSync(file)) continue;
        const raw = fs.readFileSync(file, "utf8");
        if (!raw.trim()) continue;
        writeDocument(db, project.id, kind, calendarBody(raw));
      }
    }
  });
  return index.projects.length;
}
