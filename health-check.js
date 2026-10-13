"use strict";

// Docker HEALTHCHECK: exits 0 when GET <base_url>/ping answers {"status":"UP"}.
// Uses the same env parsing as the server so port/base_url always agree.
const { parseConfig } = require("./config.js");

const { config } = parseConfig(process.env);
const url = `http://localhost:${config.port}${config.urlBase}/ping`;

// Must stay below the HEALTHCHECK --timeout in the Dockerfile (10s)
const TIMEOUT_MS = 5000;

fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    .then(async (res) => {
        if (res.status === 200) {
            const data = await res.json();
            if (data.status === "UP") {
                process.exit(0);
            }
        }
        console.error(`Health check failed with status: ${res.status}`);
        process.exit(1);
    })
    .catch((err) => {
        console.error("Health check error:", err.message);
        process.exit(1);
    });
