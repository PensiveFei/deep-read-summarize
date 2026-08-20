// ============================================================================
// deep-read-summarize — DSH plugin entry
// ============================================================================
// 导出 workflow (meta + script) 和解析器注册表，供 dsh 加载器识别。
// 安装方式（dsh profile 目录）: pnpm add ./xxx.tgz → dsh.profile.bundles 追加
// ============================================================================

const workflow = require('./workflow');
const parsers = require('./parsers');
const schemas = require('./schemas');

/**
 * 插件主入口：返回 dsh 可加载的插件定义
 * - name: 插件名（对应 cordis.patch.yml 的 id）
 * - meta: workflow 元信息（name/description/whenToUse/phases）
 * - script: workflow 脚本（供 workflow 工具执行）
 * - parsers: 解析器注册表（resolve/list）
 * - schemas: JSON Schema 约束
 */
function load() {
  return {
    name: 'deep-read-summarize',
    workflow: workflow,
    parsers: parsers,
    schemas: schemas
  };
}

module.exports = { load, workflow, parsers, schemas };

// 兼容直接 require：插件系统可能直接读取 exports
module.exports.default = load;