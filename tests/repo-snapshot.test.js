'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { snapshot } = require('../scripts/repo-snapshot');

test('repository snapshot reads the requested committed blobs with original line numbers', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-read-repo-'));
  t.after(() => fs.rmSync(tmp, { force: true, recursive: true }));
  const git = args => execFileSync('git', ['-C', tmp, ...args], { encoding: 'utf8' }).trim();
  git(['init', '--quiet']);
  git(['config', 'core.autocrlf', 'false']);
  fs.mkdirSync(path.join(tmp, 'src'));
  const paths = ['README.md', 'src/入口 [1].js'];
  fs.writeFileSync(path.join(tmp, paths[0]), '# Example\n');
  fs.writeFileSync(path.join(tmp, paths[1]), 'first\r\n  second');
  fs.writeFileSync(path.join(tmp, 'data.bin'), Buffer.from([1, 0, 2]));
  git(['add', '.']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.org', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture']);
  const revision = git(['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(tmp, paths[0]), 'Uncommitted replacement');
  const dest = path.join(tmp, 'input.txt');
  const args = [require.resolve('../scripts/repo-snapshot'), tmp, revision, dest, ...paths];
  const metadata = JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' }));
  assert.deepEqual(metadata, { revision, files: paths, totalLines: 6 });
  assert.equal(fs.readFileSync(dest, 'utf8'), 'Commit: ' + revision +
    '\nFile: "README.md" (L1-L1)\n# Example\nFile: "src/入口 [1].js" (L1-L2)\nfirst\n  second\n');
  assert.throws(() => snapshot(tmp, 'main', paths), /full Git commit/);
  assert.throws(() => snapshot(tmp, revision, []), /select 1/);
  for (const file of ['../outside', 'src', 'input.txt', '*.md', 'data.bin']) {
    assert.throws(() => snapshot(tmp, revision, [file]), /relative|tracked regular|binary/);
  }
});
