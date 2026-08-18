# deep-read-summarize
> **Disclaimer**: This is an **unofficial third-party tool**. It is not affiliated with, endorsed by, or sponsored by DeepSeek or the DeepSeek Harness project. "DeepSeek" and "DeepSeek Harness" are trademarks of their respective owners. This project only orchestrates the workflow tool available in your DSH environment; it does not redistribute any DeepSeek software.

给 DSH（DeepSeek Harness）写的一个精读工作流：输入一本书、一篇论文、一个视频链接或网页，输出一份结构化的 Obsidian 笔记。

内容会被拆成若干块，由多个子代理并行精读，再合并成一篇带 YAML frontmatter 的 Markdown。关键结论附原文出处，成稿前有一道质量校验。

> 注意：DSH 目前是 developer preview，接口可能变化。本仓库针对特定版本的 workflow 工具语义编写，见下文[兼容性](#兼容性)。

---

## 能做什么

- 书籍（PDF/EPUB/MOBI）、论文（arXiv/PDF/HTML）、视频（YouTube/B 站字幕）、网页
- 长内容分块后由并行子代理精读，再合并
- 各子任务的输出用 JSON Schema 约束，不合格自动重试
- 关键引用必须标注页码/章节/段落，降低编造风险
- 配置错误直接报错终止；某块内容解析失败则跳过并标记缺口
- 输出可直接放进 Obsidian，配合 Dataview 使用

---

## 结构

```
输入（链接或文件路径）
  │
  ▼
解析器注册表 ── book / paper / video / web
  │
  ▼
波次1  获取内容 → 写入临时文件 → 生成分块计划
  │
  ▼
波次2  N 个子代理并行精读各块（Map）
  │
  ▼
波次3  合并成稿 + 质量校验（Reduce）
  │
  ▼
Obsidian 笔记
```

三个波次，子代理总数约 N+2 个，N 是分块数。

```
parsers/         各输入类型的解析器，按类型分发
  book.js        书籍：PDF/EPUB/MOBI 文本提取、章节分块
  paper.js       论文：arXiv/PDF/HTML 结构识别
  video.js       视频：yt-dlp 抓字幕、转写清洗
  web.js         网页：正文提取
  index.js       注册表：解析器发现与回退
schemas/         子任务输出的 JSON Schema
scripts/         lint、安全检查
tests/           fixture 测试与验证脚本
workflow.js      workflow 脚本本体（meta + script）
```

想换某个输入类型的处理方式，在 `custom-parsers/` 放一个同接口的解析器即可，同名类型会覆盖内置实现。接口只有三个字段：`name`、`types`、`buildPrompt(input, opts)`。

---

## 用法

把下面这段 JSON 传给 DSH 的 workflow 工具：

```jsonc
{
  "input": "https://arxiv.org/abs/2307.09042",  // 链接或文件路径
  "type": "auto",   // auto | book | paper | video | web
  "options": {
    "minWords": 2500,
    "fastMode": false,        // true 时跳过 5-7 节，速度快一些
    "maxChunks": 6,           // 分块上限，1-12
    "requireCitations": true, // 关键结论是否必须标注出处
    "includeTimestamps": false
  }
}
```

示例：

| 类型 | input |
|------|-------|
| 论文 | `https://arxiv.org/abs/2307.09042` |
| 书籍 | `~/books/xxx.pdf` |
| 视频 | `https://youtube.com/watch?v=xxx` |
| 网页 | `https://example.com/article` |

输出写到 `D:/Obsidian 仓库/PensiveFei/精读笔记/<标题>.md`，路径在 `workflow.js` 里可以改。

视频字幕需要本机装 yt-dlp（`winget install yt-dlp.yt-dlp`）。没装也不影响其他类型；抓不到字幕时工作流会提示你手动提供转写文本。

---

## 失败怎么处理

分两类：

- **配置错误**（缺 input、type 非法、options 格式错）：直接抛异常终止，不产出半成品。
- **内容问题**（抓取失败、某块精读失败）：返回 `{ ok: false, stage, fatal: false }`，由调用方决定。某一块失败时跳过它、在成稿里标注缺口，不整体中断。

---

## 成本

一篇论文、6 块、完整模式，大约 15-25k token。用 `fastMode` 并调低 `maxChunks` 能省四成左右。

---

## 安全与版权

- 抓取视频/网页会发起外部请求，由子代理在 DSH 的沙箱和审批策略下执行；不要让模型无人值守地跑任意脚本。
- 子代理写文件需要相应权限；如果权限不够，workflow 会把内容返回，由主代理负责落盘。
- 这个仓库只有流程本身：workflow 定义、解析器代码、提示词模板、schema。**不含任何受版权保护内容的提取结果。** 测试用的 fixture 是自写的公共领域寓言。用本工作流处理有版权的材料时，产出物的使用责任在你。

---

## 开发

```bash
npm install
npm run lint       # node --check 全部 JS
npm test           # fixture 测试
npm run validate   # 发布前验证（含安全检查）
```

改动说明见 CHANGELOG.md，贡献规范见 CONTRIBUTING.md。

---

## 兼容性

DSH 还在快速迭代，有过破坏性变更。本仓库的依赖面是：

- workflow 工具的 `agent()`、`parallel()`、`phase()`、`log()`、`args`
- JSON Schema 子集：`type / properties / required / additionalProperties / items / enum / const / oneOf`

升级 DSH 后先跑一遍 `npm test`。如果坏了，对照 CHANGELOG.md 里的版本记录排查。

---

## License

MIT，见 [LICENSE](LICENSE)。