'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const cache = require('../lib/cache');

test('distinct slash resources cannot share a processed record', async function (t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drs-url-cache-'));
  const server = http.createServer(function (request, response) {
    response.end(request.url.endsWith('/') ? 'Second document' : 'First document');
  });
  t.after(async function () {
    await new Promise(function (resolve) { server.close(resolve); server.closeAllConnections(); });
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('drs-url-cache-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  const source = 'http://127.0.0.1:' + server.address().port + '/guide';
  assert.notEqual(await (await fetch(source)).text(), await (await fetch(source + '/')).text());
  const file = path.join(root, 'cache.jsonl');
  assert.equal(cache.markProcessed(file, cache.fingerprint(source), 'first.md'), true);
  assert.equal(cache.hasProcessed(file, cache.fingerprint(source)), true);
  assert.equal(cache.hasProcessed(file, cache.fingerprint(source + '/')), false);
});

test('hash routes and reading fragments remain distinct, and old collapsed keys are invalidated', function () {
  const source = 'https://example.com/reader';
  assert.notEqual(cache.fingerprint(source + '#/book-a'), cache.fingerprint(source + '#/book-b'));
  assert.equal(cache.normalizeInput(source + '?#chapter'), source + '?#chapter');
  assert.notEqual(cache.fingerprint(source), cache.fingerprint(source + '?'));
  const oldKey = crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);
  assert.notEqual(cache.fingerprint(source), oldKey);
});
