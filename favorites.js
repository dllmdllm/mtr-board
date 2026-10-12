const FAVORITES_KEY = "mtrBoardFavoritesV1";
const DIRECTION_LABELS = {
  EAL: {DOWN:"往金鐘", UP:"往羅湖／落馬洲"},
  TML: {DOWN:"往烏溪沙", UP:"往屯門"},
  KTL: {DOWN:"往黃埔", UP:"往調景嶺"},
  TWL: {DOWN:"往中環", UP:"往荃灣"},
  ISL: {DOWN:"往堅尼地城", UP:"往柴灣"},
  TKL: {DOWN:"往北角／調景嶺", UP:"往寶琳／康城"},
  TCL: {DOWN:"往香港", UP:"往東涌"},
  SIL: {DOWN:"往金鐘", UP:"往海怡半島"},
  AEL: {DOWN:"往香港", UP:"往機場／博覽館"},
  DRL: {DOWN:"往迪士尼", UP:"往欣澳"}
};

function favoriteId(item) {
  return `${item.line}-${item.code}`;
}

function validFavorite(item) {
  return !!item && typeof item === "object" &&
    STATIONS.some(station => station.line === item.line && station.code === item.code);
}

function normalizeFavorites(value) {
  if (!value || ![1, 2].includes(value.version) || !Array.isArray(value.items)) throw new Error("Invalid favorites");
  const unique = new Map();
  let selectedId = null;
  for (const item of value.items) {
    if (!validFavorite(item) || (value.version === 1 && !["UP", "DOWN"].includes(item.direction))) throw new Error("Invalid station");
    const clean = {line:item.line, code:item.code};
    const id = favoriteId(clean);
    unique.set(id, clean);
    const oldId = value.version === 1 ? `${id}-${item.direction}` : id;
    if (value.selectedId === oldId) selectedId = id;
  }
  return {version:2, items:[...unique.values()], selectedId};
}

function loadFavorites(storage) {
  try {
    const raw = storage.getItem(FAVORITES_KEY);
    const value = raw === null ? {version:2, items:[], selectedId:null} : JSON.parse(raw);
    return {data:normalizeFavorites(value), warning:"", migrated:value.version === 1};
  } catch {
    return {data:{version:2, items:[], selectedId:null}, warning:"未能讀取常用車站；你仍可使用完整看板，或重新新增。"};
  }
}

function saveFavorites(storage, data) {
  try {
    storage.setItem(FAVORITES_KEY, JSON.stringify(normalizeFavorites(data)));
    return "";
  } catch {
    return "此瀏覽器未能儲存常用車站；本次仍可使用，重新開啟後可能消失。";
  }
}

function addFavorite(data, item) {
  if (!validFavorite(item)) throw new Error("Choose a station");
  const duplicate = data.items.some(entry => favoriteId(entry) === favoriteId(item));
  const items = duplicate ? data.items : [...data.items, {line:item.line, code:item.code}];
  return {data:{version:2, items, selectedId:favoriteId(item)}, duplicate};
}

function removeFavorite(data, id) {
  return {version:2, items:data.items.filter(item => favoriteId(item) !== id), selectedId:data.selectedId === id ? null : data.selectedId};
}

// Access to the storage property itself may throw in restricted browser contexts.
function browserStorage() {
  try { return localStorage; } catch { return {getItem(){throw new Error("Unavailable")},setItem(){throw new Error("Unavailable")}}; }
}
