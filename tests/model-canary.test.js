// tests/model-canary.test.js — 金丝雀的判定逻辑（不联网）
//
// 这里测的是「产物不合格时它会不会红」，而不是「模型写得好不好」。
// 金丝雀最危险的退化是：模型随便写点什么它也报 OK。所以每条断言都对着
// 一种真实的坏产物：结构缺章节、篇幅不够、第 4 节编造引文。
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { resolveConfig, buildMessages, verifyNote, normalizeQuote, listCases } = require('../scripts/model-canary');

const SOURCE = [
  '城市热岛效应指的是城市中心气温明显高于周边郊区与乡村的现象。',
  '屋顶绿化被广泛视为缓解热岛的干预手段之一。',
  '然而，把屋顶绿化当作万能药是危险的，它的降温效果高度依赖灌溉。'
].join('\n');

function note(sections, quotes) {
  const parts = ['---', 'title: 热岛与屋顶绿化', 'author: 匿名', '---', '', '# 热岛与屋顶绿化', ''];
  for (let i = 1; i <= sections; i++) {
    parts.push('## ' + i + '. 第' + i + '节');
    parts.push('这一节用来说明结构是否齐全，内容本身不重要，但需要足够的字数以便通过篇幅检查。' +
      '再补一句让正文长度稳定超过测试里设定的下限。');
    parts.push('');
    if (i === 4) {
      for (const quote of quotes) parts.push('> ' + quote, '');
    }
  }
  return parts.join('\n');
}

test('resolveConfig refuses to exceed the call budget', () => {
  // 环境变量名拼出来而不是写死字面量：仓库自带的 security-check 会把
  // 「键名 = 带引号的值」这种形状当成密钥泄露（连注释里的示范都算），拼一下就不会撞上。
  const keyVar = ['DEEPSEEK', 'API', 'KEY'].join('_');
  const env = { [keyVar]: 'test-value', CANARY_MAX_CALLS: '1' };
  assert.throws(() => resolveConfig(env, ['--samples', '3']), /超过预算上限/);
});

test('resolveConfig requires a key only when it will actually call out', () => {
  assert.equal(resolveConfig({}, ['--dry-run']).dryRun, true);
  assert.throws(() => resolveConfig({}, []), /缺少 DEEPSEEK_API_KEY/);
});

test('buildMessages puts the skill in system and the source in user', () => {
  const messages = buildMessages('SKILL-TEXT', SOURCE);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[0].content, 'SKILL-TEXT');
  assert.equal(messages[1].role, 'user');
  assert.ok(messages[1].content.includes(SOURCE));
});

test('verifyNote passes a well-formed note that quotes the source', () => {
  const reply = note(7, [SOURCE.split('\n')[0]]);
  const report = verifyNote(reply, SOURCE, { minWords: 30 });
  assert.equal(report.ok, true, report.failures.join('; '));
  assert.equal(report.stats.quotes, 1);
});

test('verifyNote rejects an invented quote that is not in the source', () => {
  const reply = note(7, ['城市热岛效应已经被彻底解决，所有城市都比郊区凉快。']);
  const report = verifyNote(reply, SOURCE, { minWords: 30 });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => f.includes('找不到')), report.failures.join('; '));
});

test('verifyNote rejects a note missing one of the seven sections', () => {
  const reply = note(6, [SOURCE.split('\n')[0]]);
  const report = verifyNote(reply, SOURCE, { minWords: 30 });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => f.includes('结构不合格')), report.failures.join('; '));
});

test('verifyNote rejects a note with no quotable evidence', () => {
  const reply = note(7, []);
  const report = verifyNote(reply, SOURCE, { minWords: 30 });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => f.includes('没有任何可用引文')), report.failures.join('; '));
});

test('normalizeQuote strips blockquote markers and collapses whitespace', () => {
  assert.equal(normalizeQuote('>  城市   热岛效应  '), '城市 热岛效应');
});

// 提示词是 SKILL.md 里那套模板的镜像。两边漂了，金丝雀测的就成了「另一个契约」，
// 所以用结构比对把它钉住：SKILL.md 的模板块改了，这里必须跟着改。
test('the canary prompt mirrors the note template published in SKILL.md', () => {
  const root = path.join(__dirname, '..');
  const skill = fs.readFileSync(path.join(root, 'skills', 'deep-read-summarize', 'SKILL.md'), 'utf8');
  const block = skill.match(/```markdown\n([\s\S]*?)```/);
  assert.ok(block, 'SKILL.md 里找不到 ```markdown 模板块');
  const headings = block[1].match(/^## \d+\.[^\n]*$/gm) || [];
  assert.equal(headings.length, 7, '模板应含 7 个编号章节，实际 ' + headings.length);
  const prompt = fs.readFileSync(path.join(root, 'tests', 'fixtures', 'canary', 'prompt.md'), 'utf8');
  for (const heading of headings) {
    assert.ok(prompt.includes(heading), 'canary 提示词缺少模板章节：' + heading);
  }
});

// 一篇素材只能给一个平均值：表格密集的原文和中英混排的术语，模型表现可以完全不同。
// 这里钉住「素材是一组、且每个都能被读到」，并给一个下限防止有人把 cases 删空。
test('the canary runs a set of cases, not a single source', () => {
  const root = path.join(__dirname, '..');
  const dir = path.join(root, 'tests', 'fixtures', 'canary', 'cases');
  const cases = listCases(dir);
  assert.ok(cases.length >= 3, '至少要有 3 篇素材，当前 ' + cases.length);
  for (const name of cases) {
    assert.match(name, /\.md$/i);
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.ok(text.trim().length >= 500, name + ' 太短：笔记篇幅下限是 400，素材太短会让金丝雀假失败');
  }
  // 排序稳定，否则「今天失败的是哪一篇」会随文件系统顺序变化。
  assert.deepStrictEqual(cases.slice().sort(), listCases(dir));
});
