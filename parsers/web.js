// ============================================================================
// Parser plugin: web (generic web page / article)
// ============================================================================
// 独立解析器插件：处理网页/文章输入（通用 fallback）。
// 提示词骨架复用 parsers/_prompt.js（去重），此处只提供差异化配置。
// ============================================================================

const prompt = require("./_prompt");

module.exports = {
  name: "web",
  types: ["web"],
  description: "网页/文章解析器（正文提取 → 分块）",

  buildPrompt: function (input, opts) {
    return prompt.buildFetchPrompt({
      input: input,
      opts: opts,
      fetchTarget: "网页/文章正文",
      kindLabel: "网页/文章（web）",
      steps: [
        "访问链接获取正文文本（去除导航、广告、页脚等噪音），或直接读取本地文本文件。",
        "正文写入目标文件（不截断、不加评注），用 read 确认总行数。"
      ],
      chunkRule: "逻辑主题",
      jsonExample: '{ "kind": "web", "saved": true, "totalLines": N, "metadata": { "title": "", "author": "", "year": "", "language": "zh|en" }, "chunkPlan": [ { "id": 1, "topic": "主题", "startLine": 1, "endLine": 200 } ] }'
    });
  }
};
