# Temperature Monitoring API

A lightweight Node.js API that monitors CPU temperature by reading Linux thermal zone files and provides a real-time dashboard using Chart.js.

## How it Works

1.  **Backend**: A native Node.js HTTP server polls the Linux filesystem at `/sys/class/thermal/thermal_zone2/temp` (configurable) at a defined interval.
2.  **API**: It exposes endpoints for current temperature, health checks, and Prometheus metrics.
3.  **Frontend**: A simple HTML dashboard (`/temp/demo`) uses **Chart.js** to render a real-time graph. The chart JavaScript is bundled using **esbuild** for maximum performance and minimal footprint.
4.  **Configuration**: All settings are controlled via environment variables, making it perfect for Docker and Kubernetes deployments.

## Features

- 🚀 **Zero-dependency runtime**: Only regular Node.js is required to run the server.
- 📊 **Real-time Charting**: Beautiful line chart powered by Chart.js.
- 🩺 **Health Checks**: Ready-to-use `/ping` endpoint for load balancers and orchestrators.
- 📈 **Prometheus Metrics**: Built-in `/metrics` endpoint for Grafana/Prometheus integration.
- 🐳 **Dockerized**: Optimized Dockerfile for small image size.

## Configuration

The following environment variables can be used to configure the application:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `port` | Server port | `64567` |
| `hostname` | Server hostname | `localhost` |
| `protocol` | Server protocol (`http` or `https`) | `http` |
| `base_url` | API base path | `/temp` |
| `scrape_interval` | Temperature polling interval (ms) | `15000` |
| `temp_file_path` | Path to thermal zone file | `/sys/class/thermal/thermal_zone2/temp` |
| `chart_data_points` | Number of points to show in chart | `12` |
| `hide_ports` | If true, excludes port from generated URLs | `false` |

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

## Development & Testing

### Running Tests
We use the native Node.js test runner for zero-dependency testing.
```bash
npm test
```

### Mocking Temperature on Non-Linux Systems
If you are developing on macOS or Windows, the default Linux thermal path won't exist. You can mock it by creating a dummy file:

1.  Create a file named `mock_temp` with content `45000`.
2.  Run the app with the `temp_file_path` env var pointing to it:
    ```bash
    temp_file_path=./mock_temp npm run dev
    ```

## API Reference

- `GET /temp`: Returns current temperature in JSON.
- `GET /temp/ping`: Health check (returns `{"status": "UP"}`).
- `GET /temp/metrics`: Prometheus metrics.
- `GET /temp/demo`: Web dashboard.
