// ============================================================================
// Parser plugin: book (PDF/EPUB/MOBI text extraction & chunking)
// ============================================================================
// 独立解析器插件：处理书籍输入。fork 后替换此文件即可支持自定义格式。
// 接口约定：module.exports = { name, types, buildPrompt(input, opts) }
// ============================================================================

module.exports = {
  name: "book",
  types: ["book"],
  description: "书籍/长篇著作解析器（PDF/EPUB/MOBI → 文本 → 逻辑分块）",

  // 构建「获取+分块」提示词
  buildPrompt: function (input, opts) {
    const tempDir = opts.tempDir || "./_deepread_temp";
    const tempFile = tempDir + "\\input.txt";
    const maxChunks = opts.maxChunks || 6;
    return [
      "你的任务：获取书籍全文并保存为纯文本，然后给出分块计划。",
      "内容类型：书籍（book）",
      "输入来源：" + input,
      "目标文件：" + tempFile + "（先创建目录 " + tempDir + "，用 write 工具写入）",
      "步骤：",
      "1. 获取全文：PDF→用 read 或 pwsh 调 pdftotext（若为扫描版报告需 OCR）；EPUB/MOBI→解包或转文本；纯文本→直接读取。",
      "2. 全文写入目标文件（不截断、不加评注），用 read 确认总行数。",
      "3. 识别书籍结构：目录/序言/各章节标题及其行号范围。",
      "4. 分块：按章节（或章节内小节）切分，每块约 100-200 行或 4000-6000 字，块数不超过 " + maxChunks + " 块；每块给 id/topic/startLine/endLine。",
      "输出 JSON：",
      '{ "kind": "book", "saved": true, "totalLines": N, "metadata": { "title": "", "author": "", "year": "", "language": "zh|en" }, "chunkPlan": [ { "id": 1, "topic": "章节主题", "startLine": 1, "endLine": 200 } ] }',
      "若无法获取文本输出 { \"saved\": false, \"message\": \"原因\" }。只输出 JSON。"
    ].join("\n");
  }
};
