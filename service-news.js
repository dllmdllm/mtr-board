const TRAFFIC_NEWS_URL = "https://www.td.gov.hk/tc/special_news/trafficnews.xml";
const NEWS_REFRESH_MS = 180000;
const NEWS_STALE_MS = 360000;
const NEWS_LINE_NAMES = {
  EAL:["東鐵", "East Rail"], TML:["屯馬", "Tuen Ma"], KTL:["觀塘綫", "觀塘線", "Kwun Tong Line"],
  TWL:["荃灣綫", "荃灣線", "Tsuen Wan Line"], ISL:["港島綫", "港島線", "Island Line"],
  TKL:["將軍澳綫", "將軍澳線", "Tseung Kwan O Line"], TCL:["東涌綫", "東涌線", "Tung Chung Line"],
  SIL:["南港島", "South Island"], AEL:["機場快綫", "機場快線", "Airport Express"], DRL:["迪士尼綫", "迪士尼線", "Disneyland Resort Line"]
};
let serviceNews = {kind:"loading", notices:[], checkedAt:null};
let newsController = null;
let newsToken = 0;
let newsTimer = null;

function newsCheckedTime(ms) {
  return new Date(ms + 8 * 3600000).toISOString().slice(0,19).replace("T", " ");
}

function newsTime(value) {
  if (typeof value !== "string") return NaN;
  return parseTimeToMs(value.replace("T", " "));
}

function plainNewsText(value) {
  // This is text cleanup, not HTML insertion: source markup is never attached to the DOM.
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ").replace(/<\/?[a-z][^>]*>/gi, " ").replace(/\s+/g, " ").trim();
}

function relevantNewsText(text) {
  return /港鐵|地鐵|輕鐵|鐵路|\bMTR\b|\brailway\b|\blight rail\b/i.test(text) ||
    Object.values(NEWS_LINE_NAMES).some(names => names.some(name => text.toLowerCase().includes(name.toLowerCase())));
}

function parseTrafficNews(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror") || doc.documentElement.tagName !== "list") throw new Error("Invalid traffic news XML");
  const read = (message, tag) => message.querySelector(tag)?.textContent.trim() || "";
  const notices = [];
  for (const message of doc.querySelectorAll("message")) {
    const id = read(message,"INCIDENT_NUMBER") || read(message,"ID");
    const cn = plainNewsText(read(message,"CONTENT_CN")), en = plainNewsText(read(message,"CONTENT_EN"));
    const heading = plainNewsText(read(message,"INCIDENT_HEADING_CN") || read(message,"INCIDENT_HEADING_EN"));
    const detail = plainNewsText(read(message,"INCIDENT_DETAIL_CN") || read(message,"INCIDENT_DETAIL_EN"));
    const published = read(message,"ANNOUNCEMENT_DATE");
    const status = read(message,"INCIDENT_STATUS_EN").toUpperCase();
    if (!id || !(cn || en) || !Number.isFinite(newsTime(published)) || !["NEW","UPDATED","CLOSED"].includes(status)) throw new Error("Unverified traffic news fields");
    const text = `${heading} ${detail} ${cn} ${en}`;
    if (!relevantNewsText(text)) continue;
    const lines = Object.keys(NEWS_LINE_NAMES).filter(line => {
      const scoped = line === "ISL" ? text.replace(/South Island Line|南港島[綫線]/gi, "") : text;
      return NEWS_LINE_NAMES[line].some(name => scoped.toLowerCase().includes(name.toLowerCase()));
    });
    notices.push({id, heading, detail, content:cn || en, published, publishedMs:newsTime(published), status, lines,
      location:read(message,"LOCATION_CN") || read(message,"LOCATION_EN"), direction:read(message,"DIRECTION_CN") || read(message,"DIRECTION_EN")});
  }
  return {notices:notices.sort((a,b)=>b.publishedMs-a.publishedMs), total:doc.querySelectorAll("message").length};
}

function favoriteNewsSummary(notice, favoriteItems) {
  const matches = [...new Set(favoriteItems.filter(item => notice.lines.includes(item.line)).map(item => item.line))];
  if (matches.length) return `你收藏嘅${matches.map(line=>LINE_NAMES[line]).join("、")}同呢則通告提及嘅路線有關；邊段、邊個方向受影響，請睇運輸署原文。`;
  if (!favoriteItems.length) return "未有收藏車站；受影響區段以運輸署原文為準。";
  if (!notice.lines.length) return "通告未有足夠路線資料，未能判斷同你收藏嘅車站有冇關。";
  return "通告提及嘅路線暫未同你嘅收藏對上；唔代表你嘅行程一定冇影響。";
}

function renderServiceNews() {
  const summary = document.getElementById("service-summary");
  const list = document.getElementById("service-notices");
  if (!summary || !list) return;
  list.replaceChildren();
  if (serviceNews.kind !== "ready" || Date.now() - serviceNews.checkedAt > NEWS_STALE_MS) {
    summary.textContent = serviceNews.kind === "loading" ? "更新中" : serviceNews.kind === "parse-error" ? "消息格式未能驗證" : serviceNews.kind === "fetch-error" ? "消息載入失敗" : "消息檢查已過期";
    const text = document.createElement("p");
    text.textContent = `${serviceNews.checkedAt ? `最近成功檢查：${newsCheckedTime(serviceNews.checkedAt)}（香港時間）。` : ""}消息未能讀取或檢查時間已過期；唔能夠據此判斷港鐵服務正常。請查看官方網站。`;
    list.appendChild(text); return;
  }
  const active = serviceNews.notices.filter(notice=>notice.status !== "CLOSED");
  const related = active.some(notice=>favorites.items.some(item=>notice.lines.includes(item.line)));
  summary.textContent = active.length ? `${active.length} 則港鐵／鐵路相關通告${related ? " · 涉及收藏路線" : ""}` : serviceNews.total === 0 ? "來源暫未有通告" : "暫未見未完結的港鐵相關通告";
  const checked = document.createElement("p");
  checked.textContent = `檢查時間：${newsCheckedTime(serviceNews.checkedAt)}（香港時間）。未見通告唔代表全線正常；消息唔會改寫官方到站時間。`;
  list.appendChild(checked);
  serviceNews.notices.forEach(notice=>{
    const item = document.createElement("article");
    item.className = "service-notice";
    const title = document.createElement("strong"); title.textContent = `${notice.heading || "鐵路相關交通消息"}${notice.detail ? ` · ${notice.detail}` : ""}`;
    const metadata = document.createElement("p");
    metadata.textContent = `${notice.id} · ${notice.status === "CLOSED" ? "已完結" : notice.status === "UPDATED" ? "已更新" : "新通告"} · 公布 ${notice.published.replace("T"," ")}（香港時間） · ${notice.lines.length ? notice.lines.map(line=>LINE_NAMES[line]).join("、") : "路線未能確認"}`;
    const explanation = document.createElement("p");
    explanation.textContent = notice.status === "CLOSED" ? "呢則通告已完結；唔代表目前所有路線都正常。" : favoriteNewsSummary(notice,favorites.items);
    const original = document.createElement("details");
    const toggle = document.createElement("summary"); toggle.textContent = "運輸署原文及區段資料";
    const content = document.createElement("p"); content.textContent = notice.content;
    const scope = document.createElement("p"); scope.textContent = `位置：${notice.location || "原文未有另列"}；方向：${notice.direction || "原文未有另列"}。`;
    original.append(toggle,content,scope); item.append(title,metadata,explanation,original); list.appendChild(item);
  });
}

async function refreshServiceNews() {
  if (document.hidden || newsController) return;
  const controller = new AbortController(); newsController = controller;
  const token = ++newsToken;
  const timeout = setTimeout(()=>controller.abort(),8000);
  let phase = "fetch-error";
  try {
    // No station choices, favorites, identifiers, credentials or AI payloads are transmitted.
    const response = await fetch(TRAFFIC_NEWS_URL,{cache:"no-store",credentials:"omit",signal:controller.signal});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    phase = "parse-error";
    const parsed = parseTrafficNews(xml);
    if (token === newsToken && !controller.signal.aborted) serviceNews = {kind:"ready",notices:parsed.notices,total:parsed.total,checkedAt:Date.now()};
  } catch {
    if (token === newsToken) serviceNews = {kind:phase,notices:[],checkedAt:serviceNews.checkedAt};
  } finally {
    clearTimeout(timeout);
    if (newsController === controller) newsController = null;
    renderServiceNews();
  }
}

function initializeServiceNews() {
  const start = () => { if (!newsTimer) newsTimer = setInterval(()=>{renderServiceNews();refreshServiceNews();},NEWS_REFRESH_MS); refreshServiceNews(); };
  document.addEventListener("visibilitychange",()=>{
    if (document.hidden) { clearInterval(newsTimer);newsTimer=null;++newsToken;newsController?.abort();newsController=null; }
    else start();
  });
  start();
}
