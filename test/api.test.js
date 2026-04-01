const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { server, CONFIG } = require('../index.js');

let testPort;

before(async () => {
    // Start server on a random port
    return new Promise((resolve) => {
        server.listen(0, () => {
            testPort = server.address().port;
            resolve();
        });
    });
});

after(() => {
    server.close();
});

test('GET /ping returns 200 and status UP', async (t) => {
    return new Promise((resolve, reject) => {
        http.get(`http://localhost:${testPort}${CONFIG.urlBase}/ping`, (res) => {
            assert.strictEqual(res.statusCode, 200);
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                const json = JSON.parse(data);
                assert.strictEqual(json.status, 'UP');
                resolve();
            });
        }).on('error', reject);
    });
});

test('GET /metrics returns prometheus gauge', async (t) => {
    return new Promise((resolve, reject) => {
        http.get(`http://localhost:${testPort}${CONFIG.urlBase}/metrics`, (res) => {
            assert.strictEqual(res.statusCode, 200);
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                assert.ok(data.includes('# HELP cpu_temperature'));
                assert.ok(data.includes('cpu_temperature'));
                resolve();
            });
        }).on('error', reject);
    });
});

test('GET /style.css returns css content', async (t) => {
    return new Promise((resolve, reject) => {
        http.get(`http://localhost:${testPort}${CONFIG.urlBase}/style.css`, (res) => {
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.headers['content-type'], 'text/css; charset=utf-8');
            resolve();
        }).on('error', reject);
    });
});
