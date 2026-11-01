'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION = 1;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_CACHE_BYTES = 128 * 1024 * 1024;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const entryName = /^[a-f0-9]{64}\.json$/;
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function directory(root) { return path.join(root, 'transcripts-v1'); }

function hashFile(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

// Cache only managed HF snapshots with a locally identifiable environment.
// Any installed package or model snapshot change invalidates the identity.
// Local/custom model directories deliberately bypass this cache.
function runtimeIdentity(root, model) {
  try {
    if (!/^[a-z0-9.-]+$/i.test(model) || fs.existsSync(model)) return null;
    const venv = path.join(root, 'venv');
    const sites = [path.join(venv, 'Lib', 'site-packages')];
    const lib = path.join(venv, 'lib');
    if (fs.existsSync(lib)) {
      for (const name of fs.readdirSync(lib)) {
        if (/^python\d+\.\d+$/.test(name)) sites.push(path.join(lib, name, 'site-packages'));
      }
    }
    const packages = sites.filter(p => fs.existsSync(p)).flatMap(p => fs.readdirSync(p).filter(n => n.endsWith('.dist-info'))).sort();
    if (!packages.some(n => /^faster_whisper-1\.2\.1\.dist-info$/.test(n)) ||
        !packages.some(n => /^ctranslate2-/.test(n))) return null;
    const hub = path.join(root, 'hf', 'hub');
    const canonicalHub = fs.realpathSync(hub);
    const manifest = [];
    let binaries = 0;
    function visit(dir, prefix, depth) {
      if (depth > 5 || manifest.length > 4096) throw new Error('model manifest exceeds limits');
      for (const name of fs.readdirSync(dir).sort()) {
        if (manifest.length >= 4096) throw new Error('model manifest exceeds limits');
        const file = path.join(dir, name);
        const relative = prefix + '/' + name;
        const link = fs.lstatSync(file);
        if (link.isDirectory()) visit(file, relative, depth + 1);
        else {
          const real = fs.realpathSync(file);
          const inside = path.relative(canonicalHub, real);
          if (inside.startsWith('..') || path.isAbsolute(inside)) throw new Error('model file outside managed cache');
          const stat = fs.statSync(file);
          if (!stat.isFile()) throw new Error('non-file model artifact');
          if (name === 'model.bin') binaries++;
          manifest.push([relative, stat.size, stat.mtimeMs,
            prefix.includes('/refs') ? fs.readFileSync(file, 'utf8') : '']);
        }
      }
    }
    for (const repo of fs.readdirSync(hub).filter(n => n.startsWith('models--')).sort()) {
      for (const section of ['refs', 'snapshots']) {
        const dir = path.join(hub, repo, section);
        if (fs.existsSync(dir)) visit(dir, repo + '/' + section, 0);
      }
    }
    if (!binaries) return null;
    const pythonConfig = path.join(venv, 'pyvenv.cfg');
    return digest(JSON.stringify({ packages, manifest,
      python: fs.existsSync(pythonConfig) ? fs.readFileSync(pythonConfig, 'utf8') : '' }));
  } catch (error) { return null; }
}

function identity(audioHash, args, runtime, runner) {
  if (!runtime) return null;
  // Timestamp presentation is excluded: canonical segments retain both times.
  const config = { version: VERSION, audioHash, runtime, model: args.model,
    language: args.language, device: args.device, cpuThreads: args.cpuThreads,
    fasterWhisper: '1.2.1', computeType: 'int8', beamSize: 5, bestOf: 5,
    vadFilter: true, conditionOnPreviousText: true,
    temperature: [0, 0.2, 0.4, 0.6, 0.8, 1], pipeline: 'standard-v1', runner: digest(runner || '') };
  return { key: digest(JSON.stringify(config)), config };
}

function validSegments(segments) {
  return Array.isArray(segments) && segments.length > 0 && segments.every(s =>
    s && typeof s.text === 'string' && s.text.trim() && !/[\u0000\r\n]/.test(s.text) &&
    Number.isFinite(s.start) && Number.isFinite(s.end) && s.start >= 0 && s.end >= s.start);
}

function timestamp(seconds) {
  // Match Python round() (ties to even) used by the existing runner.
  const value = Math.max(0, seconds * 1000);
  const floor = Math.floor(value);
  let millis = value - floor === 0.5 ? floor + (floor % 2) : Math.round(value);
  const hours = Math.floor(millis / 3600000); millis %= 3600000;
  const minutes = Math.floor(millis / 60000); millis %= 60000;
  const whole = Math.floor(millis / 1000); millis %= 1000;
  return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ':' +
    String(whole).padStart(2, '0') + '.' + String(millis).padStart(3, '0');
}
function render(segments, timestamps) {
  return segments.map(s => (timestamps ? '[' + timestamp(s.start) + ' --> ' + timestamp(s.end) + '] ' : '') + s.text).join('\n');
}

function read(root, id) {
  if (!id) return null;
  try {
    const file = path.join(directory(root), id.key + '.json');
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > MAX_ENTRY_BYTES) return null;
    const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (entry.version !== VERSION || entry.key !== id.key ||
        JSON.stringify(entry.config) !== JSON.stringify(id.config) ||
        !Number.isFinite(entry.createdAt) || entry.createdAt > Date.now() || Date.now() - entry.createdAt > MAX_AGE_MS ||
        !entry.report || !validSegments(entry.report.segments) ||
        entry.checksum !== digest(JSON.stringify(entry.report))) return null;
    try { fs.utimesSync(file, new Date(), new Date()); } catch (error) { /* best effort LRU */ }
    return entry.report;
  } catch (error) { return null; }
}

function prune(root, limit = MAX_CACHE_BYTES) {
  const dir = directory(root);
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter(n => entryName.test(n)).flatMap(name => {
    try {
      const file = path.join(dir, name), stat = fs.lstatSync(file);
      return stat.isFile() ? [{ file, size: stat.size, modified: stat.mtimeMs }] : [];
    } catch (error) { return []; }
  }).sort((a, b) => b.modified - a.modified);
  let size = 0;
  for (const file of files) {
    if (size + file.size > limit || Date.now() - file.modified > MAX_AGE_MS) fs.unlinkSync(file.file);
    else size += file.size;
  }
}

function write(root, id, report) {
  if (!id || !report || !validSegments(report.segments)) return false;
  let temporary;
  try {
    const data = JSON.stringify({ version: VERSION, key: id.key, config: id.config,
      createdAt: Date.now(), report, checksum: digest(JSON.stringify(report)) });
    if (Buffer.byteLength(data) > MAX_ENTRY_BYTES) return false;
    const dir = directory(root);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    temporary = path.join(dir, '.write-' + crypto.randomBytes(16).toString('hex'));
    fs.writeFileSync(temporary, data, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, path.join(dir, id.key + '.json'));
    prune(root);
    return true;
  } catch (error) { return false; }
  finally { if (temporary) { try { fs.unlinkSync(temporary); } catch (error) { /* already renamed */ } } }
}

// Delete only this module's strictly named entries; never recurse or touch models.
function clear(root) {
  const dir = directory(root);
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir).filter(n => entryName.test(n))) {
    const file = path.join(dir, name);
    if (fs.lstatSync(file).isFile()) fs.unlinkSync(file);
  }
}

module.exports = { hashFile, runtimeIdentity, identity, validSegments, render, read, write, clear, prune, directory };
