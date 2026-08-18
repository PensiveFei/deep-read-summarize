// ============================================================================
// Parser plugin: web (generic web page / article)
// ============================================================================
// 独立解析器插件：处理网页/文章输入（通用 fallback）。
// ============================================================================

module.exports = {
  name: "web",
  types: ["web"],
  description: "网页/文章解析器（正文提取 → 分块）",

  buildPrompt: function (input, opts) {
    const tempDir = opts.tempDir || "./.tmp";
    const tempFile = tempDir + "\\input.txt";
    const maxChunks = opts.maxChunks || 6;
    return [
      "你的任务：获取网页/文章正文并保存为纯文本，然后给出分块计划。",
      "内容类型：网页/文章（web）",
      "输入来源：" + input,
      "目标文件：" + tempFile + "（先创建目录 " + tempDir + "，用 write 工具写入）",
      "步骤：",
      "1. 访问链接获取正文文本（去除导航、广告、页脚等噪音），或直接读取本地文本文件。",
      "2. 正文写入目标文件（不截断、不加评注），用 read 确认总行数。",
      "3. 分块：按逻辑主题切分，每块约 100-200 行或 4000-6000 字，块数不超过 " + maxChunks + " 块；每块给 id/topic/startLine/endLine。",
      "输出 JSON：",
      '{ "kind": "web", "saved": true, "totalLines": N, "metadata": { "title": "", "author": "", "year": "", "language": "zh|en" }, "chunkPlan": [ { "id": 1, "topic": "主题", "startLine": 1, "endLine": 200 } ] }',
      "若无法获取文本输出 { \"saved\": false, \"message\": \"原因\" }。只输出 JSON。"
    ].join("\n");
  }
};