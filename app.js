const DETAIL_PAGE_SIZE = 12;
const PORTRAIT_DETAIL_PAGE_SIZE = 12;
const LIBRARY_PAGE_SIZE = 25;
const TAG_RESULT_PAGE_SIZE = 20;
const CATEGORY_PREVIEW_SIZE = 10;
const CATEGORY_PAGE_SIZE = 20;
const RANKING_PAGE_SIZE = 50;
const READER_SCROLL_WINDOW = 8;
const LIBRARY_VIEW_STORAGE_KEY = "comicLibraryView";
const SELECTED_COMIC_STORAGE_KEY = "comicSelectedComic";
const SELECTED_COLLECTION_STORAGE_KEY = "comicSelectedCollection";
const CATEGORY_COVERS_STORAGE_KEY = "comicCategoryCovers";

function readSavedLibraryView() {
  try {
    return JSON.parse(localStorage.getItem(LIBRARY_VIEW_STORAGE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

const savedLibraryView = readSavedLibraryView();

function readSavedSelectedComicId() {
  try {
    return localStorage.getItem(SELECTED_COMIC_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function readSavedSelectedCollectionKey() {
  try {
    return localStorage.getItem(SELECTED_COLLECTION_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function readSavedCategoryCovers() {
  try {
    return JSON.parse(localStorage.getItem(CATEGORY_COVERS_STORAGE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

const state = {
  comics: [],
  selectedComicId: readSavedSelectedComicId(),
  selectedCollectionKey: readSavedSelectedCollectionKey(),
  collectionSort: "name",
  collectionSortDirection: "asc",
  libraryPage: Math.max(1, Math.floor(Number(savedLibraryView.libraryPage) || 1)),
  rankingPage: 1,
  pageIndex: 0,
  detailPage: 1,
  readerScrollEnd: READER_SCROLL_WINDOW,
  tagEditorOpen: false,
  descriptionEditorOpen: false,
  mode: "scroll",
  fit: "fill-screen",
  customWidth: true,
  autoFit: true,
  imageWidth: 100,
  autoPlay: false,
  autoSeconds: 5,
  autoPixels: 800,
  autoSettingsOpen: false,
  readerNight: false,
  controlsOpen: false,
  activeTag: typeof savedLibraryView.activeTag === "string" ? savedLibraryView.activeTag : "全部",
  activeCategory: typeof savedLibraryView.activeCategory === "string" ? savedLibraryView.activeCategory : "全部",
  rankingMode: "rating",
  meta: {},
  libraryRoot: "",
  libraryRoots: [],
  categoryCovers: readSavedCategoryCovers(),
  categoryCoverEditor: "",
  search: "",
  view: "home"
};

const $ = (selector) => document.querySelector(selector);

const elements = {
  pathForm: $("#pathForm"),
  libraryPath: $("#libraryPath"),
  rootList: $("#rootList"),
  syncLibraryButton: $("#syncLibraryButton"),
  libraryConfig: $("#libraryConfig"),
  settingsToggle: $("#settingsToggle"),
  statusLine: $("#statusLine"),
  syncProgress: $("#syncProgress"),
  syncProgressLabel: $("#syncProgressLabel"),
  syncProgressValue: $("#syncProgressValue"),
  syncProgressBar: $("#syncProgressBar"),
  syncProgressDetail: $("#syncProgressDetail"),
  globalSyncProgress: $("#globalSyncProgress"),
  globalSyncProgressLabel: $("#globalSyncProgressLabel"),
  globalSyncProgressValue: $("#globalSyncProgressValue"),
  globalSyncProgressBar: $("#globalSyncProgressBar"),
  globalSyncProgressDetail: $("#globalSyncProgressDetail"),
  headerSearch: $("#headerSearch"),
  searchInput: $("#searchInput"),
  tagFilters: $("#tagFilters"),
  latestList: $("#latestList"),
  homeRanking: $("#homeRanking"),
  homeFolders: $("#homeFolders"),
  comicGrid: $("#comicGrid"),
  libraryPager: $("#libraryPager"),
  comicDetail: $("#comicDetail"),
  resultCount: $("#resultCount"),
  rankingTabs: $("#rankingTabs"),
  rankingList: $("#rankingList"),
  categoryBoard: $("#categoryBoard"),
  readerTitle: $("#readerTitle"),
  readerMeta: $("#readerMeta"),
  slideReader: $("#slideReader"),
  readerTopbar: $("#readerTopbar"),
  deleteComicButton: $("#deleteComicButton"),
  deletePageButton: $("#deletePageButton"),
  moveComicButton: $("#moveComicButton"),
  readerStage: $("#readerStage"),
  readerCompleteToast: $("#readerCompleteToast"),
  readerDeleteModal: $("#readerDeleteModal"),
  readerDeleteName: $("#readerDeleteName"),
  confirmDeleteComicButton: $("#confirmDeleteComicButton"),
  readerDeletePageModal: $("#readerDeletePageModal"),
  readerDeletePageName: $("#readerDeletePageName"),
  confirmDeletePageButton: $("#confirmDeletePageButton"),
  readerMoveModal: $("#readerMoveModal"),
  readerMoveName: $("#readerMoveName"),
  readerMoveStatus: $("#readerMoveStatus"),
  moveCategorySelect: $("#moveCategorySelect"),
  confirmMoveComicButton: $("#confirmMoveComicButton"),
  progressLabel: $("#progressLabel"),
  progressBar: $("#progressBar"),
  pageSelect: $("#pageSelect"),
  readingMode: $("#readingMode"),
  fitMode: $("#fitMode"),
  autoToggle: $("#autoToggle"),
  autoInterval: $("#autoInterval"),
  autoPopover: $("#autoPopover"),
  readerThemeToggle: $("#readerThemeToggle"),
  fitToggle: $("#fitToggle"),
  widthControl: $("#widthControl"),
  imageWidth: $("#imageWidth"),
  brightness: $("#brightness"),
  prevPage: $("#prevPage"),
  nextPage: $("#nextPage"),
  themeToggle: $("#themeToggle")
};

let autoTimer = null;
let autoFrame = null;
let autoLastTime = 0;
let autoScrollTop = 0;
let scrollSyncFrame = null;
let readerCompleteTimer = null;
let completedComicId = "";
let backgroundProgressTimer = 0;
let dataVersion = 0;
const derivedCache = {
  sortedVersion: -1,
  sortedComics: [],
  rankedVersion: -1,
  rankedMode: "",
  rankedComics: []
};

function invalidateDerivedCache() {
  dataVersion += 1;
}

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const timeoutMs = options.timeoutMs || 0;
  const controller = timeoutMs ? new AbortController() : null;
  const timeoutId = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    signal: controller?.signal,
    ...options
  }).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "请求失败");
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function getMeta(id) {
  const meta = state.meta[id] || {};
  return {
    rating: Math.max(0, Math.min(5, Number(meta.rating) || 0)),
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    views: Math.max(0, Math.floor(Number(meta.views) || 0)),
    description: typeof meta.description === "string" ? meta.description : ""
  };
}

function getSelectedComic() {
  return state.comics.find((comic) => comic.id === state.selectedComicId);
}

function comicPages(comic) {
  if (!comic) return [];
  return Array.isArray(comic.pages) && comic.pages.length ? comic.pages : (comic.cover ? [comic.cover] : []);
}

function mergeComic(nextComic) {
  const index = state.comics.findIndex((comic) => comic.id === nextComic.id);
  if (index === -1) {
    state.comics.push(nextComic);
  } else {
    state.comics[index] = { ...state.comics[index], ...nextComic };
  }
  return state.comics.find((comic) => comic.id === nextComic.id);
}

async function ensureComicPages(id = state.selectedComicId) {
  const comic = state.comics.find((item) => item.id === id);
  if (!comic) return null;
  if (Array.isArray(comic.pages) && comic.pages.length) return comic;
  const fullComic = await api(`/api/comics/${encodeURIComponent(id)}`);
  return mergeComic(fullComic);
}

function naturalSort(a, b) {
  return a.localeCompare(b, "zh-CN", { numeric: true, sensitivity: "base" });
}

function comicUpdatedTime(comic) {
  const fromIso = Date.parse(comic.updatedAt || "");
  if (Number.isFinite(fromIso)) return fromIso;
  return Number(comic.dirMtimeMs) || 0;
}

function compareComicsByUpdated(a, b) {
  return comicUpdatedTime(b) - comicUpdatedTime(a) || naturalSort(a.title, b.title);
}

function comicAddedTime(comic) {
  const fromIso = Date.parse(comic.addedAt || "");
  if (Number.isFinite(fromIso)) return fromIso;
  return comicUpdatedTime(comic);
}

function directoryItemAddedTime(item) {
  if (item.type === "collection") {
    return Math.max(0, ...item.comics.map(comicAddedTime));
  }
  return comicAddedTime(item.comic);
}

function formatUpdatedAt(comic) {
  const timestamp = comicUpdatedTime(comic);
  if (!timestamp) return "更新：未知";
  return `更新：${new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(timestamp)).replace(/\//g, "-")}`;
}

function sortedComics() {
  if (derivedCache.sortedVersion !== dataVersion) {
    derivedCache.sortedComics = [...state.comics].sort(compareComicsByUpdated);
    derivedCache.sortedVersion = dataVersion;
  }
  return derivedCache.sortedComics;
}

function rankedComics() {
  if (derivedCache.rankedVersion === dataVersion && derivedCache.rankedMode === state.rankingMode) {
    return derivedCache.rankedComics;
  }
  derivedCache.rankedComics = [...state.comics].sort((a, b) => {
    const aMeta = getMeta(a.id);
    const bMeta = getMeta(b.id);
    if (state.rankingMode === "views") {
      return bMeta.views - aMeta.views || bMeta.rating - aMeta.rating || naturalSort(a.title, b.title);
    }
    return bMeta.rating - aMeta.rating || bMeta.views - aMeta.views || naturalSort(a.title, b.title);
  });
  derivedCache.rankedVersion = dataVersion;
  derivedCache.rankedMode = state.rankingMode;
  return derivedCache.rankedComics;
}

function allTags() {
  return ["全部", ...new Set(state.comics.flatMap((comic) => getMeta(comic.id).tags))];
}

function categoryParts(category) {
  return String(category || "未分类")
    .split(/\s*\/\s*|[\\/]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function categoryFilterOptions() {
  const categories = new Set();
  state.comics.forEach((comic) => {
    const parts = categoryParts(comic.category || "未分类");
    categories.add(parts[0] || "未分类");
  });
  return [...categories].sort(naturalSort);
}

function categoryPathOptions() {
  const categories = new Set();
  state.comics.forEach((comic) => {
    const parts = categoryParts(comic.category || "未分类");
    parts.forEach((_, index) => {
      categories.add(parts.slice(0, index + 1).join(" / "));
    });
    const directoryParts = categoryParts(comic.relativeDir || "");
    if (directoryParts.length >= 2) categories.add(directoryParts.slice(0, 2).join(" / "));
  });
  return [...categories].sort(naturalSort);
}

function moveCategoryOptions(currentCategory) {
  const category = currentCategory || "未分类";
  const categories = categoryFilterOptions().filter(Boolean);
  return [...new Set(["未分类", ...categories, category])].sort((a, b) => {
    if (a === "未分类") return -1;
    if (b === "未分类") return 1;
    return naturalSort(a, b);
  });
}

function comicMatchesCategory(comic, selectedCategory) {
  if (selectedCategory === "全部") return true;
  const category = comic.category || "未分类";
  const normalizedCategory = categoryParts(category).join(" / ");
  const normalizedSelected = categoryParts(selectedCategory).join(" / ");
  const normalizedDirectory = categoryParts(comic.relativeDir || "").join(" / ");
  return normalizedCategory === normalizedSelected
    || normalizedCategory.startsWith(`${normalizedSelected} / `)
    || normalizedDirectory === normalizedSelected
    || normalizedDirectory.startsWith(`${normalizedSelected} / `);
}

function categoryBreadcrumb(category) {
  const parts = categoryParts(category);
  if (!parts.length) return escapeHTML(category || "未分类");
  return parts.map((part, index) => {
    const value = parts.slice(0, index + 1).join(" / ");
    return `
      <button type="button" data-category-path="${escapeHTML(value)}">${escapeHTML(part)}</button>
      ${index < parts.length - 1 ? "<span>/</span>" : ""}
    `;
  }).join("");
}

function allCategories() {
  return ["全部", ...categoryFilterOptions()];
}

function filteredComics() {
  const keyword = state.search.trim().toLowerCase();
  return sortedComics().filter((comic) => {
    const meta = getMeta(comic.id);
    const matchesTag = state.activeTag === "全部" || meta.tags.includes(state.activeTag);
    const category = comic.category || "未分类";
    const matchesCategory = comicMatchesCategory(comic, state.activeCategory);
    const text = `${comic.title} ${category} ${meta.tags.join(" ")}`.toLowerCase();
    return matchesTag && matchesCategory && text.includes(keyword);
  });
}

function groupComicsByCategory(comics) {
  return comics.reduce((groups, comic) => {
    const category = comic.category || "未分类";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(comic);
    return groups;
  }, new Map());
}

function libraryPageItems(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set([1, total]);
  for (let page = current - 1; page <= current + 1; page += 1) {
    if (page > 1 && page < total) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b).flatMap((page, index, sorted) => {
    if (index === 0 || page === sorted[index - 1] + 1) return [page];
    return ["...", page];
  });
}

function setStatus(message, tone = "") {
  elements.statusLine.textContent = message;
  elements.statusLine.dataset.tone = tone;
}

function setMoveStatus(message = "", tone = "") {
  if (!elements.readerMoveStatus) return;
  elements.readerMoveStatus.textContent = message;
  elements.readerMoveStatus.dataset.tone = tone;
}

function renderMoveModal(comic) {
  const disabled = !comic;
  if (elements.moveComicButton) elements.moveComicButton.disabled = disabled;
  document.querySelectorAll("[data-open-move-comic]").forEach((button) => {
    button.disabled = disabled;
  });
  if (!elements.readerMoveName || !elements.moveCategorySelect) return;
  if (!comic) {
    elements.readerMoveName.textContent = "";
    elements.moveCategorySelect.innerHTML = "";
    setMoveStatus("", "");
    return;
  }
  const currentCategory = comic.category || "未分类";
  elements.readerMoveName.textContent = `${comic.title} · 当前分类：${currentCategory}`;
  elements.moveCategorySelect.innerHTML = moveCategoryOptions(currentCategory)
    .map((category) => `<option value="${escapeHTML(category)}">${escapeHTML(category)}</option>`)
    .join("");
  elements.moveCategorySelect.value = currentCategory;
  setMoveStatus("", "");
}

function secondLevelCategoryGroups(comics) {
  return comics.reduce((groups, comic) => {
    const parts = categoryParts(comic.relativeDir || comic.category || "未分类");
    if (!parts.length) return groups;
    const category = parts[0];
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(comic);
    return groups;
  }, new Map());
}

async function persistCategoryCovers() {
  try {
    localStorage.setItem(CATEGORY_COVERS_STORAGE_KEY, JSON.stringify(state.categoryCovers));
    await api("/api/category-covers", {
      method: "PUT",
      body: JSON.stringify({ categoryCovers: state.categoryCovers })
    });
  } catch (error) {
    // Local storage can be unavailable in restricted browser modes.
    setStatus(`分类封面保存失败：${error.message}`, "error");
  }
}

function renderSyncProgress(progress) {
  const active = Boolean(progress?.active);
  if (elements.syncProgress) elements.syncProgress.hidden = !active;
  if (elements.globalSyncProgress) elements.globalSyncProgress.hidden = !active;
  if (!active) return;
  const percent = Math.max(0, Math.min(100, Math.round(Number(progress.percent) || 0)));
  const label = progress.label || "正在同步";
  const value = `${percent}%`;
  const detail = progress.detail || "正在处理漫画目录...";
  if (elements.syncProgressLabel) elements.syncProgressLabel.textContent = label;
  if (elements.syncProgressValue) elements.syncProgressValue.textContent = value;
  if (elements.syncProgressBar) {
    elements.syncProgressBar.value = percent;
    elements.syncProgressBar.setAttribute("aria-valuenow", String(percent));
  }
  if (elements.syncProgressDetail) elements.syncProgressDetail.textContent = detail;
  if (elements.globalSyncProgressLabel) elements.globalSyncProgressLabel.textContent = label;
  if (elements.globalSyncProgressValue) elements.globalSyncProgressValue.textContent = value;
  if (elements.globalSyncProgressBar) {
    elements.globalSyncProgressBar.value = percent;
    elements.globalSyncProgressBar.setAttribute("aria-valuenow", String(percent));
  }
  if (elements.globalSyncProgressDetail) elements.globalSyncProgressDetail.textContent = detail;
}

async function pollSyncProgress() {
  try {
    const progress = await api("/api/sync-progress", { timeoutMs: 5000 });
    renderSyncProgress(progress);
    if (progress.active) {
      setStatus(progress.status || "正在同步本地漫画目录...");
    } else {
      stopBackgroundProgressPolling();
    }
    return progress;
  } catch {
    // The main sync request reports any connection failure.
  }
  return null;
}

function startBackgroundProgressPolling() {
  if (backgroundProgressTimer) return;
  pollSyncProgress();
  backgroundProgressTimer = window.setInterval(pollSyncProgress, 900);
}

function stopBackgroundProgressPolling() {
  if (!backgroundProgressTimer) return;
  window.clearInterval(backgroundProgressTimer);
  backgroundProgressTimer = 0;
}

function setSyncControlsDisabled(disabled) {
  if (elements.syncLibraryButton) elements.syncLibraryButton.disabled = disabled;
  const addDirectoryButton = elements.pathForm?.querySelector('button[type="submit"]');
  if (addDirectoryButton) addDirectoryButton.disabled = disabled;
}

async function withSyncProgress({ status, detail, task, completionDetail }) {
  setStatus(status);
  renderSyncProgress({ active: true, percent: 0, label: "准备同步", detail });
  setSyncControlsDisabled(true);
  const progressTimer = setInterval(pollSyncProgress, 350);
  let result;
  try {
    result = await task();
    await pollSyncProgress();
    renderSyncProgress({
      active: true,
      percent: 100,
      label: "同步完成",
      detail: completionDetail(result)
    });
    return result;
  } finally {
    clearInterval(progressTimer);
    setSyncControlsDisabled(false);
    if (!result) renderSyncProgress(null);
  }
}

function persistLibraryView() {
  try {
    localStorage.setItem(LIBRARY_VIEW_STORAGE_KEY, JSON.stringify({
      activeCategory: state.activeCategory,
      activeTag: state.activeTag,
      libraryPage: state.libraryPage
    }));
  } catch {
    // Local storage can be unavailable in restricted browser modes.
  }
}

function persistSelectedComic() {
  try {
    if (state.selectedComicId) {
      localStorage.setItem(SELECTED_COMIC_STORAGE_KEY, state.selectedComicId);
    } else {
      localStorage.removeItem(SELECTED_COMIC_STORAGE_KEY);
    }
  } catch {
    // Local storage can be unavailable in restricted browser modes.
  }
}

function persistSelectedCollection() {
  try {
    if (state.selectedCollectionKey) {
      localStorage.setItem(SELECTED_COLLECTION_STORAGE_KEY, state.selectedCollectionKey);
    } else {
      localStorage.removeItem(SELECTED_COLLECTION_STORAGE_KEY);
    }
  } catch {
    // Local storage can be unavailable in restricted browser modes.
  }
}

function friendlyError(error) {
  const message = error?.message || String(error || "未知错误");
  if (message.includes("Cannot set properties of null")) {
    return "页面控件还没准备好，请刷新页面后再试。";
  }
  if (message.includes("Failed to fetch")) {
    return "本地服务连接失败，请确认后端服务正在运行。";
  }
  return message;
}

function syncThemeToggleIcon() {
  const isDark = document.body.classList.contains("dark");
  elements.themeToggle.textContent = isDark ? "☾" : "☀";
  elements.themeToggle.title = isDark ? "切换到白天模式" : "切换到夜间模式";
  elements.themeToggle.setAttribute("aria-label", elements.themeToggle.title);
}

function setView(view) {
  state.view = view;
  document.body.classList.toggle("reader-active", view === "reader");
  document.documentElement.classList.toggle("reader-active-root", view === "reader");
  if (view !== "reader") stopAutoPlay();
  if (view !== "detail" && view !== "reader") {
    state.selectedCollectionKey = "";
    persistSelectedCollection();
  }
  document.querySelectorAll(".page-view").forEach((section) => section.classList.remove("active"));
  $(`#${view}View`)?.classList.add("active");
  document.querySelectorAll("[data-view-link]").forEach((link) => {
    link.classList.toggle("active", link.dataset.viewLink === view);
  });
  renderCurrentView();
  if (view !== "reader") window.scrollTo(0, 0);
}

function navigateToView(view) {
  const nextHash = `#${view}`;
  if (location.hash !== nextHash) {
    history.pushState(null, "", nextHash);
  }
  setView(view);
}

function syncViewFromHash() {
  const value = location.hash.replace("#", "");
  const view = ["home", "library", "ranking", "categories", "detail", "reader"].includes(value) ? value : "home";
  setView(view);
}

function comicMetaLine(comic) {
  const meta = getMeta(comic.id);
  const tags = meta.tags.length ? meta.tags.join(" / ") : "未添加标签";
  return `${comic.category || "未分类"} · ${comic.pageCount} 页 · ${meta.rating.toFixed(1)} 分 · ${tags}`;
}

function coverPreview(comic) {
  return comic?.coverThumb || comic?.cover || "";
}

function imagePreview(src, width = 420) {
  try {
    const url = new URL(src, location.origin);
    if (url.pathname !== "/api/image") return src;
    url.pathname = "/api/thumb";
    url.searchParams.set("w", String(width));
    return `${url.pathname}${url.search}`;
  } catch {
    return src;
  }
}

function seriesTitleFor(comic) {
  const normalizeSeriesText = (value) => String(value || "")
    .normalize("NFKC")
    .replace(/(?:\.|…|‥|⋯){2,}/gu, "……")
    .replace(/[~～]/gu, "〜");
  const title = normalizeSeriesText(comic?.title).trim();
  if (!title) return "";
  const cleaned = title
    .replace(/\s+/g, " ")
    .replace(/[【\[](?:中国翻訳|中国翻译|中文|汉化|漢化|DL版|無修正|无修正|完结?|完)[^\]】]*[】\]]/gi, "")
    .trim();
  const workTitle = cleaned.replace(/^[【\[][^】\]]+[】\]]\s*/u, "").trim();
  const normalizeBase = (value) => value
    .normalize("NFKC")
    .replace(/(?:\.|…|‥|⋯){2,}/gu, "……")
    .replace(/[~～]/gu, "〜")
    .trim()
    .replace(/[!！?？]+$/u, "")
    .replace(/[：:_\s-]+$/u, "")
    .trim();
  const rangeMatch = workTitle.match(/^(.{2,}?)\s*[!！]?\s*[（(]\s*\d{1,4}(?:\.\d+)?\s*[-–—~〜～]\s*\d{1,4}(?:\.\d+)?\s*[)）](?:\s*合集)?(?:\s*[【\[].*)?$/u);
  if (rangeMatch) {
    const base = normalizeBase(rangeMatch[1]);
    return base.length >= 2 ? base : title;
  }
  const match = workTitle.match(/^(.{2,}?)\s*(?:第?\s*\d{1,4}(?:\.\d+)?(?:\s*[-–—]\s*\d{1,4}(?:\.\d+)?)?\s*(?:话|話|回|集|卷|章|册|頁|页)?|0*\d{1,4}(?:\.\d+)?)(?=$|\s|[｜|〜～~—–\-_:：])(?:[\s｜|〜～~—–\-_:：]+.*)?$/u);
  if (!match) {
    const base = normalizeBase(workTitle);
    return base.length >= 2 ? base : title;
  }
  const base = normalizeBase(match[1]);
  return base.length >= 2 ? base : title;
}

function seriesAuthorKeyFor(comic) {
  const title = String(comic?.title || "")
    .normalize("NFKC")
    .trim();
  const match = title.match(/^[【\[]\s*([^\]】]+?)\s*[】\]]/u);
  if (!match) return "";
  return match[1]
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function seriesKeyFor(comic) {
  return `${seriesAuthorKeyFor(comic)}::${seriesTitleFor(comic)}`;
}

function chapterNumberFor(comic) {
  const title = String(comic?.title || "")
    .trim()
    .replace(/^[【\[][^】\]]+[】\]]\s*/u, "");
  const matches = [...title.matchAll(/(?:第\s*)?(\d{1,4}(?:\.\d+)?)\s*(?:话|話|回|集|卷|章|册|頁|页)?/gu)];
  if (!matches.length) return null;
  return Number(matches[matches.length - 1][1]);
}

function compareComicsByChapterNumber(a, b) {
  const aNumber = chapterNumberFor(a);
  const bNumber = chapterNumberFor(b);
  if (aNumber !== null && bNumber !== null && aNumber !== bNumber) return aNumber - bNumber;
  if (aNumber !== null && bNumber === null) return -1;
  if (aNumber === null && bNumber !== null) return 1;
  return compareComicsByUpdated(a, b);
}

function collectionKeyFor(category, title) {
  return encodeURIComponent(JSON.stringify([category || "未分类", title]));
}

function buildCollectionItems(comics) {
  const groups = new Map();
  const folderGroups = new Map();

  comics.forEach((comic) => {
    const parts = categoryParts(comic.category || "未分类");
    if (parts.length < 2) return;
    const folderCategory = parts.slice(0, 2).join(" / ");
    folderGroups.set(collectionKeyFor(parts[0], parts[1]), folderCategory);
  });

  comics.forEach((comic) => {
    const category = comic.category || "未分类";
    const parts = categoryParts(category);
    const seriesTitle = seriesTitleFor(comic);
    const seriesKey = seriesKeyFor(comic);
    const matchingFolderCategory = parts.length === 1
      ? folderGroups.get(collectionKeyFor(parts[0], comic.title))
      : "";
    const hasFolderGroup = parts.length > 1 || Boolean(matchingFolderCategory);
    const folderParts = parts.length > 1
      ? parts.slice(0, 2)
      : matchingFolderCategory
        ? categoryParts(matchingFolderCategory)
        : parts;
    const folderCategory = folderParts.join(" / ");
    const title = hasFolderGroup ? folderParts[folderParts.length - 1] : seriesTitle;
    const key = hasFolderGroup
      ? collectionKeyFor(folderCategory, `folder:${folderCategory}`)
      : collectionKeyFor(category, seriesKey);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        title,
        category: hasFolderGroup ? folderCategory : category,
        comics: [],
        groupType: hasFolderGroup ? "folder" : "series"
      });
    }
    groups.get(key).comics.push(comic);
  });

  return [...groups.values()]
    .map((group) => {
      const shouldUseChapterOrder = group.comics.every((comic) => seriesKeyFor(comic) === seriesKeyFor(group.comics[0]));
      const sorted = group.comics.sort(shouldUseChapterOrder ? compareComicsByChapterNumber : compareComicsByUpdated);
      const latestComic = [...group.comics].sort(compareComicsByUpdated)[0];
      if (sorted.length === 1) return { type: "comic", comic: sorted[0], sortComic: sorted[0] };
      return { type: "collection", ...group, comics: sorted, sortComic: latestComic };
    })
    .sort((a, b) => compareComicsByUpdated(a.sortComic, b.sortComic));
}

function getSelectedCollection() {
  if (!state.selectedCollectionKey) return null;
  const collections = buildCollectionItems(state.comics).filter((item) => item.type === "collection");
  const exact = collections.find((item) => item.key === state.selectedCollectionKey);
  if (exact) return exact;

  try {
    const [savedCategory, savedTitle] = JSON.parse(decodeURIComponent(state.selectedCollectionKey));
    const partialTitle = String(savedTitle || "").replace(/^[【\[]/u, "");
    const migrated = collections.find((item) => (
      savedCategory === item.category
      && partialTitle.length >= 2
      && item.title.startsWith(partialTitle)
    ));
    if (migrated) {
      state.selectedCollectionKey = migrated.key;
      persistSelectedCollection();
      return migrated;
    }
  } catch {
    // Ignore stale or malformed collection keys from older builds.
  }
  return null;
}

function comicCard(comic) {
  return `
    <article class="directory-card" data-comic-id="${escapeHTML(comic.id)}">
      <img src="${coverPreview(comic)}" alt="${escapeHTML(comic.title)} 灏侀潰" loading="lazy" decoding="async">
      <h3 title="${escapeHTML(comic.title)}">${escapeHTML(comic.title)}</h3>
      <p>${escapeHTML(comicMetaLine(comic))}</p>
      <time datetime="${escapeHTML(comic.updatedAt || "")}">${escapeHTML(formatUpdatedAt(comic))}</time>
    </article>
  `;
}

function collectionCard(collection) {
  const lead = collection.sortComic || collection.comics[0];
  const totalPages = collection.comics.reduce((sum, comic) => sum + (Number(comic.pageCount) || 0), 0);
  return `
    <article class="directory-card collection-card" data-collection-key="${escapeHTML(collection.key)}">
      <span class="collection-badge">${collection.comics.length}期</span>
      <img src="${coverPreview(lead)}" alt="${escapeHTML(collection.title)} 合集封面" loading="lazy" decoding="async">
      <h3 title="${escapeHTML(collection.title)}">${escapeHTML(collection.title)}</h3>
      <p>${escapeHTML(collection.category)} · ${totalPages} 页 · 最新：${escapeHTML(lead.title)}</p>
      <time datetime="${escapeHTML(lead.updatedAt || "")}">${escapeHTML(formatUpdatedAt(lead))}</time>
    </article>
  `;
}

function directoryItemCard(item) {
  return item.type === "collection" ? collectionCard(item) : comicCard(item.comic);
}

function pageLabel(src, index) {
  if (index === 0) return "封面";
  try {
    const url = new URL(src, location.origin);
    const file = url.searchParams.get("file") || "";
    const name = decodeURIComponent(file).split(/[\\/]/).pop() || `第 ${index + 1} 页`;
    return name.replace(/\.[^.]+$/, "");
  } catch {
    return `第 ${index + 1} 页`;
  }
}

function detailPageSize() {
  return window.innerHeight > window.innerWidth ? PORTRAIT_DETAIL_PAGE_SIZE : DETAIL_PAGE_SIZE;
}

function clampImageWidth(value) {
  return Math.max(40, Math.min(100, Number(value) || 100));
}

function adaptiveSizeForImage(image) {
  const naturalWidth = Math.max(1, image.naturalWidth);
  const naturalHeight = Math.max(1, image.naturalHeight);
  const viewportWidth = Math.max(320, window.innerWidth - 20);
  const viewportHeight = Math.max(320, window.innerHeight - 20);
  const scale = Math.min(viewportWidth / naturalWidth, viewportHeight / naturalHeight);
  return {
    width: Math.round(naturalWidth * scale),
    height: Math.round(naturalHeight * scale)
  };
}

function applyAdaptiveImageSizing() {
  const images = elements.readerStage.querySelectorAll("img");
  images.forEach((image) => {
    const apply = () => {
      if (!state.autoFit || !image.naturalWidth || !image.naturalHeight) {
        image.style.removeProperty("--image-fit-width");
        image.style.removeProperty("--image-fit-height");
        return;
      }
      const size = adaptiveSizeForImage(image);
      image.style.setProperty("--image-fit-width", `${size.width}px`);
      image.style.setProperty("--image-fit-height", `${size.height}px`);
    };
    if (image.complete) {
      apply();
    } else {
      image.addEventListener("load", () => {
        apply();
        syncScrollPageIndex();
        autoAppendReaderScrollPages();
      }, { once: true });
    }
  });
}

function updateReaderProgress(comic = getSelectedComic()) {
  const pages = comicPages(comic);
  if (!pages.length) {
    elements.progressLabel.textContent = "0 / 0";
    elements.progressBar.style.width = "0%";
    return;
  }
  const progress = ((state.pageIndex + 1) / pages.length) * 100;
  elements.progressLabel.textContent = `${state.pageIndex + 1} / ${pages.length}`;
  elements.progressBar.style.width = `${progress}%`;
}

function scrollWindowBounds(total, current) {
  const start = Math.max(0, Math.min(current, Math.max(0, total - READER_SCROLL_WINDOW)));
  return {
    start,
    end: Math.min(total, start + READER_SCROLL_WINDOW)
  };
}

function loadedScrollEnd(total) {
  return Math.min(total, Math.max(READER_SCROLL_WINDOW, state.readerScrollEnd || READER_SCROLL_WINDOW, state.pageIndex + 1));
}

function readerScrollImageHTML(comic, src, index) {
  return `<img src="${escapeHTML(src)}" data-page-index="${index}" loading="lazy" decoding="async" alt="${escapeHTML(comic.title)} 第 ${index + 1} 页">`;
}

function appendReaderScrollPages() {
  if (state.view !== "reader" || state.mode !== "scroll") return false;
  const comic = getSelectedComic();
  if (!comic) return false;
  const pages = comicPages(comic);
  const currentEnd = loadedScrollEnd(pages.length);
  if (currentEnd >= pages.length) return false;

  const nextEnd = Math.min(pages.length, currentEnd + READER_SCROLL_WINDOW);
  elements.readerStage.querySelector("[data-reader-window]")?.remove();
  elements.readerStage.insertAdjacentHTML(
    "beforeend",
    `${pages.slice(currentEnd, nextEnd).map((src, offset) => readerScrollImageHTML(comic, src, currentEnd + offset)).join("")}
    ${nextEnd < pages.length ? `<button class="reader-window-button" type="button" data-reader-window="${nextEnd}">加载下一组</button>` : ""}`
  );
  state.readerScrollEnd = nextEnd;
  applyAdaptiveImageSizing();
  return true;
}

function autoAppendReaderScrollPages() {
  if (state.view !== "reader" || state.mode !== "scroll") return;
  const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - Math.max(600, window.innerHeight * 0.7);
  if (nearBottom) appendReaderScrollPages();
}

function syncScrollPageIndex() {
  if (state.view !== "reader" || state.mode !== "scroll") return;
  const comic = getSelectedComic();
  if (!comic) return;
  const pages = comicPages(comic);
  const images = [...elements.readerStage.querySelectorAll("img")];
  if (!images.length) return;

  const viewportAnchor = window.innerHeight * 0.5;
  let nearestIndex = state.pageIndex;
  let nearestDistance = Infinity;

  images.forEach((image) => {
    const rect = image.getBoundingClientRect();
    const imageAnchor = Math.min(Math.max(viewportAnchor, rect.top), rect.bottom);
    const distance = Math.abs(imageAnchor - viewportAnchor);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = Number(image.dataset.pageIndex) || 0;
    }
  });

  if (nearestIndex !== state.pageIndex) {
    state.pageIndex = Math.max(0, Math.min(pages.length - 1, nearestIndex));
    elements.pageSelect.value = String(state.pageIndex);
    updateReaderProgress(comic);
  }
}

function renderTags() {
  elements.tagFilters.innerHTML = allCategories()
    .map((category) => `<button class="chip ${category === state.activeCategory ? "active" : ""}" type="button" data-category="${escapeHTML(category)}">${escapeHTML(category)}</button>`)
    .join("");

  elements.homeFolders.innerHTML = allCategories()
    .filter((category) => category !== "全部")
    .map((category) => `<a href="#library" data-home-category="${escapeHTML(category)}">${escapeHTML(category)}</a>`)
    .join("") || "<span class=\"muted\">暂无文件夹分类</span>";
}

function renderHome() {
  const latest = sortedComics().slice(0, 12);
  elements.latestList.innerHTML = latest.map((comic) => `
    <article class="update-item" data-comic-id="${escapeHTML(comic.id)}">
      <img src="${coverPreview(comic)}" alt="${escapeHTML(comic.title)} 封面" loading="lazy" decoding="async">
      <div>
        <h3>${escapeHTML(comic.title)}</h3>
        <p>${escapeHTML(comicMetaLine(comic))}</p>
      </div>
      <button class="text-button" type="button">详情</button>
    </article>
  `).join("") || emptyBlock("还没有漫画", "添加漫画根目录后点击同步刷新。");

  elements.homeRanking.innerHTML = rankedComics().slice(0, 10).map((comic) => `
    <li data-rank-comic="${escapeHTML(comic.id)}">
      <span>${escapeHTML(comic.title)}</span>
      <strong>${getMeta(comic.id).rating.toFixed(1)}</strong>
    </li>
  `).join("") || "<li class=\"empty-row\">鏆傛棤鎺掕</li>";
}

function renderLibrary() {
  const list = filteredComics();
  let displayList = buildCollectionItems(list);
  const allTagLabel = allTags()[0];
  const isTagResult = state.activeTag !== allTagLabel;
  const allCategoryLabel = allCategories()[0];
  const isAllCategory = state.activeCategory === allCategoryLabel;
  if (isAllCategory && !isTagResult) {
    displayList = [...displayList].sort((a, b) => compareComicsByUpdated(a.sortComic, b.sortComic));
  }
  elements.resultCount.textContent = isTagResult
    ? `标签：${state.activeTag} · ${list.length} 本漫画`
    : isAllCategory
      ? `${list.length} 本漫画`
      : `分类：${state.activeCategory} · ${list.length} 本漫画`;
  const pageSize = isTagResult ? TAG_RESULT_PAGE_SIZE : isAllCategory ? LIBRARY_PAGE_SIZE : CATEGORY_PAGE_SIZE;
  const shouldPaginate = true;
  const totalPages = Math.max(1, Math.ceil(displayList.length / pageSize));
  state.libraryPage = Math.max(1, Math.min(state.libraryPage, totalPages));
  persistLibraryView();
  const start = (state.libraryPage - 1) * pageSize;
  const pageDisplayList = shouldPaginate ? displayList.slice(start, start + pageSize) : displayList;

  if (isTagResult || isAllCategory) {
    elements.comicGrid.innerHTML = pageDisplayList.length ? `
      <section class="tag-result-group">
        <div class="tag-result-grid">
          ${pageDisplayList.map(directoryItemCard).join("")}
        </div>
      </section>
    ` : emptyBlock("没有匹配结果", "换个关键词、标签或分类试试。");

    elements.libraryPager.innerHTML = displayList.length > pageSize ? `
      <button type="button" data-library-page="${state.libraryPage - 1}" ${state.libraryPage === 1 ? "disabled" : ""}>上一页</button>
      ${libraryPageItems(state.libraryPage, totalPages).map((page) => {
        if (page === "...") return "<span>...</span>";
        return `<button type="button" class="${page === state.libraryPage ? "active" : ""}" data-library-page="${page}">${page}</button>`;
      }).join("")}
      <button type="button" data-library-page="${state.libraryPage + 1}" ${state.libraryPage === totalPages ? "disabled" : ""}>下一页</button>
    ` : "";
    return;
  }

  const groups = isAllCategory
    ? [...groupComicsByCategory(list).entries()]
      .sort(([a], [b]) => naturalSort(a, b))
      .map(([category, comics]) => {
        const items = buildCollectionItems(comics).slice(0, CATEGORY_PREVIEW_SIZE);
        return [category, items, comics.length];
      })
    : [[state.activeCategory, pageDisplayList, list.length]];

  elements.comicGrid.innerHTML = groups.map(([category, items, total]) => `
    <section class="library-category-group">
      <div class="library-category-heading">
        <h2 class="category-breadcrumb">${categoryBreadcrumb(category)}</h2>
        <div class="library-category-actions">
          <span>${isAllCategory && total > items.length ? `${items.length} / ${total}` : total}</span>
          ${isAllCategory && total > items.length ? `<button type="button" data-category-more="${escapeHTML(category)}">更多</button>` : ""}
        </div>
      </div>
      <div class="library-category-grid ${isAllCategory ? "" : "library-category-grid-paged"}">
        ${items.map(directoryItemCard).join("")}
      </div>
    </section>
  `).join("") || emptyBlock("没有匹配结果", "换个关键词、标签或分类试试。");

  elements.libraryPager.innerHTML = !isAllCategory && displayList.length > CATEGORY_PAGE_SIZE ? `
    <button type="button" data-library-page="${state.libraryPage - 1}" ${state.libraryPage === 1 ? "disabled" : ""}>上一页</button>
    ${libraryPageItems(state.libraryPage, totalPages).map((page) => {
      if (page === "...") return "<span>...</span>";
      return `<button type="button" class="${page === state.libraryPage ? "active" : ""}" data-library-page="${page}">${page}</button>`;
    }).join("")}
    <button type="button" data-library-page="${state.libraryPage + 1}" ${state.libraryPage === totalPages ? "disabled" : ""}>下一页</button>
  ` : "";
}

function renderRanking() {
  const ranked = rankedComics();
  const totalPages = Math.max(1, Math.ceil(ranked.length / RANKING_PAGE_SIZE));
  state.rankingPage = Math.max(1, Math.min(state.rankingPage, totalPages));
  const start = (state.rankingPage - 1) * RANKING_PAGE_SIZE;
  const pageList = ranked.slice(start, start + RANKING_PAGE_SIZE);
  elements.rankingTabs.querySelectorAll("[data-ranking-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.rankingMode === state.rankingMode);
  });
  elements.rankingList.style.setProperty("--rank-start", start);
  elements.rankingList.innerHTML = pageList.map((comic) => {
    const meta = getMeta(comic.id);
    const tags = meta.tags.length ? meta.tags.join(" / ") : "未添加标签";
    const rankValue = state.rankingMode === "views" ? `${meta.views} 次观看` : `${meta.rating.toFixed(1)} 分`;
    return `
      <li data-rank-comic="${escapeHTML(comic.id)}">
        <img src="${coverPreview(comic)}" alt="${escapeHTML(comic.title)} 封面" loading="lazy" decoding="async">
        <div>
          <strong>${escapeHTML(comic.title)}</strong>
          <span>${escapeHTML(tags)}</span>
        </div>
        <em>${rankValue}</em>
      </li>
    `;
  }).join("") || "<li class=\"ranking-empty\">暂无漫画，同步目录后会在这里显示排行。</li>";

  let pager = $("#rankingPager");
  if (!pager) {
    pager = document.createElement("nav");
    pager.id = "rankingPager";
    pager.className = "library-pager ranking-pager";
    pager.setAttribute("aria-label", "排行榜分页");
    elements.rankingList.insertAdjacentElement("afterend", pager);
  }
  pager.innerHTML = ranked.length > RANKING_PAGE_SIZE ? `
    <button type="button" data-ranking-page="${state.rankingPage - 1}" ${state.rankingPage === 1 ? "disabled" : ""}>上一页</button>
    ${libraryPageItems(state.rankingPage, totalPages).map((page) => {
      if (page === "...") return "<span>...</span>";
      return `<button type="button" class="${page === state.rankingPage ? "active" : ""}" data-ranking-page="${page}">${page}</button>`;
    }).join("")}
    <button type="button" data-ranking-page="${state.rankingPage + 1}" ${state.rankingPage === totalPages ? "disabled" : ""}>下一页</button>
  ` : "";
}

function renderCategories() {
  const groups = [...secondLevelCategoryGroups(state.comics).entries()]
    .sort(([a], [b]) => naturalSort(a, b));
  const titleHint = document.querySelector("#categoriesView .section-title span");
  if (titleHint) titleHint.textContent = `共 ${groups.length} 个二级目录`;
  const randomCoverComic = sortedComics()[0];
  const randomCard = randomCoverComic ? `
    <button class="category-cover-card category-random-card" type="button" data-random-comic>
      <img src="${coverPreview(randomCoverComic)}" alt="随机漫画封面" loading="eager" decoding="async">
      <div class="category-cover-shade"></div>
      <span class="category-random-mark" aria-hidden="true">↻</span>
      <div class="category-cover-copy">
        <span>从 ${state.comics.length} 部漫画中抽取</span>
        <h2>随机</h2>
      </div>
    </button>
  ` : "";
  elements.categoryBoard.innerHTML = randomCard + groups.map(([category, comics]) => {
    const sorted = [...comics].sort(compareComicsByUpdated);
    const savedCover = state.categoryCovers[category];
    const coverComic = sorted.find((comic) => comic.id === savedCover) || sorted[0];
    return `
      <article class="category-cover-card" data-category-open="${escapeHTML(category)}">
        <img src="${coverPreview(coverComic)}" alt="${escapeHTML(category)} 分类封面" loading="lazy" decoding="async">
        <div class="category-cover-shade"></div>
        <button class="category-cover-edit" type="button" data-category-cover-edit="${escapeHTML(category)}" title="更换封面" aria-label="更换 ${escapeHTML(category)} 的封面">▣</button>
        <div class="category-cover-copy">
          <span>${comics.length} 部漫画</span>
          <h2>${escapeHTML(category)}</h2>
        </div>
      </article>
    `;
  }).join("") || emptyBlock("暂无二级目录", "分类页仅展示包含二级目录的漫画。");

  if (state.categoryCoverEditor) {
    const comics = secondLevelCategoryGroups(state.comics).get(state.categoryCoverEditor) || [];
    const options = [...comics].sort(compareComicsByUpdated).slice(0, 40);
    elements.categoryBoard.insertAdjacentHTML("beforeend", `
      <div class="category-cover-modal" role="dialog" aria-modal="true" aria-label="选择分类封面">
        <button class="category-cover-backdrop" type="button" data-category-cover-close aria-label="关闭"></button>
        <section class="category-cover-picker">
          <header>
            <div><span>选择封面</span><h2>${escapeHTML(state.categoryCoverEditor)}</h2></div>
            <button type="button" data-category-cover-close aria-label="关闭">×</button>
          </header>
          <div class="category-cover-options">
            ${options.map((comic) => `
              <button type="button" data-category-cover-id="${escapeHTML(comic.id)}" title="${escapeHTML(comic.title)}">
                <img src="${coverPreview(comic)}" alt="${escapeHTML(comic.title)}" loading="lazy" decoding="async">
              </button>
            `).join("")}
          </div>
          <footer><button type="button" data-category-cover-reset>恢复默认封面</button></footer>
        </section>
      </div>
    `);
  }
}

function renderCollectionDetail(collection) {
  const lead = collection.comics[0];
  const totalPages = collection.comics.reduce((sum, comic) => sum + (Number(comic.pageCount) || 0), 0);
  const label = collection.groupType === "folder" ? "文件夹" : "合集";
  const sortedComics = [...collection.comics].sort((a, b) => {
    const result = state.collectionSort === "updated"
      ? comicUpdatedTime(a) - comicUpdatedTime(b) || naturalSort(a.title, b.title)
      : naturalSort(a.title, b.title);
    return state.collectionSortDirection === "desc" ? -result : result;
  });
  elements.comicDetail.innerHTML = `
    <div class="detail-shell collection-detail-shell">
      <nav class="breadcrumb" aria-label="当前位置">
        <a href="#home">首页</a>
        <span>&gt;</span>
        <a href="#library">漫画库</a>
        <span>&gt;</span>
        <strong>${escapeHTML(collection.title)}</strong>
      </nav>
      <section class="collection-detail-hero">
        <aside class="collection-cover-stack">
          <img src="${coverPreview(lead)}" alt="${escapeHTML(collection.title)} 合集封面" decoding="async">
        </aside>
        <section class="collection-summary">
          <h1>${escapeHTML(collection.title)} <span>${label}</span></h1>
          <dl class="plain-meta">
            <div><dt>分类：</dt><dd>${escapeHTML(collection.category)}</dd></div>
            <div><dt>数量：</dt><dd>${collection.comics.length} 部</dd></div>
            <div><dt>页数：</dt><dd>${totalPages}P</dd></div>
            <div><dt>最新：</dt><dd>${escapeHTML(lead.title)}</dd></div>
          </dl>
          <button class="start-reading-button" type="button" data-comic-id="${escapeHTML(lead.id)}">开始阅读</button>
        </section>
      </section>
      <section class="collection-chapters">
        <div class="section-title">
          <h2>章节 / 分卷</h2>
          <div class="collection-sort-bar">
            <span>${collection.comics.length} 部</span>
            <div class="collection-sort-control" role="group" aria-label="章节排序方式">
              <button type="button" class="${state.collectionSort === "name" ? "active" : ""}" data-collection-sort="name">按名称</button>
              <button type="button" class="${state.collectionSort === "updated" ? "active" : ""}" data-collection-sort="updated">按更新时间</button>
            </div>
            <div class="collection-sort-control" role="group" aria-label="排序方向">
              <button type="button" class="${state.collectionSortDirection === "asc" ? "active" : ""}" data-collection-direction="asc">正序</button>
              <button type="button" class="${state.collectionSortDirection === "desc" ? "active" : ""}" data-collection-direction="desc">倒序</button>
            </div>
          </div>
        </div>
        <div class="collection-chapter-list">
          ${sortedComics.map((comic) => `
            <article class="collection-chapter" data-comic-id="${escapeHTML(comic.id)}">
              <img src="${coverPreview(comic)}" alt="${escapeHTML(comic.title)} 封面" loading="lazy" decoding="async">
              <div>
                <h3>${escapeHTML(comic.title)}</h3>
                <p>${escapeHTML(comic.pageCount)} 页 · ${escapeHTML(formatUpdatedAt(comic))}</p>
              </div>
              <button type="button">详情</button>
            </article>
          `).join("")}
        </div>
      </section>
    </div>
  `;
}

function renderDetail() {
  const collection = getSelectedCollection();
  if (collection && !state.selectedComicId) {
    renderMoveModal(null);
    renderCollectionDetail(collection);
    return;
  }

  if (!collection && state.comics.length && state.selectedCollectionKey) {
    state.selectedCollectionKey = "";
    persistSelectedCollection();
    history.replaceState(null, "", "#library");
    setView("library");
    return;
  }

  const comic = getSelectedComic();
  if (!comic) {
    renderMoveModal(null);
    elements.comicDetail.innerHTML = emptyBlock("请选择漫画", "从漫画库、首页或排行榜点击一本漫画进入详情。");
    return;
  }

  const meta = getMeta(comic.id);
  const pages = comicPages(comic);
  const pageSize = detailPageSize();
  const totalPages = Math.max(1, Math.ceil(pages.length / pageSize));
  state.detailPage = Math.max(1, Math.min(state.detailPage, totalPages));
  const start = (state.detailPage - 1) * pageSize;
  const pageSlice = pages.slice(start, start + pageSize);
  const tags = meta.tags;
  const fallbackDescription = `本地漫画目录：${comic.relativeDir || "-"}`;
  const description = meta.description || fallbackDescription;

  elements.comicDetail.innerHTML = `
    <div class="detail-shell">
      <nav class="breadcrumb" aria-label="当前位置">
        <a href="#home">首页</a>
        <span>&gt;</span>
        <a href="#library">漫画库</a>
        <span>&gt;</span>
        <strong>${escapeHTML(comic.title)}</strong>
      </nav>
      <h1 class="detail-title-bar">${escapeHTML(comic.title)}</h1>

      <section class="detail-hero">
        <aside class="detail-cover-actions">
          <img src="${coverPreview(comic)}" alt="${escapeHTML(comic.title)} 封面" decoding="async">
        </aside>

        <section class="detail-summary">
          <dl class="plain-meta">
            <div>
              <dt>分类：</dt>
              <dd class="category-action-row">
                <span>${escapeHTML(comic.category || "未分类")}</span>
                <button class="secondary-button detail-move-button" type="button" data-open-move-comic popovertarget="readerMoveModal">移动</button>
              </dd>
            </div>
            <div><dt>页数：</dt><dd>${comic.pageCount}P</dd></div>
            <div>
              <dt>标签：</dt>
              <dd class="tag-row">
                <span class="inline-tags">${tags.length ? tags.map((tag) => `<button type="button" data-filter-tag="${escapeHTML(tag)}">${escapeHTML(tag)}</button>`).join("") : "<span class=\"muted\">未添加标签</span>"}</span>
                <button class="secondary-button add-tag-trigger" id="openTagEditorButton" type="button">管理标签</button>
                ${state.tagEditorOpen ? `
                  <span class="tag-editor-popover">
                    <input id="tagInput" type="text" placeholder="输入标签">
                    <button class="secondary-button" id="confirmTagButton" type="button">确认</button>
                    <button class="secondary-button" id="cancelTagButton" type="button">取消</button>
                    <span class="tag-manager-list">
                      ${tags.length ? tags.map((tag) => `
                        <span class="tag-manager-item">
                          ${escapeHTML(tag)}
                          <button type="button" data-manage-remove-tag="${escapeHTML(tag)}" aria-label="删除 ${escapeHTML(tag)}">×</button>
                        </span>
                      `).join("") : "<span class=\"muted\">暂无标签</span>"}
                    </span>
                  </span>
                ` : ""}
                <span class="tag-editor legacy-tag-editor" hidden>
                  <input id="legacyTagInput" type="text" placeholder="例如：热血、悬疑、已读">
                  <button class="secondary-button" id="addTagButton" type="button">+TAG</button>
                </span>
              </dd>
            </div>
            <div>
              <dt>评分：</dt>
              <dd class="star-rating" aria-label="评分，最高五星">
                ${Array.from({ length: 5 }, (_, index) => {
                  const value = index + 1;
                  const active = value <= Math.round(meta.rating);
                  return `<button type="button" class="${active ? "active" : ""}" data-rating-star="${value}" aria-label="${value} 星">★</button>`;
                }).join("")}
                <span>${Math.round(meta.rating)} / 5</span>
              </dd>
            </div>
            <div><dt>简介：</dt><dd class="description">本地漫画目录：${escapeHTML(comic.relativeDir || "-")}</dd></div>
            <div>
              <dt>简介：</dt>
              <dd class="description editable-description">
                ${state.descriptionEditorOpen ? `
                  <span class="description-editor">
                    <textarea id="descriptionInput" rows="6">${escapeHTML(description)}</textarea>
                    <span class="description-actions">
                      <button class="secondary-button" id="confirmDescriptionButton" type="button">确认</button>
                      <button class="secondary-button" id="cancelDescriptionButton" type="button">取消</button>
                    </span>
                  </span>
                ` : `
                  <span class="description-text">${escapeHTML(description)}</span>
                  <button class="secondary-button description-edit-button" id="editDescriptionButton" type="button">编辑</button>
                `}
              </dd>
            </div>
          </dl>
          <button class="start-reading-button" id="readButton" type="button">开始阅读</button>
        </section>

      </section>

      <section class="preview-grid">
        ${pageSlice.map((src, index) => {
          const pageNumber = start + index;
          const label = pageLabel(src, pageNumber);
          return `
            <article class="page-thumb" data-page-index="${pageNumber}">
              <img src="${imagePreview(src)}" alt="${escapeHTML(comic.title)} ${escapeHTML(label)}" loading="lazy" decoding="async">
              <h3>${escapeHTML(label)}</h3>
            </article>
          `;
        }).join("")}
      </section>

      <nav class="detail-pager" aria-label="详情页分页">
        <button type="button" data-detail-page="${Math.max(1, state.detailPage - 1)}" ${state.detailPage === 1 ? "disabled" : ""}>上一页</button>
        ${libraryPageItems(state.detailPage, totalPages).map((page) => {
          if (page === "...") return "<span>...</span>";
          return `<button type="button" class="${page === state.detailPage ? "active" : ""}" data-detail-page="${page}">${page}</button>`;
        }).join("")}
        <button type="button" data-detail-page="${Math.min(totalPages, state.detailPage + 1)}" ${state.detailPage === totalPages ? "disabled" : ""}>下一页</button>
      </nav>
    </div>
  `;
  renderMoveModal(comic);
}

function renderReader() {
  const comic = getSelectedComic();

  elements.deleteComicButton.disabled = !comic;
  elements.deletePageButton.disabled = !comic;
  renderMoveModal(comic);
  if (comic) {
    elements.readerDeleteName.textContent = comic.title;
  }

  if (!comic) {
    elements.pageSelect.innerHTML = "";
    elements.readerStage.innerHTML = "<p class=\"empty-state\">从漫画库选择一本漫画开始阅读。</p>";
    elements.progressLabel.textContent = "0 / 0";
    elements.progressBar.style.width = "0%";
    if (elements.prevPage) elements.prevPage.disabled = true;
    if (elements.nextPage) elements.nextPage.disabled = true;
    return;
  }

  const pages = comicPages(comic);
  elements.deletePageButton.disabled = pages.length <= 1;
  if (!pages.length) {
    elements.pageSelect.innerHTML = "";
    elements.readerStage.className = `reader-stage mode-${state.mode}${state.autoFit ? " auto-fit" : ""}`;
    elements.readerStage.innerHTML = "<p class=\"empty-state\">这本漫画没有可显示的图片。</p>";
    updateReaderProgress(comic);
    if (elements.prevPage) elements.prevPage.disabled = true;
    if (elements.nextPage) elements.nextPage.disabled = true;
    return;
  }

  state.pageIndex = Math.max(0, Math.min(Number(state.pageIndex) || 0, pages.length - 1));
  elements.readerDeletePageName.textContent = `第 ${state.pageIndex + 1} / ${pages.length} 页 · ${pageLabel(pages[state.pageIndex], state.pageIndex)}`;
  elements.pageSelect.innerHTML = pages.map((_, index) => `<option value="${index}">第 ${index + 1} 页</option>`).join("");
  elements.pageSelect.value = String(state.pageIndex);
  elements.slideReader.classList.toggle("controls-open", state.controlsOpen);
  elements.slideReader.classList.toggle("reader-night", state.readerNight);
  elements.readerThemeToggle.textContent = state.readerNight ? "☾" : "☀";
  elements.autoToggle.textContent = state.autoPlay
    ? state.mode === "scroll"
      ? `自动：${state.autoPixels}px`
      : `自动：${state.autoSeconds}s`
    : "自动：关";
  elements.autoToggle.classList.toggle("active", state.autoPlay);
  elements.autoToggle.textContent = state.autoPlay
    ? state.mode === "scroll"
      ? `自动：${state.autoPixels}px`
      : `自动：${state.autoSeconds}s`
    : "自动：关";
  elements.autoPopover.hidden = !(state.autoSettingsOpen && state.autoPlay);
  if (state.mode === "scroll") {
    elements.autoInterval.min = "100";
    elements.autoInterval.max = "2400";
    elements.autoInterval.step = "50";
    elements.autoInterval.value = String(state.autoPixels);
  } else {
    elements.autoInterval.min = "1";
    elements.autoInterval.max = "30";
    elements.autoInterval.step = "1";
    elements.autoInterval.value = String(state.autoSeconds);
  }
  const autoMin = Number(elements.autoInterval.min);
  const autoMax = Number(elements.autoInterval.max);
  const autoValue = Number(elements.autoInterval.value);
  const autoPercent = autoMax > autoMin ? (autoValue - autoMin) / (autoMax - autoMin) : 0;
  elements.autoPopover.style.setProperty("--auto-thumb-top", `${23 + (1 - autoPercent) * 140}px`);
  state.imageWidth = clampImageWidth(state.imageWidth);
  elements.fitToggle.textContent = state.autoFit ? "自适应：开" : "自适应";
  elements.fitToggle.classList.toggle("active", state.autoFit);
  elements.widthControl.hidden = state.autoFit;
  elements.imageWidth.value = String(state.imageWidth);
  elements.readingMode.value = state.mode;
  elements.readerTopbar.querySelectorAll("[data-reader-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.readerMode === state.mode);
  });
  elements.readerStage.className = `reader-stage mode-${state.mode}${state.autoFit ? " auto-fit" : ""}`;
  elements.readerStage.style.setProperty("--reader-brightness", Number(elements.brightness.value) / 100);
  elements.readerStage.style.setProperty("--reader-image-width", `${state.imageWidth}vw`);

  if (state.mode === "scroll") {
    const end = loadedScrollEnd(pages.length);
    state.readerScrollEnd = end;
    const visiblePages = pages.slice(0, end);
    elements.readerStage.innerHTML = `
      ${visiblePages.map((src, offset) => {
        return readerScrollImageHTML(comic, src, offset);
      }).join("")}
      ${end < pages.length ? `<button class="reader-window-button" type="button" data-reader-window="${end}">加载下一组</button>` : ""}
    `;
  } else {
    const currentSrc = pages[state.pageIndex];
    elements.readerStage.innerHTML = `
      <button class="reader-hotspot reader-hotspot-left" type="button" data-reader-step="-1" aria-label="上一页"></button>
      ${currentSrc
        ? `<img src="${escapeHTML(currentSrc)}" loading="eager" decoding="async" alt="${escapeHTML(comic.title)} 第 ${state.pageIndex + 1} 页">`
        : "<p class=\"empty-state\">当前图片地址为空，请返回详情页重新打开。</p>"}
      <button class="reader-hotspot reader-hotspot-right" type="button" data-reader-step="1" aria-label="下一页"></button>
    `;
  }

  applyAdaptiveImageSizing();
  updateReaderProgress(comic);
  if (state.mode === "scroll") requestAnimationFrame(syncScrollPageIndex);
  if (state.mode === "single") requestAnimationFrame(checkReaderCompletion);
  if (elements.prevPage) elements.prevPage.disabled = state.pageIndex === 0;
  if (elements.nextPage) elements.nextPage.disabled = state.pageIndex === pages.length - 1;
}

function stopAutoPlay() {
  state.autoPlay = false;
  state.autoSettingsOpen = false;
  if (autoTimer) {
    clearInterval(autoTimer);
    autoTimer = null;
  }
  if (autoFrame) {
    cancelAnimationFrame(autoFrame);
    autoFrame = null;
  }
  autoLastTime = 0;
  autoScrollTop = 0;
}

function startAutoPlay() {
  const comic = getSelectedComic();
  if (!comic) return;
  stopAutoPlay();
  state.autoPlay = true;
  state.autoSettingsOpen = true;
  if (state.mode === "scroll") {
    autoScrollTop = window.scrollY;
    const step = (timestamp) => {
      if (!state.autoPlay || state.view !== "reader" || state.mode !== "scroll") {
        stopAutoPlay();
        renderReader();
        return;
      }
      if (!autoLastTime) autoLastTime = timestamp;
      const deltaSeconds = Math.min(0.08, (timestamp - autoLastTime) / 1000);
      autoLastTime = timestamp;
      const speed = Math.max(50, state.autoPixels);
      autoScrollTop += speed * deltaSeconds;
      window.scrollTo(0, autoScrollTop);
      syncScrollPageIndex();
      autoAppendReaderScrollPages();
      const atBottom = window.innerHeight + autoScrollTop >= document.documentElement.scrollHeight - 2;
      if (atBottom) {
        stopAutoPlay();
        renderReader();
        return;
      }
      autoFrame = requestAnimationFrame(step);
    };
    autoFrame = requestAnimationFrame(step);
    return;
  }
  autoTimer = setInterval(() => {
    const current = getSelectedComic();
    if (!current || state.view !== "reader") {
      stopAutoPlay();
      renderReader();
      return;
    }
    const pages = comicPages(current);
    if (state.pageIndex >= pages.length - 1) {
      stopAutoPlay();
      renderReader();
      return;
    }
    state.pageIndex = Math.min(pages.length - 1, state.pageIndex + 1);
    renderReader();
  }, state.autoSeconds * 1000);
}

function renderAll() {
  renderTags();
  renderCurrentView();
}

async function deleteSelectedComic() {
  const comic = getSelectedComic();
  if (!comic) throw new Error("未找到当前漫画");
  elements.confirmDeleteComicButton.disabled = true;
  elements.confirmDeleteComicButton.textContent = "删除中...";
  try {
    await api(`/api/comics/${encodeURIComponent(comic.id)}`, { method: "DELETE" });
    state.comics = state.comics.filter((item) => item.id !== comic.id);
    delete state.meta[comic.id];
    invalidateDerivedCache();
    state.selectedComicId = "";
    if (elements.readerDeleteModal.matches(":popover-open")) elements.readerDeleteModal.hidePopover();
    persistSelectedComic();
    stopAutoPlay();
    renderAll();
    navigateToView("library");
    setStatus(`已永久删除：${comic.title}`, "ok");
  } finally {
    elements.confirmDeleteComicButton.disabled = false;
    elements.confirmDeleteComicButton.textContent = "永久删除";
  }
}

async function deleteSelectedPage() {
  const comic = getSelectedComic();
  if (!comic) throw new Error("未找到当前漫画");
  const pages = comicPages(comic);
  if (pages.length <= 1) throw new Error("至少需要保留一张图片");
  const deletedPage = state.pageIndex + 1;
  elements.confirmDeletePageButton.disabled = true;
  elements.confirmDeletePageButton.textContent = "删除中...";
  try {
    const result = await api(`/api/comics/${encodeURIComponent(comic.id)}/pages/${state.pageIndex}`, { method: "DELETE" });
    const updatedComic = mergeComic(result.comic);
    const nextPages = comicPages(updatedComic);
    state.pageIndex = Math.max(0, Math.min(state.pageIndex, nextPages.length - 1));
    state.readerScrollEnd = Math.min(nextPages.length, Math.max(READER_SCROLL_WINDOW, state.readerScrollEnd - 1));
    completedComicId = "";
    invalidateDerivedCache();
    if (elements.readerDeletePageModal.matches(":popover-open")) elements.readerDeletePageModal.hidePopover();
    renderReader();
    setStatus(`已永久删除第 ${deletedPage} 页`, "ok");
  } finally {
    elements.confirmDeletePageButton.disabled = false;
    elements.confirmDeletePageButton.textContent = "永久删除此页";
  }
}

async function moveSelectedComic() {
  const comic = getSelectedComic();
  if (!comic) throw new Error("未找到当前漫画");
  const category = elements.moveCategorySelect.value || "未分类";
  setMoveStatus("正在移动本地文件夹...", "");
  elements.confirmMoveComicButton.disabled = true;
  elements.confirmMoveComicButton.textContent = "移动中...";
  try {
    const result = await api(`/api/comics/${encodeURIComponent(comic.id)}/move`, {
      method: "PUT",
      body: JSON.stringify({ category })
    });
    const movedComic = mergeComic(result.comic);
    state.comics = state.comics.map((item) => item.id === (result.oldId || comic.id) ? movedComic : item);
    if (result.metadata && typeof result.metadata === "object") {
      state.meta = result.metadata;
    } else if (movedComic.id !== comic.id && state.meta[comic.id]) {
      state.meta[movedComic.id] = state.meta[comic.id];
      delete state.meta[comic.id];
    }
    state.selectedComicId = movedComic.id;
    persistSelectedComic();
    invalidateDerivedCache();
    if (elements.readerMoveModal.matches(":popover-open")) elements.readerMoveModal.hidePopover();
    setMoveStatus("", "");
    renderAll();
    setStatus(result.moved ? `已移动到分类：${movedComic.category || "未分类"}` : "漫画已经在目标分类中", "ok");
  } finally {
    elements.confirmMoveComicButton.disabled = false;
    elements.confirmMoveComicButton.textContent = "移动漫画";
  }
}

function showReaderComplete(comic) {
  if (!comic || completedComicId === comic.id || !elements.readerCompleteToast) return;
  completedComicId = comic.id;
  elements.readerCompleteToast.hidden = false;
  elements.readerCompleteToast.classList.add("visible");
  clearTimeout(readerCompleteTimer);
  readerCompleteTimer = setTimeout(() => {
    elements.readerCompleteToast.classList.remove("visible");
    setTimeout(() => {
      elements.readerCompleteToast.hidden = true;
    }, 180);
  }, 2600);
}

function checkReaderCompletion() {
  if (state.view !== "reader") return;
  const comic = getSelectedComic();
  if (!comic) return;
  const pages = comicPages(comic);
  if (!pages.length) return;
  if (state.mode === "single") {
    if (state.pageIndex >= pages.length - 1) showReaderComplete(comic);
    return;
  }
  const allPagesLoaded = loadedScrollEnd(pages.length) >= pages.length;
  const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
  if (allPagesLoaded && atBottom) showReaderComplete(comic);
}

function renderCurrentView() {
  if (state.view === "home") renderHome();
  if (state.view === "library") renderLibrary();
  if (state.view === "ranking") renderRanking();
  if (state.view === "categories") renderCategories();
  if (state.view === "detail") renderDetail();
  if (state.view === "reader") renderReader();
}

function emptyBlock(title, body) {
  return `<div class="empty-card"><h3>${escapeHTML(title)}</h3><p>${escapeHTML(body)}</p></div>`;
}

function renderRootList() {
  if (!elements.rootList) return;
  elements.rootList.innerHTML = state.libraryRoots.length
    ? state.libraryRoots.map((root) => `
      <div class="root-list-item">
        <span title="${escapeHTML(root)}">${escapeHTML(root)}</span>
        <button type="button" data-remove-root="${escapeHTML(root)}">移除</button>
      </div>
    `).join("")
    : "<span class=\"muted\">还没有导入漫画根目录。</span>";
}

async function openComic(id) {
  if (state.selectedComicId !== id) completedComicId = "";
  state.selectedComicId = id;
  persistSelectedComic();
  state.pageIndex = 0;
  state.detailPage = 1;
  state.readerScrollEnd = READER_SCROLL_WINDOW;
  history.pushState({ comicId: id }, "", "#detail");
  setView("detail");
  await ensureComicPages(id);
  renderDetail();
}

function openCollection(key) {
  state.selectedCollectionKey = key;
  persistSelectedCollection();
  state.selectedComicId = "";
  state.pageIndex = 0;
  state.detailPage = 1;
  persistSelectedComic();
  navigateToView("detail");
}

async function loadLibrary({ refresh = false } = {}) {
  const data = await api(refresh ? "/api/library?refresh=1" : "/api/library");
  state.libraryRoot = data.libraryRoot || "";
  state.libraryRoots = data.libraryRoots || (state.libraryRoot ? [state.libraryRoot] : []);
  state.comics = data.comics || [];
  state.meta = data.metadata || {};
  const serverCategoryCovers = data.categoryCovers && typeof data.categoryCovers === "object"
    ? data.categoryCovers
    : {};
  if (Object.keys(serverCategoryCovers).length) {
    state.categoryCovers = serverCategoryCovers;
    localStorage.setItem(CATEGORY_COVERS_STORAGE_KEY, JSON.stringify(state.categoryCovers));
  } else if (Object.keys(state.categoryCovers).length) {
    await persistCategoryCovers();
  }
  invalidateDerivedCache();
  elements.libraryPath.value = "";
  if (state.activeTag !== "全部" && !allTags().includes(state.activeTag)) state.activeTag = "全部";
  if (state.activeCategory !== "全部" && !categoryPathOptions().includes(state.activeCategory)) state.activeCategory = "全部";
  persistLibraryView();
  const currentComicStillExists = state.comics.some((comic) => comic.id === state.selectedComicId);
  if (!currentComicStillExists && state.view !== "detail" && state.view !== "reader") {
    state.selectedComicId = state.comics[0]?.id || "";
    persistSelectedComic();
  }
  if ((state.view === "detail" || state.view === "reader") && state.selectedComicId) {
    await ensureComicPages(state.selectedComicId);
  }
  renderRootList();
  renderAll();
  setStatus(state.libraryRoots.length ? `已导入 ${state.libraryRoots.length} 个漫画根目录${data.scanning ? "（后台同步中）" : ""}` : "请添加漫画根目录。", state.libraryRoots.length ? "ok" : "");
  if (data.scanning) {
    startBackgroundProgressPolling();
  } else if (!backgroundProgressTimer) {
    renderSyncProgress(null);
  }
}

async function scanPath(pathValue) {
  const libraryRoot = pathValue.trim();
  if (!libraryRoot) {
    setStatus("请输入漫画根目录。", "error");
    return;
  }
  await withSyncProgress({
    status: "正在添加目录并同步...",
    detail: "正在添加漫画根目录...",
    task: async () => {
      await api("/api/config", {
        method: "POST",
        body: JSON.stringify({ libraryRoots: [...state.libraryRoots, libraryRoot] })
      });
      await loadLibrary({ refresh: true });
      return { comicCount: state.comics.length };
    },
    completionDetail: (result) => `共发现 ${result.comicCount} 本漫画`
  });
  setStatus(`目录添加完成：${state.comics.length} 本漫画`, "ok");
  setTimeout(() => renderSyncProgress(null), 1200);
  location.hash = "library";
}

async function selectDirectoryAndScan() {
  setStatus("正在打开目录选择器...");
  const initial = elements.libraryPath.value.trim() || state.libraryRoot || "";
  const selected = await api(`/api/select-directory?initial=${encodeURIComponent(initial)}`, { timeoutMs: 120000 });
  if (selected.canceled || !selected.path) {
    setStatus("已取消选择目录。");
    return;
  }
  elements.libraryPath.value = selected.path;
  await scanPath(selected.path);
}

async function syncLibrary() {
  if (!state.libraryRoots.length) {
    setStatus("请先添加漫画根目录。", "error");
    return;
  }
  const data = await withSyncProgress({
    status: "正在同步本地漫画目录...",
    detail: "正在读取漫画根目录...",
    task: () => api("/api/sync", { method: "POST" }),
    completionDetail: (result) => `共发现 ${result.comics?.length || 0} 本漫画`
  });
  state.libraryRoot = data.libraryRoot || "";
  state.libraryRoots = data.libraryRoots || [];
  state.comics = data.comics || [];
  state.meta = data.metadata || {};
  invalidateDerivedCache();
  const currentComicStillExists = state.comics.some((comic) => comic.id === state.selectedComicId);
  if (!currentComicStillExists && state.view !== "detail" && state.view !== "reader") {
    state.selectedComicId = state.comics[0]?.id || "";
    persistSelectedComic();
  }
  if ((state.view === "detail" || state.view === "reader") && state.selectedComicId) {
    await ensureComicPages(state.selectedComicId);
  }
  renderRootList();
  renderAll();
  setStatus(`同步完成：${state.comics.length} 本漫画`, "ok");
  setTimeout(() => renderSyncProgress(null), 1200);
}

async function persistMeta(id, nextMeta) {
  const normalizedMeta = {
    rating: Math.max(0, Math.min(5, Number(nextMeta.rating) || 0)),
    tags: Array.isArray(nextMeta.tags) ? nextMeta.tags : [],
    views: Math.max(0, Math.floor(Number(nextMeta.views) || 0)),
    description: typeof nextMeta.description === "string" ? nextMeta.description.slice(0, 2000) : ""
  };
  state.meta[id] = normalizedMeta;
  invalidateDerivedCache();
  renderAll();
  await api(`/api/comics/${encodeURIComponent(id)}/metadata`, {
    method: "PUT",
    body: JSON.stringify(normalizedMeta)
  });
}

async function incrementViews() {
  const comic = getSelectedComic();
  if (!comic) return;
  const meta = getMeta(comic.id);
  await persistMeta(comic.id, { ...meta, views: meta.views + 1 });
}

async function updateRating(value) {
  const comic = getSelectedComic();
  if (!comic) return;
  const rating = Math.max(0, Math.min(5, Math.round(Number(value) || 0)));
  await persistMeta(comic.id, { ...getMeta(comic.id), rating });
  renderDetail();
}

async function updateDescription(value) {
  const comic = getSelectedComic();
  if (!comic) return;
  await persistMeta(comic.id, { ...getMeta(comic.id), description: value.trim() });
}

async function addTag(value) {
  const comic = getSelectedComic();
  const tag = value.trim();
  if (!comic || !tag) return;
  const meta = getMeta(comic.id);
  state.tagEditorOpen = false;
  await persistMeta(comic.id, { ...meta, tags: [...new Set([...meta.tags, tag])] });
}

async function removeTag(tag) {
  const comic = getSelectedComic();
  if (!comic) return;
  const meta = getMeta(comic.id);
  if (state.activeTag === tag) state.activeTag = "全部";
  await persistMeta(comic.id, { ...meta, tags: meta.tags.filter((item) => item !== tag) });
  persistLibraryView();
  state.tagEditorOpen = true;
  renderDetail();
}

elements.pathForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const typedPath = elements.libraryPath.value.trim();
    if (typedPath) {
      await scanPath(typedPath);
    } else {
      await selectDirectoryAndScan();
    }
  } catch (error) {
    setStatus(friendlyError(error), "error");
  }
});

if (elements.syncLibraryButton) elements.syncLibraryButton.addEventListener("click", async () => {
  try {
    await syncLibrary();
  } catch (error) {
    setStatus(friendlyError(error), "error");
  }
});

if (elements.rootList) elements.rootList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-remove-root]");
  if (!button) return;
  try {
    const nextRoots = state.libraryRoots.filter((root) => root !== button.dataset.removeRoot);
    setStatus("正在更新目录列表...");
    await api("/api/config", {
      method: "POST",
      body: JSON.stringify({ libraryRoots: nextRoots })
    });
    await loadLibrary({ refresh: true });
  } catch (error) {
    setStatus(friendlyError(error), "error");
  }
});

elements.settingsToggle.addEventListener("click", () => {
  elements.libraryConfig.hidden = !elements.libraryConfig.hidden;
  elements.settingsToggle.classList.toggle("active", !elements.libraryConfig.hidden);
});

elements.headerSearch.addEventListener("submit", (event) => {
  event.preventDefault();
  state.search = elements.searchInput.value;
  state.libraryPage = 1;
  renderLibrary();
  location.hash = "library";
});

elements.searchInput.addEventListener("input", () => {
  state.search = elements.searchInput.value;
  state.libraryPage = 1;
  renderLibrary();
});

elements.tagFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  state.activeCategory = button.dataset.category;
  state.activeTag = allTags()[0];
  state.libraryPage = 1;
  persistLibraryView();
  renderAll();
});

elements.libraryPager.addEventListener("click", (event) => {
  const button = event.target.closest("[data-library-page]");
  if (!button || button.disabled) return;
  state.libraryPage = Number(button.dataset.libraryPage);
  persistLibraryView();
  renderLibrary();
  document.querySelector("#libraryView .section-title")?.scrollIntoView({ block: "start" });
});

elements.comicGrid.addEventListener("click", (event) => {
  const categoryButton = event.target.closest("[data-category-more], [data-category-path]");
  if (!categoryButton) return;
  state.activeCategory = categoryButton.dataset.categoryMore || categoryButton.dataset.categoryPath;
  state.activeTag = allTags()[0];
  state.search = "";
  elements.searchInput.value = "";
  state.libraryPage = 1;
  persistLibraryView();
  renderAll();
  location.hash = "library";
  document.querySelector("#libraryView .section-title")?.scrollIntoView({ block: "start" });
});

elements.categoryBoard.addEventListener("click", async (event) => {
  const closeButton = event.target.closest("[data-category-cover-close]");
  if (closeButton) {
    state.categoryCoverEditor = "";
    renderCategories();
    return;
  }

  const coverOption = event.target.closest("[data-category-cover-id]");
  if (coverOption && state.categoryCoverEditor) {
    state.categoryCovers[state.categoryCoverEditor] = coverOption.dataset.categoryCoverId;
    await persistCategoryCovers();
    state.categoryCoverEditor = "";
    renderCategories();
    return;
  }

  const resetButton = event.target.closest("[data-category-cover-reset]");
  if (resetButton && state.categoryCoverEditor) {
    delete state.categoryCovers[state.categoryCoverEditor];
    await persistCategoryCovers();
    state.categoryCoverEditor = "";
    renderCategories();
    return;
  }

  const editButton = event.target.closest("[data-category-cover-edit]");
  if (editButton) {
    state.categoryCoverEditor = editButton.dataset.categoryCoverEdit;
    renderCategories();
    return;
  }

  const card = event.target.closest("[data-category-open]");
  if (!card) return;
  state.activeCategory = card.dataset.categoryOpen;
  state.activeTag = "全部";
  state.search = "";
  state.libraryPage = 1;
  elements.searchInput.value = "";
  persistLibraryView();
  renderAll();
  navigateToView("library");
});

elements.rankingTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-ranking-mode]");
  if (!button) return;
  state.rankingMode = button.dataset.rankingMode;
  state.rankingPage = 1;
  renderRanking();
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-ranking-page]");
  if (!button || button.disabled) return;
  state.rankingPage = Number(button.dataset.rankingPage);
  renderRanking();
  document.querySelector("#rankingView .section-title")?.scrollIntoView({ block: "start" });
});

elements.homeFolders.addEventListener("click", (event) => {
  const link = event.target.closest("[data-home-category]");
  if (!link) return;
  state.activeTag = "全部";
  state.activeCategory = link.dataset.homeCategory;
  state.libraryPage = 1;
  persistLibraryView();
  renderAll();
});

document.addEventListener("click", (event) => {
  const randomTarget = event.target.closest("[data-random-comic]");
  if (randomTarget) {
    if (!state.comics.length) return;
    const comic = state.comics[Math.floor(Math.random() * state.comics.length)];
    openComic(comic.id).catch((error) => {
      setStatus(`随机打开失败：${friendlyError(error)}`, "error");
    });
    return;
  }

  const collectionTarget = event.target.closest("[data-collection-key]");
  if (collectionTarget) {
    openCollection(collectionTarget.dataset.collectionKey);
    return;
  }

  const comicTarget = event.target.closest("[data-comic-id], [data-rank-comic]");
  if (comicTarget) {
    openComic(comicTarget.dataset.comicId || comicTarget.dataset.rankComic).catch((error) => {
      setStatus(friendlyError(error), "error");
    });
  }
});

elements.comicDetail.addEventListener("change", async (event) => {
  if (event.target.id !== "ratingInput") return;
  try {
    await updateRating(event.target.value);
  } catch (error) {
    setStatus(friendlyError(error), "error");
  }
});

elements.comicDetail.addEventListener("click", async (event) => {
  try {
    const collectionSortButton = event.target.closest("[data-collection-sort]");
    const collectionDirectionButton = event.target.closest("[data-collection-direction]");
    const removeButton = event.target.closest("[data-remove-tag]");
    const managedRemoveButton = event.target.closest("[data-manage-remove-tag]");
    const filterTagButton = event.target.closest("[data-filter-tag]");
    const detailPageButton = event.target.closest("[data-detail-page]");
    const thumb = event.target.closest("[data-page-index]");
    const ratingStar = event.target.closest("[data-rating-star]");

    if (collectionSortButton) {
      state.collectionSort = collectionSortButton.dataset.collectionSort;
      renderDetail();
      return;
    }
    if (collectionDirectionButton) {
      state.collectionSortDirection = collectionDirectionButton.dataset.collectionDirection;
      renderDetail();
      return;
    }
    if (removeButton && !removeButton.disabled) await removeTag(removeButton.dataset.removeTag);
    if (managedRemoveButton) await removeTag(managedRemoveButton.dataset.manageRemoveTag);
    if (filterTagButton) {
      state.activeTag = filterTagButton.dataset.filterTag;
      state.activeCategory = "全部";
      state.search = "";
      elements.searchInput.value = "";
      state.libraryPage = 1;
      persistLibraryView();
      renderAll();
      location.hash = "library";
      return;
    }
    if (ratingStar) await updateRating(ratingStar.dataset.ratingStar);
    if (detailPageButton && !detailPageButton.disabled) {
      state.detailPage = Number(detailPageButton.dataset.detailPage);
      renderDetail();
    }
    if (thumb) {
      await ensureComicPages();
      state.pageIndex = Number(thumb.dataset.pageIndex) || 0;
      state.mode = "single";
      state.controlsOpen = false;
      await incrementViews();
      navigateToView("reader");
      return;
    }
    if (event.target.id === "openTagEditorButton") {
      state.tagEditorOpen = true;
      renderDetail();
      requestAnimationFrame(() => $("#tagInput")?.focus());
    }
    if (event.target.id === "confirmTagButton") await addTag($("#tagInput")?.value || "");
    if (event.target.id === "cancelTagButton") {
      state.tagEditorOpen = false;
      renderDetail();
    }
    if (event.target.id === "addTagButton") await addTag($("#tagInput")?.value || "");
    if (event.target.id === "editDescriptionButton") {
      state.descriptionEditorOpen = true;
      renderDetail();
      requestAnimationFrame(() => $("#descriptionInput")?.focus());
    }
    if (event.target.id === "confirmDescriptionButton") {
      await updateDescription($("#descriptionInput")?.value || "");
      state.descriptionEditorOpen = false;
      renderDetail();
    }
    if (event.target.id === "cancelDescriptionButton") {
      state.descriptionEditorOpen = false;
      renderDetail();
    }
    if (event.target.id === "readButton") {
      await ensureComicPages();
      state.pageIndex = 0;
      state.mode = "scroll";
      state.readerScrollEnd = READER_SCROLL_WINDOW;
      state.controlsOpen = false;
      completedComicId = "";
      await incrementViews();
      navigateToView("reader");
      return;
    }
  } catch (error) {
    setStatus(friendlyError(error), "error");
  }
});

elements.comicDetail.addEventListener("keydown", async (event) => {
  if (event.key === "Enter" && event.target.id === "tagInput") {
    event.preventDefault();
    try {
      await addTag(event.target.value);
    } catch (error) {
      setStatus(friendlyError(error), "error");
    }
  }
  if (event.key === "Enter" && event.ctrlKey && event.target.id === "descriptionInput") {
    event.preventDefault();
    try {
      await updateDescription(event.target.value);
      state.descriptionEditorOpen = false;
      renderDetail();
    } catch (error) {
      setStatus(friendlyError(error), "error");
    }
  }
});

if (elements.prevPage) elements.prevPage.addEventListener("click", () => {
  state.pageIndex -= 1;
  renderReader();
});

if (elements.nextPage) elements.nextPage.addEventListener("click", () => {
  state.pageIndex += 1;
  renderReader();
});

if (elements.pageSelect) elements.pageSelect.addEventListener("change", () => {
  state.pageIndex = Number(elements.pageSelect.value);
  renderReader();
});

elements.readerStage.addEventListener("click", (event) => {
  const windowButton = event.target.closest("[data-reader-window]");
  if (windowButton) {
    state.readerScrollEnd = Number(windowButton.dataset.readerWindow);
    appendReaderScrollPages();
    return;
  }

  const hotspot = event.target.closest("[data-reader-step]");
  if (!hotspot) {
    state.controlsOpen = !state.controlsOpen;
    renderReader();
    return;
  }
  const comic = getSelectedComic();
  if (!comic) return;
  const pages = comicPages(comic);
  state.pageIndex = Math.max(0, Math.min(pages.length - 1, state.pageIndex + Number(hotspot.dataset.readerStep)));
  renderReader();
});

elements.readingMode.addEventListener("change", () => {
  state.mode = elements.readingMode.value;
  renderReader();
});

if (elements.fitMode) {
  elements.fitMode.addEventListener("change", () => {
    state.fit = elements.fitMode.value;
    renderReader();
  });
}

elements.imageWidth.addEventListener("input", () => {
  state.imageWidth = clampImageWidth(elements.imageWidth.value);
  state.customWidth = true;
  state.autoFit = false;
  renderReader();
});

elements.brightness.addEventListener("input", renderReader);

elements.readerTopbar.addEventListener("click", (event) => {
  const backLink = event.target.closest("a.reader-pill[href='#detail']");
  if (backLink) {
    event.preventDefault();
    if (state.selectedCollectionKey) {
      state.selectedComicId = "";
      persistSelectedComic();
    }
    navigateToView("detail");
    return;
  }
  const modeButton = event.target.closest("[data-reader-mode]");
  if (modeButton) {
    state.mode = modeButton.dataset.readerMode;
    if (state.autoPlay) startAutoPlay();
    renderReader();
    return;
  }
  if (event.target.closest("#autoToggle")) {
    state.autoSettingsOpen = true;
    if (state.autoPlay) {
      stopAutoPlay();
    } else {
      startAutoPlay();
    }
    renderReader();
    return;
  }
  if (event.target.closest("#readerThemeToggle")) {
    state.readerNight = !state.readerNight;
    renderReader();
    return;
  }
  if (event.target.closest("#fitToggle")) {
    state.autoFit = !state.autoFit;
    state.customWidth = true;
    renderReader();
  }
});

elements.autoInterval.addEventListener("input", () => {
  if (state.mode === "scroll") {
    state.autoPixels = Math.max(100, Math.min(2400, Number(elements.autoInterval.value) || 800));
  } else {
    state.autoSeconds = Math.max(1, Math.min(30, Number(elements.autoInterval.value) || 5));
  }
  if (state.autoPlay) startAutoPlay();
  renderReader();
});

window.addEventListener("keydown", (event) => {
  if (state.view !== "reader") return;
  if (event.key.toLowerCase() === "s") {
    state.mode = state.mode === "scroll" ? "single" : "scroll";
    elements.readingMode.value = state.mode;
    renderReader();
    return;
  }
  if (state.mode === "scroll") return;
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== " ") return;
  const comic = getSelectedComic();
  if (!comic) return;
  event.preventDefault();
  const delta = event.key === "ArrowLeft" ? -1 : 1;
  const pages = comicPages(comic);
  state.pageIndex = Math.max(0, Math.min(pages.length - 1, state.pageIndex + delta));
  renderReader();
});

window.addEventListener("resize", () => {
  if (state.view === "reader" && state.autoFit) {
    applyAdaptiveImageSizing();
    syncScrollPageIndex();
  }
});

window.addEventListener("scroll", () => {
  if (scrollSyncFrame) return;
  scrollSyncFrame = requestAnimationFrame(() => {
    scrollSyncFrame = null;
    syncScrollPageIndex();
    autoAppendReaderScrollPages();
    checkReaderCompletion();
  });
});

elements.readerDeleteModal.addEventListener("click", async (event) => {
  if (event.target.closest("[data-delete-cancel]")) {
    return;
  }
  if (!event.target.closest("#confirmDeleteComicButton")) return;
  try {
    await deleteSelectedComic();
  } catch (error) {
    setStatus(`删除失败：${friendlyError(error)}`, "error");
  }
});

elements.readerDeletePageModal.addEventListener("click", async (event) => {
  if (event.target.closest("[data-delete-page-cancel]")) return;
  if (!event.target.closest("#confirmDeletePageButton")) return;
  try {
    await deleteSelectedPage();
  } catch (error) {
    setStatus(`删除当前页失败：${friendlyError(error)}`, "error");
  }
});

elements.readerMoveModal.addEventListener("click", async (event) => {
  if (event.target.closest("[data-move-cancel]")) return;
  if (!event.target.closest("#confirmMoveComicButton")) return;
  try {
    await moveSelectedComic();
  } catch (error) {
    const message = friendlyError(error);
    if (error.status === 409 || message.includes("同步扫描中")) {
      startBackgroundProgressPolling();
      const progress = await pollSyncProgress();
      if (!progress?.active) {
        setStatus("扫描状态已更新，请再试一次移动。", "ok");
      }
    }
    setMoveStatus(message, "error");
    setStatus(`移动漫画失败：${message}`, "error");
  }
});

elements.themeToggle.addEventListener("click", () => {
  document.body.classList.toggle("dark");
  localStorage.setItem("comicTheme", document.body.classList.contains("dark") ? "dark" : "light");
  syncThemeToggleIcon();
});

window.addEventListener("resize", () => {
  if (state.view === "detail") renderDetail();
});

window.addEventListener("hashchange", syncViewFromHash);
function handlePopState(event) {
  if (event.state && event.state.comicId) {
    state.selectedComicId = event.state.comicId;
    persistSelectedComic();
  } else {
    state.selectedComicId = "";
    persistSelectedComic();
  }
  syncViewFromHash();
}
window.addEventListener("popstate", handlePopState);

if (localStorage.getItem("comicTheme") === "dark") {
  document.body.classList.add("dark");
}
syncThemeToggleIcon();

syncViewFromHash();
loadLibrary().catch((error) => {
  renderAll();
  setStatus(`本地服务连接失败：${error.message}`, "error");
});
