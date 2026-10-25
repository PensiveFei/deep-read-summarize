// ============================================================================
// deep-read-summarize — DSH plugin entry
// ============================================================================
// 标准 Cordis 插件（DSH 0.1.x / 0.2.x 契约，已在 0.2.0-rc.2 实测）：导出 name + inject + apply(ctx, config)。
// apply() 将插件自带的 SKILL.md 注册为运行时技能，并把 workflow 的
// meta + 自包含 script + args 示例嵌入技能内容，使模型可直接用 workflow
// 工具执行精读流程。
//
// config：插件级默认 options（cordis.patch.yml 的 config 段）。此前 apply()
// 收了 config 却从不读它——配置文件里写的那些键全是空转。现在这些键会被
// 校验、合并进技能里的 args 示例，成为该 profile 的默认值。
//
// 同时保留 load / workflow / parsers / schemas 导出，兼容旧式加载读取。
// 安装方式（dsh profile 目录）: pnpm add ./xxx.tgz → dsh.profile.bundles 追加
// ============================================================================

const { readFileSync } = require('node:fs');
const path = require('node:path');

const workflow = require('./workflow');
const parsers = require('./parsers');
const schemas = require('./schemas');
const { DEFAULT_OPTIONS, normalizeWorkflowOptions } = require('./lib/options');

module.exports.name = 'deep-read-summarize';
module.exports.inject = ['skills'];

/**
 * 归一化插件 config：只认白名单里的键，类型不符就告警并忽略（不抛错，
 * 免得一个拼错的配置项把整个 profile 拖死）。
 * 支持 `config: { outputDir: ... }` 与 `config: { options: { outputDir: ... } }` 两种写法。
 */
function normalizeOptions(config) {
  let raw = config && Object.prototype.hasOwnProperty.call(config, 'options') ? config.options : config;
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw === config) {
    raw = Object.assign({}, raw);
    delete raw.customParsersDir; // plugin-only executable extension directory
  }
  return normalizeWorkflowOptions(raw, { mode: 'config', warn: function (message) { console.warn(message); } });
}

function configuredRegistry(config) {
  if (!config || !Object.prototype.hasOwnProperty.call(config, 'customParsersDir')) return parsers.registry;
  const dir = config.customParsersDir;
  if (typeof dir !== 'string' || !dir.trim() || /[\u0000\r\n]/.test(dir)) {
    console.warn('[deep-read-summarize] ignoring config.customParsersDir — expected a non-empty directory path');
    return parsers.registry;
  }
  return new parsers.ParserRegistry({ customParsersDir: dir });
}

/** 组装技能内容：SKILL.md + workflow meta/script/args 示例（script 为自包含版本）。 */
function buildSkillContent(config = {}, runtime = {}) {
  const skillDir = path.join(__dirname, 'skills', 'deep-read-summarize');
  const body = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  const argsExample = {
    input: '<链接或本地路径>',
    type: 'auto',
    options: normalizeOptions(config)
  };
  if (runtime.toolName) {
    return [body.trim(), '', '## 调用精读工具',
      '调用 `' + runtime.toolName + '`，只提交 input / type / options。工具返回完整 note 与建议 filePath；必须按上文执行同名文件询问、落盘和质量报告。',
      'args 示例（options 是本 profile 的默认值，用户另有要求时再覆盖）：',
      '```json', JSON.stringify(argsExample, null, 2), '```'].join('\n');
  }
  return [
    body.trim(),
    '',
    '## 使用 workflow 工具执行',
    '当用户给出书籍/论文/视频/网页并要求深度精读时，调用 `workflow` 工具，按下面的 meta + script + args 提交。',
    '',
    'meta：',
    '```json',
    JSON.stringify(workflow.meta, null, 2),
    '```',
    '',
    'script（完整脚本，原样填入 script 参数；脚本已自包含解析器，无需宿主注入）：',
    '```javascript',
    workflow.buildSelfContainedScript(runtime.registry || configuredRegistry(config)),
    '```',
    '',
    'args 示例（options 是本 profile 的默认值，用户另有要求时再覆盖）：',
    '```json',
    JSON.stringify(argsExample, null, 2),
    '```'
  ].join('\n');
}

// This is the public DSH WorkflowEngine.start / ToolDefinition contract used
// by dsh-tool-workflow itself. Optional services keep older profiles working.
function optionalService(ctx, name) {
  if (typeof ctx.get === 'function') return ctx.get(name);
  return ctx[name];
}

function readingTool(engine, defaults, registry) {
  return {
    name: 'deep_read_summarize',
    description: '深度精读书籍、论文、视频或网页，返回完整 Markdown 笔记、建议保存路径及原文质量核验结果。拿到结果后必须检查同名文件并保存 note；质量未通过或有内容缺口时必须报告。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        input: { type: 'string', description: '内容链接或本地文件路径' },
        type: { type: 'string', description: 'auto 或已注册的解析器类型，默认 auto' },
        options: { type: 'object', additionalProperties: true, description: '覆盖当前 profile 的精读选项' }
      }, required: ['input']
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      // Never clip the note: the main agent needs its complete value to save it.
      render: function (args, value) { return [{ type: 'text', text: JSON.stringify(value) }]; }
    },
    async execute(args, exec) {
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('[FATAL] expected an input object');
      if (Object.keys(args).some(function (key) { return ['input', 'type', 'options'].indexOf(key) < 0; })) throw new Error('[FATAL] unknown deep_read_summarize argument');
      if (typeof args.input !== 'string' || !args.input.trim()) throw new Error('[FATAL] args.input 必须是非空字符串');
      if (args.type !== undefined && typeof args.type !== 'string') throw new Error('[FATAL] args.type 必须是字符串');
      if (args.options !== undefined && (!args.options || typeof args.options !== 'object' || Array.isArray(args.options))) throw new Error('[FATAL] options 必须是对象');
      const options = normalizeWorkflowOptions(Object.assign({}, defaults, args.options));
      if (!exec || !exec.agent) throw new Error('deep_read_summarize requires a calling agent');
      if (exec.signal && exec.signal.aborted) throw new Error('deep_read_summarize was cancelled before start');
      const run = engine.start({ script: workflow.buildSelfContainedScript(registry), meta: workflow.meta,
        args: { input: args.input, type: args.type || 'auto', options: options }, parent: exec.agent, signal: exec.signal });
      try {
        const result = await run.result;
        if (result.stopReason !== 'completed') throw new Error('deep_read_summarize ' + result.stopReason + ': ' + (result.error || 'workflow did not complete'));
        if (!result.value || typeof result.value !== 'object' || Array.isArray(result.value)) throw new Error('deep_read_summarize returned an invalid workflow result');
        return result.value;
      } finally { await run.dispose(); }
    }
  };
}

function skillDefinition(config, runtime) {
  const skillDir = path.join(__dirname, 'skills', 'deep-read-summarize');
  return {
    name: 'deep-read-summarize',
    description: workflow.meta.description,
    whenToUse: workflow.meta.whenToUse,
    content: buildSkillContent(config, runtime),
    resourceBase: { kind: 'directory', path: skillDir },
    source: 'bundled'
  };
}

// Cordis inject() owns a child fiber which activates/restarts as these optional
// services appear/disappear. Keep a fallback skill while that child is pending.
function applyWithServiceLifecycle(ctx, config, registry) {
  let stopped = false;
  let releaseSkill = ctx.skills.register(skillDefinition(config, { registry: registry }));
  function replaceSkill(toolName) {
    if (typeof releaseSkill === 'function') releaseSkill();
    releaseSkill = undefined;
    releaseSkill = ctx.skills.register(skillDefinition(config, { registry: registry, toolName: toolName }));
  }
  function parentCanRegister() {
    // Public Cordis FiberState: LOADING=1, ACTIVE=2; never restore while unloading.
    return !stopped && (!ctx.fiber || ctx.fiber.state === 1 || ctx.fiber.state === 2);
  }
  // Cordis treats callbacks with a prototype as constructors. An arrow keeps
  // the returned cleanup function in its effect lifecycle.
  const child = ctx.inject(['tools', 'workflowEngine'], (ready) => {
    const tools = optionalService(ready, 'tools');
    const engine = optionalService(ready, 'workflowEngine');
    const releaseTool = tools.register(readingTool(engine, normalizeOptions(config), registry));
    try { replaceSkill('deep_read_summarize'); }
    catch (error) {
      if (typeof releaseTool === 'function') releaseTool();
      if (parentCanRegister()) replaceSkill();
      throw error;
    }
    return function () {
      try {
        if (typeof releaseSkill === 'function') releaseSkill();
        releaseSkill = undefined;
      } finally {
        if (typeof releaseTool === 'function') releaseTool();
        if (parentCanRegister()) replaceSkill();
      }
    };
  });
  return async function () {
    stopped = true;
    try { if (child && typeof child.dispose === 'function') await child.dispose(); }
    finally {
      if (typeof releaseSkill === 'function') releaseSkill();
      releaseSkill = undefined;
    }
  };
}

/** Cordis 插件入口：注册运行时技能，使模型可直接执行精读 workflow。 */
const apply = (ctx, config = {}) => {
  const registry = configuredRegistry(config);
  if (typeof ctx.inject === 'function') return applyWithServiceLifecycle(ctx, config, registry);
  const tools = optionalService(ctx, 'tools');
  const engine = optionalService(ctx, 'workflowEngine');
  const canRunDirectly = tools && typeof tools.register === 'function' && engine && typeof engine.start === 'function';
  const unregisterTool = canRunDirectly ? tools.register(readingTool(engine, normalizeOptions(config), registry)) : undefined;
  let unregisterSkill;
  try { unregisterSkill = ctx.skills.register(skillDefinition(config, {
    registry: registry, toolName: canRunDirectly ? 'deep_read_summarize' : undefined
  })); } catch (error) {
    if (typeof unregisterTool === 'function') unregisterTool();
    throw error;
  }
  if (!canRunDirectly) return unregisterSkill;
  return function () {
    try { if (typeof unregisterSkill === 'function') unregisterSkill(); }
    finally { if (typeof unregisterTool === 'function') unregisterTool(); }
  };
};

// 兼容旧式加载（部分工具按 load() 读取插件定义）
function load() {
  return { name: 'deep-read-summarize', workflow, parsers, schemas };
}

module.exports.apply = apply;
module.exports.load = load;
module.exports.workflow = workflow;
module.exports.parsers = parsers;
module.exports.schemas = schemas;
module.exports.buildSkillContent = buildSkillContent;
module.exports.DEFAULT_OPTIONS = DEFAULT_OPTIONS;
module.exports.normalizeOptions = normalizeOptions;
module.exports.normalizeWorkflowOptions = normalizeWorkflowOptions;
