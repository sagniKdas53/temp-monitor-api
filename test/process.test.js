// End-to-end tests that run index.js / health-check.js as real processes
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const makeSensor = (t, content = '45000\n') => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sensor-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'temp');
    fs.writeFileSync(file, content);
    return file;
};

const startServer = (t, env) => {
    const child = spawn(process.execPath, ['index.js'], {
        cwd: ROOT,
        env: { PATH: process.env.PATH, port: '0', log_level: 'info', ...env },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    t.after(() => child.kill('SIGKILL'));
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
    const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 5000);
        child.stdout.on('data', () => {
            const match = output.match(/API started.* port=(\d+)/);
            if (match) {
                clearTimeout(timer);
                resolve(Number(match[1]));
            }
        });
        exited.then(() => { clearTimeout(timer); reject(new Error(`server exited:\n${output}`)); });
    });
    return { child, ready, exited, output: () => output };
};

const runHealthCheck = (env) => new Promise((resolve) => {
    const child = spawn(process.execPath, ['health-check.js'], {
        cwd: ROOT,
        env: { PATH: process.env.PATH, ...env },
        stdio: 'ignore'
    });
    child.on('exit', resolve);
});

test('server starts on the configured port, serves /ping and exits 0 on SIGTERM', async (t) => {
    const server = startServer(t, { temp_file_path: makeSensor(t) });
    const port = await server.ready;
    assert.ok(port > 0);

    const res = await fetch(`http://localhost:${port}/temp/ping`);
    assert.deepStrictEqual(await res.json(), { status: 'UP' });

    server.child.kill('SIGTERM');
    assert.strictEqual(await server.exited, 0);
    assert.match(server.output(), /HTTP server closed/);
});

test('health-check.js passes against a running server and honours base_url', async (t) => {
    const server = startServer(t, { temp_file_path: makeSensor(t), base_url: '/custom/' });
    const port = await server.ready;
    assert.strictEqual(await runHealthCheck({ port: String(port), base_url: '/custom/' }), 0);
    assert.strictEqual(await runHealthCheck({ port: String(port), base_url: '/temp' }), 1);
});

test('health-check.js fails when nothing is listening', async () => {
    // Port 1 is privileged and never used by this server
    assert.strictEqual(await runHealthCheck({ port: '1' }), 1);
});

test('process exits 1 once max_retries consecutive reads fail', async (t) => {
    const server = startServer(t, {
        temp_file_path: '/nonexistent/thermal/temp',
        max_retries: '2',
        scrape_interval: '100'
    });
    await server.ready;
    assert.strictEqual(await server.exited, 1);
    assert.match(server.output(), /Maximum retries reached, exiting process/);
});

test('a port that is already in use is reported and exits 1', async (t) => {
    const first = startServer(t, { temp_file_path: makeSensor(t) });
    const port = await first.ready;
    const second = spawn(process.execPath, ['index.js'], {
        cwd: ROOT,
        env: { PATH: process.env.PATH, port: String(port), temp_file_path: '/dev/null' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    t.after(() => second.kill('SIGKILL'));
    let output = '';
    second.stderr.on('data', (chunk) => { output += chunk; });
    const code = await new Promise((resolve) => second.on('exit', resolve));
    assert.strictEqual(code, 1);
    assert.match(output, /HTTP server error.*EADDRINUSE/);
});
