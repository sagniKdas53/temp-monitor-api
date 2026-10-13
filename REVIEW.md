# Full quality review: temp-monitor-api

Branch: `review/full-pass` (base `main` @ `33d4d23`). Date: 2026-10-13.

This file records the baseline checks, every verified finding (severity, location, failure scenario, fix), what was deliberately not changed and why, and the before/after numbers.

## 1. Baseline (Phase 1, before any change)

Environment: Node v22.22.0, npm 10.9.4, Docker 29.8.2, hadolint 2.15.1, actionlint 1.7.12.

| Command | Result |
| :--- | :--- |
| `npm ci` | OK |
| `npm run build` | OK (`dist/chart.js` 205,380 bytes) |
| `npm test` | 6 tests, 6 pass |
| `node --test --experimental-test-coverage test/*.test.js` | `index.js`: 63.91% lines, 59.46% branches, 42.11% functions |
| `npm audit` | 0 vulnerabilities |
| `hadolint Dockerfile` | **exit 1**: DL3025 (warning: CMD/HEALTHCHECK not in JSON form, line 30), DL3066 (info: non-numeric `USER node`, line 24) |
| `actionlint` | OK (no findings) |
| `docker build` | OK. Image 283 MB. `docker history` shows a 27.5 MB `RUN npm ci` layer still present despite the later `rm -rf node_modules` |
| Smoke test of the image (sensor file mounted) | `/temp/ping` 200, `/temp` 200 `{"temp":45}`, `/temp/metrics` 200, `/temp/demo` 200, `docker stop` exit 0. Also: `/temp/ping?x=1` 404, `/temp/ping/` 404, `GET /nope` **405**, `/temp/homarr.html` 404, `HEAD /temp/ping` 405, `OPTIONS /temp` 405, `/metrics` without CORS/nosniff headers |
| Action versions in workflows | All exist: `actions/checkout@v7`, `actions/setup-node@v7`, `docker/setup-qemu-action@v4`, `docker/setup-buildx-action@v4`, `docker/login-action@v4`, `docker/metadata-action@v6`, `docker/build-push-action@v7` (checked with `git ls-remote --tags`) |

Notes on tooling:
- Docker Hub returned `429 Too Many Requests` for `node:lts-alpine` from this sandbox, so the base image was pulled from `mirror.gcr.io` and re-tagged locally. The sandbox's TLS-intercepting proxy also required a local-only base layer that trusts its CA so `npm ci` can run inside `docker build`. Neither change is in the repository.
- hadolint was installed from its GitHub release binary; actionlint with `go install`.

## 2. Findings

Each finding was reproduced (command or test noted) or, where reproduction isn't possible, the reasoning is given. Severity reflects impact on a real deployment.

### High

| # | Location | Finding and failure scenario | Fix |
| :- | :- | :- | :- |
| H1 | `index.js:143` (old) | **Any client can kill the server.** `cache.retries` counted every failed read from any caller, and failures weren't cached. With the sensor briefly unreadable, 9 requests to `/temp` hit `max_retries` and the server called `process.exit(1)` mid-request. Reproduced: `temp_file_path=/nonexistent`, 9 × `curl /temp`, process gone. | Failures are cached for one scrape interval; concurrent reads share one in-flight read; only real attempts count. Tests: `a burst of HTTP-style reads…`, `concurrent callers share…`. |
| H2 | `chart.js:57`, `index.js:296` (old) | **Dashboard broken for remote viewers and for the Dashy embed.** `/config` returned an absolute URL built from `hostname` (default `http://localhost:64567/temp`), so a browser on another machine polled *its own* localhost. In the documented Dashy embed, `fetch('./config')` resolved against the Dashy page, not the script. Reproduced in Chromium: a page on another origin loading `/temp/chart.js` showed no value and logged `config fetch failed: 404` and JSON parse errors. | `chart.js` resolves `config` and the API from `document.currentScript.src`. `/config` keeps its `url` field for compatibility. Verified in Chromium: demo, homarr and the cross-origin embed all render and update. |

### Medium

| # | Location | Finding and failure scenario | Fix |
| :- | :- | :- | :- |
| M1 | `docker-compose.yml:33` | Compose passed `host=` but the code reads `hostname`, so in the compose deployment `hostname` was never set (`/config` → `https://localhost/temp`). Verified with `docker compose config`. | Pass `hostname=`. CORS default kept at `*` for compose users (it was effectively `*` before) via `cors_allowed_origins=${CORS_ALLOWED_ORIGINS:-*}`. |
| M2 | `docker-compose.yml:22` | `CHART_SIZE`/`CHART_REFRESH_INTERVAL` were passed only as build args, which the Dockerfile no longer declares, so they were ignored (`/config` returned `size: 12` with `CHART_SIZE=24`). | Passed as runtime env; dead build args removed. |
| M3 | `docker-compose.yml:27` | The `.env` key `HOSTNAME` is overridden by a shell-exported `HOSTNAME` (RHEL/Fedora export it), so the Traefik `Host()` rule and TLS domain silently used the machine name. Verified: `HOSTNAME=buildbox docker compose config`. | Compose prefers `API_HOSTNAME`, falling back to `HOSTNAME` (existing `.env` files keep working). |
| M4 | `index.js:12` (old) | `hide_ports=false` (or `0`) **hid** the port: `!!"false"` is true. Reproduced: `/config` url had no port. | Real boolean parsing (`true/false/1/0/yes/no/on/off`); unknown non-empty values keep the old truthy behaviour with a warning. |
| M5 | `index.js:8-11` (old) | Config parsing: `port` never parsed (`port=abc` silently listened on a **Unix socket** named `abc` and logged "started"); `parseInt(x) \|\| default` turned an explicit `0` into the default and accepted `15s` as 15 ms; `scrape_interval=-5` became a ~1 ms busy loop (855 reads in 1 s, reproduced); no validation of `max_retries`. | New `config.js` with strict integer parsing and bounds, warnings on invalid values, shared with `health-check.js`. 17 tests in `test/config.test.js`. |
| M6 | `index.js:177` (old) | Retry counter reset **before** the reading was validated, so garbage or out-of-range data never tripped `max_retries`; `/temp` returned 500 while `/ping` (and the Docker health check) stayed UP forever. `parseInt('45000abc')` was accepted. | Reset only after validation; strict numeric regex. Tests for `invalid`, empty, `45000abc`, out-of-range values. |
| M7 | `index.js:131` (old) | Cache TTL equalled the poll interval, so a tick firing a few ms early was served from cache and skipped the read (reproduced: 1 of 6 ticks at 1 s interval). `setInterval` with an async body could also overlap slow reads. | Poller forces a real read; `setTimeout` chain so reads never overlap; `stopPolling()` on shutdown. Test: `polling never overlaps reads and stops cleanly`. |
| M8 | `index.js:261` (old) | Query strings broke routing: `/temp/ping?t=1`, `/temp?_=1`, `/temp/metrics?x=1` → 404 (reproduced). Trailing slash also 404; `base_url=/temp/` or `/` broke every route while the health check still passed. | Route on the path only; ignore trailing slashes; normalise `base_url`. |
| M9 | `index.js:396` (old) | Everything that wasn't a GET under the base URL returned 405: `GET /` was 405 (should be 404), `HEAD` was rejected (uptime monitors using HEAD saw it as down), 405 had no `Allow`, `OPTIONS` preflight failed. | 404 for unknown paths, 405 + `Allow` for unsupported methods, `HEAD` supported, `OPTIONS` → 204 with CORS preflight headers. Error bodies keep `temp: null` and add an `error` field. |
| M10 | `index.js:35` (old) | CORS: with `hostname` set, `Access-Control-Allow-Origin` was the API's own origin (useless for same-origin, blocks the Dashy embed) and omitted the port when `hide_ports` was off. `/metrics` responses had no CORS/nosniff headers at all. | Origin includes the port; new optional `cors_allowed_origins` (list or `*`; several origins are echoed with `Vary: Origin`); headers on every response including errors. `*` without `hostname` is kept (documented as intended). |
| M11 | `index.js:40` (old) | `X-Frame-Options: SAMEORIGIN` on `/demo` blocked the documented Homarr iframe; and `/temp/homarr.html`, which the README documents, didn't exist (404; excluded by `.dockerignore`; `__BASE_URL__` placeholders never substituted). | `/homarr.html` served with page-relative URLs and copied into the image; dashboard pages omit `X-Frame-Options` (read-only pages, nothing to clickjack). JSON/API routes keep it. |
| M12 | `index.js:51` (old) | A missing `dist/chart.js` crashed the whole API at `require` time with a raw `ENOENT` stack trace (reproduced). | Assets load at startup with a clear log line (`hint: run npm run build…`); a missing asset returns 503 with that hint while the API keeps working. `npm test` now runs the build first (`pretest`). |
| M13 | `index.js:325` (old) | `/metrics` had no trailing newline; Prometheus' `expfmt` text parser rejects the body (`unexpected end of input stream`). Content type lacked the format version. | Trailing newline, `text/plain; version=0.0.4; charset=utf-8`. Test parses every line. |
| M14 | `index.js:425-441` (old) | Signal and `uncaughtException` handlers were registered at import, so inside the test runner an assertion failure called `process.exit(1)` and hid which test failed. Shutdown wasn't idempotent and never stopped the poller. | Handlers registered only when run directly (`start()`); idempotent shutdown, stops polling, closes idle sockets; `EADDRINUSE` logged and exits 1. Child-process tests in `test/process.test.js`. |
| M15 | `test/*.test.js` | Error-path tests asserted only inside `catch`, so they passed when the function resolved (mutation-tested: removing validation still gave 6/6). `/metrics` test matched the HELP line, not the sample. Mocks and `CONFIG` mutations leaked between tests. No tests for `/config`, `/temp`, 404/405, CORS, HEAD, shutdown. | Rewritten with `assert.rejects`, `t.mock`, CONFIG restored after each test; 67 tests now. |
| M16 | `Dockerfile:10-18` (old) | `rm -rf node_modules` ran in a later layer than `npm ci`, so 27.5 MB of `node_modules`/npm cache still shipped (verified with `docker history`). | Multi-stage build. Image 283 MB → 242 MB; app layers ~28 MB → ~0.24 MB. |
| M17 | `.github/workflows/ci-publish.yml:14` | Publish didn't depend on tests: a commit failing its tests was still pushed as `:latest` (both workflows start in parallel on push). | Publish calls the test workflow (`workflow_call`) and `needs` it. |
| M18 | `.github/workflows/ci-test.yml:28` | CI tested on Node 20 (EOL 2026-04-30) while the image runs Node 24. | Matrix on Node 22 and 24; image pinned to `node:24-alpine`. |

### Low

| # | Location | Finding and failure scenario | Fix |
| :- | :- | :- | :- |
| L1 | `index.js:355` (old) | Static assets were a plain object: `/temptoString`, `/temp__proto__` matched `Object.prototype` and returned 500 with an error-level stack trace (reproduced). | `Map` lookups; test covers these names. |
| L2 | `index.js:100` (old) | Unknown `log_level` (`INFO`, `warning`) gave `indexOf -1`, enabling debug logging. | Case-insensitive; unknown values warn and use the default. |
| L3 | `index.js:81-84` (old) | logfmt didn't escape newlines in strings/error messages, splitting one event over several lines (visible in the old test output). | Newlines escaped everywhere, including `msg`. |
| L4 | `index.js:230` (old) | `cache_hit` in the poll log was always true (computed after the read updated the cache). | Removed; the cache path logs its own debug line. |
| L5 | `index.js:218` (old) | `pollingInterval` assigned but never cleared. | Replaced by `startPolling`/`stopPolling`. |
| L6 | `index.js:14` (old) | Hard-coded `thermal_zone2` default; on machines without it every read failed and there was no hint which zones exist. | Keep `thermal_zone2` when present; otherwise auto-detect a CPU zone (`x86_pkg_temp`, `coretemp`, `cpu-thermal`, …) and log the choice; the zone list is logged when the initial read fails. Explicit `temp_file_path` always wins. |
| L7 | `index.js` (old) | No caching headers. | API: `Cache-Control: no-store`. Static: `no-cache` + `ETag`, `304` on `If-None-Match`. |
| L8 | `chart.js:60-83` (old) | No validation of `/config` fields (an undefined interval meant a ~4 ms poll loop and unbounded data growth), no `.catch`/`res.ok` (unhandled rejections), API value written with `innerHTML`. | Per-field defaults, errors caught, `textContent`, failed polls plotted as gaps. |
| L9 | `chart.js:1` | `chart.js/auto` registered everything (205 KB bundle). | Register only the needed parts: 156 KB (-24%). Verified rendering in Chromium. |
| L10 | `style.css:10,27` | `#canvas-container` (markup uses a class) and `.content.item` (elements are nested) never matched. | `.canvas-container`, `.content .item`. |
| L11 | `health-check-min.js` | Unused, hard-coded port/base_url and 25 s timeout; excluded from the image. | Deleted. |
| L12 | `health-check.js:7` | Script timeout (10 s) equalled the `HEALTHCHECK --timeout`, and port/base_url were parsed differently from the server. | Uses `config.js`; 5 s `AbortSignal.timeout`. |
| L13 | `Dockerfile:24,30` | hadolint DL3025 / DL3066. | Exec-form HEALTHCHECK, numeric `USER 1000:1000` (same `node` user). |
| L14 | `.dockerignore` | Didn't exclude tests, coverage, docs, compose files. | Extended. |
| L15 | `ci-publish.yml` | No concurrency group (an older run finishing last could own `:latest`); `type=semver` tag rules were dead because tags never triggered the workflow. | `concurrency` with cancel-in-progress; `tags: ['v*']` trigger. |
| L16 | `package.json:14` | `chart.js` listed as a runtime dependency although only bundled at build time; `npm test` failed on a fresh clone (no `dist/`). | Moved to `devDependencies`; `pretest` builds. |
| L17 | `docker-compose.yml:1`, `.github/dependabot.yml` | Obsolete `version:` key; Dependabot didn't track the Docker base image. | Removed; `docker` ecosystem added. |
| L18 | `README.md` | Config table missing `log_level`, `max_retries`, `chart_refresh_interval`; endpoint list incomplete; Homarr page documented but missing. | README rewritten to match the code. |

### Checked and dropped (not bugs)

- **Path traversal**: static files are served from a fixed in-memory map; request paths never reach the filesystem. `/temp/../index.js`, `%2e%2e` variants → 404 (test added).
- **`build.js` hides build errors**: esbuild prints its own diagnostics before the `catch` exits 1.
- **Upper-case letters in the GHCR image name**: `docker/metadata-action` lower-cases it; publish runs are green.
- **PID 1 signal handling**: Node as PID 1 does receive SIGTERM because the app installs handlers; `docker stop` exits 0 in ~0 s (smoke test checks it). No init process needed.

## 3. Deliberately not changed

These would break existing users (env names, endpoints, response shapes, image contract), so a backwards-compatible alternative was used or they're left as follow-ups:

| Item | Why not | What was done instead |
| :- | :- | :- |
| Rename `cpu_temperature` to `cpu_temperature_celsius` | Breaks existing dashboards/alerts | Added `cpu_temperature_celsius` alongside; old metric's HELP marks it deprecated |
| Upper-case env var names / aliases | Docker sets `HOSTNAME` to the container ID, so an upper-case alias would silently change behaviour | Documented that names are lower-case |
| Read `host` as an alias of `hostname` | Would switch existing compose users from CORS `*` to a single origin | Fixed the compose file instead, with CORS defaulting to `*` there |
| Return 503 instead of 500 on sensor errors; emit an `up`-style gauge on `/metrics` failure instead of a 500 | Changes status codes / response shape that clients may alert on | Kept 500; suggested as a follow-up |
| Remove `url` from `/config` | Response shape; may be used by custom embeds | Kept; the bundled chart no longer relies on it |
| Change default `log_level` from `debug` | Changes log volume users may rely on | Documented; suggest `info` for production |
| Make the CORS default `*` when `hostname` is set | Widens access compared to today | Opt-in via `cors_allowed_origins` |
| `npm` major upgrade, `node:lts-alpine` floating tag | Pinned to `node:24-alpine` (the current LTS, same as before) so Dependabot can bump it deliberately | — |

## 4. Before / after

| Metric | Before | After |
| :- | :- | :- |
| Tests | 6 (2 files) | 67 (4 files) |
| `index.js` coverage (lines / branches / functions) | 63.91% / 59.46% / 42.11% | 94.59% / ~91% / 91.94% |
| `config.js` / `health-check.js` coverage | n/a / not run | 98.26% / 100% lines |
| hadolint | 2 findings (exit 1) | clean |
| actionlint | clean | clean |
| npm audit | 0 vulnerabilities | 0 vulnerabilities |
| Image size | 283 MB (27.5 MB `node_modules` layer) | 242 MB (app layers ~0.24 MB) |
| `dist/chart.js` | 205 KB | 156 KB |
| Docker smoke test (`scripts/smoke-test.sh`) | fails 2 checks on the old image (no `_celsius` metric, `/homarr.html` 404) | 14/14 checks pass |

## 5. Suggested follow-ups

- Expose a `temp_sensor_up` gauge and a read-error counter on `/metrics`, and return exposition text with `temp_sensor_up 0` instead of a JSON 500 (needs a decision since it changes the error response).
- Consider `log_level=info` as the default for the image.
- Consider a `/temp/zones` endpoint (or startup flag) listing available thermal zones.
- Publish `latest` only from tags if you want immutable releases; currently `main` pushes also update `latest`.
