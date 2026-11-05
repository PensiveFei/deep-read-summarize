'use strict';

// Host-side cache. The sandbox never reads or writes this directory.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_NOTE_BYTES = 1024 * 1024;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const HASH_RE = /^[a-f0-9]{64}$/;
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}
function sourceHash(root, tempDir, tempFile) {
  try {
    const resolvedRoot = fs.realpathSync(root);
    if (!/^run-[a-z0-9-]+$/i.test(path.basename(tempDir))) return null;
    if (path.resolve(tempFile) !== path.join(path.resolve(tempDir), 'input.txt')) return null;
    if (fs.lstatSync(tempDir).isSymbolicLink() || fs.lstatSync(tempFile).isSymbolicLink()) return null;
    const resolvedDir = fs.realpathSync(tempDir), resolvedFile = fs.realpathSync(tempFile);
    if (!inside(resolvedRoot, resolvedDir) || path.dirname(resolvedFile) !== resolvedDir || path.basename(resolvedFile) !== 'input.txt') return null;
    const fd = fs.openSync(resolvedFile, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const before = fs.fstatSync(fd);
      if (!before.isFile() || before.size > MAX_SOURCE_BYTES) return null;
      const bytes = fs.readFileSync(fd);
      const after = fs.fstatSync(fd);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || bytes.length !== before.size) return null;
      // The resolved path must still refer to the opened file after reading.
      const current = fs.statSync(resolvedFile);
      if (current.ino !== after.ino || current.dev !== after.dev || current.size !== after.size || current.mtimeMs !== after.mtimeMs) return null;
      return hash(bytes);
    } finally { fs.closeSync(fd); }
  } catch (_) { return null; }
}
function keyFor(sourceDigest, identity, prompt, tempFile) {
  if (!HASH_RE.test(sourceDigest || '') || typeof identity !== 'string' || !identity.trim() || typeof prompt !== 'string' || typeof tempFile !== 'string' || !tempFile) return null;
  // Only the task-specific path changes between runs. The complete prompt,
  // including chunk coordinates and focus, otherwise participates in the key.
  return hash(JSON.stringify(['drs-map-cache-v1', sourceDigest, identity, prompt.split(tempFile).join('<SOURCE_FILE>')]));
}
function portable(note, tempDir) {
  // Notes occasionally contain references to the ephemeral run directory. Such
  // references would point to a different source on a later run; don't cache.
  const run = typeof tempDir === 'string' ? path.basename(tempDir) : '';
  return typeof note === 'string' && !!run && !note.toLowerCase().includes(run.toLowerCase());
}
function cacheDir(root, create) {
  try {
    const realRoot = fs.realpathSync(root);
    const dir = path.join(realRoot, '.read-cache-v1');
    if (create) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(dir) !== dir) return null;
    return dir;
  } catch (_) { return null; }
}
function read(root, key) {
  if (!HASH_RE.test(key || '')) return null;
  const dir = cacheDir(root, false);
  if (!dir) return null;
  try {
    const file = path.join(dir, key + '.json');
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_NOTE_BYTES + 1024) return null;
    if (Date.now() - stat.mtimeMs > MAX_AGE_MS || stat.mtimeMs > Date.now() + 60000) return null;
    const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    let data;
    try {
      const opened = fs.fstatSync(fd);
      if (!opened.isFile() || opened.size > MAX_NOTE_BYTES + 1024) return null;
      data = JSON.parse(fs.readFileSync(fd, 'utf8'));
    } finally { fs.closeSync(fd); }
    if (!data || data.version !== 1 || data.key !== key || typeof data.note !== 'string' || !data.note.trim() || Buffer.byteLength(data.note) > MAX_NOTE_BYTES || data.noteHash !== hash(data.note)) return null;
    return data.note;
  } catch (_) { return null; }
}
function prune(dir) {
  try {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !/^(?:[a-f0-9]{64}\.json|\.[a-f0-9]{32}\.tmp)$/.test(entry.name)) continue;
      const file = path.join(dir, entry.name), stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      if (Date.now() - stat.mtimeMs > MAX_AGE_MS) { try { fs.unlinkSync(file); } catch (_) {} }
      else files.push({ file: file, time: stat.mtimeMs, size: stat.size });
    }
    files.sort(function (a, b) { return a.time - b.time; });
    let total = files.reduce(function (sum, file) { return sum + file.size; }, 0);
    for (const item of files) {
      if (total <= MAX_CACHE_BYTES) break;
      try { fs.unlinkSync(item.file); total -= item.size; } catch (_) {}
    }
  } catch (_) {}
}
function write(root, key, note) {
  if (!HASH_RE.test(key || '') || typeof note !== 'string' || !note.trim() || Buffer.byteLength(note) > MAX_NOTE_BYTES) return false;
  const dir = cacheDir(root, true);
  if (!dir) return false;
  const file = path.join(dir, key + '.json');
  const temporary = path.join(dir, '.' + crypto.randomBytes(16).toString('hex') + '.tmp');
  try {
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, key: key, note: note, noteHash: hash(note) }), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
    prune(dir);
    return true;
  } catch (_) {
    try { fs.unlinkSync(temporary); } catch (_) {}
    return false;
  }
}
module.exports = { sourceHash, keyFor, portable, read, write };
