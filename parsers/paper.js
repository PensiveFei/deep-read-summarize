// ============================================================================
// Parser plugin: paper (arXiv/PDF/HTML academic paper)
// ============================================================================
// 独立解析器插件：处理学术论文输入。fork 后替换此文件即可支持自定义来源。
// 提示词骨架复用 parsers/_prompt.js（去重），此处只提供差异化配置。
// ============================================================================

const prompt = require("./_prompt");

module.exports = {
  name: "paper",
  types: ["paper"],
  description: "学术论文解析器（arXiv/期刊/PDF/HTML）",

  buildPrompt: function (input, opts) {
    return prompt.buildFetchPrompt({
      input: input,
      opts: opts,
      fetchTarget: "论文全文",
      kindLabel: "学术论文（paper）",
      steps: [
        "获取全文：arXiv→访问 abs 页取 PDF/HTML 全文；PDF→read 或 pdftotext；HTML→提取正文（去导航/广告）。",
        "全文写入目标文件（不截断、不加评注），用 read 确认总行数。",
        "识别论文结构：Abstract/Introduction/Methods/Results/Discussion/Conclusion/Appendix 及各表图行号范围。"
      ],
      chunkRule: "论文章节",
      jsonExample: '{ "kind": "paper", "saved": true, "totalLines": N, "metadata": { "title": "", "author": "", "year": "", "language": "zh|en" }, "chunkPlan": [ { "id": 1, "topic": "Introduction", "startLine": 1, "endLine": 200 } ] }'
    });
  }
};
