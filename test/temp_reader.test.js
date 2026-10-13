const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    readCpuTemp, CONFIG, cache, lifecycle, resetCache, resolveTempFilePath,
    startPolling, stopPolling, logfmt
} = require('../index.js');

const saved = { ...CONFIG };

beforeEach(() => {
    resetCache();
});

afterEach(() => {
    Object.assign(CONFIG, saved);
    stopPolling();
});

const mockSensor = (t, impl) => t.mock.method(fs, 'readFile', (p, encoding, callback) => impl(callback));

test('readCpuTemp success', async (t) => {
    mockSensor(t, (cb) => cb(null, '45000\n'));
    const temp = await readCpuTemp();
    assert.strictEqual(temp, 45.00);
    assert.strictEqual(cache.retries, 0);
});

test('readCpuTemp rejects and counts a failed read', async (t) => {
    CONFIG.maxRetries = 2;
    CONFIG.exitOnMaxRetries = false;
    mockSensor(t, (cb) => cb(new Error('File not found')));

    await assert.rejects(readCpuTemp(), /File not found/);
    assert.strictEqual(cache.retries, 1);
});

for (const raw of ['invalid\n', '', '45000abc', '255000', '-273000', '4.5e4x']) {
    test(`readCpuTemp rejects invalid sensor data ${JSON.stringify(raw)}`, async (t) => {
        mockSensor(t, (cb) => cb(null, raw));
        await assert.rejects(readCpuTemp(), /Invalid temperature reading/);
    });
}

test('invalid sensor data counts as a failure and does not reset the counter', async (t) => {
    CONFIG.exitOnMaxRetries = false;
    cache.retries = 3;
    mockSensor(t, (cb) => cb(null, 'garbage'));
    await assert.rejects(readCpuTemp({ force: true }));
    assert.strictEqual(cache.retries, 4);
});

test('fresh cached value is served without touching the sensor', async (t) => {
    const readFile = mockSensor(t, (cb) => cb(null, '45000'));
    await readCpuTemp();
    await readCpuTemp();
    assert.strictEqual(readFile.mock.callCount(), 1);
});

test('force bypasses the cache (the poller always reads the sensor)', async (t) => {
    const readFile = mockSensor(t, (cb) => cb(null, '45000'));
    await readCpuTemp();
    await readCpuTemp({ force: true });
    assert.strictEqual(readFile.mock.callCount(), 2);
});

test('concurrent callers share a single in-flight read', async (t) => {
    let pending;
    const readFile = mockSensor(t, (cb) => { pending = cb; });
    const reads = Array.from({ length: 9 }, () => readCpuTemp());
    pending(null, '50000');
    assert.deepStrictEqual(await Promise.all(reads), Array(9).fill(50));
    assert.strictEqual(readFile.mock.callCount(), 1);
});

test('a burst of HTTP-style reads during a failure cannot exhaust max_retries', async (t) => {
    CONFIG.maxRetries = 3;
    const exit = t.mock.method(lifecycle, 'exit', () => {});
    const readFile = mockSensor(t, (cb) => cb(new Error('EIO')));

    for (let i = 0; i < 20; i++) {
        await assert.rejects(readCpuTemp());
    }
    // The failure is cached for one scrape interval, so only one read happened
    assert.strictEqual(readFile.mock.callCount(), 1);
    assert.strictEqual(cache.retries, 1);
    assert.strictEqual(exit.mock.callCount(), 0);
});

test('reaching max_retries on consecutive forced reads calls lifecycle.exit(1)', async (t) => {
    CONFIG.maxRetries = 3;
    CONFIG.exitOnMaxRetries = true;
    const exit = t.mock.method(lifecycle, 'exit', () => {});
    mockSensor(t, (cb) => cb(new Error('EIO')));

    for (let i = 0; i < 3; i++) {
        await assert.rejects(readCpuTemp({ force: true }));
    }
    assert.strictEqual(exit.mock.callCount(), 1);
    assert.deepStrictEqual(exit.mock.calls[0].arguments, [1]);
});

test('with exit_on_max_retries=false the last good value is served after max retries', async (t) => {
    CONFIG.maxRetries = 2;
    CONFIG.exitOnMaxRetries = false;
    let fail = false;
    mockSensor(t, (cb) => (fail ? cb(new Error('EIO')) : cb(null, '42000')));
    assert.strictEqual(await readCpuTemp({ force: true }), 42);
    fail = true;
    await assert.rejects(readCpuTemp({ force: true }));
    assert.strictEqual(await readCpuTemp({ force: true }), 42);
});

test('a successful read resets the failure counter', async (t) => {
    cache.retries = 5;
    mockSensor(t, (cb) => cb(null, '40000'));
    await readCpuTemp({ force: true });
    assert.strictEqual(cache.retries, 0);
});

test('polling never overlaps reads and stops cleanly', async (t) => {
    CONFIG.scrapeInterval = 5;
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    mockSensor(t, (cb) => {
        active++;
        calls++;
        maxActive = Math.max(maxActive, active);
        // A read that takes longer than the interval
        setTimeout(() => { active--; cb(null, '45000'); }, 20);
    });
    startPolling();
    await new Promise((r) => setTimeout(r, 120));
    stopPolling();
    const callsAtStop = calls;
    await new Promise((r) => setTimeout(r, 60));
    assert.strictEqual(maxActive, 1);
    assert.ok(callsAtStop >= 2, `expected several polls, got ${callsAtStop}`);
    assert.strictEqual(calls, callsAtStop, 'no reads after stopPolling');
});

test('resolveTempFilePath keeps an explicit path', () => {
    assert.strictEqual(resolveTempFilePath('/custom/temp', '/nonexistent').path, '/custom/temp');
});

test('resolveTempFilePath prefers thermal_zone2 when it exists', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thermal-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const [zone, type] of [['thermal_zone0', 'acpitz'], ['thermal_zone2', 'x86_pkg_temp']]) {
        fs.mkdirSync(path.join(root, zone));
        fs.writeFileSync(path.join(root, zone, 'type'), `${type}\n`);
        fs.writeFileSync(path.join(root, zone, 'temp'), '40000\n');
    }
    const result = resolveTempFilePath(null, root);
    assert.strictEqual(result.path, path.join(root, 'thermal_zone2', 'temp'));
    assert.deepStrictEqual(result.zones.map((z) => z.type), ['acpitz', 'x86_pkg_temp']);
});

test('resolveTempFilePath auto-detects a CPU zone when thermal_zone2 is missing', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thermal-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const [zone, type] of [['thermal_zone0', 'gpu-thermal'], ['thermal_zone1', 'cpu-thermal']]) {
        fs.mkdirSync(path.join(root, zone));
        fs.writeFileSync(path.join(root, zone, 'type'), `${type}\n`);
        fs.writeFileSync(path.join(root, zone, 'temp'), '40000\n');
    }
    const result = resolveTempFilePath(null, root);
    assert.strictEqual(result.path, path.join(root, 'thermal_zone1', 'temp'));
    assert.strictEqual(result.detected, true);
});

test('resolveTempFilePath falls back to the default path when nothing is found', () => {
    const result = resolveTempFilePath(null, '/nonexistent-thermal-root');
    assert.strictEqual(result.path, '/nonexistent-thermal-root/thermal_zone2/temp');
    assert.deepStrictEqual(result.zones, []);
});

test('logfmt escapes newlines so one event stays on one line', () => {
    const line = logfmt('error', 'bad\nmsg', { raw: 'a\nb', err: new Error('x\ny') });
    assert.ok(!line.includes('\n'), line);
    assert.match(line, /raw="a\\nb"/);
    assert.match(line, /err="x\\ny"/);
});
