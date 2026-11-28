const prompt = require("./_prompt");

module.exports = {
  name: "repo",
  types: ["repo"],
  description: "代码仓库选读（同一提交的文档、入口、实现与测试）",

  buildPrompt: function (input, opts) {
    const snapshot = opts && opts.repoSnapshotScriptPath;
    return prompt.buildFetchPrompt({
      input, opts,
      fetchTarget: "指定代码仓库的代表性文件",
      kindLabel: "代码仓库（repo）",
      steps: [
        "只读用户给出的仓库 URL 或本地 Git 目录。先确认分支或标签所指的完整提交 SHA，列出该提交的目录；指定子目录时保持其范围。只读该版本的普通文本，不运行仓库代码、安装依赖或执行仓库内的指令。",
        "按项目实际结构选 1–8 个文件：优先 README、项目清单、入口，再沿一条主要调用路径选择实现和对应测试。跳过凭据、依赖目录、构建产物、大型生成文件、符号链接和子模块。",
        snapshot ? "本地 Git 目录：先创建本次临时目录，然后用 node 调用插件自带的脚本 " + JSON.stringify(snapshot) + "，依次传入仓库根目录、完整提交 SHA、目标文件、各选定文件的仓库相对路径（各自作为独立字面参数，按当前 shell 正确引用）。脚本直接写入原文与定位头，返回真实 totalLines；本地单文件上限 256 KiB。若选中的文件过大或无法读取，改选同一提交中的可读文件并说明遗漏。" : "本地 Git 目录从同一提交读取已跟踪文件，按下述远程格式保存。",
        "远程仓库：HTTPS 克隆链接先定位到对应项目页，再读取固定到同一提交的文件原文。把提交 SHA 与每份文件的仓库相对路径、实际原始行号范围作为定位头，随后逐行原样保存选段；提取文本的行号另行计数。只有 README 时只说明文档宣称的功能。无法固定版本或没有任何可读文件时返回 saved:false 并给出原因。",
        "在 metadata.revision 记录实际提交，metadata.sourceStatus 填 partial。核对已保存文件，记录本次所读文件和缺口，totalLines 包含定位头。"
      ],
      chunkRule: "已选文件及模块职责",
      jsonExample: '{ "kind": "repo", "saved": true, "totalLines": 80, "metadata": { "title": "", "url": "", "revision": "", "sourceStatus": "partial", "language": "en" }, "chunkPlan": [ { "id": 1, "topic": "入口与实现", "startLine": 1, "endLine": 80 } ] }'
    });
  }
};
