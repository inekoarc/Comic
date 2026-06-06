const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { createReadStream } = require("node:fs");

const PORT = Number(process.env.PORT || 9000);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const META_FILE = path.join(DATA_DIR, "metadata.json");

const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".avif"]);
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".avif": "image/avif"
};

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await ensureDataDir();
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function getConfig() {
  return readJson(CONFIG_FILE, { libraryRoot: "" });
}

async function getMetadata() {
  return readJson(META_FILE, {});
}

function sendJson(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function normalizeRoot(root) {
  return path.resolve(String(root || "").trim());
}

function isInside(base, target) {
  const resolvedBase = path.resolve(base);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(resolvedBase + path.sep);
}

function isImage(filePath) {
  return imageExtensions.has(path.extname(filePath).toLowerCase());
}

function naturalSort(a, b) {
  return a.localeCompare(b, "zh-CN", { numeric: true, sensitivity: "base" });
}

function idFor(relativeDir) {
  return crypto.createHash("sha1").update(relativeDir).digest("hex").slice(0, 16);
}

async function collectImages(dir, root, output = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => naturalSort(a.name, b.name))) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectImages(fullPath, root, output);
    } else if (entry.isFile() && isImage(fullPath)) {
      output.push(path.relative(root, fullPath));
    }
  }
  return output;
}

async function scanLibrary(root) {
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error("Library path is not a directory");

  const entries = await fs.readdir(root, { withFileTypes: true });
  const categoryFolders = entries.filter((entry) => entry.isDirectory()).sort((a, b) => naturalSort(a.name, b.name));
  const rootImages = entries
    .filter((entry) => entry.isFile() && isImage(entry.name))
    .map((entry) => entry.name)
    .sort(naturalSort);

  const comics = [];

  if (rootImages.length) {
    comics.push(buildComic(".", "根目录漫画", rootImages, "未分类"));
  }

  for (const category of categoryFolders) {
    const categoryPath = path.join(root, category.name);
    const categoryEntries = await fs.readdir(categoryPath, { withFileTypes: true });
    const directImages = categoryEntries
      .filter((entry) => entry.isFile() && isImage(entry.name))
      .map((entry) => path.join(category.name, entry.name))
      .sort(naturalSort);
    const comicFolders = categoryEntries
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => naturalSort(a.name, b.name));

    if (directImages.length) {
      comics.push(buildComic(category.name, category.name, directImages, category.name));
    }

    for (const comicFolder of comicFolders) {
      const relativeDir = path.join(category.name, comicFolder.name);
      const images = await collectImages(path.join(root, relativeDir), root);
      if (images.length) {
        comics.push(buildComic(relativeDir, comicFolder.name, images.sort(naturalSort), category.name));
      }
    }
  }

  return comics;
}

function buildComic(relativeDir, title, images, category) {
  const id = idFor(relativeDir);
  const pages = images.map((file) => `/api/image?file=${encodeURIComponent(file)}`);
  return {
    id,
    title,
    category,
    relativeDir,
    pageCount: pages.length,
    source: `${category} · ${pages.length} 张图片`,
    cover: pages[0],
    pages
  };
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/config") {
    sendJson(res, 200, await getConfig());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/config") {
    const body = await readRequestBody(req);
    const libraryRoot = normalizeRoot(body.libraryRoot);
    const stat = await fs.stat(libraryRoot).catch(() => null);
    if (!stat?.isDirectory()) {
      sendError(res, 400, "Library folder was not found");
      return;
    }
    await writeJson(CONFIG_FILE, { libraryRoot });
    sendJson(res, 200, { libraryRoot });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/library") {
    const { libraryRoot } = await getConfig();
    if (!libraryRoot) {
      sendJson(res, 200, { libraryRoot: "", comics: [], metadata: await getMetadata() });
      return;
    }
    const comics = await scanLibrary(libraryRoot);
    sendJson(res, 200, { libraryRoot, comics, metadata: await getMetadata() });
    return;
  }

  if (req.method === "PUT" && url.pathname.startsWith("/api/comics/") && url.pathname.endsWith("/metadata")) {
    const id = decodeURIComponent(url.pathname.split("/")[3] || "");
    const body = await readRequestBody(req);
    const rating = Math.max(0, Math.min(10, Number(body.rating) || 0));
    const tags = Array.isArray(body.tags)
      ? [...new Set(body.tags.map((tag) => String(tag).trim()).filter(Boolean))]
      : [];
    const views = Math.max(0, Math.floor(Number(body.views) || 0));
    const metadata = await getMetadata();
    metadata[id] = { rating, tags, views };
    await writeJson(META_FILE, metadata);
    sendJson(res, 200, metadata[id]);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/image") {
    const { libraryRoot } = await getConfig();
    const relativeFile = url.searchParams.get("file");
    if (!libraryRoot || !relativeFile) {
      sendError(res, 400, "Missing image path");
      return;
    }

    const filePath = path.resolve(libraryRoot, relativeFile);
    if (!isInside(libraryRoot, filePath) || !isImage(filePath)) {
      sendError(res, 403, "Image path is outside the library root");
      return;
    }

    await fs.access(filePath);
    res.writeHead(200, { "content-type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
    createReadStream(filePath).pipe(res);
    return;
  }

  sendError(res, 404, "API route not found");
}

async function serveStatic(req, res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.resolve(ROOT, `.${pathname}`);
  if (!isInside(ROOT, filePath)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  res.writeHead(200, { "content-type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
  createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
    } else {
      await serveStatic(req, res, url);
    }
  } catch (error) {
    sendError(res, 500, error.message || "Server error");
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Local comic server: http://${HOST}:${PORT}`);
  });
}

module.exports = {
  scanLibrary,
  idFor,
  isInside,
  server
};
