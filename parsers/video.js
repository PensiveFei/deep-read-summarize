// ============================================================================
// Parser plugin: video (YouTube/Bilibili subtitles & transcripts)
// ============================================================================
// 独立解析器插件：处理视频输入。优先 yt-dlp 自动抓字幕，失败降级人工转写。
// 提示词骨架复用 parsers/_prompt.js（去重），此处只提供差异化配置。
// ============================================================================

const prompt = require("./_prompt");

module.exports = {
  name: "video",
  types: ["video"],
  description: "视频解析器（YouTube/B站/播客 → 字幕 → 文本）",

  buildPrompt: function (input, opts) {
    const tempDir = (opts && opts.tempDir) || "./.tmp";
    return prompt.buildFetchPrompt({
      input: input,
      opts: opts,
      fetchTarget: "视频字幕/转写",
      kindLabel: "视频（video）",
      steps: [
        "用 pwsh 运行 yt-dlp 抓字幕，命令示例：\n    yt-dlp --skip-download --write-auto-sub --write-subs --sub-langs 'zh,en' --sub-format vtt/srt -o '" + tempDir + "/sub.%(ext)s' <URL>",
        "读取字幕文件（vtt/srt），去除时间戳与 HTML 标签，转为纯文本写入目标文件。",
        "若 yt-dlp 不可用或抓取失败：输出 { \"saved\": false, \"message\": \"需要人工提供转写文本\" }。"
      ],
      chunkRule: "主题脉络（而非时间）",
      jsonExample: '{ "kind": "video", "saved": true, "totalLines": N, "metadata": { "title": "", "author": "", "year": "", "language": "zh|en" }, "chunkPlan": [ { "id": 1, "topic": "主题段", "startLine": 1, "endLine": 200 } ] }'
    });
  }
};
