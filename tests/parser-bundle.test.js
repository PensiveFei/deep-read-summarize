'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { buildParserBundle } = require('../lib/parser-bundle');
const { ParserRegistry } = require('../parsers');

function fixtures(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drs-parser-bundle-'));
  t.after(function () {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('drs-parser-bundle-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  for (const [name, body] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, 'utf8');
  }
  return root;
}

function fileRegistry(root, names) {
  const parser = { name: 'podcast', buildPrompt: function () {} };
  const table = Object.create(null);
  for (const name of names || ['podcast']) table[name] = parser;
  return { parsers: table, sourceFor: function () { return path.join(root, 'parser.js'); } };
}

test('B05 file parsers retain method shorthand, module constants, nested helpers and JSON dependencies', function (t) {
  const root = fixtures(t, {
    'parser.js': [
      "const helper = require('./helpers');",
      "const label = 'PODCAST'; let calls = 0;",
      "module.exports = { name: 'podcast', buildPrompt(input) { calls++; return label + ':' + helper(input) + ':' + calls + ':' + this.name; } };"
    ].join('\n'),
    'helpers/index.js': "const data = require('../data.json'); module.exports = function(input) { return data.prefix + input; };",
    'data.json': '{"prefix":"source="}'
  });
  const context = vm.createContext({});
  vm.runInContext(buildParserBundle(fileRegistry(root, ['podcast', 'audio'])), context);
  assert.equal(vm.runInContext("__parsers.podcast.buildPrompt('one')", context), 'PODCAST:source=one:1:podcast');
  assert.equal(vm.runInContext("__parsers.audio.buildPrompt('two')", context), 'PODCAST:source=two:2:podcast');
  assert.equal(vm.runInContext('typeof require', context), 'undefined');
  assert.equal(vm.runInContext('typeof process', context), 'undefined');
});

test('B05 local imports inside template expressions work, while lookalikes in literals/comments are ignored', function (t) {
  const root = fixtures(t, {
    'parser.js': [
      "// require('node:fs') is only a comment",
      "const text = \"require('node:os')\";",
      "const pattern = /require\\('node:path'\\)/;",
      "if (false) /require('node:crypto')/.test(text);",
      "if (false) {} /require('node:stream')/.test(text);",
      "module.exports = { buildPrompt(input) { return `${require('./helper').prefix}:${input}:${pattern.test(text)}`; } };"
    ].join('\n'),
    'helper.js': "exports.prefix = 'template';"
  });
  const script = buildParserBundle(fileRegistry(root));
  assert.equal(vm.runInNewContext(script + "\n__parsers.podcast.buildPrompt('x');"), 'template:x:false');
});

test('B05 bundled local cycles expose cached CommonJS exports rather than recursing forever', function (t) {
  const root = fixtures(t, {
    'parser.js': "const a = require('./a'); module.exports = { buildPrompt() { return a.describe(); } };",
    'a.js': "exports.label = 'cycle'; const b = require('./b'); exports.describe = function() { return b.describe(); };",
    'b.js': "const a = require('./a'); exports.describe = function() { return a.label; };"
  });
  assert.equal(vm.runInNewContext(buildParserBundle(fileRegistry(root)) + '\n__parsers.podcast.buildPrompt();'), 'cycle');
});

test('B05 module factories retain CommonJS top-level this even in strict mode', function (t) {
  const root = fixtures(t, {
    'parser.js': "'use strict'; this.prefix = 'CJS:'; const initial = this; module.exports.buildPrompt = function(input) { return (initial === module.exports) + ':' + this.prefix + input; };"
  });
  assert.equal(vm.runInNewContext(buildParserBundle(fileRegistry(root)) + "\n__parsers.podcast.buildPrompt('x');"), 'true:CJS:x');
});

test('B05 object property names and regexps after class declarations are not mistaken for Node APIs', function (t) {
  const root = fixtures(t, {
    'parser.js': [
      "class Helper {} /require('node:fs')/.test('ignored');",
      "const data = { process: 'OK', Buffer: 'BUFFER', __dirname: 'DIR', __filename: 'FILE' };",
      "module.exports = { buildPrompt() { return data.process + ':' + typeof Helper; } };"
    ].join('\n')
  });
  assert.equal(vm.runInNewContext(buildParserBundle(fileRegistry(root)) + '\n__parsers.podcast.buildPrompt();'), 'OK:function');
});

test('B05 postfix increment and decrement division cannot hide a subsequent real local import', function (t) {
  for (const operator of ['++', '--']) {
    const root = fixtures(t, {
      'parser.js': "let n = 2; const ratio = n" + operator + " / 2; const helper = require('./helper'); module.exports = { buildPrompt() { return helper.prefix + ratio; } };",
      'helper.js': "exports.prefix = 'OK:';"
    });
    const script = buildParserBundle(fileRegistry(root));
    assert.equal(vm.runInNewContext(script + '\n__parsers.podcast.buildPrompt();'), 'OK:1');
  }
});

test('B05 unsupported Node dependencies, dynamic imports and missing modules fail at build time', function (t) {
  for (const [body, expected] of [
    ["const fs = require('node:fs'); module.exports = { buildPrompt() { return fs; } };", /unsupported parser dependency.*node:fs/],
    ["const dep = './helper'; module.exports = { buildPrompt() { return require(dep); } };", /literal local path/],
    ["module.exports = { buildPrompt() { return import('./helper'); } };", /dynamic import is unavailable/],
    ["const dep = require('./missing'); module.exports = { buildPrompt() { return dep; } };", /cannot resolve parser dependency/],
    ["module.exports = { buildPrompt() { return process.platform; } };", /unavailable workflow global process/],
    ["module.exports = { buildPrompt() { return globalThis.process.platform; } };", /unavailable workflow API globalThis.process/],
    ["module.exports = { buildPrompt() { return globalThis['process'].platform; } };", /unavailable workflow API/],
    ["module.exports = { buildPrompt() { return module['require']('node:fs'); } };", /unavailable workflow API/],
    ["const load = require; module.exports = { buildPrompt() { return load('./helper'); } };", /literal local path/],
    ["if (true) { const process = 'local'; } module.exports = { buildPrompt() { return process.platform; } };", /unavailable workflow global process/],
    ["function f(value = process.platform) { var process; return value; } module.exports = { buildPrompt() { return f(); } };", /unavailable workflow global process/]
  ]) {
    const root = fixtures(t, { 'parser.js': body });
    assert.throws(function () { buildParserBundle(fileRegistry(root)); }, expected);
  }
});

test('B05 AST scope analysis preserves local bindings named process and require', function (t) {
  const root = fixtures(t, {
    'parser.js': [
      "const process = { platform: 'LOCAL' };",
      "function use(require) { return require('bound'); }",
      "module.exports = { buildPrompt() { return process.platform + ':' + use(value => value.toUpperCase()); } };"
    ].join('\n')
  });
  assert.equal(vm.runInNewContext(buildParserBundle(fileRegistry(root)) + '\n__parsers.podcast.buildPrompt();'), 'LOCAL:BOUND');
});

test('B05 generated import bindings cannot collide with helper constants', function (t) {
  const root = fixtures(t, {
    'parser.js': "const __drsLocalImport = 'LOCAL:'; const helper = require /* comment */ ('./helper'); module.exports = { buildPrompt() { return __drsLocalImport + helper.prefix; } };",
    'helper.js': "exports.prefix = 'HELPER';"
  });
  assert.equal(vm.runInNewContext(buildParserBundle(fileRegistry(root)) + '\n__parsers.podcast.buildPrompt();'), 'LOCAL:HELPER');
});

test('B05 programmatic standalone functions, arrows and method shorthand remain compatible', function () {
  const registry = { parsers: {
    normal: { buildPrompt: function (input) { return 'normal:' + input; } },
    arrow: { buildPrompt: input => 'arrow:' + input },
    method: { prefix: 'method:', buildPrompt(input) { return this.prefix + input; } }
  } };
  const context = vm.createContext({});
  vm.runInContext(buildParserBundle(registry), context);
  for (const name of ['normal', 'arrow', 'method']) {
    assert.equal(vm.runInContext('__parsers.' + name + ".buildPrompt('value')", context), name + ':value');
  }
});

test('B05 registry validates parser shape and retains the source for aliases', function () {
  const registry = new ParserRegistry();
  const parser = { name: 'podcast', types: ['podcast', 'audio'], buildPrompt() { return 'x'; } };
  registry.register(parser, __filename);
  assert.equal(registry.resolve('audio'), parser);
  assert.equal(registry.sourceFor(parser), __filename);
  parser.buildPrompt = function () { return 'replacement'; };
  assert.equal(registry.sourceFor(parser), undefined, 'runtime overrides must not silently reuse the original module');
  assert.throws(function () { registry.register({ name: 'bad', buildPrompt: 'not a function' }); }, /buildPrompt/);
  assert.throws(function () { registry.register({ name: 'bad', types: 'bad', buildPrompt() {} }); }, /types/);
});
