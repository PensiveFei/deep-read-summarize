// ============================================================================
// parsers/_prompt.js — 共享「获取+分块」提示词模板（内部模块）
// ============================================================================
// 四个内置解析器共用同一提示词骨架，各自只提供差异化配置：
//   - label/kindLabel：类型名称（中文 / 中英混合）
//   - steps：获取文本的具体步骤（不含分块步骤，模板自动编号）
//   - chunkRule：分块规则描述
//   - jsonExample：输出 JSON 示例（含 kind 字段）
// 保持各解析器 buildPrompt(input, opts) 插件接口不变；fork 时仍可整体重写。
// ============================================================================

/**
 * 构建「获取+分块」提示词。
 * @param {object} cfg
 * @param {string} cfg.input 输入（URL 或本地路径）
 * @param {object} [cfg.opts] 选项（tempDir/tempFile/maxChunks）
 * @param {string} cfg.fetchTarget 获取对象描述（如「书籍全文」「视频字幕/转写」）
 * @param {string} cfg.kindLabel 内容类型描述（如「书籍（book）」）
 * @param {string[]} cfg.steps 获取步骤（不含分块步骤；模板统一编号并追加分块步骤）
 * @param {string} cfg.chunkRule 分块规则（如「章节（或章节内小节）」）
 * @param {string} cfg.jsonExample 输出 JSON 示例
 * @returns {string} 完整提示词
 */
function buildFetchPrompt(cfg) {
  const opts = cfg.opts || {};
  const tempDir = opts.tempDir || "./.tmp";
  const tempFile = opts.tempFile || (tempDir.replace(/[\\/]+$/, "") + "/input.txt");
  const maxChunks = opts.maxChunks || 6;
  const steps = (cfg.steps || []).map(function (s, i) { return (i + 1) + ". " + s; });
  return [
    "你的任务：获取" + cfg.fetchTarget + "并保存为纯文本，然后给出分块计划。",
    "内容类型：" + cfg.kindLabel,
    "输入来源：" + cfg.input,
    "目标文件：" + tempFile + "（先创建目录 " + tempDir + "，用 write 工具写入）",
    "步骤："
  ].concat(steps, [
    (steps.length + 1) + ". 分块：按" + cfg.chunkRule + "切分，每块约 100-200 行或 4000-6000 字，块数不超过 " + maxChunks + " 块；每块给 id/topic/startLine/endLine。",
    "输出 JSON：",
    cfg.jsonExample,
    "若无法获取文本输出 { \"saved\": false, \"message\": \"原因\" }。只输出 JSON。"
  ]).join("\n");
}

module.exports = { buildFetchPrompt };
