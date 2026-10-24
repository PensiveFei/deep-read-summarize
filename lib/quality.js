'use strict';

// Both functions are self-contained so workflow.js can inline them into the
// coordination sandbox. They never evaluate YAML or read files themselves.
function checkNoteStructure(note, options) {
  const opts = options || {};
  const issues = [];
  if (typeof note !== 'string' || !note.trim()) {
    return { formatComplete: false, lengthMet: false, wordCount: 0, quotes: [], issues: ['笔记为空或不是字符串'] };
  }
  const text = note.trim().replace(/\r\n?/g, '\n');
  const front = text.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  function scalar(raw) {
    const value = raw.trim();
    if (value[0] === '"') {
      const parsed = JSON.parse(value);
      if (typeof parsed !== 'string') throw new Error('expected string');
      return parsed;
    }
    if (value[0] === "'") {
      if (value.length < 2 || value[value.length - 1] !== "'" || /(^|[^'])'([^']|$)/.test(value.slice(1, -1))) throw new Error('invalid quoted scalar');
      return value.slice(1, -1).replace(/''/g, "'");
    }
    if (value[0] === '[') {
      if (value[value.length - 1] !== ']') throw new Error('invalid sequence');
      const tokens = [];
      let token = '', quote = '', escaped = false;
      for (const character of value.slice(1, -1)) {
        if (quote) {
          token += character;
          if (escaped) escaped = false;
          else if (quote === '"' && character === '\\') escaped = true;
          else if (character === quote) quote = '';
        } else if (character === '"' || character === "'") {
          quote = character; token += character;
        } else if (character === ',') {
          tokens.push(scalar(token)); token = '';
        } else token += character;
      }
      if (quote) throw new Error('unclosed quote');
      if (token.trim()) tokens.push(scalar(token));
      return tokens;
    }
    if (/[:][ \t]|[\[\]{}]|^[!&*|>]/.test(value)) throw new Error('invalid template scalar');
    return value.replace(/[ \t]+#.*$/, '').trim();
  }
  function fields(lines) {
    const values = Object.create(null);
    for (const line of lines) {
      if (!line.trim() || /^\s*#/.test(line)) continue;
      const match = line.match(/^([A-Za-z][\w-]*):[ \t]*(.*)$/);
      if (!match || Object.prototype.hasOwnProperty.call(values, match[1])) throw new Error('invalid or duplicate field');
      values[match[1]] = scalar(match[2]);
    }
    return values;
  }
  let frontmatterValid = !!front;
  if (!front) issues.push('缺少开头的 YAML frontmatter');
  else {
    try {
      const actual = fields(front[1].split('\n'));
      const expected = fields((opts.expectedFrontmatter || []).filter(line => line !== '---'));
      for (const key of Object.keys(expected)) {
        if (!Object.prototype.hasOwnProperty.call(actual, key) || JSON.stringify(actual[key]) !== JSON.stringify(expected[key])) {
          frontmatterValid = false;
          issues.push('frontmatter 字段缺失或不符合本次模板：' + key);
        }
      }
      if (!Object.prototype.hasOwnProperty.call(actual, 'title') || !actual.title) {
        frontmatterValid = false; issues.push('frontmatter 缺少有效 title');
      }
    } catch (error) {
      frontmatterValid = false;
      issues.push('frontmatter 不符合提供的标量/列表模板，或包含重复字段');
    }
  }
  const body = front ? text.slice(front[0].length) : text;
  // Ignore fenced examples when checking real headings and prose length.
  const prose = [];
  let fence = '', fenceLength = 0;
  const visibleBody = body.replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '');
  for (const line of visibleBody.split('\n')) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) { fence = marker[1][0]; fenceLength = marker[1].length; }
      else if (marker[1][0] === fence && marker[1].length >= fenceLength && /^\s*$/.test(line.slice(marker[0].length))) fence = '';
      continue;
    }
    if (!fence && !/^(?: {4}|\t)/.test(line)) prose.push(line);
  }
  const proseText = prose.join('\n');
  let sectionsComplete = /^#[ \t]+\S/m.test(proseText) && !fence;
  if (!/^#[ \t]+\S/m.test(proseText)) issues.push('缺少笔记一级标题');
  if (fence) issues.push('存在未闭合的代码围栏');
  const requiredCount = opts.fastMode ? 4 : 7;
  for (let section = 1; section <= requiredCount; section++) {
    const heading = new RegExp('^##[ \\t]+' + section + '(?:[.、．][ \\t]*|[ \\t]+)\\S', 'gm');
    const found = proseText.match(heading) || [];
    if (found.length !== 1) {
      sectionsComplete = false;
      issues.push('必要章节缺失或重复：第 ' + section + ' 节');
    }
  }
  const countable = proseText.replace(/https?:\/\/[^\s)>\]]+/g, '');
  const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
  const ideographs = countable.match(cjk) || [];
  const words = countable.replace(cjk, ' ').match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) || [];
  const wordCount = ideographs.length + words.length;
  const lengthMet = wordCount >= opts.minWords;
  if (!lengthMet) issues.push('正文篇幅不足：计数 ' + wordCount + '，要求至少 ' + opts.minWords + '（不计 frontmatter、代码块和链接地址）');
  const quotes = [];
  const quoteStart = prose.findIndex(line => /^##[ \t]+4(?:[.、．][ \t]*|[ \t]+)\S/.test(line));
  if (quoteStart !== -1) {
    const quoteLines = [];
    for (const line of prose.slice(quoteStart + 1)) {
      if (/^##[ \t]/.test(line)) break;
      quoteLines.push(line);
    }
    for (const line of quoteLines) {
      // A blockquote can contain a quoted sentence followed by its location.
      // Prefer the explicit sentence so Markdown markers and locations do not become source text.
      const expression = /“([^”\n]+)”|「([^」\n]+)」|"([^"\n]+)"/g;
      let match, explicit = false;
      while ((match = expression.exec(line))) {
        explicit = true;
        const quote = (match[1] || match[2] || match[3]).trim();
        if (quote && quotes.indexOf(quote) === -1) quotes.push(quote);
      }
      if (!explicit && /^>[ \t]+/.test(line)) {
        const quote = line.replace(/^(?:>[ \t]*)+/, '').trim();
        if (quote && quotes.indexOf(quote) === -1) quotes.push(quote);
      }
    }
  }
  return { formatComplete: frontmatterValid && sectionsComplete, lengthMet, wordCount, quotes, visibleText: proseText, issues };
}

function validateSourceCheck(check, context) {
  const ctx = context || {};
  const issues = [];
  const gates = ['sourceChecked', 'coverage', 'citationsReal', 'terminologyConsistent', 'languageConsistent'];
  const results = {};
  for (const gate of gates) {
    results[gate] = !!check && check[gate] === true;
    if (!results[gate]) issues.push('原文核验未通过或缺失：' + gate);
  }
  if (check && Array.isArray(check.issues)) {
    issues.push(...check.issues.filter(issue => typeof issue === 'string' && issue.trim()));
  }
  const plan = ctx.chunkPlan || [];
  const chunkChecks = check && Array.isArray(check.chunkChecks) ? check.chunkChecks : [];
  const seen = new Set();
  for (const evidence of chunkChecks) {
    const chunk = evidence && plan.find(item => item.id === evidence.chunkId);
    if (!chunk || seen.has(evidence.chunkId) || evidence.startLine !== chunk.startLine || evidence.endLine !== chunk.endLine ||
        typeof evidence.sourceExcerpt !== 'string' || !evidence.sourceExcerpt.trim() || evidence.covered !== true) {
      results.coverage = false;
      issues.push('分块核验证据无效、重复或未覆盖');
    } else seen.add(evidence.chunkId);
  }
  if (plan.some(chunk => !seen.has(chunk.id))) {
    results.coverage = false; issues.push('原文核验未逐一覆盖全部分块');
  }
  if (ctx.coverageComplete !== true) {
    results.coverage = false; issues.push('获取结果缺少有效 totalLines，无法确认原文尾部是否完整覆盖');
  }
  if (ctx.failedChunkIds && ctx.failedChunkIds.length) {
    results.coverage = false; issues.push('精读仍有缺口，失败块：' + ctx.failedChunkIds.join(', '));
  }
  function normalize(value) { return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''; }
  const citationChecks = check && Array.isArray(check.citationChecks) ? check.citationChecks : [];
  const requiredQuotes = (ctx.quotes || []).map(normalize);
  const verifiedQuotes = [];
  for (const citation of citationChecks) {
    const chunk = citation && plan.find(item => item.id === citation.chunkId);
    const quote = normalize(citation && citation.quote);
    const valid = chunk && citation.verified === true && quote && requiredQuotes.includes(quote) &&
      normalize(ctx.visibleNote === undefined ? ctx.note : ctx.visibleNote).includes(quote) &&
      normalize(citation.sourceQuote).includes(quote) && typeof citation.location === 'string' && citation.location.trim() &&
      Number.isInteger(citation.startLine) && Number.isInteger(citation.endLine) &&
      citation.startLine >= chunk.startLine && citation.endLine >= citation.startLine && citation.endLine <= chunk.endLine;
    if (!valid) {
      results.citationsReal = false; issues.push('引用无法与笔记、原文摘录及分块行号对应');
    } else verifiedQuotes.push(quote);
  }
  if (ctx.requireCitations && (requiredQuotes.length === 0 || verifiedQuotes.length === 0)) {
    results.citationsReal = false; issues.push('未提交有效的原文引用核验记录');
  }
  for (const quote of ctx.quotes || []) {
    if (!verifiedQuotes.some(verified => verified === normalize(quote))) {
      results.citationsReal = false; issues.push('关键引用缺少对应的原文核验记录：' + quote);
    }
  }
  return { passed: issues.length === 0 && gates.every(gate => results[gate]), checks: results, issues, chunkChecks, citationChecks };
}

module.exports = { checkNoteStructure, validateSourceCheck };
