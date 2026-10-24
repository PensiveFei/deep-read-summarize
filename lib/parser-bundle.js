'use strict';

const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');

// Acorn handles the regexp/division, template and modern syntax boundaries.
// The two-pass scope walk distinguishes free host APIs from local bindings and
// property names. Only literal relative CommonJS imports are bundled.
function analyze(source, filename) {
  const comments = [];
  let tree;
  try { tree = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'commonjs', onComment: comments }); }
  catch (error) { throw new Error('[FATAL] cannot parse parser module ' + filename + ': ' + error.message); }
  const nodes = [];
  const scopes = new WeakMap();
  const bindings = new WeakSet();
  const identifiers = new Set();
  function scope(parent, kind) { return { parent, kind, names: new Set() }; }
  function children(node, visit) {
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof child.type === 'string') visit(child, node, key);
      } else if (value && typeof value.type === 'string') visit(value, node, key);
    }
  }
  function bind(pattern, target) {
    if (!pattern) return;
    if (pattern.type === 'Identifier') { target.names.add(pattern.name); bindings.add(pattern); }
    else if (pattern.type === 'RestElement') bind(pattern.argument, target);
    else if (pattern.type === 'AssignmentPattern') bind(pattern.left, target);
    else if (pattern.type === 'ArrayPattern') pattern.elements.forEach(item => bind(item, target));
    else if (pattern.type === 'ObjectPattern') pattern.properties.forEach(item => bind(item.type === 'RestElement' ? item.argument : item.value, target));
  }
  function collect(node, active, parent, key) {
    if (/^Function/.test(node.type) || node.type === 'ArrowFunctionExpression') {
      if (node.type === 'FunctionDeclaration') bind(node.id, active);
      const parameters = scope(active, 'parameters');
      bind(node.id, parameters);
      node.params.forEach(param => bind(param, parameters));
      scopes.set(node, parameters);
      nodes.push({ node, parent, key });
      node.params.forEach(param => collect(param, parameters, node, 'params'));
      if (node.id) collect(node.id, parameters, node, 'id');
      collect(node.body, scope(parameters, 'function'), node, 'body');
      return;
    }
    if (node.type === 'ClassDeclaration') bind(node.id, active);
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      active = scope(active, 'block'); bind(node.id, active);
    } else if (['BlockStatement', 'CatchClause', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement'].indexOf(node.type) >= 0) {
      active = scope(active, 'block');
    } else if (node.type === 'StaticBlock') active = scope(active, 'function');
    if (node.type === 'CatchClause') bind(node.param, active);
    if (node.type === 'VariableDeclaration') {
      let target = active;
      if (node.kind === 'var') while (target.parent && target.kind !== 'function' && target.kind !== 'program') target = target.parent;
      node.declarations.forEach(declaration => bind(declaration.id, target));
    }
    scopes.set(node, active);
    if (node.type === 'Identifier') identifiers.add(node.name);
    nodes.push({ node, parent, key });
    children(node, (child, owner, field) => collect(child, active, owner, field));
  }
  collect(tree, scope(null, 'program'), null, '');
  function bound(node) {
    for (let current = scopes.get(node); current; current = current.parent) if (current.names.has(node.name)) return true;
    return false;
  }
  function reference(item) {
    const { node, parent, key } = item;
    if (node.type !== 'Identifier' || bindings.has(node)) return false;
    if (!parent) return true;
    if ((parent.type === 'MemberExpression' && key === 'property' && !parent.computed) ||
        (['Property', 'MethodDefinition', 'PropertyDefinition'].indexOf(parent.type) >= 0 && key === 'key' && !parent.computed) ||
        (['LabeledStatement', 'BreakStatement', 'ContinueStatement'].indexOf(parent.type) >= 0 && key === 'label')) return false;
    return true;
  }
  return { nodes, comments, identifiers, bound, reference };
}

function standaloneParserSource(parser, name) {
  let fn = Function.prototype.toString.call(parser.buildPrompt);
  // Method shorthand is valid inside an object, but not after a property colon.
  if (!/^(?:async\s+)?function\b/.test(fn) && /^(?:async\s+)?[\w$]+\s*\(/.test(fn)) {
    fn = fn.replace(/^(async\s+)?/, function (_, asyncPrefix) { return (asyncPrefix || '') + 'function '; });
  }
  try { new Function('return (' + fn + ');'); }
  catch (error) { throw new Error('[FATAL] cannot serialize parser ' + name + ': ' + error.message); }
  const data = Object.create(null);
  for (const key of Object.keys(parser)) {
    if (typeof parser[key] !== 'function' && parser[key] !== undefined) data[key] = parser[key];
  }
  const fields = JSON.stringify(data).slice(1, -1);
  return '{ buildPrompt: ' + fn + (fields ? ', ' + fields : '') + ' }';
}

/** Bundle local CommonJS modules while retaining each module's lexical scope. */
function buildParserBundle(registry) {
  const modules = [];
  const ids = new Map();
  function addModule(filename) {
    const resolved = fs.realpathSync(filename);
    if (ids.has(resolved)) return ids.get(resolved);
    const id = 'm' + modules.length;
    ids.set(resolved, id);
    const entry = { id, code: '', importName: '__drsLocalImport' };
    modules.push(entry); // reserve before recursion, so CommonJS cycles work
    const ext = path.extname(resolved).toLowerCase();
    if (ext === '.json') {
      const json = JSON.parse(fs.readFileSync(resolved, 'utf8').replace(/^\uFEFF/, ''));
      entry.code = 'module.exports = JSON.parse(' + JSON.stringify(JSON.stringify(json)) + ');';
      return id;
    }
    if (ext !== '.js' && ext !== '.cjs') throw new Error('[FATAL] parser module must be local CommonJS (.js/.cjs/.json): ' + resolved);
    const source = fs.readFileSync(resolved, 'utf8').replace(/^\uFEFF/, '').replace(/^#![^\n]*/, '');
    const scanned = analyze(source, resolved);
    while (scanned.identifiers.has(entry.importName)) entry.importName += '_';
    const edits = scanned.comments.map(function (comment) {
      return { start: comment.start, end: comment.end, text: source.slice(comment.start, comment.end).replace(/[^\n]/g, ' ') };
    });
    const unavailable = ['process', 'Buffer', '__dirname', '__filename', 'global'];
    for (const item of scanned.nodes) {
      const current = item.node;
      if (current.type === 'ImportExpression' || current.type === 'WithStatement') {
        throw new Error('[FATAL] ' + (current.type === 'ImportExpression' ? 'dynamic import is unavailable' : 'with scopes are unsupported') + ' in parser bundle: ' + resolved);
      }
      if (current.type === 'MemberExpression' && current.object.type === 'Identifier' && !scanned.bound(current.object)) {
        const owner = current.object.name;
        const member = !current.computed && current.property.type === 'Identifier' ? current.property.name :
          (current.computed && current.property.type === 'Literal' ? current.property.value : undefined);
        if ((owner === 'globalThis' && (member === undefined || unavailable.indexOf(member) >= 0 || member === 'require')) ||
            (owner === 'module' && member === 'require')) {
          throw new Error('[FATAL] unavailable workflow API ' + owner + '.' + (member === undefined ? '<dynamic>' : member) + ' in parser module: ' + resolved);
        }
      }
      if (!scanned.reference(item) || scanned.bound(current)) continue;
      if (unavailable.indexOf(current.name) >= 0) {
        throw new Error('[FATAL] parser module uses unavailable workflow global ' + current.name + ': ' + resolved);
      }
      if (current.name === 'eval' || current.name === 'Function') {
        throw new Error('[FATAL] dynamic code generation is unsupported in parser bundle: ' + resolved);
      }
      if (current.name === 'globalThis' && (!item.parent || item.parent.type !== 'MemberExpression' || item.key !== 'object')) {
        throw new Error('[FATAL] aliases of host globals are unsupported in parser bundle: ' + resolved);
      }
      if (current.name !== 'require') continue;
      const call = item.parent;
      const request = call && call.type === 'CallExpression' && item.key === 'callee' && !call.optional && call.arguments.length === 1 ? call.arguments[0] : null;
      if (!request || request.type !== 'Literal' || typeof request.value !== 'string') {
        throw new Error('[FATAL] parser imports must use require with a literal local path: ' + resolved);
      }
      const specifier = request.value;
      if (!/^\.\.?[\\/]/.test(specifier)) {
        throw new Error('[FATAL] unsupported parser dependency ' + JSON.stringify(specifier) + ' in ' + resolved + '; workflow bundles accept relative local modules only');
      }
      let dependency;
      try { dependency = require.resolve(path.resolve(path.dirname(resolved), specifier)); }
      catch (error) { throw new Error('[FATAL] cannot resolve parser dependency ' + specifier + ' in ' + resolved + ': ' + error.message); }
      edits.push({ start: call.start, end: call.end, text: entry.importName + '(' + JSON.stringify(addModule(dependency)) + ')' });
    }
    edits.sort(function (a, b) { return b.start - a.start; });
    let rewritten = source;
    for (const edit of edits) rewritten = rewritten.slice(0, edit.start) + edit.text + rewritten.slice(edit.end);
    try { new Function('module', 'exports', entry.importName, rewritten); }
    catch (error) { throw new Error('[FATAL] cannot compile parser module ' + resolved + ': ' + error.message); }
    entry.code = rewritten;
    return id;
  }
  const parserEntries = Object.keys(registry.parsers).map(function (name) {
    const parser = registry.parsers[name];
    if (!parser || typeof parser.buildPrompt !== 'function') throw new Error('[FATAL] parser ' + name + ' must expose buildPrompt(input, options)');
    const filename = typeof registry.sourceFor === 'function' ? registry.sourceFor(parser) : undefined;
    const source = filename
      ? '{ buildPrompt: function (input, options) { return __bundleLoad(' + JSON.stringify(addModule(filename)) + ').buildPrompt(input, options); } }'
      : standaloneParserSource(parser, name);
    return '  ' + (name === '__proto__' ? '[' + JSON.stringify(name) + ']' : JSON.stringify(name)) + ': ' + source;
  });
  return [
    'const __bundleFactories = {',
    modules.map(function (entry) { return JSON.stringify(entry.id) + ': function (module, exports, ' + entry.importName + ') {\n' + entry.code + '\n}'; }).join(',\n'),
    '};',
    'const __bundleCache = Object.create(null);',
    'function __bundleLoad(id) {',
    '  if (__bundleCache[id]) return __bundleCache[id].exports;',
    '  const module = { exports: {} };',
    '  __bundleCache[id] = module;',
    '  try { __bundleFactories[id].call(module.exports, module, module.exports, __bundleLoad); }',
    '  catch (error) { delete __bundleCache[id]; throw error; }',
    '  return module.exports;',
    '}',
    'const __parsers = {', parserEntries.join(',\n'), '};'
  ].join('\n');
}

module.exports = { buildParserBundle };
