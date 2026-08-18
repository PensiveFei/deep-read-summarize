// ============================================================================
// Parser plugin: paper (arXiv/PDF/HTML academic paper)
// ============================================================================
// 独立解析器插件：处理学术论文输入。fork 后替换此文件即可支持自定义来源。
// ============================================================================

module.exports = {
  name: "paper",
  types: ["paper"],
  description: "学术论文解析器（arXiv/期刊/PDF/HTML）",

  buildPrompt: function (input, opts) {
    const tempDir = opts.tempDir || "./.tmp";
    const tempFile = tempDir + "\\input.txt";
    const maxChunks = opts.maxChunks || 6;
    return [
      "你的任务：获取论文全文并保存为纯文本，然后给出分块计划。",
      "内容类型：学术论文（paper）",
      "输入来源：" + input,
      "目标文件：" + tempFile + "（先创建目录 " + tempDir + "，用 write 工具写入）",
      "步骤：",
      "1. 获取全文：arXiv→访问 abs 页取 PDF/HTML 全文；PDF→read 或 pdftotext；HTML→提取正文（去导航/广告）。",
      "2. 全文写入目标文件（不截断、不加评注），用 read 确认总行数。",
      "3. 识别论文结构：Abstract/Introduction/Methods/Results/Discussion/Conclusion/Appendix 及各表图行号范围。",
      "4. 分块：按论文章节切分，每块约 100-200 行或 4000-6000 字，块数不超过 " + maxChunks + " 块；每块给 id/topic/startLine/endLine。",
      "输出 JSON：",
      '{ "kind": "paper", "saved": true, "totalLines": N, "metadata": { "title": "", "author": "", "year": "", "language": "zh|en" }, "chunkPlan": [ { "id": 1, "topic": "Introduction", "startLine": 1, "endLine": 200 } ] }',
      "若无法获取文本输出 { \"saved\": false, \"message\": \"原因\" }。只输出 JSON。"
    ].join("\n");
  }
};