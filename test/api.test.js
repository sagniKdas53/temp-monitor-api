const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { server, CONFIG, resetCache, loadStaticAssets, setCorsOrigins } = require('../index.js');

let testPort;
let sensorValue = '45000\n';
const originalReadFile = fs.readFile;

before(async () => {
    // Mock fs.readFile so /metrics and / endpoints work in CI
    // where /sys/class/thermal/thermal_zone2/temp doesn't exist
    fs.readFile = (file, encoding, callback) => {
        if (file === CONFIG.tempFilePath) {
            if (sensorValue instanceof Error) callback(sensorValue);
            else callback(null, sensorValue);
            return;
        }
        originalReadFile(file, encoding, callback);
    };

    // Start server on a random port
    await new Promise((resolve) => server.listen(0, resolve));
    testPort = server.address().port;
});

after(() => {
    fs.readFile = originalReadFile;
    server.close();
});

beforeEach(() => {
    sensorValue = '45000\n';
    resetCache();
    setCorsOrigins(['*']);
});

// Raw request helper: returns status, headers and body for any method/path
const request = (method, urlPath, headers = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: 'localhost', port: testPort, method, path: urlPath, headers }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
});

const base = CONFIG.urlBase;

test('GET /ping returns 200 and status UP', async () => {
    const res = await request('GET', `${base}/ping`);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(JSON.parse(res.body), { status: 'UP' });
});

test('GET base returns the temperature', async () => {
    const res = await request('GET', base);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers['content-type'], 'application/json; charset=utf-8');
    assert.strictEqual(res.headers['cache-control'], 'no-store');
    assert.deepStrictEqual(JSON.parse(res.body), { temp: 45 });
});

test('GET base returns 500 with temp null when the sensor fails', async () => {
    sensorValue = new Error('EIO');
    const res = await request('GET', base);
    assert.strictEqual(res.status, 500);
    assert.deepStrictEqual(JSON.parse(res.body), { temp: null, error: 'Internal server error' });
    assert.strictEqual(res.headers['access-control-allow-origin'], '*');
});

test('GET /metrics returns valid Prometheus exposition format', async () => {
    const res = await request('GET', `${base}/metrics`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers['content-type'], 'text/plain; version=0.0.4; charset=utf-8');
    assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
    assert.strictEqual(res.headers['access-control-allow-origin'], '*');
    assert.ok(res.body.endsWith('\n'), 'exposition format requires a trailing newline');
    const lines = res.body.trimEnd().split('\n');
    assert.ok(lines.includes('# TYPE cpu_temperature gauge'));
    assert.ok(lines.includes('cpu_temperature 45'), res.body);
    assert.ok(lines.includes('# TYPE cpu_temperature_celsius gauge'));
    assert.ok(lines.includes('cpu_temperature_celsius 45'), res.body);
    for (const line of lines) {
        assert.match(line, /^(# (HELP|TYPE) [a-z_]+ .+|[a-z_]+ -?\d+(\.\d+)?)$/, line);
    }
});

test('GET /metrics returns 500 when the sensor fails', async () => {
    sensorValue = 'garbage';
    const res = await request('GET', `${base}/metrics`);
    assert.strictEqual(res.status, 500);
});

test('GET /config returns the runtime chart settings', async () => {
    const res = await request('GET', `${base}/config`);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(JSON.parse(res.body), {
        url: CONFIG.url,
        size: CONFIG.chartDataPoints,
        interval: CONFIG.chartRefreshInterval
    });
});

test('static assets are served with the right content types', async () => {
    const expected = {
        '/style.css': 'text/css; charset=utf-8',
        '/chart.js': 'text/javascript; charset=utf-8',
        '/demo': 'text/html; charset=utf-8',
        '/homarr.html': 'text/html; charset=utf-8',
        '/favicon.ico': 'image/x-icon'
    };
    for (const [asset, type] of Object.entries(expected)) {
        const res = await request('GET', `${base}${asset}`);
        assert.strictEqual(res.status, 200, asset);
        assert.strictEqual(res.headers['content-type'], type, asset);
        assert.ok(res.headers.etag, asset);
    }
});

test('dashboard pages can be framed (Homarr/Dashy); API responses cannot', async () => {
    for (const page of ['/demo', '/homarr.html']) {
        const res = await request('GET', `${base}${page}`);
        assert.strictEqual(res.headers['x-frame-options'], undefined, page);
    }
    assert.strictEqual((await request('GET', `${base}/ping`)).headers['x-frame-options'], 'SAMEORIGIN');
});

test('homarr.html uses page-relative asset URLs', async () => {
    const res = await request('GET', `${base}/homarr.html`);
    assert.ok(!res.body.includes('__BASE_URL__'));
    assert.match(res.body, /src="\.\/chart\.js"/);
});

test('static assets honour If-None-Match', async () => {
    const first = await request('GET', `${base}/style.css`);
    const second = await request('GET', `${base}/style.css`, { 'If-None-Match': first.headers.etag });
    assert.strictEqual(second.status, 304);
    assert.strictEqual(second.body, '');
});

test('query strings do not break routing', async () => {
    assert.strictEqual((await request('GET', `${base}/ping?t=1`)).status, 200);
    assert.strictEqual((await request('GET', `${base}?_=123`)).status, 200);
    assert.strictEqual((await request('GET', `${base}/metrics?x=1`)).status, 200);
});

test('a trailing slash is accepted', async () => {
    assert.strictEqual((await request('GET', `${base}/`)).status, 200);
    assert.strictEqual((await request('GET', `${base}/ping/`)).status, 200);
});

test('HEAD is supported on every GET route and has no body', async () => {
    const res = await request('HEAD', `${base}/ping`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body, '');
});

test('unknown paths return 404 (inside and outside the base URL)', async () => {
    for (const p of [`${base}/nope`, '/nope', '/', `${base}erature`, '/favicon.ico']) {
        const res = await request('GET', p);
        assert.strictEqual(res.status, 404, p);
        assert.deepStrictEqual(JSON.parse(res.body), { temp: null, error: 'Not Found' }, p);
        assert.strictEqual(res.headers['access-control-allow-origin'], '*', p);
    }
});

test('Object.prototype names are not treated as assets', async () => {
    for (const p of ['/toString', '/__proto__', '/hasOwnProperty', '/constructor']) {
        assert.strictEqual((await request('GET', `${base}${p}`)).status, 404, p);
    }
});

test('path traversal attempts are plain 404s', async () => {
    for (const p of ['/../index.js', '/%2e%2e/index.js', '/..%2fpackage.json', '/dist/../index.js']) {
        assert.strictEqual((await request('GET', `${base}${p}`)).status, 404, p);
    }
});

test('unsupported methods on known routes return 405 with an Allow header', async () => {
    const res = await request('POST', `${base}/ping`);
    assert.strictEqual(res.status, 405);
    assert.strictEqual(res.headers.allow, 'GET, HEAD, OPTIONS');
    assert.deepStrictEqual(JSON.parse(res.body), { temp: null, error: 'Method Not Allowed' });
});

test('OPTIONS preflight returns 204 with CORS headers', async () => {
    const res = await request('OPTIONS', base, {
        Origin: 'https://dashy.example.com',
        'Access-Control-Request-Method': 'GET'
    });
    assert.strictEqual(res.status, 204);
    assert.strictEqual(res.headers['access-control-allow-origin'], '*');
    assert.strictEqual(res.headers['access-control-allow-methods'], 'GET, HEAD, OPTIONS');
    assert.strictEqual(res.headers.allow, 'GET, HEAD, OPTIONS');
});

test('a single configured CORS origin is always sent', async () => {
    setCorsOrigins(['https://temp.example.com']);
    const res = await request('GET', `${base}/ping`);
    assert.strictEqual(res.headers['access-control-allow-origin'], 'https://temp.example.com');
});

test('with several CORS origins the matching Origin is echoed with Vary', async () => {
    setCorsOrigins(['https://a.example', 'https://b.example']);
    const match = await request('GET', `${base}/ping`, { Origin: 'https://b.example' });
    assert.strictEqual(match.headers['access-control-allow-origin'], 'https://b.example');
    assert.match(match.headers.vary, /Origin/);
    const miss = await request('GET', `${base}/ping`, { Origin: 'https://evil.example' });
    assert.strictEqual(miss.headers['access-control-allow-origin'], undefined);
});

test('over-long URLs are rejected with 414', async () => {
    const res = await request('GET', `${base}/${'a'.repeat(300)}`);
    assert.strictEqual(res.status, 414);
});

test('loadStaticAssets reports a missing build output clearly instead of crashing', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, 'style.css'), 'body{}');
    const errors = [];
    const assets = loadStaticAssets(dir, (message, fields) => errors.push({ message, fields }));
    assert.ok(assets.get('/style.css').body);
    assert.strictEqual(assets.get('/chart.js').body, null);
    assert.ok(errors.some((e) => /npm run build/.test(e.fields.hint)), JSON.stringify(errors));
});

test('a missing asset is served as 503 with a hint', async (t) => {
    const { staticAssets } = require('../index.js');
    const original = staticAssets.get('/chart.js');
    staticAssets.set('/chart.js', { ...original, body: null, hint: 'run `npm run build`' });
    t.after(() => staticAssets.set('/chart.js', original));
    const res = await request('GET', `${base}/chart.js`);
    assert.strictEqual(res.status, 503);
    assert.match(JSON.parse(res.body).error, /npm run build/);
});
