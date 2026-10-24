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
  const raw = config && Object.prototype.hasOwnProperty.call(config, 'options') ? config.options : config;
  return normalizeWorkflowOptions(raw, { mode: 'config', warn: function (message) { console.warn(message); } });
}

/** 组装技能内容：SKILL.md + workflow meta/script/args 示例（script 为自包含版本）。 */
function buildSkillContent(config = {}) {
  const skillDir = path.join(__dirname, 'skills', 'deep-read-summarize');
  const body = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  const argsExample = {
    input: '<链接或本地路径>',
    type: 'auto',
    options: normalizeOptions(config)
  };
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
    workflow.script,
    '```',
    '',
    'args 示例（options 是本 profile 的默认值，用户另有要求时再覆盖）：',
    '```json',
    JSON.stringify(argsExample, null, 2),
    '```'
  ].join('\n');
}

/** Cordis 插件入口：注册运行时技能，使模型可直接执行精读 workflow。 */
function apply(ctx, config = {}) {
  const skillDir = path.join(__dirname, 'skills', 'deep-read-summarize');
  return ctx.skills.register({
    name: 'deep-read-summarize',
    description: workflow.meta.description,
    whenToUse: workflow.meta.whenToUse,
    content: buildSkillContent(config),
    resourceBase: { kind: 'directory', path: skillDir },
    // source 是技能的「来源桶」（runtime / bundled / user-dsh …），不是自由描述：
    // 本技能随插件包分发，因此登记为 bundled。
    source: 'bundled'
  });
}

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
