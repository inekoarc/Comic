const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { createReadStream } = require("node:fs");
const { execFile } = require("node:child_process");

const PORT = Number(process.env.PORT || 9000);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const META_FILE = path.join(DATA_DIR, "metadata.json");
const INDEX_FILE = path.join(DATA_DIR, "library-index.json");
const THUMB_DIR = path.join(DATA_DIR, "thumbs");
const INDEX_VERSION = 4;

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

let indexCache = null;
let scanPromise = null;
let knownScanDirectories = new Set();
let scanProgress = {
  active: false,
  phase: "idle",
  percent: 0,
  processedDirectories: 0,
  totalDirectories: 0,
  comicsFound: 0,
  current: ""
};

function updateScanProgress(patch) {
  scanProgress = { ...scanProgress, ...patch };
}

function publicScanProgress() {
  const progress = { ...scanProgress };
  const details = {
    scanning: `目录 ${progress.processedDirectories} / ${progress.totalDirectories} · 已发现 ${progress.comicsFound} 本漫画${progress.current ? ` · ${progress.current}` : ""}`,
    metadata: `正在整理 ${progress.comicsFound} 本漫画的标签和简介`,
    saving: "正在保存漫画索引...",
    complete: `共发现 ${progress.comicsFound} 本漫画`
  };
  const labels = {
    scanning: "扫描漫画文件",
    metadata: "整理漫画信息",
    saving: "保存同步结果",
    complete: "同步完成"
  };
  return {
    ...progress,
    label: labels[progress.phase] || "准备同步",
    detail: details[progress.phase] || "正在准备漫画目录...",
    status: progress.phase === "scanning"
      ? `正在同步：${progress.processedDirectories} / ${progress.totalDirectories} 个目录`
      : labels[progress.phase] || "正在同步本地漫画目录..."
  };
}

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

function normalizeRoot(root) {
  return path.resolve(String(root || "").trim());
}

function normalizeRoots(value) {
  const roots = Array.isArray(value) ? value : [value].filter(Boolean);
  return [...new Set(roots.map(normalizeRoot).filter(Boolean))];
}

async function getConfig() {
  const config = await readJson(CONFIG_FILE, { libraryRoots: [] });
  const libraryRoots = normalizeRoots(config.libraryRoots?.length ? config.libraryRoots : config.libraryRoot);
  const categoryCovers = config.categoryCovers && typeof config.categoryCovers === "object"
    ? Object.fromEntries(Object.entries(config.categoryCovers)
      .map(([category, comicId]) => [String(category).trim(), String(comicId).trim()])
      .filter(([category, comicId]) => category && comicId))
    : {};
  return { libraryRoots, libraryRoot: libraryRoots[0] || "", categoryCovers };
}

async function saveConfig(libraryRoots, categoryCovers) {
  const current = await getConfig();
  await writeJson(CONFIG_FILE, {
    libraryRoots,
    libraryRoot: libraryRoots[0] || "",
    categoryCovers: categoryCovers ?? current.categoryCovers
  });
}

async function getMetadata() {
  return readJson(META_FILE, {});
}

function normalizedTagKey(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase();
}

function mergeMissingTags(currentTags, requiredTags) {
  const result = Array.isArray(currentTags)
    ? currentTags.map((tag) => String(tag).trim()).filter(Boolean)
    : [];
  const known = new Set(result.map(normalizedTagKey));
  for (const value of requiredTags || []) {
    const tag = String(value || "").trim();
    const key = normalizedTagKey(tag);
    if (!tag || !key || known.has(key)) continue;
    result.push(tag);
    known.add(key);
  }
  return result;
}

const nonAuthorTitlePrefixes = new Set([
  "ai", "ai generated", "al generated", "同人cg集", "同人cg", "cg集", "漫画", "漫畫",
  "patreon", "pixiv", "fanbox", "fantia"
].map(normalizedTagKey));

function usableAuthorTag(value) {
  const tag = String(value || "").trim();
  if (!tag || nonAuthorTitlePrefixes.has(normalizedTagKey(tag))) return "";
  if (/(?:汉化|漢化|翻译|翻譯|翻訳|掃圖|扫图|嵌字|重嵌|机翻|機翻)(?:组|組|社|團|团)?$/u.test(tag)) return "";
  return tag;
}

function titleAuthorTags(title) {
  let remainder = String(title || "").trim();
  for (let index = 0; index < 6 && remainder; index += 1) {
    const authorAlias = remainder.match(
      /^[\[\u3010]\s*([^\[\]\u3010\u3011()\uFF08\uFF09]+?)\s*[\(\uFF08]\s*([^()\uFF08\uFF09]+?)\s*[\)\uFF09]\s*[\]\u3011]\s*/u
    );
    if (authorAlias) {
      const tags = mergeMissingTags([], [usableAuthorTag(authorAlias[1]), usableAuthorTag(authorAlias[2])]);
      if (tags.length) return tags;
      remainder = remainder.slice(authorAlias[0].length).trim();
      continue;
    }

    const prefix = remainder.match(
      /^(?:[\[\u3010]\s*([^\[\]\u3010\u3011]+?)\s*[\]\u3011]|[\(\uFF08]\s*([^()\uFF08\uFF09]+?)\s*[\)\uFF09])\s*/u
    );
    if (!prefix) return [];
    const author = usableAuthorTag(prefix[1] || prefix[2]);
    if (author) return [author];
    remainder = remainder.slice(prefix[0].length).trim();
  }
  return [];
}

function decodeHtmlEntities(value) {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " "
  };
  return String(value).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function introDescriptionFromHtml(intro) {
  if (typeof intro !== "string" || !intro.trim()) return "";
  const plainText = decodeHtmlEntities(intro
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, ""))
    .replace(/\r\n?/g, "\n");
  const marker = plainText.match(/(?:簡介|简介)\s*[：:]\s*/u);
  if (!marker) return "";
  return plainText
    .slice((marker.index || 0) + marker[0].length)
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function readComicMetadata(dir, entries = []) {
  const metadataEntry = entries.find((entry) => entry.isFile() && entry.name.toLowerCase() === "元数据.json");
  if (!metadataEntry) return { tags: [], description: "" };
  try {
    const text = (await fs.readFile(path.join(dir, metadataEntry.name), "utf8")).replace(/^\uFEFF/, "");
    const value = JSON.parse(text);
    const tags = Array.isArray(value?.tags) ? [...new Set(value.tags
      .map((tag) => typeof tag?.name === "string" ? tag.name.trim() : "")
      .filter(Boolean))] : [];
    return { tags, description: introDescriptionFromHtml(value?.intro) };
  } catch (error) {
    console.warn(`Failed to read comic metadata: ${path.join(dir, metadataEntry.name)} (${error.message})`);
    return { tags: [], description: "" };
  }
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

function idFor(value) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 16);
}

function rootIdFor(root) {
  return idFor(path.resolve(root).toLowerCase());
}

function pageUrl(rootId, file) {
  return `/api/image?root=${encodeURIComponent(rootId)}&file=${encodeURIComponent(file)}`;
}

function thumbUrl(rootId, file, width = 360) {
  return `/api/thumb?root=${encodeURIComponent(rootId)}&file=${encodeURIComponent(file)}&w=${width}`;
}

function thumbUrlFromImageUrl(imageUrl, width = 360) {
  try {
    const url = new URL(imageUrl, "http://local");
    if (url.pathname !== "/api/image") return imageUrl;
    url.pathname = "/api/thumb";
    url.searchParams.set("w", String(width));
    return `${url.pathname}${url.search}`;
  } catch {
    return imageUrl;
  }
}

function publicComic(comic) {
  const dirMtimeMs = Number(comic.dirMtimeMs) || 0;
  return {
    id: comic.id,
    title: comic.title,
    category: comic.category,
    relativeDir: comic.relativeDir,
    pageCount: comic.pageCount,
    source: comic.source,
    cover: comic.cover,
    coverThumb: comic.coverThumb || thumbUrlFromImageUrl(comic.cover),
    updatedAt: comic.updatedAt || (dirMtimeMs ? new Date(dirMtimeMs).toISOString() : ""),
    addedAt: comic.addedAt || comic.updatedAt || (dirMtimeMs ? new Date(dirMtimeMs).toISOString() : ""),
    rootId: comic.rootId,
    rootName: comic.rootName,
    rootPath: comic.rootPath
  };
}

function selectDirectory(initialDir = "") {
  if (process.platform !== "win32") {
    throw new Error("Directory picker is only available on Windows in this local build");
  }

  const script = [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "$OutputEncoding = [System.Text.Encoding]::UTF8",
    "$initial = $env:COMIC_INITIAL_DIR",
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = '选择漫画根目录'",
    "$dialog.ShowNewFolderButton = $true",
    "if ($initial -and [System.IO.Directory]::Exists($initial)) { $dialog.SelectedPath = $initial }",
    "$result = $dialog.ShowDialog()",
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }"
  ].join("; ");

  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-STA", "-Command", script],
      {
        windowsHide: false,
        timeout: 600000,
        env: { ...process.env, COMIC_INITIAL_DIR: initialDir }
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}

function categoryForRelativeDir(relativeDir) {
  if (relativeDir === ".") return "未分类";
  const parts = relativeDir.split(/[\\/]+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] || "未分类";
  return parts.slice(0, -1).join(" / ");
}

function titleForRelativeDir(relativeDir) {
  if (relativeDir === ".") return "根目录漫画";
  const parts = relativeDir.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) || relativeDir;
}

function buildComic({ root, rootId, rootName, relativeDir, title, images, category, dirMtimeMs, initialTags = [], initialDescription = "" }) {
  const id = idFor(`${rootId}:${relativeDir}`);
  const pages = images.map((file) => pageUrl(rootId, file));
  const coverThumb = images[0] ? thumbUrl(rootId, images[0]) : pages[0];
  return {
    id,
    title,
    category,
    relativeDir,
    pageCount: pages.length,
    source: `${category} · ${pages.length}P`,
    cover: pages[0],
    coverThumb,
    pages,
    initialTags,
    initialDescription,
    dirMtimeMs,
    updatedAt: dirMtimeMs ? new Date(dirMtimeMs).toISOString() : "",
    addedAt: new Date().toISOString(),
    rootId,
    rootName,
    rootPath: root
  };
}

async function buildOrReuseComic({ root, rootId, rootName, relativeDir, title, category, dirPath, directImages, initialTags, initialDescription, previousByKey }) {
  const stat = await fs.stat(dirPath);
  const cacheKey = `${rootId}:${relativeDir}`;
  const previous = previousByKey.get(cacheKey);
  if (previous && Number(previous.dirMtimeMs) === Number(stat.mtimeMs) && previous.pages?.length) {
    return {
      ...previous,
      addedAt: previous.addedAt || previous.updatedAt || new Date().toISOString(),
      initialTags,
      initialDescription
    };
  }

  const images = directImages || [];
  if (!images.length) return null;
  return buildComic({
    root,
    rootId,
    rootName,
    relativeDir,
    title,
    images: images.sort(naturalSort),
    category,
    dirMtimeMs: stat.mtimeMs,
    initialTags,
    initialDescription
  });
}

async function scanComicDirectories(root, rootId, rootName, dir, previousByKey, comics, comicOffset = 0) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const fileMetadata = await readComicMetadata(dir, entries);
  const directImages = entries
    .filter((entry) => entry.isFile() && isImage(entry.name))
    .map((entry) => path.relative(root, path.join(dir, entry.name)))
    .sort(naturalSort);
  const relativeDir = path.relative(root, dir) || ".";

  if (directImages.length) {
    const comic = await buildOrReuseComic({
      root,
      rootId,
      rootName,
      relativeDir,
      title: titleForRelativeDir(relativeDir),
      category: categoryForRelativeDir(relativeDir),
      dirPath: dir,
      directImages,
      initialTags: fileMetadata.tags,
      initialDescription: fileMetadata.description,
      previousByKey
    });
    if (comic) comics.push(comic);
  }

  const folders = entries
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => naturalSort(a.name, b.name));

  for (const folder of folders) {
    knownScanDirectories.add(`${rootId}:${path.relative(root, path.join(dir, folder.name)) || "."}`);
  }
  const processedDirectories = scanProgress.processedDirectories + 1;
  const totalDirectories = Math.max(1, knownScanDirectories.size);
  updateScanProgress({
    phase: "scanning",
    processedDirectories,
    totalDirectories,
    comicsFound: comicOffset + comics.length,
    current: path.relative(root, dir) || path.basename(root),
    percent: Math.min(90, 10 + Math.round((processedDirectories / totalDirectories) * 80))
  });

  for (const folder of folders) {
    await scanComicDirectories(root, rootId, rootName, path.join(dir, folder.name), previousByKey, comics, comicOffset);
  }
}

async function scanLibrary(root, previousIndex = null, comicOffset = 0) {
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error("Library path is not a directory");

  const rootId = rootIdFor(root);
  const rootName = path.basename(root) || root;
  const previousByKey = new Map(
    (previousIndex?.comics || [])
      .filter((comic) => comic.rootId === rootId)
      .map((comic) => [`${comic.rootId}:${comic.relativeDir}`, comic])
  );
  const comics = [];
  await scanComicDirectories(root, rootId, rootName, root, previousByKey, comics, comicOffset);
  return {
    version: INDEX_VERSION,
    libraryRoot: root,
    libraryRoots: [root],
    scannedAt: new Date().toISOString(),
    comics
  };
}

async function scanLibraries(libraryRoots, previousIndex = null) {
  knownScanDirectories = new Set();
  for (const root of libraryRoots) knownScanDirectories.add(`${rootIdFor(root)}:.`);
  for (const comic of previousIndex?.comics || []) {
    const parts = String(comic.relativeDir || "").split(/[\\/]+/).filter(Boolean);
    let relative = "";
    for (const part of parts) {
      relative = relative ? path.join(relative, part) : part;
      knownScanDirectories.add(`${comic.rootId}:${relative}`);
    }
  }
  updateScanProgress({
    active: true,
    phase: "scanning",
    percent: 2,
    processedDirectories: 0,
    totalDirectories: Math.max(1, knownScanDirectories.size),
    comicsFound: 0,
    current: ""
  });
  const comics = [];
  for (const root of libraryRoots) {
    const result = await scanLibrary(root, previousIndex, comics.length);
    comics.push(...result.comics);
  }
  return {
    version: INDEX_VERSION,
    libraryRoot: libraryRoots[0] || "",
    libraryRoots,
    scannedAt: new Date().toISOString(),
    comics
  };
}

async function loadIndex() {
  if (indexCache) return indexCache;
  const index = await readJson(INDEX_FILE, null);
  if (index?.version === INDEX_VERSION && Array.isArray(index.comics)) {
    indexCache = index;
    return indexCache;
  }
  return null;
}

async function saveIndex(index) {
  indexCache = index;
  await writeJson(INDEX_FILE, index);
}

async function initializeMetadataFromFiles(comics) {
  const metadata = await getMetadata();
  let changed = false;

  for (const comic of comics) {
    const initialTags = Array.isArray(comic.initialTags) ? comic.initialTags : [];
    const authorTags = titleAuthorTags(comic.title);
    const initialDescription = typeof comic.initialDescription === "string" ? comic.initialDescription.trim() : "";
    if (!initialTags.length && !authorTags.length && !initialDescription) continue;
    const current = metadata[comic.id] || {};
    const next = {
      rating: Math.max(0, Math.min(5, Number(current.rating) || 0)),
      tags: Array.isArray(current.tags) ? current.tags : [],
      views: Math.max(0, Math.floor(Number(current.views) || 0)),
      description: typeof current.description === "string" ? current.description : "",
      tagsInitializedFromFile: Boolean(current.tagsInitializedFromFile),
      tagsInitializationVersion: Math.max(0, Math.floor(Number(current.tagsInitializationVersion) || 0)),
      descriptionInitializedFromFile: Boolean(current.descriptionInitializedFromFile)
    };

    const tagsWithAuthors = mergeMissingTags(next.tags, authorTags);
    if (tagsWithAuthors.length !== next.tags.length) {
      next.tags = tagsWithAuthors;
      changed = true;
    }

    const shouldInitializeTags = initialTags.length && (
      !next.tagsInitializedFromFile
      || (!next.tags.length && next.tagsInitializationVersion < 2)
    );
    if (shouldInitializeTags) {
      next.tags = mergeMissingTags(next.tags, initialTags);
      next.tagsInitializedFromFile = true;
      next.tagsInitializationVersion = 2;
      changed = true;
    }
    if (initialDescription && !next.descriptionInitializedFromFile) {
      if (!next.description.trim()) next.description = initialDescription;
      next.descriptionInitializedFromFile = true;
      changed = true;
    }
    metadata[comic.id] = next;
  }

  if (changed) await writeJson(META_FILE, metadata);
}

function rootsMatch(a = [], b = []) {
  return a.length === b.length && a.every((root, index) => root === b[index]);
}

async function refreshIndex(libraryRoots) {
  if (scanPromise) return scanPromise;
  scanPromise = (async () => {
    const previous = await loadIndex();
    const nextIndex = await scanLibraries(libraryRoots, previous);
    updateScanProgress({ phase: "metadata", percent: 94, comicsFound: nextIndex.comics.length, current: "" });
    await initializeMetadataFromFiles(nextIndex.comics);
    updateScanProgress({ phase: "saving", percent: 98 });
    await saveIndex(nextIndex);
    updateScanProgress({ phase: "complete", percent: 100 });
    return nextIndex;
  })().finally(() => {
    scanPromise = null;
    setTimeout(() => {
      if (!scanPromise) updateScanProgress({ active: false, phase: "idle", current: "" });
    }, 1500);
  });
  return scanPromise;
}

async function getLibraryIndex(libraryRoots, { refresh = false } = {}) {
  const cached = await loadIndex();
  const cacheMatches = cached && rootsMatch(cached.libraryRoots || [cached.libraryRoot].filter(Boolean), libraryRoots);
  if (refresh || !cacheMatches) {
    return refreshIndex(libraryRoots);
  }
  if (!scanPromise) {
    refreshIndex(libraryRoots).catch((error) => console.error("Background scan failed:", error.message));
  }
  return cached;
}

async function findComic(libraryRoots, id) {
  let index = await getLibraryIndex(libraryRoots);
  let comic = index.comics.find((item) => item.id === id);
  if (!comic) {
    index = await getLibraryIndex(libraryRoots, { refresh: true });
    comic = index.comics.find((item) => item.id === id);
  }
  return comic;
}

function findRootById(libraryRoots, rootId) {
  return libraryRoots.find((root) => rootIdFor(root) === rootId);
}

async function resolveImageRequest(url) {
  const { libraryRoots } = await getConfig();
  const rootId = url.searchParams.get("root") || rootIdFor(libraryRoots[0] || "");
  const relativeFile = url.searchParams.get("file");
  const libraryRoot = findRootById(libraryRoots, rootId);
  if (!libraryRoot || !relativeFile) {
    const error = new Error("Missing image path");
    error.status = 400;
    throw error;
  }

  const filePath = path.resolve(libraryRoot, relativeFile);
  if (!isInside(libraryRoot, filePath) || !isImage(filePath)) {
    const error = new Error("Image path is outside the library root");
    error.status = 403;
    throw error;
  }
  await fs.access(filePath);
  return { filePath };
}

async function generateThumbnail(filePath, width) {
  const stat = await fs.stat(filePath);
  const cacheKey = crypto
    .createHash("sha1")
    .update(`${filePath}:${stat.size}:${stat.mtimeMs}:${width}`)
    .digest("hex");
  const thumbPath = path.join(THUMB_DIR, `${cacheKey}.jpg`);
  if (await fs.access(thumbPath).then(() => true).catch(() => false)) return thumbPath;

  await fs.mkdir(THUMB_DIR, { recursive: true });
  const script = [
    "Add-Type -AssemblyName System.Drawing",
    "$src = $env:COMIC_THUMB_SRC",
    "$dest = $env:COMIC_THUMB_DEST",
    "$max = [Math]::Max(120, [int]$env:COMIC_THUMB_WIDTH)",
    "$img = $null; $bmp = $null; $g = $null; $params = $null",
    "try {",
    "  $img = [System.Drawing.Image]::FromFile($src)",
    "  $scale = [Math]::Min($max / $img.Width, $max / $img.Height)",
    "  if ($scale -gt 1) { $scale = 1 }",
    "  $w = [Math]::Max(1, [int]($img.Width * $scale))",
    "  $h = [Math]::Max(1, [int]($img.Height * $scale))",
    "  $bmp = New-Object System.Drawing.Bitmap $w, $h",
    "  $g = [System.Drawing.Graphics]::FromImage($bmp)",
    "  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic",
    "  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality",
    "  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality",
    "  $g.DrawImage($img, 0, 0, $w, $h)",
    "  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }",
    "  $params = New-Object System.Drawing.Imaging.EncoderParameters 1",
    "  $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 82L",
    "  $bmp.Save($dest, $codec, $params)",
    "} finally {",
    "  if ($params) { $params.Dispose() }",
    "  if ($g) { $g.Dispose() }",
    "  if ($bmp) { $bmp.Dispose() }",
    "  if ($img) { $img.Dispose() }",
    "}"
  ].join("; ");

  await new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-Command", script],
      {
        windowsHide: true,
        timeout: 60000,
        env: {
          ...process.env,
          COMIC_THUMB_SRC: filePath,
          COMIC_THUMB_DEST: thumbPath,
          COMIC_THUMB_WIDTH: String(width)
        }
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(stdout);
      }
    );
  });
  return thumbPath;
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/config") {
    const { libraryRoots, libraryRoot, categoryCovers } = await getConfig();
    sendJson(res, 200, { libraryRoots, libraryRoot, categoryCovers });
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/category-covers") {
    const body = await readRequestBody(req);
    const categoryCovers = body.categoryCovers && typeof body.categoryCovers === "object"
      ? Object.fromEntries(Object.entries(body.categoryCovers)
        .map(([category, comicId]) => [String(category).trim(), String(comicId).trim()])
        .filter(([category, comicId]) => category && comicId))
      : {};
    const { libraryRoots } = await getConfig();
    await saveConfig(libraryRoots, categoryCovers);
    sendJson(res, 200, { categoryCovers });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/select-directory") {
    const selectedPath = await selectDirectory(url.searchParams.get("initial") || "");
    sendJson(res, 200, selectedPath ? { path: selectedPath, canceled: false } : { path: "", canceled: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/config") {
    const body = await readRequestBody(req);
    const current = await getConfig();
    const hasRootsList = Object.prototype.hasOwnProperty.call(body, "libraryRoots");
    const nextRoots = normalizeRoots(hasRootsList ? body.libraryRoots : [...current.libraryRoots, body.libraryRoot]);
    if (!hasRootsList && !nextRoots.length) {
      sendError(res, 400, "Library folder was not found");
      return;
    }

    for (const root of nextRoots) {
      const stat = await fs.stat(root).catch(() => null);
      if (!stat?.isDirectory()) {
        sendError(res, 400, `Library folder was not found: ${root}`);
        return;
      }
    }

    await saveConfig(nextRoots);
    if (nextRoots.length) {
      refreshIndex(nextRoots).catch((error) => console.error("Background scan failed:", error.message));
    } else {
      await saveIndex({ version: INDEX_VERSION, libraryRoot: "", libraryRoots: [], scannedAt: new Date().toISOString(), comics: [] });
    }
    sendJson(res, 200, { libraryRoots: nextRoots, libraryRoot: nextRoots[0] || "" });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/sync") {
    const { libraryRoots } = await getConfig();
    if (!libraryRoots.length) {
      sendJson(res, 200, { libraryRoots: [], comics: [], metadata: await getMetadata(), scanning: false });
      return;
    }
    const index = await refreshIndex(libraryRoots);
    sendJson(res, 200, {
      libraryRoots,
      libraryRoot: libraryRoots[0] || "",
      comics: index.comics.map(publicComic),
      metadata: await getMetadata(),
      scannedAt: index.scannedAt,
      scanning: Boolean(scanPromise)
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/sync-progress") {
    sendJson(res, 200, publicScanProgress());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/library") {
    const { libraryRoots, libraryRoot, categoryCovers } = await getConfig();
    if (!libraryRoots.length) {
      sendJson(res, 200, { libraryRoot: "", libraryRoots: [], categoryCovers, comics: [], metadata: await getMetadata(), scanning: false });
      return;
    }
    const refresh = url.searchParams.get("refresh") === "1";
    const index = await getLibraryIndex(libraryRoots, { refresh });
    sendJson(res, 200, {
      libraryRoot,
      libraryRoots,
      categoryCovers,
      comics: index.comics.map(publicComic),
      metadata: await getMetadata(),
      scannedAt: index.scannedAt,
      scanning: Boolean(scanPromise)
    });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/comics/")) {
    const id = decodeURIComponent(url.pathname.split("/")[3] || "");
    const { libraryRoots } = await getConfig();
    if (!libraryRoots.length || !id) {
      sendError(res, 400, "Missing comic id");
      return;
    }
    const comic = await findComic(libraryRoots, id);
    if (!comic) {
      sendError(res, 404, "Comic was not found");
      return;
    }
    sendJson(res, 200, comic);
    return;
  }

  if (req.method === "DELETE" && /^\/api\/comics\/[^/]+$/.test(url.pathname)) {
    const id = decodeURIComponent(url.pathname.split("/")[3] || "");
    const config = await getConfig();
    if (!config.libraryRoots.length || !id) {
      sendError(res, 400, "Missing comic id");
      return;
    }
    const index = await getLibraryIndex(config.libraryRoots);
    const comic = index.comics.find((item) => item.id === id);
    if (!comic) {
      sendError(res, 404, "Comic was not found");
      return;
    }
    const libraryRoot = findRootById(config.libraryRoots, comic.rootId);
    const comicDir = path.resolve(libraryRoot || "", comic.relativeDir || ".");
    if (!libraryRoot || comicDir === path.resolve(libraryRoot) || !isInside(libraryRoot, comicDir)) {
      sendError(res, 403, "Refusing to delete the library root");
      return;
    }
    const stat = await fs.stat(comicDir).catch(() => null);
    if (!stat?.isDirectory()) {
      sendError(res, 404, "Comic folder was not found");
      return;
    }
    await fs.rm(comicDir, { recursive: true, force: false });
    await saveIndex({
      ...index,
      scannedAt: new Date().toISOString(),
      comics: index.comics.filter((item) => item.id !== id)
    });
    const metadata = await getMetadata();
    delete metadata[id];
    await writeJson(META_FILE, metadata);
    const categoryCovers = Object.fromEntries(
      Object.entries(config.categoryCovers).filter(([, comicId]) => comicId !== id)
    );
    if (Object.keys(categoryCovers).length !== Object.keys(config.categoryCovers).length) {
      await saveConfig(config.libraryRoots, categoryCovers);
    }
    sendJson(res, 200, { deleted: true, id });
    return;
  }

  if (req.method === "PUT" && url.pathname.startsWith("/api/comics/") && url.pathname.endsWith("/metadata")) {
    const id = decodeURIComponent(url.pathname.split("/")[3] || "");
    const body = await readRequestBody(req);
    const rating = Math.max(0, Math.min(5, Number(body.rating) || 0));
    const tags = Array.isArray(body.tags)
      ? [...new Set(body.tags.map((tag) => String(tag).trim()).filter(Boolean))]
      : [];
    const views = Math.max(0, Math.floor(Number(body.views) || 0));
    const description = String(body.description || "").slice(0, 2000);
    const metadata = await getMetadata();
    const current = metadata[id] || {};
    metadata[id] = {
      rating,
      tags,
      views,
      description,
      tagsInitializedFromFile: Boolean(current.tagsInitializedFromFile),
      tagsInitializationVersion: current.tagsInitializedFromFile
        ? Math.max(2, Math.floor(Number(current.tagsInitializationVersion) || 0))
        : 0,
      descriptionInitializedFromFile: Boolean(current.descriptionInitializedFromFile)
    };
    await writeJson(META_FILE, metadata);
    sendJson(res, 200, metadata[id]);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/image") {
    const { filePath } = await resolveImageRequest(url);
    res.writeHead(200, {
      "content-type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable"
    });
    createReadStream(filePath).pipe(res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/thumb") {
    const { filePath } = await resolveImageRequest(url);
    const width = Math.max(120, Math.min(720, Number(url.searchParams.get("w")) || 360));
    try {
      const thumbPath = await generateThumbnail(filePath, width);
      res.writeHead(200, {
        "content-type": "image/jpeg",
        "cache-control": "public, max-age=31536000, immutable"
      });
      createReadStream(thumbPath).pipe(res);
    } catch {
      res.writeHead(200, {
        "content-type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
        "cache-control": "public, max-age=31536000, immutable"
      });
      createReadStream(filePath).pipe(res);
    }
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
  scanLibraries,
  idFor,
  isInside,
  server
};
