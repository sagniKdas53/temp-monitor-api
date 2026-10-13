# Temperature Monitoring API

A lightweight Node.js API that monitors CPU temperature by reading Linux thermal zone files and provides a real-time dashboard using Chart.js.

## How it Works

1.  **Backend**: A native Node.js HTTP server polls a Linux thermal zone file at a defined interval. By default it reads `/sys/class/thermal/thermal_zone2/temp`; if that zone doesn't exist and `temp_file_path` is unset, it picks a CPU thermal zone automatically (and lists the available zones in the log when a read fails).
2.  **API**: It exposes endpoints for the current temperature, health checks, and Prometheus metrics.
3.  **Frontend**: A simple HTML dashboard (`/temp/demo`) uses **Chart.js** to render a real-time graph. The chart JavaScript is bundled using **esbuild**. It finds the API relative to its own script URL, so it also works when embedded in another site (Dashy, Homarr).
4.  **Configuration**: All settings are controlled via environment variables, making it perfect for Docker and Kubernetes deployments.

## Features

- 🚀 **Zero-dependency runtime**: Only regular Node.js is required to run the server.
- 📊 **Real-time Charting**: Beautiful line chart powered by Chart.js.
- 🩺 **Health Checks**: Ready-to-use `/ping` endpoint for load balancers and orchestrators.
- 📈 **Prometheus Metrics**: Built-in `/metrics` endpoint for Grafana/Prometheus integration.
- 🐳 **Dockerized**: Multi-stage Dockerfile, runs as a non-root user, with a built-in `HEALTHCHECK`.

## Configuration

The following environment variables configure the application. Names are **lower-case** (Docker sets an upper-case `HOSTNAME` to the container ID, so upper-case names are deliberately not read). Invalid values are logged as a warning at startup and the default is used. One exception keeps old deployments working: an unrecognised non-empty `hide_ports` value (e.g. `y`) is still treated as true, as it was before booleans were parsed.

| Variable | Description | Default |
| :--- | :--- | :--- |
| `port` | Server port (integer 0–65535; `0` picks a free port) | `64567` |
| `hostname` | Public hostname, used for the `url` in `/config` and the default CORS origin | `localhost` |
| `protocol` | Public protocol (`http` or `https`) | `http` |
| `base_url` | API base path. Trailing slashes are ignored; `/` serves from the root | `/temp` |
| `hide_ports` | `true`/`false` (also `1`/`0`, `yes`/`no`, `on`/`off`). If true, the port is left out of the public URL | `false` |
| `scrape_interval` | Sensor polling interval and cache lifetime, in ms (integer ≥ 100) | `15000` |
| `temp_file_path` | Path to the thermal zone file | `/sys/class/thermal/thermal_zone2/temp`, or an auto-detected CPU zone if that doesn't exist |
| `max_retries` | Consecutive failed sensor reads before giving up (integer ≥ 1) | `9` |
| `exit_on_max_retries` | Exit with code 1 after `max_retries` failures (so Docker/autoheal restarts the container). If false, keep serving the last good value | `true` |
| `log_level` | `debug`, `info`, `warn` or `error` (case-insensitive) | `debug` |
| `chart_data_points` | Number of points shown in the chart | `12` |
| `chart_refresh_interval` | How often the chart polls the API, in ms | `15000` |
| `cors_allowed_origins` | Comma-separated list of origins (`scheme://host[:port]`) allowed to call the API from a browser, or `*`. Invalid entries are ignored with a warning | `*` if `hostname` is unset, otherwise the API's own origin (`protocol://hostname[:port]`) |

> [!NOTE]
> To embed the chart in a dashboard served from a different origin (e.g. Dashy), that origin must be allowed by CORS: either leave `hostname` unset, or set `cors_allowed_origins` to the dashboard's origin (or `*`).

## Getting Started

### Local Development

1.  Install dependencies:
    ```bash
    npm install
    ```
2.  Build the frontend:
    ```bash
    npm run build
    ```
3.  Start the server:
    ```bash
    npm run dev
    ```

### Running with Docker

```bash
docker build -t temp-monitor-api .
docker run -p 64567:64567 temp-monitor-api
```

Docker mounts the host's `/sys` read-only inside containers, so every thermal zone (and automatic zone selection) is visible without a volume. Set `temp_file_path` to pick a specific zone.

Or use `docker-compose.yml` together with a `.env` file based on `.env.example`. Compose reads `API_HOSTNAME` (falling back to `HOSTNAME`, which many shells export and which would otherwise override `.env`).

## Development & Testing

### Running Tests
We use the native Node.js test runner for zero-dependency testing. `npm test` builds `dist/chart.js` first.
```bash
npm test
npm run test:coverage   # with a coverage report
```

To smoke-test a built image (endpoints, health check, non-root user, graceful shutdown):
```bash
docker build -t temp-api:local . && scripts/smoke-test.sh temp-api:local
```

### Mocking Temperature on Non-Linux Systems
If you are developing on macOS or Windows, the default Linux thermal path won't exist. You can mock it by creating a dummy file:

1.  Create a file named `mock_temp` with content `45000`.
2.  Run the app with the `temp_file_path` env var pointing to it:
    ```bash
    temp_file_path=./mock_temp npm run dev
    ```

## Dashy Integration

This project is designed to be easily integrated into [Dashy](https://dashy.to/) as a custom widget. You can use the `embed` widget type to display the real-time temperature graph directly on your dashboard.

### Example Dashy Configuration

Add the following to your Dashy `conf.yml`:

```yaml
- type: embed
  options:
    css: >-
      .white { color: white; font-weight: bold; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; }
    html: >-
      <div class="white">Temperature:<span id="value"></span>°C</div>
      <br><br>
      <div><canvas id="tempChart"></canvas></div>
    scriptSrc: https://your-api-url/temp/chart.js
```

> [!TIP]
> Ensure the `scriptSrc` points to the correct public URL of your API's `/chart.js` endpoint.

## Homarr Integration

For [Homarr](https://homarr.dev/) users, you can use the `iframe` widget and point it to the `/temp/homarr.html` endpoint provided by this API. The dashboard pages (`/demo`, `/homarr.html`) are served without `X-Frame-Options` so they can be framed.

---

## API Reference

All routes live under `base_url` (default `/temp`). Query strings and a trailing slash are ignored. `GET` and `HEAD` are supported; `OPTIONS` answers CORS preflights; other methods return `405` with an `Allow` header; unknown paths return `404` (`{"temp": null, "error": "Not Found"}`).

| Route | Response |
| :--- | :--- |
| `GET /temp` | Current temperature: `{"temp": 45.5}`. On a sensor error: `500` with `{"temp": null, "error": "Internal server error"}` |
| `GET /temp/ping` | Health check: `{"status": "UP"}` |
| `GET /temp/metrics` | Prometheus text format: `cpu_temperature_celsius` (and the older `cpu_temperature`, kept for existing dashboards). `500` on a sensor error |
| `GET /temp/config` | Chart settings: `{"url": "...", "size": 12, "interval": 15000}` |
| `GET /temp/demo` | Web dashboard |
| `GET /temp/homarr.html` | Dashboard variant for Homarr iframes |
| `GET /temp/chart.js`, `/style.css`, `/favicon.ico` | Static assets (with `ETag`) |

Temperature values are degrees Celsius, cached for `scrape_interval` ms.
