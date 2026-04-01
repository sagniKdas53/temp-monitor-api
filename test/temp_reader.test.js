const { test, mock } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { readCpuTemp, CONFIG, cache } = require('../index.js');

test('readCpuTemp success', async (t) => {
    // Reset cache and retries
    cache.lastReadData = null;
    cache.lastReadTime = null;
    cache.retries = 0;

    // Mock fs.readFile
    const readFileMock = mock.method(fs, 'readFile', (path, encoding, callback) => {
        callback(null, '45000\n');
    });

    const temp = await readCpuTemp();
    assert.strictEqual(temp, 45.00);
    assert.strictEqual(cache.retries, 0);

    readFileMock.mock.restore();
});

test('readCpuTemp retry on error', async (t) => {
    // Reset cache and retries
    cache.lastReadData = null;
    cache.lastReadTime = null;
    cache.retries = 0;
    CONFIG.maxRetries = 2;
    CONFIG.exitOnMaxRetries = false;

    // Mock fs.readFile to fail
    const readFileMock = mock.method(fs, 'readFile', (path, encoding, callback) => {
        callback(new Error('File not found'));
    });

    try {
        await readCpuTemp();
    } catch (err) {
        assert.strictEqual(err.message, 'File not found');
    }

    assert.strictEqual(cache.retries, 1);

    readFileMock.mock.restore();
});

test('readCpuTemp handles invalid data', async (t) => {
    // Reset cache and retries
    cache.lastReadData = null;
    cache.lastReadTime = null;
    cache.retries = 0;

    // Mock fs.readFile with invalid data
    const readFileMock = mock.method(fs, 'readFile', (path, encoding, callback) => {
        callback(null, 'invalid\n');
    });

    try {
        await readCpuTemp();
    } catch (err) {
        assert.ok(err.message.includes('Invalid temperature reading'));
    }

    readFileMock.mock.restore();
});
