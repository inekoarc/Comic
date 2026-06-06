const DETAIL_PAGE_SIZE = 10;
const PORTRAIT_DETAIL_PAGE_SIZE = 8;
const LIBRARY_PAGE_SIZE = 25;

const state = {
  comics: [],
  selectedComicId: "",
  libraryPage: 1,
  pageIndex: 0,
  detailPage: 1,
  mode: "scroll",
  fit: "fill-screen",
  customWidth: true,
  imageWidth: 100,
  autoPlay: false,
  autoSeconds: 5,
  autoPixels: 800,
  autoSettingsOpen: false,
  readerNight: false,
  controlsOpen: false,
  activeTag: "全部",
  activeCategory: "全部",
  rankingMode: "rating",
  meta: {},
  libraryRoot: "",
  search: "",
  view: "home"
};

const $ = (selector) => document.querySelector(selector);

const elements = {
  pathForm: $("#pathForm"),
  libraryPath: $("#libraryPath"),
  libraryConfig: $("#libraryConfig"),
  settingsToggle: $("#settingsToggle"),
  statusLine: $("#statusLine"),
  headerSearch: $("#headerSearch"),
  searchInput: $("#searchInput"),
  tagFilters: $("#tagFilters"),
  latestList: $("#latestList"),
  homeRanking: $("#homeRanking"),
  homeTags: $("#homeTags"),
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
  readerStage: $("#readerStage"),
  progressLabel: $("#progressLabel"),
  progressBar: $("#progressBar"),
  pageSelect: $("#pageSelect"),
  readingMode: $("#readingMode"),
  fitMode: $("#fitMode"),
  autoToggle: $("#autoToggle"),
  autoInterval: $("#autoInterval"),
  autoPopover: $("#autoPopover"),
  readerThemeToggle: $("#readerThemeToggle"),
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

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function getMeta(id) {
  const meta = state.meta[id] || {};
  return {
    rating: Number(meta.rating) || 0,
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    views: Math.max(0, Math.floor(Number(meta.views) || 0))
  };
}

function getSelectedComic() {
  return state.comics.find((comic) => comic.id === state.selectedComicId);
}

function naturalSort(a, b) {
  return a.localeCompare(b, "zh-CN", { numeric: true, sensitivity: "base" });
}

function sortedComics() {
  return [...state.comics].sort((a, b) => naturalSort(a.title, b.title));
}

function rankedComics() {
  return [...state.comics].sort((a, b) => {
    const aMeta = getMeta(a.id);
    const bMeta = getMeta(b.id);
    if (state.rankingMode === "views") {
      return bMeta.views - aMeta.views || bMeta.rating - aMeta.rating || naturalSort(a.title, b.title);
    }
    return bMeta.rating - aMeta.rating || bMeta.views - aMeta.views || naturalSort(a.title, b.title);
  });
}

function allTags() {
  return ["全部", ...new Set(state.comics.flatMap((comic) => getMeta(comic.id).tags))];
}

function allCategories() {
  return ["全部", ...[...new Set(state.comics.map((comic) => comic.category || "未分类"))].sort(naturalSort)];
}

function filteredComics() {
  const keyword = state.search.trim().toLowerCase();
  return sortedComics().filter((comic) => {
    const meta = getMeta(comic.id);
    const matchesTag = state.activeTag === "全部" || meta.tags.includes(state.activeTag);
    const category = comic.category || "未分类";
    const matchesCategory = state.activeCategory === "全部" || category === state.activeCategory;
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

function setView(view) {
  state.view = view;
  document.body.classList.toggle("reader-active", view === "reader");
  document.documentElement.classList.toggle("reader-active-root", view === "reader");
  if (view !== "reader") stopAutoPlay();
  document.querySelectorAll(".page-view").forEach((section) => section.classList.remove("active"));
  $(`#${view}View`)?.classList.add("active");
  document.querySelectorAll("[data-view-link]").forEach((link) => {
    link.classList.toggle("active", link.dataset.viewLink === view);
  });
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

function renderTags() {
  elements.tagFilters.innerHTML = allCategories()
    .map((category) => `<button class="chip ${category === state.activeCategory ? "active" : ""}" type="button" data-category="${escapeHTML(category)}">${escapeHTML(category)}</button>`)
    .join("");

  elements.homeTags.innerHTML = allTags()
    .filter((tag) => tag !== "全部")
    .map((tag) => `<a href="#library" data-home-tag="${escapeHTML(tag)}">${escapeHTML(tag)}</a>`)
    .join("") || "<span class=\"muted\">暂无标签</span>";
}

function renderHome() {
  const latest = sortedComics().slice(0, 12);
  elements.latestList.innerHTML = latest.map((comic) => `
    <article class="update-item" data-comic-id="${escapeHTML(comic.id)}">
      <img src="${comic.cover}" alt="${escapeHTML(comic.title)} 封面" loading="lazy">
      <div>
        <h3>${escapeHTML(comic.title)}</h3>
        <p>${escapeHTML(comicMetaLine(comic))}</p>
      </div>
      <button class="text-button" type="button">详情</button>
    </article>
  `).join("") || emptyBlock("还没有漫画", "输入漫画根目录后点击扫描目录。");

  elements.homeRanking.innerHTML = rankedComics().slice(0, 10).map((comic) => `
    <li data-rank-comic="${escapeHTML(comic.id)}">
      <span>${escapeHTML(comic.title)}</span>
      <strong>${getMeta(comic.id).rating.toFixed(1)}</strong>
    </li>
  `).join("") || "<li class=\"empty-row\">暂无排行</li>";
}

function renderLibrary() {
  const list = filteredComics();
  elements.resultCount.textContent = `${list.length} 本漫画`;
  const totalPages = Math.max(1, Math.ceil(list.length / LIBRARY_PAGE_SIZE));
  state.libraryPage = Math.max(1, Math.min(state.libraryPage, totalPages));
  const start = (state.libraryPage - 1) * LIBRARY_PAGE_SIZE;
  const pageList = list.slice(start, start + LIBRARY_PAGE_SIZE);
  const groups = [...groupComicsByCategory(pageList).entries()].sort(([a], [b]) => naturalSort(a, b));

  elements.comicGrid.innerHTML = groups.map(([category, comics]) => `
    <section class="library-category-group">
      <div class="library-category-heading">
        <h2>${escapeHTML(category)}</h2>
        <span>${comics.length}</span>
      </div>
      <div class="library-category-grid">
        ${comics.map((comic) => `
          <article class="directory-card" data-comic-id="${escapeHTML(comic.id)}">
            <img src="${comic.cover}" alt="${escapeHTML(comic.title)} 封面" loading="lazy">
            <h3 title="${escapeHTML(comic.title)}">${escapeHTML(comic.title)}</h3>
            <p>${escapeHTML(comicMetaLine(comic))}</p>
          </article>
        `).join("")}
      </div>
    </section>
  `).join("") || emptyBlock("没有匹配结果", "换个关键词或标签试试。");

  elements.libraryPager.innerHTML = list.length > LIBRARY_PAGE_SIZE ? `
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
  elements.rankingTabs.querySelectorAll("[data-ranking-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.rankingMode === state.rankingMode);
  });
  elements.rankingList.innerHTML = ranked.map((comic) => {
    const meta = getMeta(comic.id);
    const tags = meta.tags.length ? meta.tags.join(" / ") : "未添加标签";
    const rankValue = state.rankingMode === "views" ? `${meta.views} 次观看` : `${meta.rating.toFixed(1)} 分`;
    return `
      <li data-rank-comic="${escapeHTML(comic.id)}">
        <img src="${comic.cover}" alt="${escapeHTML(comic.title)} 封面" loading="lazy">
        <div>
          <strong>${escapeHTML(comic.title)}</strong>
          <span>${escapeHTML(tags)}</span>
        </div>
        <em>${rankValue}</em>
      </li>
    `;
  }).join("") || "<li class=\"ranking-empty\">暂无漫画，扫描目录后会在这里显示排行。</li>";
}

function renderCategories() {
  const categories = [...new Set(state.comics.map((comic) => comic.category || "未分类"))].sort(naturalSort);
  elements.categoryBoard.innerHTML = categories.map((category) => {
    const comics = state.comics.filter((comic) => (comic.category || "未分类") === category).sort((a, b) => naturalSort(a.title, b.title));
    return `
      <section class="category-block">
        <h2>${escapeHTML(category)} <span>${comics.length}</span></h2>
        ${comics.slice(0, 8).map((comic) => `<button type="button" data-comic-id="${escapeHTML(comic.id)}">${escapeHTML(comic.title)}</button>`).join("")}
      </section>
    `;
  }).join("") || emptyBlock("暂无分类", "按“分类 / 漫画 / 图片”的目录结构扫描后，这里会自动生成分类。");
}

function renderDetail() {
  const comic = getSelectedComic();
  if (!comic) {
    elements.comicDetail.innerHTML = emptyBlock("请选择漫画", "从漫画库、首页或排行榜点击一本漫画进入详情。");
    return;
  }

  const meta = getMeta(comic.id);
  const pageSize = detailPageSize();
  const totalPages = Math.max(1, Math.ceil(comic.pages.length / pageSize));
  state.detailPage = Math.max(1, Math.min(state.detailPage, totalPages));
  const start = (state.detailPage - 1) * pageSize;
  const pageSlice = comic.pages.slice(start, start + pageSize);
  const tags = meta.tags;

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
          <img src="${comic.cover}" alt="${escapeHTML(comic.title)} 封面">
        </aside>

        <section class="detail-summary">
          <dl class="plain-meta">
            <div><dt>分类：</dt><dd>${escapeHTML(comic.category || "未分类")}</dd></div>
            <div><dt>页数：</dt><dd>${comic.pageCount}P</dd></div>
            <div>
              <dt>标签：</dt>
              <dd class="tag-row">
                <span class="inline-tags">${tags.map((tag) => `<button type="button" data-remove-tag="${escapeHTML(tag)}">${escapeHTML(tag)}</button>`).join("")}</span>
                <span class="tag-editor">
                  <input id="tagInput" type="text" placeholder="例如：热血、悬疑、已读">
                  <button class="secondary-button" id="addTagButton" type="button">+TAG</button>
                </span>
              </dd>
            </div>
            <div><dt>评分：</dt><dd><input id="ratingInput" class="score-input" type="number" min="0" max="10" step="0.1" value="${meta.rating}"> / 10</dd></div>
            <div><dt>简介：</dt><dd class="description">本地漫画目录：${escapeHTML(comic.relativeDir || "-")}</dd></div>
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
              <img src="${src}" alt="${escapeHTML(comic.title)} ${escapeHTML(label)}" loading="lazy">
              <h3>${escapeHTML(label)}</h3>
            </article>
          `;
        }).join("")}
      </section>

      <nav class="detail-pager" aria-label="详情页分页">
        ${Array.from({ length: totalPages }, (_, index) => {
          const page = index + 1;
          return `<button type="button" class="${page === state.detailPage ? "active" : ""}" data-detail-page="${page}">${page}</button>`;
        }).join("")}
        <button type="button" data-detail-page="${Math.min(totalPages, state.detailPage + 1)}" ${state.detailPage === totalPages ? "disabled" : ""}>後頁&gt;</button>
      </nav>
    </div>
  `;
}

function renderReader() {
  const comic = getSelectedComic();

  if (!comic) {
    elements.pageSelect.innerHTML = "";
    elements.readerStage.innerHTML = "<p class=\"empty-state\">从漫画库选择一本漫画开始阅读。</p>";
    elements.progressLabel.textContent = "0 / 0";
    elements.progressBar.style.width = "0%";
    elements.prevPage.disabled = true;
    elements.nextPage.disabled = true;
    return;
  }

  state.pageIndex = Math.max(0, Math.min(state.pageIndex, comic.pages.length - 1));
  elements.pageSelect.innerHTML = comic.pages.map((_, index) => `<option value="${index}">第 ${index + 1} 页</option>`).join("");
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
  elements.widthControl.hidden = !state.customWidth;
  elements.imageWidth.value = String(state.imageWidth);
  elements.readingMode.value = state.mode;
  elements.readerTopbar.querySelectorAll("[data-reader-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.readerMode === state.mode);
  });
  elements.readerStage.className = `reader-stage mode-${state.mode}`;
  elements.readerStage.style.setProperty("--reader-brightness", Number(elements.brightness.value) / 100);
  elements.readerStage.style.setProperty("--reader-image-width", `${state.imageWidth}vw`);

  if (state.mode === "scroll") {
    elements.readerStage.innerHTML = comic.pages.map((src, index) => `<img src="${src}" alt="${escapeHTML(comic.title)} 第 ${index + 1} 页">`).join("");
  } else {
    elements.readerStage.innerHTML = `
      <button class="reader-hotspot reader-hotspot-left" type="button" data-reader-step="-1" aria-label="上一页"></button>
      <img src="${comic.pages[state.pageIndex]}" alt="${escapeHTML(comic.title)} 第 ${state.pageIndex + 1} 页">
      <button class="reader-hotspot reader-hotspot-right" type="button" data-reader-step="1" aria-label="下一页"></button>
    `;
  }

  const progress = comic.pages.length ? ((state.pageIndex + 1) / comic.pages.length) * 100 : 0;
  elements.progressLabel.textContent = `${state.pageIndex + 1} / ${comic.pages.length}`;
  elements.progressBar.style.width = `${progress}%`;
  if (elements.prevPage) elements.prevPage.disabled = state.pageIndex === 0;
  if (elements.nextPage) elements.nextPage.disabled = state.pageIndex === comic.pages.length - 1;
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
    if (state.pageIndex >= current.pages.length - 1) {
      stopAutoPlay();
      renderReader();
      return;
    }
    state.pageIndex = Math.min(current.pages.length - 1, state.pageIndex + 1);
    renderReader();
  }, state.autoSeconds * 1000);
}

function renderAll() {
  renderTags();
  renderHome();
  renderLibrary();
  renderRanking();
  renderCategories();
  renderDetail();
  renderReader();
}

function emptyBlock(title, body) {
  return `<div class="empty-card"><h3>${escapeHTML(title)}</h3><p>${escapeHTML(body)}</p></div>`;
}

function openComic(id) {
  state.selectedComicId = id;
  state.pageIndex = 0;
  state.detailPage = 1;
  renderAll();
  location.hash = "detail";
}

async function loadLibrary() {
  const data = await api("/api/library");
  state.libraryRoot = data.libraryRoot || "";
  state.comics = data.comics || [];
  state.meta = data.metadata || {};
  elements.libraryPath.value = state.libraryRoot;
  if (!allCategories().includes(state.activeCategory)) state.activeCategory = "全部";
  if (!state.comics.some((comic) => comic.id === state.selectedComicId)) {
    state.selectedComicId = state.comics[0]?.id || "";
  }
  renderAll();
  setStatus(state.libraryRoot ? `已扫描：${state.libraryRoot}` : "请输入漫画根目录并扫描。", state.libraryRoot ? "ok" : "");
}

async function scanPath(pathValue) {
  const libraryRoot = pathValue.trim();
  if (!libraryRoot) {
    setStatus("请输入漫画根目录。", "error");
    return;
  }
  setStatus("正在扫描目录...");
  await api("/api/config", {
    method: "POST",
    body: JSON.stringify({ libraryRoot })
  });
  await loadLibrary();
  location.hash = "library";
}

async function persistMeta(id, nextMeta) {
  const normalizedMeta = {
    rating: Number(nextMeta.rating) || 0,
    tags: Array.isArray(nextMeta.tags) ? nextMeta.tags : [],
    views: Math.max(0, Math.floor(Number(nextMeta.views) || 0))
  };
  state.meta[id] = normalizedMeta;
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
  const rating = Math.max(0, Math.min(10, Number(value) || 0));
  await persistMeta(comic.id, { ...getMeta(comic.id), rating });
}

async function addTag(value) {
  const comic = getSelectedComic();
  const tag = value.trim();
  if (!comic || !tag) return;
  const meta = getMeta(comic.id);
  await persistMeta(comic.id, { ...meta, tags: [...new Set([...meta.tags, tag])] });
}

async function removeTag(tag) {
  const comic = getSelectedComic();
  if (!comic) return;
  const meta = getMeta(comic.id);
  if (state.activeTag === tag) state.activeTag = "全部";
  await persistMeta(comic.id, { ...meta, tags: meta.tags.filter((item) => item !== tag) });
}

elements.pathForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await scanPath(elements.libraryPath.value);
  } catch (error) {
    setStatus(error.message, "error");
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
  state.libraryPage = 1;
  renderAll();
});

elements.libraryPager.addEventListener("click", (event) => {
  const button = event.target.closest("[data-library-page]");
  if (!button || button.disabled) return;
  state.libraryPage = Number(button.dataset.libraryPage);
  renderLibrary();
  document.querySelector("#libraryView .section-title")?.scrollIntoView({ block: "start" });
});

elements.rankingTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-ranking-mode]");
  if (!button) return;
  state.rankingMode = button.dataset.rankingMode;
  renderRanking();
});

elements.homeTags.addEventListener("click", (event) => {
  const link = event.target.closest("[data-home-tag]");
  if (!link) return;
  state.activeTag = link.dataset.homeTag;
  state.activeCategory = "全部";
  state.libraryPage = 1;
  renderAll();
});

document.addEventListener("click", (event) => {
  const comicTarget = event.target.closest("[data-comic-id], [data-rank-comic]");
  if (comicTarget) {
    openComic(comicTarget.dataset.comicId || comicTarget.dataset.rankComic);
  }
});

elements.comicDetail.addEventListener("change", async (event) => {
  if (event.target.id !== "ratingInput") return;
  try {
    await updateRating(event.target.value);
  } catch (error) {
    setStatus(error.message, "error");
  }
});

elements.comicDetail.addEventListener("click", async (event) => {
  try {
    const removeButton = event.target.closest("[data-remove-tag]");
    const detailPageButton = event.target.closest("[data-detail-page]");
    const thumb = event.target.closest("[data-page-index]");

    if (removeButton && !removeButton.disabled) await removeTag(removeButton.dataset.removeTag);
    if (detailPageButton && !detailPageButton.disabled) {
      state.detailPage = Number(detailPageButton.dataset.detailPage);
      renderDetail();
    }
    if (thumb) {
      state.pageIndex = Number(thumb.dataset.pageIndex);
      state.mode = "scroll";
      state.controlsOpen = false;
      await incrementViews();
      location.hash = "reader";
      renderReader();
    }
    if (event.target.id === "addTagButton") await addTag($("#tagInput").value);
    if (event.target.id === "readButton") {
      state.pageIndex = 0;
      state.mode = "scroll";
      state.controlsOpen = false;
      await incrementViews();
      location.hash = "reader";
      renderReader();
    }
  } catch (error) {
    setStatus(error.message, "error");
  }
});

elements.comicDetail.addEventListener("keydown", async (event) => {
  if (event.key === "Enter" && event.target.id === "tagInput") {
    event.preventDefault();
    try {
      await addTag(event.target.value);
    } catch (error) {
      setStatus(error.message, "error");
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
  const hotspot = event.target.closest("[data-reader-step]");
  if (!hotspot) {
    state.controlsOpen = !state.controlsOpen;
    renderReader();
    return;
  }
  const comic = getSelectedComic();
  if (!comic) return;
  state.pageIndex = Math.max(0, Math.min(comic.pages.length - 1, state.pageIndex + Number(hotspot.dataset.readerStep)));
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
  renderReader();
});

elements.brightness.addEventListener("input", renderReader);

elements.readerTopbar.addEventListener("click", (event) => {
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
  state.pageIndex = Math.max(0, Math.min(comic.pages.length - 1, state.pageIndex + delta));
  renderReader();
});

elements.themeToggle.addEventListener("click", () => {
  document.body.classList.toggle("dark");
  localStorage.setItem("comicTheme", document.body.classList.contains("dark") ? "dark" : "light");
});

window.addEventListener("resize", () => {
  if (state.view === "detail") renderDetail();
});

window.addEventListener("hashchange", syncViewFromHash);

if (localStorage.getItem("comicTheme") === "dark") {
  document.body.classList.add("dark");
}

syncViewFromHash();
loadLibrary().catch((error) => {
  renderAll();
  setStatus(`本地服务连接失败：${error.message}`, "error");
});
