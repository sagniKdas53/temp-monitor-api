"use strict";

// Environment variable parsing, shared by index.js and health-check.js.
// Variable names are lower-case for backwards compatibility; upper-case aliases
// are deliberately not read because Docker sets HOSTNAME to the container ID.

const DEFAULT_PORT = 64567;
const LOG_LEVELS = ["debug", "info", "warn", "error"];
const TRUE_VALUES = ["true", "1", "yes", "on"];
const FALSE_VALUES = ["false", "0", "no", "off"];

const isUnset = (raw) => raw === undefined || raw.trim() === "";

// Strict integer parsing: "15s", "1.5" and "" are rejected instead of being
// silently truncated by parseInt, and an explicit 0 is kept when allowed.
const readInt = (env, name, def, min, max, warnings) => {
    const raw = env[name];
    if (isUnset(raw)) return def;
    const trimmed = raw.trim();
    const value = Number(trimmed);
    if (!/^-?\d+$/.test(trimmed) || value < min || value > max) {
        warnings.push(`${name}="${raw}" is not an integer between ${min} and ${max}; using default ${def}`);
        return def;
    }
    return value;
};

const readBool = (env, name, def, warnings) => {
    const raw = env[name];
    if (isUnset(raw)) return def;
    const value = raw.trim().toLowerCase();
    if (TRUE_VALUES.includes(value)) return true;
    if (FALSE_VALUES.includes(value)) return false;
    // Previously any non-empty value enabled the flag; keep that for unknown values.
    warnings.push(`${name}="${raw}" is not a recognised boolean (true/false); treating it as true`);
    return true;
};

const readEnum = (env, name, def, allowed, warnings) => {
    const raw = env[name];
    if (isUnset(raw)) return def;
    const value = raw.trim().toLowerCase();
    if (allowed.includes(value)) return value;
    warnings.push(`${name}="${raw}" must be one of ${allowed.join(", ")}; using default ${def}`);
    return def;
};

// "/temp/" -> "/temp", "temp" -> "/temp", "/" -> "" (serve from the root)
const normalizeBaseUrl = (raw) => {
    if (raw === undefined) return "/temp";
    const trimmed = raw.trim().replace(/\/+$/, "");
    if (trimmed === "") return "";
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

// Canonical origin, e.g. drops a default port ("https://h:443" -> "https://h")
const toOrigin = (value) => {
    try {
        return new URL(value).origin;
    } catch {
        return value;
    }
};

// Each entry must be "*" or an http(s) origin; invalid entries are dropped
// with a warning ("dashy.example.com" without a scheme would never match).
const parseOrigins = (raw, warnings) => raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "")
    .flatMap((origin) => {
        if (origin === "*") return ["*"];
        try {
            const parsed = new URL(origin);
            if (parsed.protocol === "http:" || parsed.protocol === "https:") return [parsed.origin];
        } catch {
            // Reported below
        }
        warnings.push(`cors_allowed_origins entry "${origin}" is not a valid http(s) origin; ignoring it`);
        return [];
    });

const parseConfig = (env = process.env) => {
    const warnings = [];

    const protocol = readEnum(env, "protocol", "http", ["http", "https"], warnings);
    const host = isUnset(env.hostname) ? "localhost" : env.hostname.trim();
    const port = readInt(env, "port", DEFAULT_PORT, 0, 65535, warnings);
    const urlBase = normalizeBaseUrl(env.base_url);
    const hidePorts = readBool(env, "hide_ports", false, warnings);

    const origin = hidePorts ? `${protocol}://${host}` : `${protocol}://${host}:${port}`;

    // CORS: an explicit list wins; otherwise keep the historical behaviour of
    // "*" without a hostname and the public origin (now including the port) with one.
    let corsAllowedOrigins = isUnset(env.cors_allowed_origins)
        ? []
        : parseOrigins(env.cors_allowed_origins, warnings);
    if (corsAllowedOrigins.length === 0) {
        corsAllowedOrigins = isUnset(env.hostname) ? ["*"] : [toOrigin(origin)];
    } else if (corsAllowedOrigins.includes("*")) {
        corsAllowedOrigins = ["*"];
    }

    const config = {
        protocol,
        host,
        port,
        urlBase,
        url: `${origin}${urlBase}`,
        hidePorts,
        maxRetries: readInt(env, "max_retries", 9, 1, Number.MAX_SAFE_INTEGER, warnings),
        exitOnMaxRetries: readBool(env, "exit_on_max_retries", true, warnings),
        // Upper bound is the largest delay setTimeout accepts
        scrapeInterval: readInt(env, "scrape_interval", 15000, 100, 2147483647, warnings),
        logLevel: readEnum(env, "log_level", "debug", LOG_LEVELS, warnings),
        // null means "auto": use thermal_zone2 if present, otherwise detect a zone
        tempFilePath: isUnset(env.temp_file_path) ? null : env.temp_file_path.trim(),
        tempFileEncoding: "utf8",
        chartDataPoints: readInt(env, "chart_data_points", 12, 1, 10000, warnings),
        chartRefreshInterval: readInt(env, "chart_refresh_interval", 15000, 100, 2147483647, warnings),
        corsAllowedOrigins
    };

    return { config, warnings };
};

module.exports = { parseConfig, normalizeBaseUrl, LOG_LEVELS, DEFAULT_PORT };
