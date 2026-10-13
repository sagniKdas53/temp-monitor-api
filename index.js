const crypto = require("crypto");
const http = require("http");
const fs = require("fs");
const path = require("path");

const { parseConfig } = require("./config.js");

// Configuration variables (see config.js and the README for the env vars)
const { config: CONFIG, warnings: configWarnings } = parseConfig(process.env);
const DEFAULT_THERMAL_ROOT = "/sys/class/thermal";

// Public base URL of the API
const url = CONFIG.url;

// Helper function to format logs in Grafana logfmt format
const escapeLogValue = (value) => value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');

const logfmt = (level, message, fields = {}) => {
    // Start with log level and message
    let logEntry = `level=${level} msg="${escapeLogValue(String(message))}"`;

    // Add timestamp in ISO format
    logEntry += ` ts=${new Date().toISOString()}`;

    // Add all other fields
    for (const [key, value] of Object.entries(fields)) {
        // Properly format different value types
        if (typeof value === 'string') {
            logEntry += ` ${key}="${escapeLogValue(value)}"`;
        } else if (value instanceof Error) {
            // Extract error details
            logEntry += ` ${key}="${escapeLogValue(value.message)}"`;
            if (value.stack) {
                logEntry += ` ${key}_stack="${escapeLogValue(value.stack)}"`;
            }
        } else if (value === null || value === undefined) {
            logEntry += ` ${key}=null`;
        } else {
            logEntry += ` ${key}=${value}`;
        }
    }

    return logEntry;
};

// Define log level functions
const logLevels = ["debug", "info", "warn", "error"];
const currentLogLevelIndex = logLevels.indexOf(CONFIG.logLevel);

const logger = {
    debug: (message, fields = {}) => {
        if (currentLogLevelIndex <= logLevels.indexOf("debug")) {
            console.debug(logfmt('debug', message, fields));
        }
    },
    info: (message, fields = {}) => {
        if (currentLogLevelIndex <= logLevels.indexOf("info")) {
            console.log(logfmt('info', message, fields));
        }
    },
    warn: (message, fields = {}) => {
        if (currentLogLevelIndex <= logLevels.indexOf("warn")) {
            console.warn(logfmt('warn', message, fields));
        }
    },
    error: (message, fields = {}) => {
        if (currentLogLevelIndex <= logLevels.indexOf("error")) {
            console.error(logfmt('error', message, fields));
        }
    }
};

// Surface invalid settings instead of silently using defaults
for (const warning of configWarnings) {
    logger.warn("Invalid configuration value, using default", { detail: warning });
}

// Process-level side effects, replaceable in tests
const lifecycle = {
    exit: (code) => process.exit(code)
};

// Pick the sensor file. An explicit temp_file_path always wins. Otherwise keep
// the historical thermal_zone2 default when it exists, and if it doesn't, pick
// the first zone whose type looks like a CPU sensor (or the first zone at all).
const CPU_ZONE_TYPES = /x86_pkg_temp|coretemp|k10temp|cpu|soc|acpitz/i;

const listThermalZones = (thermalRoot) => {
    let entries;
    try {
        entries = fs.readdirSync(thermalRoot);
    } catch {
        return [];
    }
    return entries
        .filter((name) => /^thermal_zone\d+$/.test(name))
        .sort((a, b) => Number(a.slice(12)) - Number(b.slice(12)))
        .map((name) => {
            let type = "unknown";
            try {
                type = fs.readFileSync(path.join(thermalRoot, name, "type"), "utf8").trim();
            } catch {
                // Zone without a readable type; still listed
            }
            return { zone: name, type, path: path.join(thermalRoot, name, "temp") };
        })
        .filter((zone) => fs.existsSync(zone.path));
};

const resolveTempFilePath = (configured, thermalRoot = DEFAULT_THERMAL_ROOT) => {
    if (configured) {
        return { path: configured, detected: false, zones: [] };
    }
    const zones = listThermalZones(thermalRoot);
    const fallback = path.join(thermalRoot, "thermal_zone2", "temp");
    if (zones.some((zone) => zone.path === fallback) || zones.length === 0) {
        return { path: fallback, detected: false, zones };
    }
    const pick = zones.find((zone) => CPU_ZONE_TYPES.test(zone.type)) || zones[0];
    return { path: pick.path, detected: true, zones };
};

const sensor = resolveTempFilePath(CONFIG.tempFilePath);
CONFIG.tempFilePath = sensor.path;
if (sensor.detected) {
    logger.warn("Default thermal_zone2 not found, auto-detected a thermal zone; set temp_file_path to choose explicitly", {
        temp_path: sensor.path,
        zones: sensor.zones.map((zone) => `${zone.zone}:${zone.type}`).join(",")
    });
}

// Cache storage. Failures are cached for one scrape interval too, so a burst
// of HTTP requests during a sensor outage neither hammers the file nor counts
// as many consecutive failures (which used to make the process exit).
const cache = {
    lastReadTime: null,
    lastReadData: null,
    lastErrorTime: null,
    lastError: null,
    inflight: null,
    retries: 0
};

const resetCache = () => {
    Object.assign(cache, {
        lastReadTime: null,
        lastReadData: null,
        lastErrorTime: null,
        lastError: null,
        inflight: null,
        retries: 0
    });
};

const parseTemperature = (data) => {
    const trimmed = data.trim();
    // Linux thermal zones report integer millidegrees Celsius
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
        throw new Error(`Invalid temperature reading: ${JSON.stringify(data)}`);
    }
    const tempC = parseFloat((Number(trimmed) / 1000).toFixed(2));
    // Validate temperature value to ensure it's reasonable
    if (tempC < -100 || tempC > 150) {
        throw new Error(`Invalid temperature reading (out of range): ${JSON.stringify(data)}`);
    }
    return tempC;
};

const readSensorFile = () => new Promise((resolve, reject) => {
    fs.readFile(CONFIG.tempFilePath, CONFIG.tempFileEncoding, (err, data) => {
        if (err) {
            reject(err);
            return;
        }
        try {
            resolve(parseTemperature(data));
        } catch (parseError) {
            reject(parseError);
        }
    });
});

const recordFailure = (err) => {
    cache.retries++;
    cache.lastError = err;
    cache.lastErrorTime = Date.now();
    logger.error("Failed to read temperature", {
        error: err,
        retries: cache.retries,
        max_retries: CONFIG.maxRetries,
        file_path: CONFIG.tempFilePath
    });

    if (cache.retries < CONFIG.maxRetries) {
        throw err;
    }
    if (CONFIG.exitOnMaxRetries) {
        logger.error("Maximum retries reached, exiting process", {
            retries: cache.retries,
            max_retries: CONFIG.maxRetries
        });
        lifecycle.exit(1);
        throw err;
    }
    logger.warn("Maximum retries reached, returning last known value or null", {
        retries: cache.retries,
        max_retries: CONFIG.maxRetries,
        has_cached_data: cache.lastReadData !== null
    });
    // Return last known value if available, otherwise reject
    if (cache.lastReadData !== null) {
        return cache.lastReadData;
    }
    throw new Error("Failed to read temperature after maximum retries");
};

// Read CPU temperature. HTTP handlers use the cache (fresh for one scrape
// interval); the poller passes force so every tick really reads the sensor.
// Concurrent callers share one in-flight read.
const readCpuTemp = ({ force = false } = {}) => {
    const now = Date.now();
    if (!force) {
        if (cache.lastReadTime !== null && cache.lastReadData !== null &&
            now - cache.lastReadTime < CONFIG.scrapeInterval &&
            (cache.lastErrorTime === null || cache.lastErrorTime < cache.lastReadTime)) {
            logger.debug("Using cached temperature data", {
                temperature: cache.lastReadData,
                cache_age_ms: now - cache.lastReadTime
            });
            return Promise.resolve(cache.lastReadData);
        }
        if (cache.lastErrorTime !== null && now - cache.lastErrorTime < CONFIG.scrapeInterval &&
            (cache.lastReadTime === null || cache.lastReadTime < cache.lastErrorTime)) {
            if (cache.retries >= CONFIG.maxRetries && cache.lastReadData !== null) {
                return Promise.resolve(cache.lastReadData);
            }
            return Promise.reject(cache.lastError);
        }
    }
    if (cache.inflight) {
        return cache.inflight;
    }

    cache.inflight = readSensorFile()
        .then((tempC) => {
            // Reset retry counter only after the value has been validated
            cache.retries = 0;
            cache.lastReadData = tempC;
            cache.lastReadTime = Date.now();
            logger.debug("Temperature reading successful", {
                temperature: tempC,
                unit: "celsius"
            });
            return tempC;
        }, recordFailure)
        .finally(() => {
            cache.inflight = null;
        });
    return cache.inflight;
};

// Polling: a setTimeout chain, so a slow read can never overlap the next one
let pollTimer = null;
let polling = false;

const pollOnce = async () => {
    try {
        const tempC = await readCpuTemp({ force: true });
        logger.info("CPU temperature read", {
            temperature: tempC,
            unit: "celsius",
            retries: cache.retries
        });
    } catch (err) {
        logger.error("Failed to read CPU temperature", {
            error: err,
            retries: cache.retries,
            component: "temperature_monitor"
        });
    }
    if (polling) {
        pollTimer = setTimeout(pollOnce, CONFIG.scrapeInterval);
    }
};

const startPolling = () => {
    if (polling) return;
    polling = true;
    pollTimer = setTimeout(pollOnce, CONFIG.scrapeInterval);
};

const stopPolling = () => {
    polling = false;
    clearTimeout(pollTimer);
    pollTimer = null;
};

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const ALLOWED_METHODS = "GET, HEAD, OPTIONS";
const MAX_URL_LENGTH = 256;

// CORS: one configured origin (or "*") is always sent, as before. With several,
// the request's Origin is echoed only when it is in the list.
let corsOrigins = CONFIG.corsAllowedOrigins;
const setCorsOrigins = (origins) => {
    corsOrigins = origins;
};

const corsHeaders = (req) => {
    if (corsOrigins.length === 1) {
        return { "Access-Control-Allow-Origin": corsOrigins[0] };
    }
    const headers = { "Vary": "Origin" };
    if (req.headers.origin && corsOrigins.includes(req.headers.origin)) {
        headers["Access-Control-Allow-Origin"] = req.headers.origin;
    }
    return headers;
};

// Every response goes through here so CORS and security headers are uniform,
// including on errors. Dashboard pages are meant to be iframed (Homarr), so
// they skip X-Frame-Options; they have no state-changing UI to clickjack.
const send = (req, res, status, body, headers = {}, { frameable = false } = {}) => {
    res.writeHead(status, {
        ...corsHeaders(req),
        "X-Content-Type-Options": "nosniff",
        ...(frameable ? {} : { "X-Frame-Options": "SAMEORIGIN" }),
        ...headers
    });
    res.end(body);
};

const sendJson = (req, res, status, payload, headers = {}) => {
    send(req, res, status, JSON.stringify(payload), {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...headers
    });
};

const sendServerError = (req, res, err, message) => {
    sendJson(req, res, 500, { temp: null, error: "Internal server error" });
    logger.error(message, { path: req.url, status: 500, error: err });
};

// Static assets, read once at startup. A missing file no longer crashes the
// server at require time: the API keeps working and the asset returns 503.
const STATIC_FILES = [
    { route: "/chart.js", file: "dist/chart.js", type: "text/javascript; charset=utf-8", hint: "run `npm run build` to create dist/chart.js" },
    { route: "/demo", file: "demo.html", type: "text/html; charset=utf-8", frameable: true },
    { route: "/homarr.html", file: "homarr.html", type: "text/html; charset=utf-8", frameable: true },
    { route: "/favicon.ico", file: "favicon.ico", type: "image/x-icon" },
    { route: "/style.css", file: "style.css", type: "text/css; charset=utf-8" }
];

const loadStaticAssets = (dir = __dirname, logError = logger.error) => {
    const assets = new Map();
    for (const spec of STATIC_FILES) {
        const filePath = path.join(dir, spec.file);
        const hint = spec.hint || `${spec.file} is missing from the installation`;
        let body = null;
        let etag = null;
        try {
            body = fs.readFileSync(filePath);
            etag = `"${crypto.createHash("sha1").update(body).digest("base64url")}"`;
        } catch (err) {
            logError("Static asset could not be loaded and will return 503", {
                file: filePath,
                error: err,
                hint
            });
        }
        assets.set(spec.route, { ...spec, hint, body, etag });
    }
    return assets;
};

const staticAssets = loadStaticAssets();

const serveAsset = (req, res, route) => {
    const asset = staticAssets.get(route);
    if (asset.body === null) {
        sendJson(req, res, 503, { temp: null, error: `Static asset unavailable: ${asset.hint}` });
        return;
    }
    const headers = {
        "Content-Type": asset.type,
        "Cache-Control": "no-cache",
        "ETag": asset.etag
    };
    const ifNoneMatch = req.headers["if-none-match"];
    if (ifNoneMatch && ifNoneMatch.split(",").map((tag) => tag.trim()).includes(asset.etag)) {
        send(req, res, 304, undefined, headers, { frameable: asset.frameable });
        return;
    }
    send(req, res, 200, asset.body, headers, { frameable: asset.frameable });
};

const metricsBody = (tempC) => [
    "# HELP cpu_temperature Current CPU temperature in Celsius (deprecated alias of cpu_temperature_celsius)",
    "# TYPE cpu_temperature gauge",
    `cpu_temperature ${tempC}`,
    "# HELP cpu_temperature_celsius Current CPU temperature in degrees Celsius",
    "# TYPE cpu_temperature_celsius gauge",
    `cpu_temperature_celsius ${tempC}`,
    // The text exposition format requires a trailing newline
    ""
].join("\n");

const apiRoutes = new Map([
    ["", (req, res) => {
        readCpuTemp()
            .then((tempC) => sendJson(req, res, 200, { temp: tempC }))
            .catch((err) => sendServerError(req, res, err, "Error handling API request"));
    }],
    ["/config", (req, res) => {
        // Runtime config for the frontend chart — avoids baking deployment
        // details into the image at build time
        sendJson(req, res, 200, {
            url: url,
            size: CONFIG.chartDataPoints,
            interval: CONFIG.chartRefreshInterval
        });
    }],
    ["/ping", (req, res) => {
        sendJson(req, res, 200, { "status": "UP" });
    }],
    ["/metrics", (req, res) => {
        readCpuTemp()
            .then((tempC) => send(req, res, 200, metricsBody(tempC), {
                "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
                "Cache-Control": "no-store"
            }))
            .catch((err) => sendServerError(req, res, err, "Error handling metrics request"));
    }]
]);

// Path only: drops the query string/fragment; accepts absolute-form targets
const requestPath = (rawUrl) => {
    if (rawUrl.startsWith("/")) {
        return rawUrl.split(/[?#]/, 1)[0];
    }
    try {
        return new URL(rawUrl).pathname;
    } catch {
        return null;
    }
};

// Map a request path to a handler, or null for 404. Trailing slashes are
// ignored; lookups use Maps so "/__proto__" and friends can't match.
const resolveRoute = (pathname) => {
    const base = CONFIG.urlBase;
    let route;
    if (pathname === base) {
        route = "";
    } else if (pathname.startsWith(`${base}/`)) {
        route = pathname.slice(base.length).replace(/\/+$/, "");
    } else {
        return null;
    }
    if (apiRoutes.has(route)) {
        return apiRoutes.get(route);
    }
    if (staticAssets.has(route)) {
        return (req, res) => serveAsset(req, res, route);
    }
    return null;
};

const handleRequest = (req, res) => {
    const startTime = Date.now();

    res.on("finish", () => {
        logger.debug("HTTP request completed", {
            method: req.method,
            path: req.url,
            status: res.statusCode,
            remote_addr: req.socket.remoteAddress,
            duration_ms: Date.now() - startTime
        });
    });

    // Basic URL validation
    if (req.url.length > MAX_URL_LENGTH) {
        sendJson(req, res, 414, { error: "URI Too Long" });
        return;
    }

    const pathname = requestPath(req.url);
    const handler = pathname === null ? null : resolveRoute(pathname);
    if (!handler) {
        sendJson(req, res, 404, { temp: null, error: "Not Found" });
        logger.warn("Resource not found", { method: req.method, path: req.url, status: 404 });
        return;
    }

    if (req.method === "OPTIONS") {
        send(req, res, 204, undefined, {
            "Allow": ALLOWED_METHODS,
            "Access-Control-Allow-Methods": ALLOWED_METHODS,
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "600"
        });
        return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
        sendJson(req, res, 405, { temp: null, error: "Method Not Allowed" }, { "Allow": ALLOWED_METHODS });
        logger.warn("Method not allowed", { method: req.method, path: req.url, status: 405 });
        return;
    }

    try {
        handler(req, res);
    } catch (err) {
        sendServerError(req, res, err, "Unhandled error while serving request");
    }
};

// Create HTTP server
const server = http.createServer(handleRequest);

// Graceful shutdown handling
let shuttingDown = false;

const gracefulShutdown = (signal, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down gracefully`, {
        signal: signal
    });

    stopPolling();
    server.close(() => {
        logger.info("HTTP server closed", {
            shutdown_reason: signal
        });
        lifecycle.exit(exitCode);
    });
    // Don't wait for idle keep-alive sockets
    server.closeIdleConnections();

    // Force close after 10s
    setTimeout(() => {
        logger.error("Forced shutdown after timeout", {
            timeout_ms: 10000
        });
        lifecycle.exit(1);
    }, 10000).unref();
};

const start = () => {
    // Handle termination signals (node runs as PID 1 in Docker)
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (err) => {
        logger.error("Uncaught exception", {
            error: err
        });

        // Exit with error
        lifecycle.exit(1);
    });

    server.on('error', (err) => {
        logger.error("HTTP server error", { error: err, port: CONFIG.port });
        lifecycle.exit(1);
    });

    server.listen(CONFIG.port, () => {
        logger.info("Temperature monitoring API started", {
            url: url,
            port: server.address().port,
            temp_path: CONFIG.tempFilePath,
            interval_ms: CONFIG.scrapeInterval
        });

        // Perform initial read to verify everything works
        readCpuTemp({ force: true })
            .then(temp => {
                logger.info("Initial temperature reading successful", {
                    temperature: temp,
                    unit: "celsius"
                });
            })
            .catch(err => {
                logger.error("Initial temperature reading failed", {
                    error: err,
                    temp_path: CONFIG.tempFilePath,
                    available_zones: sensor.zones.map((zone) => `${zone.zone}:${zone.type}`).join(",") || "none"
                });
            })
            .finally(startPolling);
    });
};

// Export functions for testing
module.exports = {
    CONFIG,
    cache,
    resetCache,
    readCpuTemp,
    resolveTempFilePath,
    startPolling,
    stopPolling,
    lifecycle,
    logfmt,
    logger,
    loadStaticAssets,
    staticAssets,
    setCorsOrigins,
    server
};

// Start server and polling ONLY if run directly
if (require.main === module) {
    start();
}
