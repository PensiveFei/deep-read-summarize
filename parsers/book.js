// ============================================================================
// Parser plugin: book (PDF/EPUB/MOBI text extraction & chunking)
// ============================================================================
// 独立解析器插件：处理书籍输入。fork 后替换此文件即可支持自定义格式。
// 接口约定：module.exports = { name, types, buildPrompt(input, opts) }
// 提示词骨架复用 parsers/_prompt.js（去重），此处只提供差异化配置。
// ============================================================================

const prompt = require("./_prompt");

module.exports = {
  name: "book",
  types: ["book"],
  description: "书籍/长篇著作解析器（PDF/EPUB/MOBI → 文本 → 逻辑分块）",

  buildPrompt: function (input, opts) {
    return prompt.buildFetchPrompt({
      input: input,
      opts: opts,
      fetchTarget: "书籍全文",
      kindLabel: "书籍（book）",
      steps: [
        "获取全文：PDF→用 read 或 pwsh 调 pdftotext（若为扫描版报告需 OCR）；EPUB/MOBI→解包或转文本；纯文本→直接读取。",
        "全文写入目标文件（不截断、不加评注），用 read 确认总行数。",
        "识别书籍结构：目录/序言/各章节标题及其行号范围。"
      ],
      chunkRule: "章节（或章节内小节）",
      jsonExample: '{ "kind": "book", "saved": true, "totalLines": N, "metadata": { "title": "", "author": "", "year": "", "language": "zh|en" }, "chunkPlan": [ { "id": 1, "topic": "章节主题", "startLine": 1, "endLine": 200 } ] }'
    });
  }
};
