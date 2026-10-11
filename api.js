const FETCH_TIMEOUT_MS = 8000;
const SCHEDULE_CACHE_MS = 8000;
const CP_CACHE_MS = 30000;
const MAX_CONCURRENT_REQUESTS = 6;

const scheduleCache = new Map();
const jsonCache = new Map();

function cacheKey(parts) {
  return parts.join(":");
}

async function fetchJson(url, timeoutMs = FETCH_TIMEOUT_MS, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

function readCache(cache, key, ttlMs) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ttlMs) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function writeCache(cache, key, value) {
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function fetchStationSchedule(line, code, signal) {
  const key = cacheKey(["schedule", line, code]);
  const cached = readCache(scheduleCache, key, SCHEDULE_CACHE_MS);
  if (cached) return cached;

  const url = `${API_BASE}?line=${line}&sta=${code}&lang=TC`;
  const data = await fetchJson(url, FETCH_TIMEOUT_MS, signal);
  return writeCache(scheduleCache, key, data);
}

async function fetchCachedJson(url, ttlMs = CP_CACHE_MS, signal) {
  const cached = readCache(jsonCache, url, ttlMs);
  if (cached) return cached;
  const data = await fetchJson(url, FETCH_TIMEOUT_MS, signal);
  return writeCache(jsonCache, url, data);
}

async function fetchControlPointQueues(signal) {
  const proxyResident = `${CP_PROXY_BASE}?target=${encodeURIComponent(CP_RESIDENT_URL)}`;
  const proxyVisitor = `${CP_PROXY_BASE}?target=${encodeURIComponent(CP_VISITOR_URL)}`;
  const [residentData, visitorData] = await Promise.all([
    fetchCachedJson(proxyResident, CP_CACHE_MS, signal).catch(() => null),
    fetchCachedJson(proxyVisitor, CP_CACHE_MS, signal).catch(() => null)
  ]);
  return { residentData, visitorData };
}

async function runLimited(items, worker, limit = MAX_CONCURRENT_REQUESTS) {
  const results = new Array(items.length);
  let next = 0;

  async function runner() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    () => runner()
  );
  await Promise.all(runners);
  return results;
}
