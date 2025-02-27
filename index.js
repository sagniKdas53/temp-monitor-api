const http = require("http");
const fs = require("fs");

// Configuration variables
const CONFIG = {
    protocol: process.env.protocol || "http",
    host: process.env.hostname || "localhost",
    port: process.env.port || 64567,
    urlBase: process.env.base_url || "/temp",
    maxRetries: parseInt(process.env.max_retries) || 9,
    scrapeInterval: parseInt(process.env.scrape_interval) || 15000,
    hidePorts: !!process.env.hide_ports,
    logLevel: process.env.log_level || "debug",
    PCHTempFilePath: "/sys/class/thermal/thermal_zone0/temp",
    CPUTempFilePath: "/sys/class/thermal/thermal_zone2/temp",
    tempFileEncoding: "utf8",
    exitOnMaxRetries: true
};

// Build base URL
const url = CONFIG.hidePorts
    ? `${CONFIG.protocol}://${CONFIG.host}${CONFIG.urlBase}`
    : `${CONFIG.protocol}://${CONFIG.host}:${CONFIG.port}${CONFIG.urlBase}`;

// Cache storage
const cache = {
    lastReadTime: null,
    lastReadData: null,
    retries: 0
};

// Directory path handling
const basePath = __dirname === '/' ? '' : __dirname;

// Response headers
const JSON_HEADER = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8"
};

// Static assets preloading
const staticAssets = {
    "/chart.js": {
        obj: fs.readFileSync(basePath + "/dist/chart.js"),
        type: "text/javascript; charset=utf-8"
    },
    "/test": {
        obj: fs.readFileSync(basePath + "/test.html"),
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
const logfmt = (level, message, fields = {}) => {
    // Start with log level and message
    let logEntry = `level=${level} msg="${message}"`;

    // Add timestamp in ISO format
    logEntry += ` ts=${new Date().toISOString()}`;

    // Add all other fields
    for (const [key, value] of Object.entries(fields)) {
        // Properly format different value types
        if (typeof value === 'string') {
            // Escape quotes in strings
            logEntry += ` ${key}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
        } else if (value instanceof Error) {
            // Extract error details
            logEntry += ` ${key}="${value.message.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
            if (value.stack) {
                logEntry += ` ${key}_stack="${value.stack.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
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

// Read CPU temperature with proper error handling
const readCpuTemp = () => {
    return new Promise((resolve, reject) => {
        // Return cached data if it's fresh enough
        if (cache.lastReadTime &&
            cache.lastReadData !== null &&
            Date.now() - cache.lastReadTime < CONFIG.scrapeInterval) {
            logger.debug("Using cached temperature data", {
                temperature: cache.lastReadData,
                cache_age_ms: Date.now() - cache.lastReadTime
            });
            resolve(cache.lastReadData);
            return;
        }

        // Read temperature file
        fs.readFile(CONFIG.CPUTempFilePath, CONFIG.tempFileEncoding, (err, data) => {
            if (err) {
                cache.retries++;
                logger.error("Failed to read temperature file", {
                    error: err,
                    retries: cache.retries,
                    max_retries: CONFIG.maxRetries,
                    file_path: CONFIG.tempFilePath
                });

                if (cache.retries >= CONFIG.maxRetries) {
                    if (CONFIG.exitOnMaxRetries) {
                        logger.error("Maximum retries reached, exiting process", {
                            retries: cache.retries,
                            max_retries: CONFIG.maxRetries
                        });
                        process.exit(1);
                    } else {
                        logger.warn("Maximum retries reached, returning last known value or null", {
                            retries: cache.retries,
                            max_retries: CONFIG.maxRetries,
                            has_cached_data: cache.lastReadData !== null
                        });
                        // Return last known value if available, otherwise reject
                        if (cache.lastReadData !== null) {
                            resolve(cache.lastReadData);
                        } else {
                            reject(new Error("Failed to read temperature after maximum retries"));
                        }
                    }
                } else {
                    reject(err);
                }
            } else {
                try {
                    // Reset retry counter on success
                    cache.retries = 0;

                    // Parse temperature (convert to Celsius)
                    const tempC = parseFloat((parseInt(data.trim(), 10) / 1000).toFixed(2));

                    // Validate temperature value to ensure it's reasonable
                    if (isNaN(tempC) || tempC < -100 || tempC > 150) {
                        throw new Error(`Invalid temperature reading: ${data}`);
                    }

                    // Update cache
                    cache.lastReadData = tempC;
                    cache.lastReadTime = Date.now();

                    logger.debug("Temperature reading successful", {
                        temperature: tempC,
                        unit: "celsius"
                    });
                    resolve(tempC);
                } catch (parseError) {
                    logger.error("Error parsing temperature data", {
                        error: parseError,
                        raw_data: data
                    });
                    reject(parseError);
                }
            }
        });
    });
};

// Schedule regular temperature checks
setInterval(async () => {
    try {
        const tempC = await readCpuTemp();
        logger.info("CPU temperature read", {
            temperature: tempC,
            unit: "celsius",
            retries: cache.retries,
            cache_hit: tempC === cache.lastReadData && cache.lastReadTime !== null && Date.now() - cache.lastReadTime < CONFIG.scrapeInterval
        });
    } catch (err) {
        logger.error("Failed to read CPU temperature", {
            error: err,
            retries: cache.retries,
            component: "temperature_monitor"
        });
    }
}, CONFIG.scrapeInterval);

// Create and start HTTP server
const server = http.createServer((req, res) => {
    const startTime = Date.now();

    // Log incoming request
    logger.debug("Received HTTP request", {
        method: req.method,
        path: req.url,
        remote_addr: req.socket.remoteAddress
    });

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
                        error: err.toString()
                    }));

                    logger.error("Error handling API request", {
                        path: "/",
                        status: 500,
                        error: err,
                        duration_ms: Date.now() - startTime
                    });
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
                        error: err.toString()
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
                        "Access-Control-Allow-Origin": "*",
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
                    error: error.toString()
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
const gracefulShutdown = (signal) => {
    logger.info(`Received ${signal}, shutting down gracefully`, {
        signal: signal
    });

    server.close(() => {
        logger.info("HTTP server closed", {
            shutdown_reason: signal
        });
        process.exit(0);
    });

    // Force close after 10s
    setTimeout(() => {
        logger.error("Forced shutdown after timeout", {
            timeout_ms: 10000
        });
        process.exit(1);
    }, 10000);
};

// Handle termination signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    logger.error("Uncaught exception", {
        error: err
    });

    // Exit with error
    process.exit(1);
});

// Start server
server.listen(CONFIG.port, () => {
    logger.info("Temperature monitoring API started", {
        url: url,
        port: CONFIG.port,
        temp_path: CONFIG.tempFilePath,
        interval_ms: CONFIG.scrapeInterval
    });

    // Perform initial read to verify everything works
    readCpuTemp()
        .then(temp => {
            logger.info("Initial temperature reading successful", {
                temperature: temp,
                unit: "celsius"
            });
        })
        .catch(err => {
            logger.error("Initial temperature reading failed", {
                error: err
            });
        });
});
