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

- Add official MTR service status from MTR's RYG XML feed.
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
