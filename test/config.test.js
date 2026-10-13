const { test } = require('node:test');
const assert = require('node:assert');
const { parseConfig } = require('../config.js');

test('defaults match the documented values', () => {
    const { config, warnings } = parseConfig({});
    assert.deepStrictEqual(warnings, []);
    assert.strictEqual(config.protocol, 'http');
    assert.strictEqual(config.host, 'localhost');
    assert.strictEqual(config.port, 64567);
    assert.strictEqual(config.urlBase, '/temp');
    assert.strictEqual(config.maxRetries, 9);
    assert.strictEqual(config.scrapeInterval, 15000);
    assert.strictEqual(config.hidePorts, false);
    assert.strictEqual(config.logLevel, 'debug');
    assert.strictEqual(config.tempFilePath, null);
    assert.strictEqual(config.chartDataPoints, 12);
    assert.strictEqual(config.chartRefreshInterval, 15000);
    assert.strictEqual(config.exitOnMaxRetries, true);
    assert.deepStrictEqual(config.corsAllowedOrigins, ['*']);
    assert.strictEqual(config.url, 'http://localhost:64567/temp');
});

test('port is parsed to a number', () => {
    const { config } = parseConfig({ port: '8080' });
    assert.strictEqual(config.port, 8080);
});

test('explicit port 0 is honoured (ephemeral port), not replaced by the default', () => {
    const { config, warnings } = parseConfig({ port: '0' });
    assert.strictEqual(config.port, 0);
    assert.deepStrictEqual(warnings, []);
});

test('non-numeric, partial or out-of-range ports fall back to the default with a warning', () => {
    for (const port of ['abc', '80abc', '65536', '-1', '1.5']) {
        const { config, warnings } = parseConfig({ port });
        assert.strictEqual(config.port, 64567, `port=${port}`);
        assert.strictEqual(warnings.length, 1, `port=${port}`);
        assert.match(warnings[0], /port/);
    }
});

test('scrape_interval rejects unit suffixes, zero and negatives instead of busy-looping', () => {
    for (const v of ['15s', '0', '-5', 'NaN', '']) {
        const { config } = parseConfig({ scrape_interval: v });
        assert.strictEqual(config.scrapeInterval, 15000, `scrape_interval=${v}`);
    }
    assert.strictEqual(parseConfig({ scrape_interval: ' 5000 ' }).config.scrapeInterval, 5000);
});

test('max_retries must be at least 1', () => {
    const zero = parseConfig({ max_retries: '0' });
    assert.strictEqual(zero.config.maxRetries, 9);
    assert.match(zero.warnings[0], /max_retries/);
    assert.strictEqual(parseConfig({ max_retries: '3' }).config.maxRetries, 3);
});

test('chart settings are validated', () => {
    const { config } = parseConfig({ chart_data_points: '24', chart_refresh_interval: '5000' });
    assert.strictEqual(config.chartDataPoints, 24);
    assert.strictEqual(config.chartRefreshInterval, 5000);
    const bad = parseConfig({ chart_data_points: '0', chart_refresh_interval: 'fast' });
    assert.strictEqual(bad.config.chartDataPoints, 12);
    assert.strictEqual(bad.config.chartRefreshInterval, 15000);
    assert.strictEqual(bad.warnings.length, 2);
});

test('hide_ports=false and hide_ports=0 do not hide the port', () => {
    for (const v of ['false', 'FALSE', '0', 'no', 'off']) {
        assert.strictEqual(parseConfig({ hide_ports: v }).config.hidePorts, false, `hide_ports=${v}`);
    }
    for (const v of ['true', 'TRUE', '1', 'yes', 'on']) {
        assert.strictEqual(parseConfig({ hide_ports: v }).config.hidePorts, true, `hide_ports=${v}`);
    }
});

test('unrecognised non-empty hide_ports keeps the old truthy behaviour but warns', () => {
    const { config, warnings } = parseConfig({ hide_ports: 'y' });
    assert.strictEqual(config.hidePorts, true);
    assert.match(warnings[0], /hide_ports/);
});

test('base_url is normalised: leading slash added, trailing slashes stripped, "/" means root', () => {
    assert.strictEqual(parseConfig({ base_url: '/temp/' }).config.urlBase, '/temp');
    assert.strictEqual(parseConfig({ base_url: 'temp' }).config.urlBase, '/temp');
    assert.strictEqual(parseConfig({ base_url: '/a/b//' }).config.urlBase, '/a/b');
    assert.strictEqual(parseConfig({ base_url: '/' }).config.urlBase, '');
});

test('log_level is case-insensitive and unknown values fall back to the default', () => {
    assert.strictEqual(parseConfig({ log_level: 'INFO' }).config.logLevel, 'info');
    const bad = parseConfig({ log_level: 'warning' });
    assert.strictEqual(bad.config.logLevel, 'debug');
    assert.match(bad.warnings[0], /log_level/);
});

test('protocol only accepts http/https', () => {
    assert.strictEqual(parseConfig({ protocol: 'HTTPS' }).config.protocol, 'https');
    const bad = parseConfig({ protocol: 'ftp' });
    assert.strictEqual(bad.config.protocol, 'http');
    assert.strictEqual(bad.warnings.length, 1);
});

test('url honours hostname, port and hide_ports', () => {
    assert.strictEqual(
        parseConfig({ hostname: 'temp.example.com', protocol: 'https', port: '8443' }).config.url,
        'https://temp.example.com:8443/temp');
    assert.strictEqual(
        parseConfig({ hostname: 'temp.example.com', protocol: 'https', hide_ports: 'true' }).config.url,
        'https://temp.example.com/temp');
});

test('CORS: "*" when hostname unset, the public origin (including port) when set', () => {
    assert.deepStrictEqual(parseConfig({}).config.corsAllowedOrigins, ['*']);
    assert.deepStrictEqual(
        parseConfig({ hostname: 'temp.example.com', protocol: 'https', hide_ports: 'true' }).config.corsAllowedOrigins,
        ['https://temp.example.com']);
    assert.deepStrictEqual(
        parseConfig({ hostname: 'temp.example.com', port: '8080' }).config.corsAllowedOrigins,
        ['http://temp.example.com:8080']);
});

test('cors_allowed_origins overrides the derived origin', () => {
    assert.deepStrictEqual(
        parseConfig({ hostname: 'h', cors_allowed_origins: '*' }).config.corsAllowedOrigins, ['*']);
    assert.deepStrictEqual(
        parseConfig({ cors_allowed_origins: 'https://a.example, https://b.example/ ' }).config.corsAllowedOrigins,
        ['https://a.example', 'https://b.example']);
});

test('exit_on_max_retries can be disabled', () => {
    assert.strictEqual(parseConfig({ exit_on_max_retries: 'false' }).config.exitOnMaxRetries, false);
});

test('temp_file_path is kept verbatim when set', () => {
    assert.strictEqual(parseConfig({ temp_file_path: '/x/temp' }).config.tempFilePath, '/x/temp');
});
