// tests/workflow-pins.test.js — workflow 里的 action 必须按 commit SHA 锁定
//
// 为什么要测这个：0.6.6 之前 ci.yml 停在 checkout@v4 三个大版本，没有任何东西会提醒；
// 改成 SHA 之后更糟——可变 tag 至少还会跟着上游动，SHA 是彻底静止的。
// 所以「加了 uses 却写成 @v4」必须在本地/CI 当场红，而不是等半年后被人发现。
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');

// `uses: owner/repo@<40 hex> # vX.Y.Z`；本地 action（./xxx）与 docker:// 不在检查范围。
const USES = /^\s*(?:-\s*)?uses:\s*(\S+)(?:\s+#\s*(\S+))?\s*$/;

function workflowFiles() {
  return fs.readdirSync(WORKFLOWS)
    .filter(function (f) { return /\.ya?ml$/.test(f); })
    .map(function (f) { return path.join(WORKFLOWS, f); });
}

function usesLines(file) {
  const out = [];
  fs.readFileSync(file, 'utf8').split('\n').forEach(function (line, i) {
    const m = line.match(USES);
    if (m) out.push({ file: path.basename(file), line: i + 1, ref: m[1], comment: m[2] || '' });
  });
  return out;
}

test('every workflow action is pinned to a full commit SHA', () => {
  const actions = workflowFiles().flatMap(usesLines)
    .filter(function (u) { return u.ref.indexOf('./') !== 0 && u.ref.indexOf('docker://') !== 0; });
  assert.ok(actions.length >= 4, 'expected to find the workflow actions, got ' + actions.length);
  for (const action of actions) {
    const m = action.ref.match(/^([^@]+)@([0-9a-f]{40})$/);
    assert.ok(m, action.file + ':' + action.line + ' is not SHA-pinned: ' + action.ref +
      ' — use `uses: ' + action.ref.split('@')[0] + '@<40-hex-sha> # vX.Y.Z`');
  }
});

test('every pinned action keeps a human-readable version comment', () => {
  for (const action of workflowFiles().flatMap(usesLines)) {
    if (action.ref.indexOf('./') === 0 || action.ref.indexOf('docker://') === 0) continue;
    assert.match(action.comment, /^v\d+\.\d+\.\d+$/,
      action.file + ':' + action.line + ' needs a `# vX.Y.Z` comment so the next reader ' +
      '(and Dependabot) can tell which release the SHA is');
  }
});

test('dependabot config keeps the SHA pins moving', () => {
  const file = path.join(ROOT, '.github', 'dependabot.yml');
  assert.ok(fs.existsSync(file), '.github/dependabot.yml is missing — pinned SHAs would freeze');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /^version:\s*2$/m);
  assert.match(text, /package-ecosystem:\s*github-actions/, 'no github-actions update entry');
  assert.match(text, /groups:/, 'actions updates should be grouped, otherwise every action opens a PR');
  assert.match(text, /package-ecosystem:\s*npm/, 'no npm entry — security updates would not open PRs');
});
