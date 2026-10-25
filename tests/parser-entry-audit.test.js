'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const plugin = require('../index');
const video = require('../parsers/video');

function fixture(t, source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drs-parser-entry-'));
  fs.writeFileSync(path.join(root, 'parser.cjs'), source);
  t.after(function () {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('drs-parser-entry-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function host(engine) {
  const state = { skills: [], tools: [], disposed: [] };
  const services = {
    tools: { register(definition) { state.tools.push(definition); return function () { state.disposed.push('tool'); }; } },
    workflowEngine: engine
  };
  state.ctx = {
    get(name) { return services[name]; },
    skills: { register(skill) { state.skills.push(skill); return function () { state.disposed.push('skill'); }; } }
  };
  return state;
}

async function fetchCall(script, args) {
  const calls = [];
  const result = await vm.runInNewContext('(async () => {\n' + script + '\n})()', {
    args,
    phase() {}, log() {},
    agent(prompt, settings) { calls.push({ prompt, settings }); return Promise.resolve({ saved: false, message: 'fixture fetch stop' }); }
  });
  return { calls, result };
}

test('Bilibili multipart prompts preserve the requested page across metadata, subtitles and audio', () => {
  const prompt = video.buildPrompt('https://www.bilibili.com/video/BVfixture/?p=2', {});
  assert.ok(prompt.includes('本次输入明确指定 p=2'));
  assert.ok(prompt.includes('p <= pages.length'));
  assert.ok(prompt.includes('pages[p-1]'));
  assert.ok(prompt.includes('selectedPage.cid / selectedPage.part / selectedPage.duration'));
  assert.ok(prompt.includes('x/player/v2?aid=<aid>&cid=<selectedPage.cid>'));
  assert.ok(prompt.includes('x/player/playurl?avid=<aid>&cid=<selectedPage.cid>'));
  assert.ok(prompt.includes('禁止改用第1P'));
  const short = video.buildPrompt('https://b23.tv/fixture?p=3', {});
  assert.ok(short.includes('本次输入明确指定 p=3'));
  assert.ok(short.includes('保留 query'));
  assert.ok(short.includes('否则读取重定向最终 URL 的 p'));
});

test('malformed Bilibili page inputs fail before requesting any subtitle, audio or transcription', () => {
  for (const page of ['0', '-1', '2.1', 'NaN', '', '%FF', '9007199254740992']) {
    const prompt = video.buildPrompt('https://www.bilibili.com/video/BVfixture/?p=' + page, {});
    assert.ok(prompt.includes('"saved":false'), page);
    assert.ok(!prompt.includes('x/player/v2'), page);
    assert.ok(!prompt.includes('--audio'), page);
  }
});

test('explicit custom parser directories resolve relative to the chosen base and preserve module helpers', async t => {
  const root = fixture(t, "const label = require('./label.json'); module.exports = { name: 'podcast', buildPrompt(input) { return label.prefix + input; } };\n");
  fs.writeFileSync(path.join(root, 'label.json'), '{"prefix":"CUSTOM AUDIO "}');
  const registry = new plugin.parsers.ParserRegistry({ customParsersDir: path.basename(root), baseDir: path.dirname(root) });
  assert.equal(registry.resolve('podcast').buildPrompt('x'), 'CUSTOM AUDIO x');
  const script = plugin.workflow.buildSelfContainedScript(registry);
  const run = await fetchCall(script, { input: 'x', type: 'podcast' });
  assert.equal(run.calls[0].prompt, 'CUSTOM AUDIO x');
  assert.ok(Array.from(run.calls[0].settings.schema.properties.kind.enum).includes('podcast'));
  assert.equal(run.result.stage, 'fetch');
});

test('profile custom directories are isolated and never become workflow options', async t => {
  const root = fixture(t, "module.exports = { name: 'web', buildPrompt(input) { return 'PROFILE WEB ' + input; } };\n");
  const state = host(undefined);
  const warnings = [];
  const warn = console.warn;
  console.warn = function (message) { warnings.push(String(message)); };
  try { plugin.apply(state.ctx, { customParsersDir: root, minWords: 100 }); }
  finally { console.warn = warn; }
  assert.equal(warnings.length, 0);
  const content = state.skills[0].content;
  const match = content.match(/```javascript\n([\s\S]*?)\n```/);
  const run = await fetchCall(match[1], { input: 'x', type: 'web' });
  assert.equal(run.calls[0].prompt, 'PROFILE WEB x');
  assert.ok(!plugin.parsers.resolve('web').buildPrompt('x').startsWith('PROFILE WEB'));
  assert.equal(Object.hasOwn(plugin.normalizeOptions({ customParsersDir: root }), 'customParsersDir'), false);
  assert.equal(plugin.normalizeOptions({ customParsersDir: root, options: { minWords: 77 } }).minWords, 77);
});

test('skills and exported workflow scripts use the latest programmatic registration', t => {
  const registry = plugin.parsers.registry;
  t.after(function () { delete registry.parsers.audit_audio; });
  registry.register({ name: 'audit_audio', buildPrompt(input) { return 'LATEST ' + input; } });
  assert.ok(plugin.buildSkillContent().includes('"audit_audio": { buildPrompt:'));
  assert.ok(plugin.workflow.script.includes('"audit_audio": { buildPrompt:'));
  registry.parsers.audit_audio.buildPrompt = function (input) { return 'REPLACED ' + input; };
  assert.ok(plugin.buildSkillContent().includes("return 'REPLACED ' + input"));
});

test('generated workflow provides the exact installed transcription path inside a sandbox without Node globals', async () => {
  const run = await fetchCall(plugin.workflow.script, { input: 'https://youtu.be/fixture', type: 'video' });
  const prompt = run.calls[0].prompt;
  const realScript = fs.realpathSync(path.join(__dirname, '..', 'scripts', 'transcribe.js'));
  assert.ok(prompt.includes(JSON.stringify(realScript)));
  assert.ok(prompt.includes('插件已定位本版本转写脚本'));
  assert.ok(!prompt.includes('Get-ChildItem'));
  assert.ok(!prompt.includes('find "$HOME/.dsh"'));
});

test('thin tool submits loaded code with defaults, caller context and complete quality results', async () => {
  let request;
  let disposed = 0;
  const value = { ok: true, note: 'FULL NOTE '.repeat(8000), filePath: './output/note.md', qualityPassed: false,
    qualityIssues: ['fixture quality gap'], qualityEvidence: { sourceFile: 'fixture/input.txt' }, failedChunks: 1 };
  const state = host({ start(input) { request = input; return { result: Promise.resolve({ stopReason: 'completed', value }), async dispose() { disposed++; } }; } });
  const cleanup = plugin.apply(state.ctx, { options: { minWords: 400, maxChunks: 2 } });
  const tool = state.tools[0];
  assert.equal(tool.name, 'deep_read_summarize');
  assert.ok(state.skills[0].content.length < plugin.buildSkillContent().length / 4);
  assert.ok(state.skills[0].content.includes('同名笔记'));
  assert.ok(state.skills[0].content.includes('qualityPassed: false'));
  assert.ok(state.skills[0].content.includes('write'));
  const parent = { session: {} };
  const signal = new AbortController().signal;
  const returned = await tool.execute({ input: 'fixture', type: 'paper', options: { minWords: 500 } }, { agent: parent, signal });
  assert.equal(returned, value);
  assert.equal(request.parent, parent);
  assert.equal(request.signal, signal);
  assert.equal(request.args.options.minWords, 500);
  assert.equal(request.args.options.maxChunks, 2);
  assert.equal(request.meta.name, 'deep-read-summarize');
  assert.ok(request.script.includes('validateSourceCheck'));
  assert.equal(JSON.parse(tool.output.render({}, returned)[0].text).note.length, value.note.length);
  assert.equal(disposed, 1);
  cleanup();
  assert.deepEqual(state.disposed, ['skill', 'tool']);
});

test('thin tool disposes failed and cancelled runs and refuses invalid or already cancelled requests', async () => {
  for (const stopReason of ['error', 'cancelled']) {
    let disposed = 0;
    const state = host({ start() { return { result: Promise.resolve({ stopReason, error: 'fixture reason' }), async dispose() { disposed++; } }; } });
    plugin.apply(state.ctx);
    await assert.rejects(state.tools[0].execute({ input: 'fixture' }, { agent: {}, signal: new AbortController().signal }), new RegExp(stopReason));
    assert.equal(disposed, 1);
  }
  let starts = 0;
  const state = host({ start() { starts++; throw new Error('must not start'); } });
  plugin.apply(state.ctx);
  const controller = new AbortController();
  controller.abort();
  const tool = state.tools[0];
  await assert.rejects(tool.execute({ input: 'fixture' }, { agent: {}, signal: controller.signal }), /cancelled before start/);
  await assert.rejects(tool.execute({ input: 'fixture', options: { maxChunks: '4' } }, { agent: {} }), /FATAL/);
  await assert.rejects(tool.execute({ input: 'fixture', options: null }, { agent: {} }), /FATAL/);
  await assert.rejects(tool.execute({ input: 'fixture', script: 'untrusted' }, { agent: {} }), /unknown/);
  assert.equal(starts, 0);
});

test('missing optional host services retain the legacy skill and failed skill registration releases the tool', () => {
  const state = host(undefined);
  const cleanup = plugin.apply(state.ctx);
  assert.equal(state.tools.length, 0);
  assert.ok(state.skills[0].content.includes('```javascript\n'));
  cleanup();
  assert.deepEqual(state.disposed, ['skill']);
  const failing = host({ start() {} });
  failing.ctx.skills.register = function () { throw new Error('fixture skill registration failed'); };
  assert.throws(() => plugin.apply(failing.ctx), /fixture skill registration failed/);
  assert.deepEqual(failing.disposed, ['tool']);
});

test('Cordis optional-service injection upgrades late services, restores fallback and cleans up on unload', async () => {
  const state = host({ start() {} });
  let activate;
  let releaseActive;
  const current = new Map();
  state.ctx.fiber = { state: 2 };
  state.ctx.skills.register = function (skill) {
    assert.equal(current.has(skill.name), false, 'previous skill must be removed before replacing it');
    current.set(skill.name, skill);
    return function () { if (current.get(skill.name) === skill) current.delete(skill.name); };
  };
  state.ctx.inject = function (dependencies, callback) {
    assert.deepEqual(dependencies, ['tools', 'workflowEngine']);
    assert.equal(callback.prototype, undefined, 'Cordis must execute the callback as an effect rather than construct it');
    activate = function () { releaseActive = callback(state.ctx); };
    return { async dispose() { if (releaseActive) releaseActive(); releaseActive = undefined; } };
  };
  assert.equal(plugin.apply.prototype, undefined, 'plugin cleanup must be collected as an effect');
  const cleanup = plugin.apply(state.ctx);
  assert.ok(current.get(plugin.name).content.includes('```javascript\n'));
  activate();
  assert.equal(state.tools.length, 1);
  assert.ok(!current.get(plugin.name).content.includes('```javascript\n'));
  releaseActive();
  releaseActive = undefined;
  assert.ok(current.get(plugin.name).content.includes('```javascript\n'));
  activate();
  assert.equal(state.tools.length, 2);
  state.ctx.fiber.state = 5;
  await cleanup();
  assert.equal(current.size, 0);
  assert.deepEqual(state.disposed, ['tool', 'tool']);
});
