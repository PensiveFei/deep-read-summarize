'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomInt } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { PATCH, dshInvocation, packCandidate, verifySavedNote } = require('../../scripts/e2e-dsh');
const { version } = require('../../package.json');

const url = 'https://arxiv.org/pdf/2201.11903v2';
const pdfDigest = '6d17654c6bb0837df56876efcdd7c846b20dfc11a1809c06d4fca173eee6d88a';
const task = 'Write a concise English Markdown reading note of at least 800 words, close to that minimum. ' +
  'Include an overview, structured findings, terminology and key quotations. Give the source location and experimental conditions beside important numbers and comparisons.';
const options = { lengthMode: 'concise', minWords: 800, maxChunks: 4 };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function command(exe, args, settings = {}) {
  const proc = spawnSync(exe, args, { encoding: 'utf8', timeout: 30 * 60 * 1000, maxBuffer: 32 * 1024 * 1024, ...settings });
  if (proc.error) throw proc.error;
  if (proc.status !== 0) throw new Error(path.basename(exe) + ' failed: ' + (proc.stderr || '').slice(-1400));
  return proc.stdout;
}

function extractPaper(pdf) {
  if (hash(fs.readFileSync(pdf)) !== pdfDigest) throw new Error('PDF SHA-256 differs from the pinned arXiv v2 copy');
  const text = command('pdftotext', ['-layout', '-enc', 'UTF-8', pdf, '-']).replace(/\r\n/g, '\n');
  const pages = text.trimEnd().split('\f');
  if (pages.length !== 24 || pages.some(page => !page.trim())) throw new Error('Expected 24 nonempty PDF pages');
  return url + '\n' + pages.map((page, index) => '\n[PDF page ' + (index + 1) + ']\n' + page.trimEnd() + '\n').join('');
}

function directNote(stdout) {
  const events = stdout.trim().split('\n').map(line => JSON.parse(line));
  if (events.some(event => event.type === 'tool_call')) throw new Error('Direct arm used a tool');
  const final = events[events.length - 1];
  if (events[0].type !== 'session' || final.type !== 'final' || final.sessionId !== events[0].sessionId ||
      final.reason?.kind !== 'completed' || !final.text?.trim()) throw new Error('Missing completed direct answer');
  return final.text;
}

function main(argv) {
  const [pdf, requestedOut, flag] = argv;
  if (!pdf || !requestedOut || argv.length > 3 || (flag !== undefined && flag !== '--prepare-only')) {
    throw new Error('Usage: node benchmarks/paper-pair/run.js PAPER_V2.pdf NEW_DIRECTORY [--prepare-only]');
  }
  const source = extractPaper(path.resolve(pdf));
  const dsh = flag ? null : dshInvocation();
  if (!flag && (!dsh || !process.env.DEEPSEEK_API_KEY)) throw new Error('Live run requires dsh, pnpm and DEEPSEEK_API_KEY');
  runComparison(source, requestedOut, dsh);
}

function runComparison(source, requestedOut, dsh) {
  const out = path.resolve(requestedOut);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.mkdirSync(out);
  const organizer = path.join(out, 'organizer');
  fs.mkdirSync(organizer);
  fs.writeFileSync(path.join(organizer, 'source.txt'), source);
  const direct = task + '\nAnswer directly without tools. Return only the note.\n\n' + source;
  const plugin = task + '\nCall deep_read_summarize on ./source.txt with type paper and options ' +
    JSON.stringify(options) + '. Save the entire returned note unchanged in ./note.md, including any warnings.';
  const manifest = { startedAt: new Date().toISOString(), status: 'prepared', sourceUrl: url, pdfSha256: pdfDigest, textSha256: hash(source), pluginVersion: version,
    provider: 'deepseek-official', requestedModel: process.env.E2E_MODEL || 'deepseek-v4-pro', pluginOptions: options, arms: {} };
  const saveManifest = () => fs.writeFileSync(path.join(organizer, 'run.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(organizer, 'direct-prompt.txt'), direct);
  fs.writeFileSync(path.join(organizer, 'plugin-prompt.txt'), plugin);
  saveManifest();
  if (!dsh) return;

  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'drs-pair-'));
  let stage = 'install';
  try {
    const home = path.join(base, 'home');
    const env = { ...process.env, DSH_HOME: home };
    const invoke = (args, settings) => command(dsh.command, [...dsh.prefix, ...args], { cwd: base, env, ...settings });
    const patch = path.join(base, 'model.yml');
    fs.writeFileSync(patch, PATCH);
    const candidate = packCandidate(base);
    manifest.packageSha256 = hash(fs.readFileSync(candidate));
    manifest.dshVersion = invoke(['--version']).trim();
    saveManifest();
    invoke(['plugin', '--profile', 'headless', 'add', candidate]);
    const runArgs = ['--profile', 'headless', '--patch', patch, '--json', '--permission-mode', 'workspace-write', '--approval-policy', 'never', '-'];
    // Independent random draws for run order and reviewer labels.
    const order = randomInt(2) ? ['plugin', 'direct'] : ['direct', 'plugin'];
    manifest.order = order;
    for (const arm of order) {
      stage = arm;
      const cwd = path.join(base, arm);
      fs.mkdirSync(cwd);
      if (arm === 'plugin') fs.writeFileSync(path.join(cwd, 'source.txt'), source);
      const started = Date.now();
      const stdout = invoke(runArgs, { cwd, input: arm === 'direct' ? direct : plugin });
      const elapsedMs = Date.now() - started;
      let note;
      if (arm === 'direct') {
        note = directNote(stdout);
      } else {
        note = fs.readFileSync(path.join(cwd, 'note.md'), 'utf8');
        const callId = verifySavedNote(stdout, path.join(home, 'sessions'), note);
        const call = stdout.trim().split('\n').map(line => JSON.parse(line)).find(event => event.type === 'tool_call' && event.callId === callId);
        const args = call.input;
        if (args.type !== 'paper' || path.resolve(cwd, args.input) !== path.join(cwd, 'source.txt') ||
            Object.keys(args.options || {}).length !== Object.keys(options).length ||
            !Object.entries(options).every(([k, v]) => args.options?.[k] === v)) throw new Error('Plugin did not use the specified source and options');
      }
      manifest.arms[arm] = { elapsedMs, noteSha256: hash(note) };
      fs.writeFileSync(path.join(organizer, arm + '.md'), note);
      saveManifest();
    }
    stage = 'prepare-review';
    const labels = randomInt(2) ? ['plugin', 'direct'] : ['direct', 'plugin'];
    const review = path.join(organizer, 'pending-review');
    fs.mkdirSync(review);
    labels.forEach((arm, i) => fs.copyFileSync(path.join(organizer, arm + '.md'), path.join(review, ['A.md', 'B.md'][i])));
    fs.copyFileSync(path.join(__dirname, 'rubric.md'), path.join(review, 'rubric.md'));
    fs.renameSync(review, path.join(out, 'review'));
    manifest.labels = { A: labels[0], B: labels[1] };
    manifest.status = 'awaiting-human-review';
    saveManifest();
  } catch (error) {
    manifest.status = 'failed';
    manifest.failedStage = stage;
    saveManifest();
    throw error;
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}

module.exports = { directNote, extractPaper, runComparison };
