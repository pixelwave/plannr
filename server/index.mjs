import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearThemeUser,
  deleteDocument,
  ensureThemeDefault,
  getDocument,
  getIndex,
  getTheme,
  importFileStore,
  openDatabase,
  PROJECT_ID,
  putDocument,
  putIndex,
  putThemeUser,
  schemaVersion,
  seedThemeFile,
} from "./db.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = process.env.PLANNR_DATA || path.join(ROOT, "data");
const DB_FILE = path.join(DATA, "plannr.sqlite");
const STATIC_ROOT = process.env.PLANNR_STATIC || "";
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const MAX_BODY = 8 * 1024 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

const db = openDatabase(DB_FILE);
if (process.env.PLANNR_IMPORT_DIR) {
  const imported = importFileStore(db, process.env.PLANNR_IMPORT_DIR);
  if (imported) console.log(`Imported ${imported} projects from ${process.env.PLANNR_IMPORT_DIR}`);
}
if (seedThemeFile(db, "desktop", process.env.PLANNR_THEME_DESKTOP || "")) {
  console.log("Seeded desktop theme defaults");
}
if (seedThemeFile(db, "mobile", process.env.PLANNR_THEME_MOBILE || "")) {
  console.log("Seeded mobile theme defaults");
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("Body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function calendarRoute(pathname) {
  const match = pathname.match(/^\/api\/calendars\/([^/]+)\/(working|saved)$/);
  if (!match) return null;
  return { id: decodeURIComponent(match[1]), kind: match[2] };
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    send(res, 200, `${JSON.stringify({ ok: true, schema: schemaVersion(db) })}\n`);
    return;
  }

  const themeMatch = url.pathname.match(/^\/api\/theme\/(desktop|mobile)(\/default)?$/);
  if (themeMatch) {
    const scope = themeMatch[1];
    const isDefault = Boolean(themeMatch[2]);
    if (req.method === "GET" && !isDefault) {
      send(res, 200, `${JSON.stringify(getTheme(db, scope))}\n`);
      return;
    }
    if (req.method === "PUT" && !isDefault) {
      try {
        putThemeUser(db, scope, JSON.parse(await readBody(req)));
        send(res, 204, "");
      } catch (error) {
        send(res, error.status || 400, `${JSON.stringify({ error: error.message })}\n`);
      }
      return;
    }
    if (req.method === "PUT" && isDefault) {
      try {
        const stored = ensureThemeDefault(db, scope, JSON.parse(await readBody(req)));
        send(res, 200, `${JSON.stringify(stored)}\n`);
      } catch (error) {
        send(res, error.status || 400, `${JSON.stringify({ error: error.message })}\n`);
      }
      return;
    }
    if (req.method === "DELETE" && !isDefault) {
      clearThemeUser(db, scope);
      send(res, 204, "");
      return;
    }
    send(res, 405, "");
    return;
  }

  if (url.pathname === "/api/calendars/index.json") {
    if (req.method === "GET") {
      const index = getIndex(db);
      if (!index) {
        send(res, 404, "");
        return;
      }
      send(res, 200, `${JSON.stringify(index)}\n`);
      return;
    }
    if (req.method === "PUT") {
      try {
        const index = putIndex(db, JSON.parse(await readBody(req)));
        send(res, 200, `${JSON.stringify(index)}\n`);
      } catch (error) {
        send(res, error.status || 400, `${JSON.stringify({ error: error.message })}\n`);
      }
      return;
    }
    send(res, 405, "");
    return;
  }

  const route = calendarRoute(url.pathname);
  if (!route || !PROJECT_ID.test(route.id)) {
    if (url.pathname.startsWith("/api/calendars/")) {
      send(res, 404, "");
      return;
    }
    return false;
  }

  if (req.method === "GET") {
    const body = getDocument(db, route.id, route.kind);
    if (body == null) {
      send(res, 404, "");
      return;
    }
    send(res, 200, body.endsWith("\n") ? body : `${body}\n`);
    return;
  }
  if (req.method === "PUT") {
    try {
      putDocument(db, route.id, route.kind, await readBody(req));
      send(res, 204, "");
    } catch (error) {
      send(res, error.status || 400, `${JSON.stringify({ error: error.message })}\n`);
    }
    return;
  }
  if (req.method === "DELETE") {
    deleteDocument(db, route.id, route.kind);
    send(res, 204, "");
    return;
  }
  send(res, 405, "");
  return;
}

const MOBILE_UA = /iPhone|iPod|iPad|Android|Mobile|Mobi|webOS|BlackBerry|IEMobile|Opera Mini|Silk|Kindle|Tablet/i;
const TOUCH_PROBE = `<script>(function(){try{if(/(?:^|; )plannr-ui=/.test(document.cookie))return;if(navigator.maxTouchPoints>0&&window.matchMedia("(pointer: coarse)").matches){document.cookie="plannr-ui=mobile; Path=/; Max-Age=31536000; SameSite=Lax";location.reload()}}catch(e){}})()</script>`;

function prefersMobile(req) {
  const cookie = req.headers.cookie || "";
  if (/(?:^|; )plannr-ui=desktop(?:;|$)/.test(cookie)) return false;
  if (/(?:^|; )plannr-ui=mobile(?:;|$)/.test(cookie)) return true;
  const hint = String(req.headers["sec-ch-ua-mobile"] || "").trim();
  if (hint === "?1") return true;
  return MOBILE_UA.test(req.headers["user-agent"] || "");
}

function htmlHeaders() {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-cache",
    Vary: "User-Agent, Cookie, Sec-CH-UA-Mobile",
    "Accept-CH": "Sec-CH-UA-Mobile",
  };
}

function serveAppHtml(res, file, mobile) {
  let html = fs.readFileSync(file, "utf8");
  if (mobile) {
    if (!html.includes("<base ")) html = html.replace("<head>", '<head>\n    <base href="/mobile/">');
  } else if (!html.includes("plannr-ui=")) {
    html = html.replace("<head>", `<head>\n    ${TOUCH_PROBE}`);
  }
  res.writeHead(200, htmlHeaders());
  res.end(html);
}

function serveStatic(req, res, url) {
  if (!STATIC_ROOT) return false;
  if (url.pathname === "/app" || url.pathname === "/app/") {
    res.writeHead(302, {
      Location: "/",
      "Set-Cookie": "plannr-ui=desktop; Path=/; Max-Age=31536000; SameSite=Lax",
    });
    res.end();
    return true;
  }
  if (url.pathname === "/mobile") {
    res.writeHead(302, { Location: "/mobile/" });
    res.end();
    return true;
  }
  const root = path.resolve(STATIC_ROOT);
  if (url.pathname === "/" || url.pathname === "/index.html") {
    const mobile = prefersMobile(req);
    const indexPath = path.resolve(root, mobile ? "mobile/index.html" : "index.html");
    const fallback = path.resolve(root, "index.html");
    const file = fs.existsSync(indexPath) ? indexPath : fallback;
    if (file.startsWith(`${root}${path.sep}`) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      serveAppHtml(res, file, mobile && file.endsWith(`${path.sep}mobile${path.sep}index.html`));
      return true;
    }
  }
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    send(res, 400, "");
    return true;
  }
  if (rel === "/") rel = "index.html";
  else rel = rel.replace(/^\/+/, "");
  if (!rel || rel.endsWith("/")) rel += "index.html";
  const file = path.resolve(root, rel);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
    send(res, 403, "");
    return true;
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    send(res, 404, "");
    return true;
  }
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": path.extname(file) === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
  });
  fs.createReadStream(file).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    const handled = await handleApi(req, res, url);
    if (handled !== false) return;
    if (serveStatic(req, res, url)) return;
    send(res, 404, "");
  } catch (error) {
    if (!res.headersSent) send(res, error.status || 500, `${JSON.stringify({ error: "Server error" })}\n`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`PLANNR data http://${HOST}:${PORT}  db ${DB_FILE}`);
});
