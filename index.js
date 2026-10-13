const http = require("http");
const fs = require("fs");
const path = require("path");

const { parseConfig } = require("./config.js");

// Configuration variables (see config.js and the README for the env vars)
const { config: CONFIG, warnings: configWarnings } = parseConfig(process.env);
const DEFAULT_THERMAL_ROOT = "/sys/class/thermal";

// Public base URL of the API
const url = CONFIG.url;

// Directory path handling
const basePath = __dirname === '/' ? '' : __dirname;

// Response headers
const ALLOWED_ORIGINS = CONFIG.corsAllowedOrigins[0];

const COMMON_HEADERS = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN"
};

const JSON_HEADER = {
    ...COMMON_HEADERS,
    "Content-Type": "application/json; charset=utf-8"
};

// Static assets preloading
const staticAssets = {
    "/chart.js": {
        obj: fs.readFileSync(basePath + "/dist/chart.js"),
        type: "text/javascript; charset=utf-8"
    },
    "/demo": {
        obj: fs.readFileSync(basePath + "/demo.html"),
        type: "text/html; charset=utf-8"
    },
    "/favicon.ico": {
        obj: fs.readFileSync(basePath + "/favicon.ico"),
        type: "image/x-icon"
    },
    "/style.css": {
        obj: fs.readFileSync(basePath + "/style.css"),
        type: "text/css; charset=utf-8"
    }
};

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

// Create and start HTTP server
const server = http.createServer((req, res) => {
    const startTime = Date.now();

    // Log incoming request
    logger.debug("Received HTTP request", {
        method: req.method,
        path: req.url,
        remote_addr: req.socket.remoteAddress
    });

    // Basic URL validation
    if (req.url.length > 256) {
        res.writeHead(414, JSON_HEADER);
        res.end(JSON.stringify({ error: "URI Too Long" }));
        return;
    }

    if (req.url.startsWith(CONFIG.urlBase) && req.method === "GET") {
        const path = req.url.replace(CONFIG.urlBase, "");

        // Handle different endpoints
        if (path === "" || path === "/") {
            readCpuTemp()
                .then((tempC) => {
                    res.writeHead(200, JSON_HEADER);
                    res.end(JSON.stringify({ temp: tempC }));

                    logger.debug("API request completed", {
                        path: "/",
                        status: 200,
                        duration_ms: Date.now() - startTime
                    });
                })
                .catch((err) => {
                    res.writeHead(500, JSON_HEADER);
                    res.end(JSON.stringify({
                        temp: null,
                        error: "Internal server error"
                    }));

                    logger.error("Error handling API request", {
                        path: "/",
                        status: 500,
                        error: err,
                        duration_ms: Date.now() - startTime
                    });
                });
        }
        else if (path === "/config") {
            // Runtime config for the frontend chart — avoids baking deployment
            // details into the image at build time
            res.writeHead(200, JSON_HEADER);
            res.end(JSON.stringify({
                url: url,
                size: CONFIG.chartDataPoints,
                interval: CONFIG.chartRefreshInterval
            }));

            logger.debug("Config request completed", {
                path: "/config",
                status: 200,
                duration_ms: Date.now() - startTime
            });
        }
        else if (path === "/ping") {
            res.writeHead(200, JSON_HEADER);
            res.write(JSON.stringify({ "status": "UP" }));
            res.end();

            logger.debug("Health check completed", {
                path: "/ping",
                status: 200,
                duration_ms: Date.now() - startTime
            });
        }
        else if (path === "/metrics") {
            readCpuTemp()
                .then((tempC) => {
                    const metricsOutput = [
                        '# HELP cpu_temperature Current CPU temperature in Celsius',
                        '# TYPE cpu_temperature gauge',
                        `cpu_temperature ${tempC}`
                    ].join('\n');

                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end(metricsOutput);

                    logger.debug("Metrics request completed", {
                        path: "/metrics",
                        status: 200,
                        temperature: tempC,
                        duration_ms: Date.now() - startTime
                    });
                })
                .catch((err) => {
                    res.writeHead(500, JSON_HEADER);
                    res.end(JSON.stringify({
                        temp: null,
                        error: "Internal server error"
                    }));

                    logger.error("Error handling metrics request", {
                        path: "/metrics",
                        status: 500,
                        error: err,
                        duration_ms: Date.now() - startTime
                    });
                });
        }
        else {
            try {
                // Check if the path is in our staticAssets map
                if (staticAssets[path]) {
                    res.writeHead(200, {
                        ...COMMON_HEADERS,
                        "Content-Type": staticAssets[path].type
                    });
                    res.write(staticAssets[path].obj);
                    res.end();

                    logger.debug("Static asset served", {
                        path: path,
                        status: 200,
                        asset_type: staticAssets[path].type,
                        duration_ms: Date.now() - startTime
                    });
                } else {
                    res.writeHead(404, JSON_HEADER);
                    res.end(JSON.stringify({ temp: null }));

                    logger.warn("Resource not found", {
                        path: path,
                        status: 404,
                        duration_ms: Date.now() - startTime
                    });
                }
            } catch (error) {
                res.writeHead(500, JSON_HEADER);
                res.end(JSON.stringify({
                    temp: null,
                    error: "Internal server error"
                }));

                logger.error("Server error serving static asset", {
                    path: path,
                    status: 500,
                    error: error,
                    duration_ms: Date.now() - startTime
                });
            }
        }
    }
    else {
        res.writeHead(405, JSON_HEADER);
        res.end(JSON.stringify({ temp: null }));

        logger.warn("Method not allowed", {
            method: req.method,
            path: req.url,
            status: 405,
            duration_ms: Date.now() - startTime
        });
    }
});

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
    server
};

// Start server and polling ONLY if run directly
if (require.main === module) {
    start();
}
