// tests/e2e-dsh.test.js — 端到端脚本里「不需要宿主」的那部分
//
// 用与固定 DSH 宿主相同的事件格式，检查调用、完整返回值与落盘文件的对应关系。
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { PATCH, TASK, SOURCE, newestNote, verifySavedNote, plan } = require('../scripts/e2e-dsh');

// 素材路径曾经是「共用金丝雀的」：金丝雀把 source.md 移进 cases/ 之后，E2E 直接崩在
// copyFileSync 的 ENOENT 上，而且是在装完 dsh、装完插件之后才崩。素材各自持有 + 这条断言
// 就是为了让这类耦合在本地就红，而不是在 CI 里白跑一轮。
test('the E2E fixture exists, lives under fixtures/e2e, and can fill a 300-word note', () => {
  assert.ok(fs.existsSync(SOURCE), 'missing fixture: ' + SOURCE);
  assert.ok(SOURCE.replace(/\\/g, '/').includes('tests/fixtures/e2e/'), 'fixture must not be shared with the canary: ' + SOURCE);
  const text = fs.readFileSync(SOURCE, 'utf8');
  assert.ok(text.length >= 200, 'fixture too short for MIN_WORDS=300: ' + text.length);
});

test('isolated profile keeps the official provider and a readable full session log', () => {
  assert.ok(PATCH.includes('  provider: deepseek-official'), PATCH);
  assert.ok(PATCH.includes('    model: ' + (process.env.E2E_MODEL || 'deepseek-v4-pro')), PATCH);
  assert.ok(PATCH.includes("    root: !!js dshHomePath('sessions')"), PATCH);
  assert.ok(PATCH.includes('    compression: none'), PATCH);
});

test('the task names the plugin tool and asks to save its note into ./output', () => {
  assert.ok(TASK.includes('./input.md'));
  assert.ok(TASK.includes('./output'));
  assert.ok(TASK.includes('deep_read_summarize'));
});

const sessionId = 'session-e2e';
const call = { type: 'tool_call', tool: 'deep_read_summarize', callId: 'call-1' };
// headless marks long tool results as truncated even when the invocation succeeded.
const result = { type: 'tool_result', callId: call.callId, status: 'completed', result: '{"ok":tr', truncated: true };
const note = '> 待核验\n\n' + '原文'.repeat(3000) + '\n结论 A';

function stream(events, reason = 'completed') {
  return [{ type: 'session', sessionId }, ...events, { type: 'final', sessionId, reason: { kind: reason } }]
    .map(event => JSON.stringify(event)).join('\n') + '\n';
}

function journal(t, value = { ok: true, qualityPassed: false, note }, callId = call.callId, id = sessionId) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drs-session-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, '--project--', id);
  fs.mkdirSync(dir, { recursive: true });
  const message = { toolCallId: callId, role: 'tool', content: [{ type: 'text', text: JSON.stringify(value) }] };
  const rows = [{ type: 'session', id }, { type: 'tool/result', surfaceOp: 'append', data: { message } }];
  fs.writeFileSync(path.join(dir, 'session.v4.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  return root;
}

test('a saved note matches the complete result, including a quality warning and the tail beyond stdout', t => {
  const root = journal(t);
  const stdout = stream([call, result]);
  assert.equal(verifySavedNote(stdout, root, note.replace(/\n/g, '\r\n') + '\r\n'), call.callId);
  for (const changed of [note.replace('结论 A', '结论 B'), note.replace('> 待核验\n\n', ''), note + ' ']) {
    assert.throws(() => verifySavedNote(stdout, root, changed), /正文与工具返回的 note 不一致/);
  }
});

test('a handwritten note, a different tool, an unrelated result, or a failed call cannot pass', t => {
  const root = journal(t);
  for (const events of [[], [{ type: 'text', text: JSON.stringify(call) }],
    [{ ...call, tool: 'write' }, result], [call], [result, call], [call, { ...result, callId: 'other' }],
    [call, { ...result, status: 'error' }]]) {
    assert.throws(() => verifySavedNote(stream(events), root, note), /没有成功调用/);
  }
  assert.throws(() => verifySavedNote(stream([call, result], 'cancelled'), root, note), /已完成的 DSH 主会话/);
});

test('only a matching successful plugin result from the primary session counts', t => {
  const stdout = stream([call, result]);
  for (const value of [{ ok: false, note }, { ok: true, note: '' }]) {
    assert.throws(() => verifySavedNote(stdout, journal(t, value), note), /完整成功结果/);
  }
  assert.throws(() => verifySavedNote(stdout, journal(t, undefined, 'other'), note), /完整成功结果/);
  assert.throws(() => verifySavedNote(stdout, journal(t, undefined, call.callId, 'session-child'), note), /主会话完整日志/);
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
