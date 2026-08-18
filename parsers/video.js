// ============================================================================
// Parser plugin: video (YouTube/Bilibili subtitles & transcripts)
// ============================================================================
// 独立解析器插件：处理视频输入。优先 yt-dlp 自动抓字幕，失败降级人工转写。
// ============================================================================

module.exports = {
  name: "video",
  types: ["video"],
  description: "视频解析器（YouTube/B站/播客 → 字幕 → 文本）",

  buildPrompt: function (input, opts) {
    const tempDir = opts.tempDir || "./.tmp";
    const tempFile = tempDir + "\\input.txt";
    const maxChunks = opts.maxChunks || 6;
    return [
      "你的任务：获取视频字幕/转写并保存为纯文本，然后给出分块计划。",
      "内容类型：视频（video）",
      "输入来源：" + input,
      "目标文件：" + tempFile + "（先创建目录 " + tempDir + "，用 write 工具写入）",
      "步骤：",
      "1. 用 pwsh 运行 yt-dlp 抓字幕，命令示例：",
      "    yt-dlp --skip-download --write-auto-sub --write-subs --sub-langs 'zh,en' --sub-format vtt/srt -o '" + tempDir + "/sub.%(ext)s' <URL>",
      "2. 读取字幕文件（vtt/srt），去除时间戳与 HTML 标签，转为纯文本写入目标文件。",
      "3. 若 yt-dlp 不可用或抓取失败：输出 { \"saved\": false, \"message\": \"需要人工提供转写文本\" }。",
      "4. 分块：按主题脉络（而非时间）切分，每块约 100-200 行或 4000-6000 字，块数不超过 " + maxChunks + " 块；每块给 id/topic/startLine/endLine。",
      "输出 JSON：",
      '{ "kind": "video", "saved": true, "totalLines": N, "metadata": { "title": "", "author": "", "year": "", "language": "zh|en" }, "chunkPlan": [ { "id": 1, "topic": "主题段", "startLine": 1, "endLine": 200 } ] }',
      "若无法获取文本输出 { \"saved\": false, \"message\": \"原因\" }。只输出 JSON。"
    ].join("\n");
  }
};