// tests/cache.test.js — idempotency cache tests
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cache = require('../lib/cache');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✅', name); }
  catch (e) { failed++; console.error('  ❌', name, '—', e.message); }
}

const tmp = path.join(os.tmpdir(), 'drs-cache-test-' + Date.now());
const cacheFile = path.join(tmp, 'cache.jsonl');

test('fingerprint is deterministic for same input', () => {
  const a = cache.fingerprint('https://arxiv.org/abs/2307.09042');
  const b = cache.fingerprint('https://arxiv.org/abs/2307.09042');
  assert.strictEqual(a, b);
  assert.ok(a && a.length >= 16);
});

test('fingerprint differs for different inputs', () => {
  const a = cache.fingerprint('input-a');
  const b = cache.fingerprint('input-b');
  assert.notStrictEqual(a, b);
});

test('fingerprint normalizes URL variants', () => {
  const a = cache.fingerprint('https://EXAMPLE.com/doc/');
  const b = cache.fingerprint('https://example.com/doc#frag');
  assert.strictEqual(a, b, 'URL variants (case/slash/fragment) should share fingerprint');
  const c = cache.fingerprint('https://example.com/doc?x=1');
  assert.notStrictEqual(a, c, 'different query should produce different fingerprint');
});

test('normalizeInput keeps non-URL input and root path unchanged', () => {
  assert.strictEqual(cache.normalizeInput('C:\\Users\\x\\doc.md'), 'C:\\Users\\x\\doc.md');
  assert.strictEqual(cache.normalizeInput('https://example.com/'), 'https://example.com/');
  assert.strictEqual(cache.normalizeInput('   '), '');
});

test('fingerprint includes file meta for local files', () => {
  const f = path.join(tmp, 'sample.txt');
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(f, 'hello');
  const st = fs.statSync(f);
  const a = cache.fingerprint(f, { size: st.size, mtimeMs: st.mtimeMs });
  const b = cache.fingerprint(f, { size: st.size + 1, mtimeMs: st.mtimeMs });
  assert.notStrictEqual(a, b, 'size change should change fingerprint');
});

test('hasProcessed returns false for unknown key', () => {
  assert.strictEqual(cache.hasProcessed(cacheFile, 'unknown-key'), false);
});

test('markProcessed then hasProcessed returns true', () => {
  const key = cache.fingerprint('https://example.com/doc');
  cache.markProcessed(cacheFile, key, '/tmp/out.md');
  assert.strictEqual(cache.hasProcessed(cacheFile, key), true);
});

test('cache file is JSONL (append-only)', () => {
  const raw = fs.readFileSync(cacheFile, 'utf8').trim().split('\n');
  assert.ok(raw.length >= 1);
  const rec = JSON.parse(raw[0]);
  assert.ok(rec.key && rec.outputPath && rec.ts);
});

test('corrupted line is skipped', () => {
  fs.appendFileSync(cacheFile, '{broken json}\n', 'utf8');
  const map = cache.readCache(cacheFile);
  assert.ok(map.size >= 1, 'should still read valid lines');
});

test('hasProcessed TTL: stale record is treated as unprocessed', () => {
  const key = cache.fingerprint('https://example.com/stale');
  cache.markProcessed(cacheFile, key, '/tmp/stale.md', { ts: '2020-01-01T00:00:00.000Z' });
  assert.strictEqual(cache.hasProcessed(cacheFile, key), true, 'no TTL -> still processed');
  assert.strictEqual(cache.hasProcessed(cacheFile, key, { maxAgeMs: 60 * 1000 }), false, 'stale -> unprocessed');
  assert.strictEqual(cache.hasProcessed(cacheFile, key, { maxAgeMs: 1e12 }), true, 'recent enough -> processed');
});

test('markProcessed tolerates unwritable cache location', () => {
  const blocker = path.join(tmp, 'blocked-file');
  fs.writeFileSync(blocker, 'x');
  const badFile = path.join(blocker, 'cache.jsonl');
  let threw = false, ret = null;
  try { ret = cache.markProcessed(badFile, 'some-key', '/out.md'); } catch (e) { threw = true; }
  assert.strictEqual(threw, false, 'should not throw');
  assert.strictEqual(ret, false, 'should report failure instead');
});

// cleanup
fs.rmSync(tmp, { recursive: true, force: true });

console.log('');
console.log(passed + ' cache tests passed, ' + failed + ' failed');
if (require.main === module) process.exit(failed ? 1 : 0);
module.exports = { passed, failed };