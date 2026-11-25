// Offline DSH process substitute for exercising the paired-run CLI and its file boundaries.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('fixture-host');
} else if (args.includes('plugin')) {
  const packed = args[args.length - 1];
  assert.ok(packed.endsWith('.tgz') && fs.statSync(packed).size > 0);
} else if (args.includes('--json')) {
  const sessionId = 'session-fixture';
  const callId = 'call-test';
  const emit = event => console.log(JSON.stringify(event));
  const prompt = fs.readFileSync(0, 'utf8');
  emit({ type: 'session', sessionId });
  if (fs.existsSync('source.txt')) {
    assert.match(prompt, /deep_read_summarize/);
    assert.equal(fs.readFileSync('source.txt', 'utf8'), 'paper input');
    const input = { input: './source.txt', type: args.includes('--wrong-arm') ? 'web' : 'paper',
      options: { lengthMode: 'concise', minWords: 800, maxChunks: 4 } };
    const note = 'Plugin note with a warning and a quotation.';
    emit({ type: 'tool_call', tool: 'deep_read_summarize', callId, input });
    emit({ type: 'tool_result', callId, status: 'completed', truncated: true });
    const dir = path.join(process.env.DSH_HOME, 'sessions', 'project', sessionId);
    fs.mkdirSync(dir, { recursive: true });
    const message = { toolCallId: callId, content: [{ type: 'text', text: JSON.stringify({ ok: true, note }) }] };
    const rows = [{ type: 'session', id: sessionId }, { type: 'tool/result', surfaceOp: 'append', data: { message } }];
    fs.writeFileSync(path.join(dir, 'session.v4.jsonl'), rows.map(row => JSON.stringify(row)).join('\n'));
    fs.writeFileSync('note.md', note);
  } else {
    assert.ok(prompt.endsWith('\n\npaper input'));
  }
  emit({ type: 'final', sessionId, reason: { kind: 'completed' }, text: 'Direct answer.' });
}
