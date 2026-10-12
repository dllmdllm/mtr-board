# MTR Board

A static Hong Kong MTR next train dashboard for scanning live arrivals across a full line.

## Features

- Line tabs for heavy rail lines covered by the MTR Next Train API.
- Station cards showing upcoming trains by direction.
- Transfer view for major interchange stations.
- Train count toggle for showing 1-4 upcoming trains.
- 15-second auto refresh with countdown.
- Boundary control point queue board on the East Rail tab.

## Data Sources

- MTR Next Train API:
  `https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php`
- Immigration Department boundary control point queue JSON, fetched through a Cloudflare Worker proxy because direct browser access can be blocked by CORS.

## Local Development

This is a static site. Run a local server from the repo root:

```sh
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

Opening `index.html` directly may work for the shell, but API calls are more reliable through a local server.

## Structure

- `index.html` - page markup and script/style references
- `styles.css` - visual layout and responsive styles
- `config.js` - station, line, interchange, and endpoint configuration
- `api.js` - fetch timeout, short cache, concurrency limiting, and API helpers
- `app.js` - board rendering, refresh loop, countdown, filtering, and interaction logic

## Reliability Notes

- MTR schedule data has no public train ID, so the app displays station ETAs rather than tracking individual train sets.
- Failed schedule requests are shown as `更新失敗`.
- Browser refresh is paused while the page is hidden.
- Schedule requests use a short cache and concurrency limit to reduce request pressure.

## Planned Work

- Consider additional documented, reuse-approved official railway data sources.
- Add Transport Department Special Traffic News filtering for MTR-related incidents.
- Add anomaly detection for unusual ETA and headway patterns.
- Add AI-generated incident summaries after deterministic detection is in place.

## Regression checks

No installation is needed for deterministic checks (Node.js 18 or newer):

```sh
TZ=Asia/Hong_Kong node --test tests/regression.test.cjs
TZ=UTC node --test tests/regression.test.cjs
TZ=America/Los_Angeles node --test tests/regression.test.cjs
node --check config.js
node --check api.js
node --check app.js
```

The optional `tests/browser-regression.cjs` uses an **already installed** Playwright Core and Chromium. Set `PLAYWRIGHT_MODULE` to the module path and `CHROMIUM_PATH` to the executable if needed; set `QA_OUTPUT` to a screenshot directory. It serves the site on loopback and mocks all external APIs. It covers hung queue feeds, request overlap and cancellation, source freshness, replacement trains, errors, and narrow-screen control sizes. It never installs dependencies or calls publication helpers.

MTR timestamps are parsed as Hong Kong time, retaining the API date across midnight. Each countdown uses the same ETA as its tooltip. The header shows the oldest currently usable source timestamp; `部分` means some visible station data is unavailable. Source data older than 90 seconds is withheld and marked expired. Border queues update separately, with their check time and partial failures shown. Refreshes pause and outstanding requests abort while the page is hidden. Same-view refreshes coalesce, while line changes cancel superseded work.

## Favorites and official traffic news (local feature)

Save a station and its line in the favorites editor; no direction selection is needed. Shortcuts open both directions together, with each train’s actual platform and destination; line tabs and `完整路線` restore the full board. The last explicitly opened shortcut is restored on the next visit. Favorites stay in this browser's local storage. Existing version1 directional shortcuts migrate to version2 station shortcuts: opposite directions at the same station/line merge, and the selected station is retained. Explicitly empty directions show no upcoming trains; missing/malformed direction data is marked unavailable. Direction headings never imply fixed platform numbers. No examples are pre-saved. Corrupt or unavailable storage falls back to the full board and a clear warning; shortcuts still work for the current visit when writing is blocked.

`service-news.js` reads the Transport Department's documented, CORS-enabled XML directly, separately from train arrivals. It does not use or redistribute undocumented MTR website JSON. Sources:

- [Transport Department Special Traffic News dataset](https://data.gov.hk/en-data/dataset/hk-td-tis_19-special-traffic-news-v2/resource/c177d6fe-658f-4320-9594-a9cb54a3af62)
- [XML feed](https://www.td.gov.hk/tc/special_news/trafficnews.xml), [schema](https://www.td.gov.hk/en/special_news/trafficnews.xsd)
- [Data specification](https://static.data.gov.hk/td/special-traffic-news/en/Data_Specification_for_STN_Eng_v4.0.pdf), [reuse and attribution terms](https://data.gov.hk/en/terms-and-conditions)

Rail/MTR notices retain source text, incident ID, publication time and NEW/UPDATED/CLOSED state. Last successful retrieval is shown separately: publication time is not a heartbeat. Empty feeds, no matching notices, parse failures, fetch failures and expired retrievals have separate states. No matching notice never means all lines are normal. Generic railway notices remain visible when the affected line cannot be identified. Favorites relevance is calculated locally from explicitly named lines, without inferring affected stations, directions, recovery times or alternative routes. Source markup is shown as text, never executed.

The displayed explanation is explicitly labelled **rule-based, not AI**. There is no approved AI backend in this repository. Actual AI prose would require a separately approved server-side inference endpoint and provider/credential arrangement; only public source facts could be submitted, with content-hash caching and strict output validation. Favorites, personal routes and location must never be sent. This feature creates no keys, accounts, new proxy access or hosting configuration.

Additional optional browser checks:

```sh
node tests/favorites-news-browser.cjs
```

Use the existing Playwright/Chromium environment variables described above. The checks use a loopback server and mocked feeds, test local persistence/duplicate/removal/direction races, unavailable/corrupt storage, source-status parsing, relevance, stale retrievals and request privacy. No external service is mutated.
