// ============================================================================
// deep-read-summarize — DSH plugin entry
// ============================================================================
// 标准 Cordis 插件（DSH 0.1.x 契约，已在 0.1.2-rc.1 实测）：导出 name + inject + apply(ctx)。
// apply() 将插件自带的 SKILL.md 注册为运行时技能，并把 workflow 的
// meta + 自包含 script + args 示例嵌入技能内容，使模型可直接用 workflow
// 工具执行精读流程。
//
// 同时保留 load / workflow / parsers / schemas 导出，兼容旧式加载读取。
// 安装方式（dsh profile 目录）: pnpm add ./xxx.tgz → dsh.profile.bundles 追加
// ============================================================================

const { readFileSync } = require('node:fs');
const path = require('node:path');

const workflow = require('./workflow');
const parsers = require('./parsers');
const schemas = require('./schemas');

module.exports.name = 'deep-read-summarize';
module.exports.inject = ['skills'];

/** 组装技能内容：SKILL.md + workflow meta/script/args 示例（script 为自包含版本）。 */
function buildSkillContent() {
  const skillDir = path.join(__dirname, 'skills', 'deep-read-summarize');
  const body = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
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
    'script（完整脚本，原样填入 script 参数；脚本已自包含四个解析器，无需宿主注入）：',
    '```javascript',
    workflow.script,
    '```',
    '',
    'args 示例：',
    '```json',
    '{ "input": "<链接或本地路径>", "type": "auto", "options": { "minWords": 2500, "fastMode": false, "maxChunks": 6, "requireCitations": true, "includeTimestamps": false, "outputDir": "./output", "tempDir": "./.tmp" } }',
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
    content: buildSkillContent(),
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
