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
const rowState = new Map();
const ACTIVE_LINE_KEY = "activeLine";
let activeLine = localStorage.getItem(ACTIVE_LINE_KEY) || "EAL";
let visibleCards = [];
let visibleRows = [];
let refreshToken = 0;
let refreshTimer = null;

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
  if (activeLine === "XFR") return isPrimaryInterchangeCard(card);
  return card.dataset.line === activeLine;
}

function colorForPlat(plat) {
  const colors = ["#06D6A0", "#118AB2", "#EF476F", "#F4A261", "#90BE6D", "#F72585", "#A8DADC", "#F28482"];
  const num = Number(plat);
  if (Number.isNaN(num)) return "";
  return colors[(Math.abs(num) - 1) % colors.length];
}

function statusRow(text) {
  const row = document.createElement("div");
  row.className = "train-row";
  row.dataset.status = "status";
  row.innerHTML = `
    <span class="train-dest">${text}</span>
    <span class="train-right"><span class="train-mins"></span><span class="train-hint"></span></span>
  `;
  return row;
}

function parseTimeToMs(value) {
  if (!value || value === "-") return NaN;
  const iso = value.replace(" ", "T");
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? NaN : ms;
}


function computeTargetMs(train) {
  const byTime = parseTimeToMs(train.time);
  if (!Number.isNaN(byTime)) return byTime;
  const ttnt = Number(train.ttnt);
  if (!Number.isNaN(ttnt)) return Date.now() + ttnt * 60 * 1000;
  return NaN;
}


function formatCountdown(sec) {
  if (sec <= -GRACE_AFTER_ZERO) return "已開";
  if (sec <= 59) return "就到";
  const mins = Math.ceil(sec / 60);
  return `${mins} 分`;
}

function trainRow(train, key) {
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
  const mins = train.ttnt ?? "--";
  const plat = train.plat ?? "--";
  const time = train.time ?? "--";
  const color = colorForPlat(plat);
  if (color) row.style.color = color;
  row.dataset.key = key;
  const targetMs = computeTargetMs(train);
  if (!Number.isNaN(targetMs)) row.dataset.target = String(targetMs);
  row.title = `P${plat} | 到站 ${time}`;
  row.innerHTML = `
    <span class="train-dest"><span class="plat-num">${plat}</span>${destName}</span>
    <span class="train-right"><span class="train-mins">${mins} 分</span><span class="train-hint"></span></span>
  `;
  return row;
}

function fillList(listEl, trains, statusText, stationCode, direction) {
  listEl.innerHTML = "";
  if (!Array.isArray(trains) || trains.length === 0) {
    listEl.appendChild(statusRow(statusText || "暫無班次"));
    return;
  }
  trains.slice(0, visibleCount).forEach((train, idx) => {
    const key = `${stationCode}-${direction}-${idx}`;
    listEl.appendChild(trainRow(train, key));
  });
}

function updateRowCountdown(row) {
  if (row.dataset.status) return;
  const targetMs = Number(row.dataset.target);
  if (!targetMs) return;
  const remainingSec = Math.floor((targetMs - Date.now()) / 1000);
  const key = row.dataset.key || "";
  const state = rowState.get(key) || { displaySec: remainingSec, delayHint: false };
  let displaySec = state.displaySec;
  if (Number.isNaN(displaySec)) displaySec = remainingSec;
  const diff = remainingSec - displaySec;
  if (diff > NORMAL_DIFF) {
    displaySec = displaySec + Math.min(MAX_SLEW, diff);
  } else if (diff < -MAX_SLEW) {
    displaySec = displaySec + Math.max(-MAX_SLEW, diff);
  } else {
    displaySec = remainingSec;
  }
  state.displaySec = displaySec;
  rowState.set(key, state);

  const minsEl = row.querySelector(".train-mins");
  const hintEl = row.querySelector(".train-hint");
  const label = formatCountdown(displaySec);
  const shouldBlink = label === "就到" || label === "已開";
  if (minsEl) {
    minsEl.textContent = label;
    minsEl.classList.toggle("blink", shouldBlink);
  }
  if (hintEl) hintEl.textContent = "";
}

function applyLineFilter() {
  lineTabs.forEach(btn => btn.classList.toggle("active", btn.dataset.line === activeLine));
  visibleCards = [];
  visibleRows = [];
  document.querySelectorAll(".station-card").forEach(card => {
    const show = shouldShowCard(card);
    card.dataset.filtered = show ? "0" : "1";
    card.style.display = show ? "" : "none";
    card.classList.toggle("xfr-mode", activeLine === "XFR" && show);
    if (show) visibleCards.push(card);
  });
  if (cpBoard) {
    cpBoard.style.display = activeLine === "EAL" ? "" : "none";
  }
}

function updateAllRows() {
  if (visibleRows.length === 0) {
    document.querySelectorAll(".station-card .train-row").forEach(updateRowCountdown);
    return;
  }
  visibleRows.forEach(updateRowCountdown);
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
        <td><span class="cp-badge"><span class="cp-dot ${dotA}"></span></span></td>
        <td><span class="cp-badge"><span class="cp-dot ${dotD}"></span></span></td>
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

function prefillLoading(cards) {
  cards.forEach(card => {
    if (!shouldShowCard(card)) return;
    const refs = card._refs || {};
    const downList = refs.downList || card.querySelector('[data-dir="DOWN"] .train-list');
    const upList = refs.upList || card.querySelector('[data-dir="UP"] .train-list');
    const upCol = refs.upCol || upList.closest(".dir-col");
    if (activeLine === "XFR") {
      if (downList) {
        downList.innerHTML = "";
        downList.appendChild(statusRow("更新中"));
      }
      if (upList) upList.innerHTML = "";
      if (upCol) upCol.style.display = "none";
      return;
    }
    const code = card.dataset.code || "";
    if (downList) fillList(downList, [], "更新中", code, "DOWN");
    if (upList) fillList(upList, [], "更新中", code, "UP");
  });
}

async function refreshAll() {
  if (document.hidden) return;
  board.classList.add("is-refreshing");
  const token = ++refreshToken;
  const cards = visibleCards.length > 0
    ? visibleCards
    : Array.from(document.querySelectorAll(".station-card"));
  remaining = REFRESH_SECONDS;
  countdownEl.textContent = remaining;
  countdownEl.classList.remove("blink");
  const countdownPill = document.getElementById("countdown-pill");
  if (countdownPill) countdownPill.classList.remove("blink");

  const requestKeys = new Set();
  const requestItems = [];
  cards.forEach(card => {
    const line = card.dataset.line || "EAL";
    const code = card.dataset.code;
    const name = card.dataset.name || "";
    const linesToShow = activeLine === "XFR" ? (INTERCHANGE_LINES[name] || [line]) : [line];
    linesToShow.forEach(lineKey => {
      const key = `${lineKey}-${code}`;
      if (requestKeys.has(key)) return;
      requestKeys.add(key);
      requestItems.push({ key, line: lineKey, code });
    });
  });

  const [results, cpQueues] = await Promise.all([
    runLimited(requestItems, item =>
      fetchStationSchedule(item.line, item.code)
        .then(data => ({ key: item.key, data, error: null }))
        .catch(error => ({ key: item.key, data: null, error }))
    ),
    activeLine === "EAL"
      ? fetchControlPointQueues().catch(err => {
          console.error("Control point fetch failed:", err);
          showControlPointError();
          return { residentData: null, visitorData: null };
        })
      : Promise.resolve({ residentData: null, visitorData: null })
  ]);
  if (token !== refreshToken) {
    board.classList.remove("is-refreshing");
    return;
  }
  const byKey = new Map(results.map(r => [r.key, r.data]));
  const errorKeys = new Set(results.filter(r => r.error).map(r => r.key));
  if (activeLine === "EAL") {
    renderControlPoints(cpQueues.residentData, cpQueues.visitorData);
  }
  const now = new Date();
  const timeStr = now.toLocaleTimeString("zh-HK", { hour12: false });

  const changes = [];
  visibleRows = [];
  cards.forEach(card => {
    const line = card.dataset.line || "EAL";
    const code = card.dataset.code;
    if (!shouldShowCard(card)) {
      changes.push({ card, display: "none" });
      return;
    }
    const name = card.dataset.name || "";
    const linesToShow = activeLine === "XFR" ? (INTERCHANGE_LINES[name] || [line]) : [line];
    const groups = linesToShow.map(lineKey => {
      const data = byKey.get(`${lineKey}-${code}`);
      const entry = data?.data?.[`${lineKey}-${code}`];
      const down = (entry?.DOWN || []).filter(t => t && t.valid === "Y" && t.ttnt !== "-" && t.time && t.time !== "-");
      const up = (entry?.UP || []).filter(t => t && t.valid === "Y" && t.ttnt !== "-" && t.time && t.time !== "-");
      return { lineKey, down, up, ok: !!entry, failed: errorKeys.has(`${lineKey}-${code}`) };
    });
    const refs = card._refs || {};
    const downList = refs.downList || card.querySelector('[data-dir="DOWN"] .train-list');
    const upList = refs.upList || card.querySelector('[data-dir="UP"] .train-list');
    const downCol = refs.downCol || downList.closest(".dir-col");
    const upCol = refs.upCol || upList.closest(".dir-col");

    if (activeLine === "XFR") {
      changes.push({ card, display: "" });
      const renderMulti = () => {
        downList.innerHTML = "";
        const frag = document.createDocumentFragment();
        groups.forEach(group => {
          const groupWrap = document.createElement("div");
          groupWrap.className = "xfr-group";
          groupWrap.style.setProperty("--line-color", LINE_COLORS[group.lineKey] || "#53B7E8");
          groupWrap.style.setProperty("--line-color-rgb", hexToRgb(LINE_COLORS[group.lineKey] || "#53B7E8"));

          const downHas = group.down.length > 0;
          const upHas = group.up.length > 0;
          if (downHas || upHas || !group.ok) {
            const header = document.createElement("div");
            header.className = "train-row xfr-header";
            header.dataset.status = "status";
            header.style.color = LINE_COLORS[group.lineKey] || "#53B7E8";
            header.innerHTML = `
              <span class="train-dest">${LINE_NAMES[group.lineKey] || group.lineKey}</span>
              <span class="train-right"><span class="train-mins"></span><span class="train-hint"></span></span>
            `;
            groupWrap.appendChild(header);
          }

          const lineRow = document.createElement("div");
          lineRow.className = "xfr-pair";

          const makeCol = (dir, trains, statusText) => {
            const col = document.createElement("div");
            col.className = "xfr-col";
            if (trains.length === 0) {
              if (statusText) col.appendChild(statusRow(statusText));
              return col;
            }
            const shownTrains = trains.slice(0, visibleCount);
            shownTrains.forEach((train, idx) => {
              const key = `${group.lineKey}-${code}-${dir}-${idx}`;
              col.appendChild(trainRow(train, key));
            });
            const padCount = Math.max(0, visibleCount - shownTrains.length);
            for (let i = 0; i < padCount; i += 1) {
              const spacer = document.createElement("div");
              spacer.className = "train-row xfr-pad";
              spacer.innerHTML = `
                <span class="train-dest">&nbsp;</span>
                <span class="train-right"><span class="train-mins">&nbsp;</span><span class="train-hint"></span></span>
              `;
              col.appendChild(spacer);
            }
            return col;
          };

          if (!group.ok) {
            const statusText = group.failed ? "更新失敗" : "更新中";
            lineRow.appendChild(makeCol("DOWN", [], statusText));
            lineRow.appendChild(makeCol("UP", [], statusText));
          } else if (downHas && upHas) {
            lineRow.appendChild(makeCol("DOWN", group.down));
            lineRow.appendChild(makeCol("UP", group.up));
          } else if (downHas) {
            const downColLocal = makeCol("DOWN", group.down, "");
            const upColLocal = makeCol("UP", [], "");
            upColLocal.style.display = "none";
            lineRow.appendChild(downColLocal);
            lineRow.appendChild(upColLocal);
          } else if (upHas) {
            const downColLocal = makeCol("DOWN", [], "");
            const upColLocal = makeCol("UP", group.up, "");
            downColLocal.style.display = "none";
            lineRow.appendChild(downColLocal);
            lineRow.appendChild(upColLocal);
          } else {
            groupWrap.classList.add("xfr-empty");
            lineRow.appendChild(makeCol("DOWN", [], "暫無班次"));
            lineRow.appendChild(makeCol("UP", [], "暫無班次"));
          }
          groupWrap.appendChild(lineRow);

          frag.appendChild(groupWrap);
        });
        downList.appendChild(frag);
      };
      downCol.style.display = "";
      upCol.style.display = "";
      renderMulti();
      downList.querySelectorAll(".train-row").forEach(row => visibleRows.push(row));
      return;
    }

    const data = byKey.get(`${line}-${code}`);
    const entry = data?.data?.[`${line}-${code}`];
    if (!data || !entry) {
      const statusText = errorKeys.has(`${line}-${code}`) ? "更新失敗" : "更新中";
      changes.push({ card, display: "" });
      downCol.style.display = "";
      upCol.style.display = "";
      fillList(downList, [], statusText, code, "DOWN");
      fillList(upList, [], statusText, code, "UP");
      downList.querySelectorAll(".train-row").forEach(row => visibleRows.push(row));
      upList.querySelectorAll(".train-row").forEach(row => visibleRows.push(row));
      return;
    }
    const downTrains = groups[0]?.down || [];
    const upTrains = groups[0]?.up || [];
    const hasAnyTrain = downTrains.length > 0 || upTrains.length > 0;
    const override = DIR_OVERRIDE[`${line}-${code}`];

    if (!hasAnyTrain) {
      if (line === "EAL" && code === "RAC") {
        changes.push({ card, display: "none" });
        return;
      }
      changes.push({ card, display: "" });
      downCol.style.display = "";
      upCol.style.display = "";
      if (override === "DOWN") {
        upCol.style.display = "none";
        fillList(downList, [], "暫無班次", code, "DOWN");
      } else if (override === "UP") {
        downCol.style.display = "none";
        fillList(upList, [], "暫無班次", code, "UP");
      } else {
        fillList(downList, [], "暫無班次", code, "DOWN");
        fillList(upList, [], "暫無班次", code, "UP");
      }
      downList.querySelectorAll(".train-row").forEach(row => visibleRows.push(row));
      if (upCol.style.display !== "none") {
        upList.querySelectorAll(".train-row").forEach(row => visibleRows.push(row));
      }
      return;
    }

    changes.push({ card, display: "" });
    if (override === "DOWN") {
      downCol.style.display = "";
      upCol.style.display = "none";
      fillList(downList, downTrains, "", code, "DOWN");
    } else if (override === "UP") {
      downCol.style.display = "none";
      upCol.style.display = "";
      fillList(upList, upTrains, "", code, "UP");
    } else {
      if (downTrains.length > 0) {
        downCol.style.display = "";
        fillList(downList, downTrains, "", code, "DOWN");
      } else {
        downCol.style.display = upTrains.length > 0 ? "none" : "";
        if (downCol.style.display !== "none") fillList(downList, [], "暫無班次", code, "DOWN");
      }
      if (upTrains.length > 0) {
        upCol.style.display = "";
        fillList(upList, upTrains, "", code, "UP");
      } else {
        upCol.style.display = downTrains.length > 0 ? "none" : "";
        if (upCol.style.display !== "none") fillList(upList, [], "暫無班次", code, "UP");
      }
    }
    downList.querySelectorAll(".train-row").forEach(row => visibleRows.push(row));
    if (upCol.style.display !== "none") {
      upList.querySelectorAll(".train-row").forEach(row => visibleRows.push(row));
    }
  });

  changes.forEach(({ card, display }) => {
    card.style.display = display;
  });

  lastUpdate.textContent = timeStr;
  updateAllRows();
  requestAnimationFrame(() => {
    board.classList.remove("is-refreshing");
  });
}

refreshBtn.addEventListener("click", refreshAll);
toggleButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    const count = Number(btn.dataset.count);
    visibleCount = Number.isNaN(count) ? 1 : count;
    toggleButtons.forEach(b => b.classList.toggle("active", b === btn));
    if (toggleGroup) {
      toggleGroup.classList.toggle("has-active", toggleButtons.some(b => b.classList.contains("active")));
    }
    refreshAll();
  });
});

lineTabs.forEach(btn => {
  btn.addEventListener("click", () => {
    activeLine = btn.dataset.line || "EAL";
    localStorage.setItem(ACTIVE_LINE_KEY, activeLine);
    applyLineFilter();
    refreshAll();
  });
});

function tickCountdown() {
  if (document.hidden) return;
  remaining = Math.max(0, remaining - 1);
  countdownEl.textContent = remaining;
  countdownEl.classList.toggle("blink", remaining <= 5);
  const countdownPill = document.getElementById("countdown-pill");
  if (countdownPill) countdownPill.classList.toggle("blink", remaining <= 5);
  updateAllRows();
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
    return;
  }
  remaining = REFRESH_SECONDS;
  countdownEl.textContent = remaining;
  startRefreshTimer();
  refreshAll();
});

renderBoard();
refreshAll();
startRefreshTimer();
