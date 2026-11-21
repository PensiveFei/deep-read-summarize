// tests/e2e-dsh.test.js — 端到端脚本里「不需要宿主」的那部分
//
// 真正的断言在 scripts/e2e-dsh.js 跑完一次真实精读之后，这里只钉住三件容易写错的事：
// patch 是否只覆盖了模型那一行、产物挑选会不会挑错文件、工作区是否真的在仓库之外
// （放仓库里会被 Windows 沙箱的 DACL 授权拒掉，实测踩过）。
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { PATCH, TASK, SOURCE, newestNote, plan } = require('../scripts/e2e-dsh');

// 素材路径曾经是「共用金丝雀的」：金丝雀把 source.md 移进 cases/ 之后，E2E 直接崩在
// copyFileSync 的 ENOENT 上，而且是在装完 dsh、装完插件之后才崩。素材各自持有 + 这条断言
// 就是为了让这类耦合在本地就红，而不是在 CI 里白跑一轮。
test('the E2E fixture exists, lives under fixtures/e2e, and can fill a 300-word note', () => {
  assert.ok(fs.existsSync(SOURCE), 'missing fixture: ' + SOURCE);
  assert.ok(SOURCE.replace(/\\/g, '/').includes('tests/fixtures/e2e/'), 'fixture must not be shared with the canary: ' + SOURCE);
  const text = fs.readFileSync(SOURCE, 'utf8');
  assert.ok(text.length >= 200, 'fixture too short for MIN_WORDS=300: ' + text.length);
});

test('patch overrides only the model, keeping the deepseek-official provider', () => {
  const lines = PATCH.trim().split('\n');
  assert.equal(lines[0], '- id: agent-default-model');
  assert.ok(PATCH.includes('  provider: deepseek-official'), PATCH);
  assert.ok(PATCH.includes('    model: ' + (process.env.E2E_MODEL || 'deepseek-v4-pro')), PATCH);
  assert.equal(lines.length, 4, 'patch 只该有 4 行：id + config + provider + model');
});

test('the task tells the model to use the plugin tool and write into ./output', () => {
  assert.ok(TASK.includes('./input.md'));
  assert.ok(TASK.includes('./output'));
  assert.ok(TASK.includes('插件'));
});

test('newestNote ignores non-markdown files and picks the latest note', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drs-note-'));
  try {
    fs.writeFileSync(path.join(dir, 'old.md'), '# old');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a note');
    fs.writeFileSync(path.join(dir, 'new.md'), '# new');
    const past = Date.now() / 1000 - 100;
    fs.utimesSync(path.join(dir, 'old.md'), past, past);
    assert.equal(path.basename(newestNote(dir)), 'new.md');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the work tree is created outside the repository', () => {
  const paths = plan();
  assert.ok(paths.work.startsWith(os.tmpdir()), paths.work);
  assert.ok(!paths.work.startsWith(process.cwd()), paths.work);
  assert.ok(paths.home.endsWith('dsh-home'));
});
