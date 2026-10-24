'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync, spawnSync } = require('node:child_process');
const release = require('../scripts/release');

const workflowText = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'publish.yml'), 'utf8');
function bashStep(name) {
  const start = workflowText.indexOf('      - name: ' + name + '\n');
  assert.ok(start >= 0);
  const end = workflowText.indexOf('\n      - name:', start + 1);
  const section = workflowText.slice(start, end < 0 ? undefined : end);
  const run = section.indexOf('        run: |\n');
  assert.ok(run >= 0);
  return section.slice(run + '        run: |\n'.length).split('\n')
    .filter(line => line.startsWith('          ')).map(line => line.slice(10)).join('\n') + '\n';
}
const preCheckout = bashStep('Validate tag reference before checkout');
const postCheckout = bashStep('Guard package.json version against the ref');
const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
const sha = 'a'.repeat(40);
const workflowSha = 'b'.repeat(40);
function identity(dryRun = false) {
  return { repo: 'PensiveFei/deep-read-summarize', publishRef: 'refs/tags/v0.3.19', publishSha: sha,
    workflowRef: 'main', workflowSha, correlationId: 'fixture-nonce', dryRun, attempt: 1 };
}
function runRecord(id = 22, changes = {}, expected = identity()) {
  return Object.assign({ id, display_title: release.runTitle(expected), event: 'workflow_dispatch',
    head_branch: 'main', head_sha: workflowSha, path: '.github/workflows/publish.yml', run_attempt: 1,
    status: 'completed', conclusion: 'success', repository: { full_name: expected.repo } }, changes);
}
function hooksFor(expected, changes = {}) {
  const calls = [];
  const hooks = {
    repo: expected.repo, correlationId: expected.correlationId, appearanceAttempts: 1, completionAttempts: 1,
    info() {}, sleep() { throw new Error('unexpected wait'); },
    run(command, args) {
      calls.push({ command, args });
      if (command === 'git') return args[2] === 'HEAD^{commit}' ? workflowSha : sha;
      if (args[0] === 'workflow') return changes.dispatchOutput || '';
      if (args[0] === 'api' && args[1].includes('/workflows/')) {
        return JSON.stringify({ workflow_runs: changes.candidates || [runRecord(11, { display_title: 'unrelated dispatch' }), runRecord(22, {}, expected)] });
      }
      if (args[0] === 'api') return JSON.stringify(changes.record || runRecord(22, {}, expected));
      if (args[0] === 'run') return changes.log === undefined ? 'timestamp ' + release.identityLogMarker(expected) + '\n+ deep-read-summarize@0.3.19\n' : changes.log;
      throw new Error('unexpected mocked command');
    }
  };
  return { hooks, calls };
}

test('B10 requires a complete tag ref, including when dispatch input is empty', () => {
  assert.equal(release.resolvePublishRef('refs/tags/v0.3.19'), 'refs/tags/v0.3.19');
  assert.equal(release.resolvePublishRef('', 'refs/tags/v0.3.19', 'tag'), 'refs/tags/v0.3.19');
  for (const ref of ['v0.3.19', 'refs/heads/v0.3.19', 'refs/tags/vfoo', 'refs/tags/v01.2.3', 'refs/tags/v0.3.19/extra']) {
    assert.throws(() => release.resolvePublishRef(ref), /complete refs\/tags/);
  }
  assert.throws(() => release.resolvePublishRef('', 'refs/heads/v0.3.19', 'branch'), /tag event/);
});

test('B10 actual pre-checkout Bash rejects branch-shaped and malformed refs before git is invoked', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'drs-ref-reject-'));
  try {
    const sentinel = path.join(temp, 'git-called');
    for (const values of [
      { PUBLISH_REF: 'refs/heads/v0.3.19' }, { PUBLISH_REF: 'v0.3.19' },
      { PUBLISH_REF: 'refs/tags/vfoo' }, { PUBLISH_REF: '', GITHUB_REF_TYPE: 'branch', GITHUB_REF: 'refs/heads/v0.3.19' }
    ]) {
      const result = spawnSync(bash, ['-s'], { input: 'git() { touch "$SENTINEL"; return 99; }\n' + preCheckout,
        encoding: 'utf8', env: Object.assign({}, process.env, { SENTINEL: sentinel.replace(/\\/g, '/'), CORRELATION_ID: 'fixture', DRY_RUN: 'false' }, values) });
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.equal(fs.existsSync(sentinel), false);
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('B10 actual Bash validates local tag object, checkout commit, and package version', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'drs-ref-valid-'));
  const remote = path.join(temp, 'owner', 'repo.git');
  const checkout = path.join(temp, 'checkout');
  const env = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.com', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.com' });
  function git(args, input) { return execFileSync('git', args, { env, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] }).trim(); }
  try {
    fs.mkdirSync(path.dirname(remote), { recursive: true });
    git(['init', '--bare', remote]);
    const blob = git(['--git-dir', remote, 'hash-object', '-w', '--stdin'], '{"version":"0.3.19"}\n');
    const tree = git(['--git-dir', remote, 'mktree'], '100644 blob ' + blob + '\tpackage.json\n');
    const commit = git(['--git-dir', remote, 'commit-tree', tree, '-m', 'fixture']);
    git(['--git-dir', remote, 'update-ref', 'refs/tags/v0.3.19', commit]);
    git(['clone', '--no-checkout', remote, checkout]);
    git(['-C', checkout, 'checkout', '--detach', commit]);
    const output = path.join(temp, 'outputs');
    const baseEnv = Object.assign({}, process.env, {
      PUBLISH_REF: 'refs/tags/v0.3.19', EXPECTED_SHA: commit, DRY_RUN: 'false', CORRELATION_ID: 'fixture',
      GITHUB_SERVER_URL: temp.replace(/\\/g, '/'), GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_OUTPUT: output.replace(/\\/g, '/'), GITHUB_RUN_ATTEMPT: '1', PUBLISH_MODE: 'real'
    });
    function shell(script, overrides) { return spawnSync(bash, ['-s'], { cwd: checkout, env: Object.assign({}, baseEnv, overrides), input: script, encoding: 'utf8' }); }
    let result = shell(preCheckout);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(fs.readFileSync(output, 'utf8').includes('commit=' + commit));
    result = shell(preCheckout, { PUBLISH_REF: '', GITHUB_REF_TYPE: 'tag', GITHUB_REF: 'refs/tags/v0.3.19' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    git(['--git-dir', remote, 'tag', '-a', 'v0.3.21', commit, '-m', 'annotated fixture']);
    result = shell(preCheckout, { PUBLISH_REF: 'refs/tags/v0.3.21' });
    assert.equal(result.status, 0, 'annotated tag must be peeled to its commit: ' + result.stdout + result.stderr);
    assert.notEqual(shell(preCheckout, { EXPECTED_SHA: sha }).status, 0);
    assert.notEqual(shell(preCheckout, { PUBLISH_REF: 'refs/tags/v0.3.20' }).status, 0);
    result = shell(postCheckout);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(result.stdout.includes('sha=' + commit + ' mode=real correlation=fixture attempt=1'));
    assert.notEqual(shell(postCheckout, { EXPECTED_SHA: sha }).status, 0);
    fs.writeFileSync(path.join(checkout, 'package.json'), '{"version":"0.3.20"}\n');
    assert.notEqual(shell(postCheckout).status, 0);
    git(['--git-dir', remote, 'update-ref', 'refs/tags/v0.3.20', tree]);
    git(['-C', checkout, 'fetch', 'origin', 'refs/tags/v0.3.20:refs/tags/v0.3.20']);
    assert.notEqual(shell(postCheckout, { PUBLISH_REF: 'refs/tags/v0.3.20', EXPECTED_SHA: tree }).status, 0);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('B10 dispatch identifies its own nonce rather than the first newly visible run', () => {
  const expected = identity();
  const { hooks, calls } = hooksFor(expected);
  const selected = release.dispatchPublish('0.3.19', false, hooks);
  assert.equal(selected.id, 22);
  const dispatch = calls.find(call => call.args[0] === 'workflow');
  assert.ok(dispatch.args.includes('correlation_id=fixture-nonce'));
  assert.ok(dispatch.args.includes('publish_sha=' + sha));
  assert.ok(dispatch.args.includes('publish_ref=refs/tags/v0.3.19'));
  assert.ok(dispatch.args.includes('dry_run=false'));
});

test('B10 a returned run URL is preferred and still requires every identity field', () => {
  const expected = identity();
  const { hooks, calls } = hooksFor(expected, { dispatchOutput: 'Created\nhttps://github.com/' + expected.repo + '/actions/runs/22\n' });
  assert.equal(release.dispatchPublish('0.3.19', false, hooks).id, 22);
  assert.equal(calls.some(call => call.args[0] === 'api' && call.args[1].includes('/workflows/')), false);
  assert.throws(() => release.runIdFromOutput('https://github.com/other/repo/actions/runs/22', expected.repo), /another repository/);
  for (const changes of [
    { head_sha: sha }, { head_branch: 'other' }, { run_attempt: 2 }, { event: 'release' },
    { path: '.github/workflows/ci.yml' }, { display_title: release.runTitle(identity(true)) },
    { display_title: release.runTitle(Object.assign({}, expected, { correlationId: 'another-call' })) },
    { display_title: release.runTitle(Object.assign({}, expected, { publishSha: workflowSha })) },
    { display_title: release.runTitle(Object.assign({}, expected, { publishRef: 'refs/tags/v0.3.20' })) }
  ]) {
    const mock = hooksFor(expected, { dispatchOutput: 'https://github.com/' + expected.repo + '/actions/runs/22', record: runRecord(22, changes) });
    assert.throws(() => release.dispatchPublish('0.3.19', false, mock.hooks), /identity mismatch/);
  }
});

test('B10 duplicate correlation and wrong dry/real log markers are rejected', () => {
  const expected = identity();
  const duplicate = hooksFor(expected, { candidates: [runRecord(22), runRecord(23)] });
  assert.throws(() => release.dispatchPublish('0.3.19', false, duplicate.hooks), /multiple publish runs/);
  for (const log of [release.identityLogMarker(identity(true)), release.identityLogMarker(expected).replace('attempt=1', 'attempt=10')]) {
    const mock = hooksFor(expected, { log });
    assert.throws(() => release.dispatchPublish('0.3.19', false, mock.hooks), /missing the expected/);
  }
  const dry = hooksFor(identity(true));
  const selected = release.dispatchPublish('0.3.19', true, dry.hooks);
  assert.throws(() => release.assertPublished(selected, '0.3.19', dry.hooks), /dry-run/);
});

test('B10 publication evidence must match the run identity and exact npm version', () => {
  const expected = identity();
  const selected = { id: 22, identity: expected };
  const mock = hooksFor(expected);
  assert.doesNotThrow(() => release.assertPublished(selected, '0.3.19', mock.hooks));
  const wrongVersion = hooksFor(expected, { log: release.identityLogMarker(expected) + '\n+ deep-read-summarize@0.3.190\n' });
  assert.throws(() => release.assertPublished(selected, '0.3.19', wrongVersion.hooks), /不能算发布成功/);
});

test('B10 release table and package version are rendered together before writes', () => {
  const pkg = { name: 'fixture', version: '0.3.18' };
  const text = '| **v0.3.18** | **npm 已发布（当前）** | prior |\n';
  const prepared = release.prepareReleaseFiles(pkg, text, '0.3.19', 'New | summary');
  assert.equal(JSON.parse(prepared.packageJson).version, '0.3.19');
  assert.ok(prepared.releaseMd.includes('| v0.3.18 | npm 已发布 |'));
  assert.ok(prepared.releaseMd.includes('New \\| summary'));
  assert.throws(() => release.prepareReleaseFiles(pkg, 'missing current row', '0.3.19', 'Summary'), /当前/);
});

test('release updates both locked root versions without changing dependency resolutions', () => {
  const pkg = { name: 'fixture', version: '0.3.18' };
  const dependency = { version: '8.19.0', integrity: 'fixture-integrity' };
  const lock = { name: 'fixture', version: '0.3.18', lockfileVersion: 3,
    packages: { '': { name: 'fixture', version: '0.3.18', dependencies: { acorn: '8.19.0' } }, 'node_modules/acorn': dependency } };
  const prepared = JSON.parse(release.preparePackageLock(lock, pkg, '0.3.19'));
  assert.equal(prepared.version, '0.3.19');
  assert.equal(prepared.packages[''].version, '0.3.19');
  assert.deepEqual(prepared.packages['node_modules/acorn'], dependency);
  assert.equal(lock.version, '0.3.18', 'rendering cannot mutate the original lock');
  assert.throws(() => release.preparePackageLock({ ...lock, version: '0.3.17' }, pkg, '0.3.19'), /must agree/);
});

test('B10 VM main import is inert and malformed docs abort before gates or file writes', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'release.js'), 'utf8');
  const writes = [];
  const commands = [];
  const now = new Date();
  const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  const mockedFs = Object.assign({}, fs, {
    readFileSync(file) {
      if (path.basename(file) === 'package.json') return JSON.stringify({ name: 'deep-read-summarize', version: '0.3.18', repository: { url: 'https://github.com/PensiveFei/deep-read-summarize.git' } });
      if (path.basename(file) === 'CHANGELOG.md') return '## [0.3.19] — ' + today + '\n\nFixture summary.\n';
      if (path.basename(file) === 'RELEASE.md') return 'No current version table row.\n';
      throw new Error('unexpected read');
    },
    writeFileSync() { writes.push(Array.from(arguments)); }
  });
  const mockedChild = {
    execFileSync(command, args) {
      commands.push({ command, args });
      if (command !== 'git') throw new Error('unexpected external command');
      if (args[0] === 'rev-parse') return args[1] === '--abbrev-ref' ? 'main' : sha;
      return '';
    },
    execSync() { throw new Error('gate ran before document validation'); }
  };
  const module = { exports: {} };
  const requireMock = name => name === 'node:fs' ? mockedFs : name === 'node:child_process' ? mockedChild : require(name);
  requireMock.main = {};
  vm.runInNewContext(source, { module, require: requireMock, __dirname: path.join(__dirname, '..', 'scripts'),
    process: { argv: ['node', 'release.js', '--yes', '--version', '0.3.19'] }, console: { log() {}, error() {} }, Buffer });
  assert.equal(commands.length, 0, 'requiring release helpers cannot start the release');
  assert.throws(() => module.exports.main(), /当前/);
  assert.equal(writes.length, 0, 'a bad release table cannot leave a bumped package.json');
});
