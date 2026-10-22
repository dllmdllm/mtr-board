const board = document.getElementById("board");
const cpBoard = document.getElementById("cp-board");
const lastUpdate = document.getElementById("last-update");
const refreshBtn = document.getElementById("refresh");
const countdownEl = document.getElementById("countdown");
const toggleButtons = Array.from(document.querySelectorAll(".toggle-btn"));
const lineTabs = Array.from(document.querySelectorAll(".line-tab"));
const toggleGroup = document.querySelector(".toggle-group");
if (toggleGroup) {
  toggleGroup.classList.toggle("has-active", toggleButtons.some(b => b.classList.contains("active")));
}
let visibleCount = 4;
let remaining = REFRESH_SECONDS;
const stationStates = new Map();
const STALE_AFTER_MS = 90000;
let activeRefresh = null;
let queueController = null;
const ACTIVE_LINE_KEY = "activeLine";
const BOARD_VIEW_KEY = "mtrBoardViewV1";
function loadBoardView(storage) {
  try {
    const value = JSON.parse(storage.getItem(BOARD_VIEW_KEY));
    if (value?.version === 1 && ["line", "favorites"].includes(value.view) && (value.line === "XFR" || Object.hasOwn(LINE_NAMES, value.line))) return value;
  } catch { /* Older or unavailable storage falls back to the legacy selection. */ }
  return null;
}
const restoredView = loadBoardView(browserStorage());
let activeLine = "EAL";
try { activeLine = browserStorage().getItem(ACTIVE_LINE_KEY) || "EAL"; } catch { /* Use the full board when storage is unavailable. */ }
if (activeLine !== "XFR" && !Object.hasOwn(LINE_NAMES, activeLine)) activeLine = "EAL";
if (restoredView) activeLine = restoredView.line;
const loadedFavorites = loadFavorites(browserStorage());
let favorites = loadedFavorites.data;
let favoritesWarning = loadedFavorites.warning;
if (loadedFavorites.migrated) favoritesWarning = saveFavorites(browserStorage(), favorites);
const restoredFavorite = favorites.items.find(item => favoriteId(item) === favorites.selectedId);
let showingFavorites = restoredView ? restoredView.view === "favorites" && favorites.items.length > 0 : !!restoredFavorite;
if (showingFavorites && restoredFavorite && !restoredView) activeLine = restoredFavorite.line;
let visibleCards = [];
let visibleRows = [];
let refreshToken = 0;
let refreshTimer = null;
let nextScheduleExpiry = Infinity;

function hexToRgb(hex) {
  const cleaned = hex.replace("#", "");
  const value = parseInt(cleaned, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `${r}, ${g}, ${b}`;
}

function makeCard(station) {
  const card = document.createElement("div");
  card.className = "station-card fade-in";
  card.dataset.code = station.code;
  card.dataset.line = station.line;
  card.dataset.name = station.name;
  const lineColor = LINE_COLORS[station.line] || "#53B7E8";
  card.style.setProperty("--line-color", lineColor);
  card.style.setProperty("--line-color-rgb", hexToRgb(lineColor));

  card.innerHTML = `
    <div class="card-head">
      <div class="station-title">
        <div class="station-name">${station.name}</div>
      </div>
    </div>
    <div class="card-body">
      <div class="dir-col" data-dir="DOWN">
        <div class="train-list"></div>
      </div>
      <div class="dir-col" data-dir="UP">
        <div class="train-list"></div>
      </div>
    </div>
  `;
  const downList = card.querySelector('[data-dir="DOWN"] .train-list');
  const upList = card.querySelector('[data-dir="UP"] .train-list');
  card._refs = {
    downList,
    upList,
    downCol: downList.closest(".dir-col"),
    upCol: upList.closest(".dir-col")
  };
  return card;
}

function renderBoard() {
  board.innerHTML = "";
  STATIONS.forEach((s, idx) => {
    const card = makeCard(s);
    card.style.animationDelay = `${idx * 0.02}s`;
    card._order = idx;
    board.appendChild(card);
  });
  if (cpBoard) board.appendChild(cpBoard);
  applyLineFilter();
}

function isPrimaryInterchangeCard(card) {
  const name = card.dataset.name || "";
  const lines = INTERCHANGE_LINES[name];
  if (!lines || lines.length === 0) return false;
  return (card.dataset.line || "") === lines[0];
}

function shouldShowCard(card) {
  if (showingFavorites) return favorites.items.some(item => item.line === card.dataset.line && item.code === card.dataset.code);
  if (activeLine === "XFR") return isPrimaryInterchangeCard(card);
  return card.dataset.line === activeLine;
}

function colorForPlat(plat) {
  const colors = ["#06D6A0", "#118AB2", "#EF476F", "#F4A261", "#90BE6D", "#F72585", "#A8DADC", "#F28482"];
  const num = Number(plat);
  if (Number.isNaN(num)) return "";
  return colors[(Math.abs(num) - 1) % colors.length];
}

function statusRow(text, serviceUrl) {
  const row = document.createElement("div");
  row.className = "train-row";
  row.dataset.status = "status";
  row.innerHTML = `
    <span class="train-dest">${escapeHtml(text)}</span>
    <span class="train-right"><span class="train-mins"></span><span class="train-hint"></span></span>
  `;
  if (serviceUrl) {
    try {
      const url = new URL(serviceUrl);
      if (url.protocol === "https:" && (url.hostname === "mtr.com.hk" || url.hostname.endsWith(".mtr.com.hk"))) {
        const link = document.createElement("a");
        link.href = url.href;
        link.textContent = "服務安排";
        link.className = "service-link";
        row.appendChild(link);
      }
    } catch { /* Ignore invalid service links; keep the alert message. */ }
  }
  return row;
}

function parseTimeToMs(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return NaN;
  // The API's full wall-clock date is Hong Kong time, including after midnight.
  const ms = Date.parse(`${value.replace(" ", "T")}+08:00`);
  if (!Number.isFinite(ms)) return NaN;
  const roundTrip = new Date(ms + 8 * 3600000).toISOString().slice(0, 19).replace("T", " ");
  return roundTrip === value ? ms : NaN;
}

function computeTargetMs(train) {
  return parseTimeToMs(train.time);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[ch]));
}

function hongKongTime(ms) {
  return new Date(ms).toLocaleTimeString("zh-HK", { hour12: false, timeZone: "Asia/Hong_Kong" });
}

function classifySchedule(data, key, error, now = Date.now()) {
  if (error) return { kind: "error", text: typeof navigator !== "undefined" && navigator.onLine === false ? "離線，請檢查網絡" : "更新失敗，請重試" };
  if (!data) return { kind: "loading", text: "更新中" };
  if (Number(data.status) === 0) return { kind: "disruption", text: data.message || "服務異常", url: data.url };
  const entry = data.data?.[key];
  const sourceMs = parseTimeToMs(entry?.curr_time || entry?.sys_time || data.curr_time || data.sys_time);
  if (Number(data.status) !== 1 || !entry || !Number.isFinite(sourceMs) || (!Array.isArray(entry.UP) && !Array.isArray(entry.DOWN))) {
    return { kind: "unavailable", text: "暫未能提供列車資料" };
  }
  if (now - sourceMs > STALE_AFTER_MS || sourceMs - now > STALE_AFTER_MS) return { kind: "stale", text: "資料已過期，請重試", sourceMs };
  const validTrains = trains => (Array.isArray(trains) ? trains : []).filter(t => t && Number.isFinite(parseTimeToMs(t.time)));
  const down = validTrains(entry.DOWN), up = validTrains(entry.UP);
  const downUnavailable = !Array.isArray(entry.DOWN) || down.length !== entry.DOWN.length;
  const upUnavailable = !Array.isArray(entry.UP) || up.length !== entry.UP.length;
  return { kind: "ready", sourceMs, down, up, downUnavailable, upUnavailable, text: data.isdelay === "Y" ? "列車延誤" : "" };
}

function formatCountdown(sec, timeType) {
  if (sec < 0) return "逾時";
  if (sec <= 59) return timeType === "D" ? "將開" : timeType === "A" ? "將到" : "即將";
  const mins = Math.ceil(sec / 60);
  return `${mins} 分`;
}

function trainRow(train, key, showPlatformLabel = false) {
  const row = document.createElement("div");
  row.className = "train-row";
  if (!train) {
    row.innerHTML = `
      <span class="train-dest">--</span>
      <span class="train-right"><span class="train-mins">--</span><span class="train-hint"></span></span>
    `;
    return row;
  }
  const destName = CODE_TO_NAME.get(train.dest) || train.dest || "--";
  const mins = formatCountdown(Math.floor((computeTargetMs(train) - Date.now()) / 1000), train.timetype);
  const route = train.route === "RAC" ? "（經馬場）" : "";
  const event = train.timetype === "D" ? "開出" : train.timetype === "A" ? "到站" : "時間";
  const plat = train.plat ?? "--";
  const time = train.time ?? "--";
  const color = colorForPlat(plat);
  if (color) row.style.setProperty("--platform-color", color);
  row.dataset.key = key;
  row.dataset.timeType = train.timetype || "";
  const targetMs = computeTargetMs(train);
  if (!Number.isNaN(targetMs)) row.dataset.target = String(targetMs);
  row.title = `P${plat} | 預計${event} ${time}（香港時間）${route}；時間已過不代表已到站或已開出`;
  row.innerHTML = `
    <span class="train-dest"><span class="plat-num">${showPlatformLabel ? "月台 " : ""}${escapeHtml(plat)}</span> ${escapeHtml(destName)}${route}</span>
    <span class="train-right"><span class="train-mins">${mins}</span><span class="train-hint" aria-label="預計${event}">${event === "時間" ? "估計" : event}</span></span>
  `;
  return row;
}

function updateRowCountdown(row) {
  if (row.dataset.status) return;
  const targetMs = Number(row.dataset.target);
  if (!targetMs) return;
  const remainingSec = Math.floor((targetMs - Date.now()) / 1000);
  const minsEl = row.querySelector(".train-mins");
  const label = formatCountdown(remainingSec, row.dataset.timeType);
  const shouldBlink = remainingSec >= 0 && remainingSec <= 59;
  if (minsEl) {
    if (minsEl.textContent !== label) minsEl.textContent = label;
    minsEl.classList.toggle("blink", shouldBlink);
  }
}

function applyLineFilter() {
  lineTabs.forEach(btn => {
    const selected = !showingFavorites && btn.dataset.line === activeLine;
    btn.classList.toggle("active", selected);
    btn.setAttribute("aria-pressed", String(selected));
  });
  visibleCards = [];
  visibleRows = [];
  document.querySelectorAll(".station-card").forEach(card => {
    const show = shouldShowCard(card);
    card.dataset.filtered = show ? "0" : "1";
    card.style.display = show ? "" : "none";
    card.classList.toggle("xfr-mode", !showingFavorites && activeLine === "XFR" && show);
    card.classList.toggle("is-favorite", !!showingFavorites && show);
    if (show) visibleCards.push(card);
  });
  const cards = Array.from(document.querySelectorAll(".station-card"));
  cards.sort((a,b)=>a._order-b._order).forEach(card=>board.appendChild(card));
  if (showingFavorites) {
    visibleCards.sort((a,b)=>favorites.items.findIndex(item=>favoriteId(item)===`${a.dataset.line}-${a.dataset.code}`)-favorites.items.findIndex(item=>favoriteId(item)===`${b.dataset.line}-${b.dataset.code}`));
    visibleCards.forEach(card=>board.appendChild(card));
  }
  if (cpBoard) {
    board.appendChild(cpBoard);
    cpBoard.style.display = activeLine === "EAL" && !showingFavorites ? "" : "none";
  }
}

function updateAllRows() {
  if (visibleRows.length === 0) {
    document.querySelectorAll(".station-card .train-row").forEach(updateRowCountdown);
    return;
  }
  visibleRows.forEach(updateRowCountdown);
}

function queueLabel(value) {
  return ({0: "正常", 1: "繁忙", 2: "非常繁忙", 4: "系統維護", 99: "非服務時間"})[value] || "資料未能提供";
}

function queueDot(value) {
  if (value === 0) return "green";
  if (value === 1) return "yellow";
  if (value === 2) return "red";
  if (value === 4) return "blue";
  if (value === 99) return "gray";
  return "gray";
}

function queueDotClass(value) {
  const base = queueDot(value);
  const blink = value === 1 || value === 2 ? " blink" : "";
  return `${base}${blink}`;
}

function showControlPointError() {
  if (!cpBoard) return;
  cpBoard.innerHTML = `
    <div class="cp-card cp-error">
      <div class="cp-error-msg">管制站數據載入失敗，請稍後重試</div>
    </div>
  `;
}

function renderControlPoints(residentData, visitorData) {
  if (!cpBoard) return;
  if (residentData === null && visitorData === null) {
    showControlPointError();
    return;
  }
  const visiblePoints = CP_POINTS.filter(point => {
    const r = residentData?.[point.code];
    const v = visitorData?.[point.code];
    const values = [
      r?.arrQueue, r?.depQueue, v?.arrQueue, v?.depQueue
    ];
    return values.some(vv => vv === 0 || vv === 1 || vv === 2);
  });
  if (visiblePoints.length === 0) {
    cpBoard.innerHTML = "";
    return;
  }
  const makeRowFiltered = (label, data) => {
    const cells = visiblePoints.map(point => {
      const entry = data?.[point.code];
      const arr = entry?.arrQueue ?? "--";
      const dep = entry?.depQueue ?? "--";
      const dotA = queueDotClass(arr);
      const dotD = queueDotClass(dep);
      return `
        <td><span class="cp-badge"><span class="cp-dot ${dotA}" role="img" aria-label="${queueLabel(arr)}" title="${queueLabel(arr)}"></span></span></td>
        <td><span class="cp-badge"><span class="cp-dot ${dotD}" role="img" aria-label="${queueLabel(dep)}" title="${queueLabel(dep)}"></span></span></td>
      `;
    }).join("");
    return `
      <tr>
        <td class="cp-row-label">${label}</td>
        ${cells}
      </tr>
    `;
  };
  const rows = [
    makeRowFiltered("居民", residentData),
    makeRowFiltered("旅客", visitorData)
  ].join("");
  cpBoard.innerHTML = `
    <div class="cp-card">
      <div class="cp-title">陸路邊境管制站等候時間</div>
      <div class="cp-legend">
        <span class="cp-legend-item"><span class="cp-dot green"></span>正常</span>
        <span class="cp-legend-item"><span class="cp-dot yellow"></span>繁忙</span>
        <span class="cp-legend-item"><span class="cp-dot red"></span>非常繁忙</span>
        <span class="cp-legend-item"><span class="cp-dot blue"></span>系統維護</span>
        <span class="cp-legend-item"><span class="cp-dot gray"></span>非服務時間</span>
      </div>
      <table class="cp-table">
      <caption>檢查時間 ${hongKongTime(Date.now())}${residentData === null || visitorData === null ? "（部分資料載入失敗）" : ""}</caption>
        <thead>
          <tr>
            <th rowspan="2"></th>
            ${visiblePoints.map(p => `<th colspan="2">${p.name}</th>`).join("")}
          </tr>
          <tr>
            ${visiblePoints.map(() => `<th>入境</th><th>出境</th>`).join("")}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderSchedules() {
  visibleRows = [];
  const readyTimes = [];
  let incomplete = false;
  visibleCards.forEach(card => {
    const { line, code, name } = card.dataset;
    const lines = !showingFavorites && activeLine === "XFR" ? INTERCHANGE_LINES[name] || [line] : [line];
    const states = lines.map(lineKey => {
      const key = `${lineKey}-${code}`, saved = stationStates.get(key);
      const state = classifySchedule(saved?.data, key, saved?.error);
      if (state.kind === "ready") readyTimes.push(state.sourceMs);
      if (state.kind !== "ready" || state.downUnavailable || state.upUnavailable) incomplete = true;
      return state;
    });
    // Source heartbeats update the header, but unchanged content keeps its DOM and focus.
    const signature = JSON.stringify([showingFavorites, activeLine === "XFR", visibleCount,
      states.map(({sourceMs, ...content}) => content)]);
    if (signature === card._scheduleSignature) {
      card.style.display = card._scheduleDisplay;
      visibleRows.push(...card.querySelectorAll(".train-row[data-target]"));
      return;
    }
    card._scheduleSignature = signature;
    const { downList, upList, downCol, upCol } = card._refs;
    downList.innerHTML = "";
    upList.innerHTML = "";
    card.style.display = "";
    downCol.style.display = "";
    upCol.style.display = !showingFavorites && activeLine === "XFR" ? "none" : "";
    lines.forEach((lineKey, index) => {
      const key = `${lineKey}-${code}`;
      const state = states[index];
      let down = downList, up = upList;
      if (!showingFavorites && activeLine === "XFR") {
        const group = document.createElement("div");
        group.className = "xfr-group";
        group.style.setProperty("--line-color", LINE_COLORS[lineKey]);
        group.style.setProperty("--line-color-rgb", hexToRgb(LINE_COLORS[lineKey]));
        const heading = statusRow(LINE_NAMES[lineKey]);
        heading.classList.add("xfr-header");
        group.appendChild(heading);
        const pair = document.createElement("div");
        pair.className = "xfr-pair";
        down = document.createElement("div"); up = document.createElement("div");
        down.className = up.className = "xfr-col";
        pair.appendChild(down); pair.appendChild(up);
        group.appendChild(pair); downList.appendChild(group);
      }
      card.querySelector(".station-name").textContent = showingFavorites ? `${name} · ${LINE_NAMES[lineKey]}` : name;
      if (showingFavorites) {
        for (const [list, direction] of [[down, "DOWN"], [up, "UP"]]) {
          const heading = document.createElement("h3");
          heading.className = "direction-heading";
          heading.textContent = `${DIRECTION_LABELS[lineKey][direction]}方向`;
          list.appendChild(heading);
        }
      }
      if (state.kind !== "ready") {
        down.appendChild(statusRow(state.text, state.url));
        if (!showingFavorites && activeLine === "XFR") up.style.display = "none";
        else up.appendChild(statusRow(state.text, state.url));
        return;
      }
      if (state.text) down.appendChild(statusRow(state.text, state.url));
      const addTrains = (list, trains, dir) => {
        const unavailable = dir === "DOWN" ? state.downUnavailable : state.upUnavailable;
        if (unavailable) list.appendChild(statusRow(trains.length ? "此方向部分資料未提供" : "此方向資料未提供"));
        else if (!trains.length) list.appendChild(statusRow("暫無班次"));
        trains.slice(0, visibleCount).forEach(train => {
          // Each row reads its own exact ETA; no countdown state survives replacement.
          const row = trainRow(train, `${key}-${dir}-${train.time}-${train.dest}-${train.plat}`, !!showingFavorites);
          list.appendChild(row); visibleRows.push(row);
        });
      };
      addTrains(down, state.down, "DOWN");
      addTrains(up, state.up, "UP");
      if (!showingFavorites && state.down.length && !state.up.length && !state.upUnavailable) {
        if (!showingFavorites && activeLine === "XFR") up.style.display = "none"; else upCol.style.display = "none";
      } else if (!showingFavorites && state.up.length && !state.down.length && !state.text && !state.downUnavailable) {
        if (activeLine === "XFR") down.style.display = "none"; else downCol.style.display = "none";
      }
      if (!showingFavorites && lineKey === "EAL" && code === "RAC" && !state.down.length && !state.up.length && !state.downUnavailable && !state.upUnavailable) card.style.display = "none";
    });
    card._scheduleDisplay = card.style.display;
  });
  const oldest = readyTimes.length ? Math.min(...readyTimes) : null;
  nextScheduleExpiry = readyTimes.length ? Math.min(...readyTimes) + STALE_AFTER_MS + 1 : Infinity;
  lastUpdate.textContent = oldest === null ? (incomplete ? "資料未更新" : "--:--:--") : `${incomplete ? "部分 " : ""}${hongKongTime(oldest)}`;
  lastUpdate.title = "目前可用列車資料的最早來源時間（香港時間）；口岸資料獨立更新";
  updateAllRows();
}

async function refreshAll() {
  if (document.hidden) return;
  const view = showingFavorites ? `favorites|${favorites.items.map(favoriteId).join(",")}` : `${activeLine}|all`;
  if (activeRefresh?.view === view) return activeRefresh.promise;
  activeRefresh?.controller.abort();
  queueController?.abort();
  const controller = new AbortController();
  const token = ++refreshToken;
  const line = activeLine;
  const requestItems = new Map();
  visibleCards.forEach(card => {
    const lines = !showingFavorites && line === "XFR" ? INTERCHANGE_LINES[card.dataset.name] || [card.dataset.line] : [card.dataset.line];
    lines.forEach(lineKey => {
      const key = `${lineKey}-${card.dataset.code}`;
      requestItems.set(key, { key, line: lineKey, code: card.dataset.code });
    });
  });
  board.classList.add("is-refreshing");
  renderSchedules();
  if (line === "EAL" && !showingFavorites) {
    if (cpBoard) cpBoard.textContent = "口岸資料更新中";
    queueController = new AbortController();
    const queueSignal = queueController.signal;
    fetchControlPointQueues(queueSignal).then(queues => {
      if (token !== refreshToken || queueSignal.aborted) return;
      renderControlPoints(queues.residentData, queues.visitorData);
    }).catch(() => { if (token === refreshToken && !queueSignal.aborted) showControlPointError(); });
  }
  const job = { line, view, controller, promise: null };
  activeRefresh = job;
  job.promise = runLimited([...requestItems.values()], async item => {
    if (controller.signal.aborted) return;
    let data, error;
    try { data = await fetchStationSchedule(item.line, item.code, controller.signal); }
    catch (err) { error = err; }
    if (token !== refreshToken || controller.signal.aborted) return;
    stationStates.set(item.key, { data, error });
    renderSchedules();
  }).finally(() => {
    if (activeRefresh !== job) return;
    activeRefresh = null;
    remaining = REFRESH_SECONDS;
    countdownEl.textContent = remaining;
    board.classList.remove("is-refreshing");
  });
  return job.promise;
}

refreshBtn.addEventListener("click", () => refreshAll());
toggleButtons.forEach(btn => {
  btn.setAttribute("aria-label", `顯示 ${btn.dataset.count} 班列車`);
  btn.setAttribute("aria-pressed", String(Number(btn.dataset.count) === visibleCount));
  btn.addEventListener("click", () => {
    visibleCount = Number(btn.dataset.count) || 1;
    toggleButtons.forEach(b => {
      b.classList.toggle("active", b === btn);
      b.setAttribute("aria-pressed", String(b === btn));
    });
    renderSchedules();
    collapseMobileMenu();
  });
});

lineTabs.forEach(btn => btn.addEventListener("click", () => {
  activeLine = btn.dataset.line || "EAL";
  showingFavorites = false;
  favorites.selectedId = null;
  persistFavorites();
  renderFavoriteShortcuts();
  applyLineFilter();
  refreshAll();
  collapseMobileMenu();
}));

function tickCountdown() {
  if (document.hidden) return;
  remaining = Math.max(0, remaining - 1);
  countdownEl.textContent = remaining;
  countdownEl.classList.toggle("blink", remaining <= 5);
  const countdownPill = document.getElementById("countdown-pill");
  if (countdownPill) countdownPill.classList.toggle("blink", remaining <= 5);
  if (Date.now() >= nextScheduleExpiry) renderSchedules();
  else updateAllRows();
  if (remaining === 0) {
    refreshAll();
  }
}

function startRefreshTimer() {
  if (!refreshTimer) {
    refreshTimer = setInterval(tickCountdown, 1000);
  }
}

function stopRefreshTimer() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopRefreshTimer();
    activeRefresh?.controller.abort();
    queueController?.abort();
    ++refreshToken;
    activeRefresh = null;
    return;
  }
  remaining = REFRESH_SECONDS;
  countdownEl.textContent = remaining;
  startRefreshTimer();
  refreshAll();
});

initializeFavorites();
initializeBoardMenu();
renderBoard();
refreshAll();
startRefreshTimer();
initializeServiceNews();


function persistFavorites() {
  favoritesWarning = saveFavorites(browserStorage(), favorites);
  try {
    browserStorage().setItem(BOARD_VIEW_KEY, JSON.stringify({version:1, line:activeLine, view:showingFavorites ? "favorites" : "line"}));
  } catch {
    favoritesWarning ||= "此瀏覽器未能儲存看板選擇；本次仍可使用，重新開啟後可能重設。";
  }
}

function openFavorite(item) {
  showingFavorites = true;
  activeLine = item.line;
  favorites.selectedId = favoriteId(item);
  persistFavorites();
  renderFavoriteShortcuts();
  collapseMobileMenu();
  applyLineFilter();
  refreshAll();
}

function renderFavoriteShortcuts(message = "") {
  const feedback = document.getElementById("menu-feedback");
  if (feedback && (message || favoritesWarning)) feedback.textContent = favoritesWarning || message;
  renderServiceNews();
  const shortcuts = document.getElementById("favorites-shortcuts");
  shortcuts.replaceChildren();
  favorites.items.forEach(item => {
    const station = STATIONS.find(s => s.line === item.line && s.code === item.code);
    const label = `${station.name} · ${LINE_NAMES[item.line]}`;
    const group = document.createElement("div");
    group.className = "favorite-shortcut";
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = label;
    open.setAttribute("aria-pressed", String(showingFavorites && favorites.selectedId === favoriteId(item)));
    open.addEventListener("click", () => openFavorite(item));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `移除 ${label}`);
    remove.addEventListener("click", () => {
      const wasSelected = favorites.selectedId === favoriteId(item);
      favorites = removeFavorite(favorites, favoriteId(item));
      if (wasSelected) favorites.selectedId = favorites.items.length ? favoriteId(favorites.items[0]) : null;
      if (!favorites.items.length) showingFavorites = false;
      persistFavorites();
      renderFavoriteShortcuts("已移除快捷鍵");
      document.querySelector("#favorites-editor summary").focus();
      applyLineFilter(); refreshAll();
    });
    group.append(open, remove);
    shortcuts.appendChild(group);
  });
  updateMenuLabel();
  document.getElementById("favorites-all").disabled = !favorites.items.length;
  document.getElementById("favorites-all").setAttribute("aria-pressed", String(showingFavorites));
  document.getElementById("favorites-full").setAttribute("aria-pressed", String(!showingFavorites));
  document.getElementById("favorites-message").textContent = favoritesWarning || (favorites.items.length ? message || "所有常用站按收藏次序一起顯示，每站保留兩方向及實際月台。" : `${message ? `${message}。` : ""}尚未儲存常用車站。選擇路線及車站來新增快捷鍵。`);
}

function initializeFavorites() {
  const lineSelect = document.getElementById("favorite-line");
  const stationSelect = document.getElementById("favorite-station");
  const save = document.getElementById("favorite-save");
  const option = (value, label) => {
    const entry = document.createElement("option");
    entry.value = value; entry.textContent = label; return entry;
  };
  Object.keys(LINE_NAMES).forEach(line => lineSelect.appendChild(option(line, LINE_NAMES[line])));
  lineSelect.value = activeLine === "XFR" ? "EAL" : activeLine;
  const updateChoices = () => {
    stationSelect.replaceChildren(option("", "選擇車站"));
    STATIONS.filter(station => station.line === lineSelect.value).forEach(station => stationSelect.appendChild(option(station.code, station.name)));
    save.disabled = true;
  };
  updateChoices();
  lineSelect.addEventListener("change", updateChoices);
  stationSelect.addEventListener("change", () => { save.disabled = !stationSelect.value; });
  document.getElementById("favorites-form").addEventListener("submit", event => {
    event.preventDefault();
    const item = {line:lineSelect.value, code:stationSelect.value};
    if (!validFavorite(item)) return;
    const result = addFavorite(favorites, item);
    favorites = result.data;
    openFavorite(item);
    renderFavoriteShortcuts(result.duplicate ? "此快捷鍵已儲存" : "已儲存快捷鍵");
    document.getElementById("favorites-editor").open = false;
    collapseMobileMenu();
  });
  document.getElementById("favorites-all").addEventListener("click", () => {
    if (!favorites.items.length) return;
    showingFavorites = true;
    favorites.selectedId ||= favoriteId(favorites.items[0]);
    persistFavorites(); renderFavoriteShortcuts(); applyLineFilter(); refreshAll(); collapseMobileMenu();
  });
  document.getElementById("favorites-full").addEventListener("click", () => {
    showingFavorites = false;
    favorites.selectedId = null;
    persistFavorites();
    renderFavoriteShortcuts();
    applyLineFilter(); refreshAll(); collapseMobileMenu();
  });
  renderFavoriteShortcuts();
}


function updateMenuLabel() {
  const label = document.getElementById("board-menu-label");
  if (label) label.textContent = favorites.items.length ? `${favorites.items.length} 個常用站 · 管理／路線` : "新增常用站／選擇路線";
  const menu = document.getElementById("board-menu");
  if (menu && !favorites.items.length) menu.open = true;
}

function collapseMobileMenu() {
  const menu = document.getElementById("board-menu");
  if (menu && favorites.items.length && !favoritesWarning && window.matchMedia("(max-width: 760px)").matches) {
    menu.open = false;
    menu.querySelector("summary").focus();
  }
}

function initializeBoardMenu() {
  const menu = document.getElementById("board-menu");
  if (!menu) return;
  const media = window.matchMedia("(max-width: 760px)");
  const reset = () => { menu.open = !media.matches || !favorites.items.length || !!favoritesWarning; };
  reset();
  media.addEventListener("change", reset);
}
