---
name: deep-read-summarize
description: 深度精读并总结书籍/学术论文/视频/网页，输出带 YAML frontmatter 的 Obsidian 笔记（2500+ 字，含术语表/批判分析/行动要点/延伸阅读）
whenToUse: 用户提供一本书、论文（arXiv/PDF）、视频链接（YouTube/B站）或网页，要求深度精读、提取要点、生成可存入 Obsidian 的精读笔记时
---

# deep-read-summarize — 深度精读与总结

把一本书、一篇论文、一个视频或网页，精读成一篇结构化的 Obsidian 笔记。

## 能力

- 书籍（PDF/EPUB/MOBI）、论文（arXiv/PDF/HTML）、视频（yt-dlp 字幕）、网页
- 长内容分块后由并行子代理精读（MapReduce），不溢出上下文
- JSON Schema 约束子任务输出，不合格自动重试
- 关键引用标注页码/章节/段落，降低编造风险
- 配置错误终止（FATAL）；内容解析失败降级标记缺口继续
- 输出带 YAML frontmatter（type 字段可配 Dataview）

## 输入

用户提供：内容链接或本地文件路径。
可选参数：`type`（auto/book/paper/video/web）、`options`（minWords/fastMode/maxChunks/requireCitations/includeTimestamps/outputDir）。

## 执行步骤

1. **配置校验**：缺 input 或 type 非法 → 报 FATAL 终止
2. **幂等检查**：若输入已处理过（args._processedKeys 命中）→ 直接返回缓存结果
3. **解析器选择**：按类型从 parsers 注册表选解析器（book/paper/video/web）
4. **波次1 获取+分块**：解析器获取全文 → 写入临时文件 → 生成分块计划（JSON Schema 校验）
5. **波次2 并行精读**：每个分块一个子代理深度精读（Map）
6. **波次3 合并成稿**：整合为完整笔记（Reduce），内嵌质量自检
7. **质量校验**：可选重试（maxRetries），检查覆盖度/引用真实性/术语一致/格式完整/篇幅/语言

## 输出

Markdown 笔记（默认写到 `./output/`，可用 `options.outputDir` 指向 Obsidian 仓库）

```markdown
---
title: "《XXX》深度精读笔记"
author: 作者
year: 年份
type: book | paper | video | web
url: 来源
tags: [精读, ...]
created: 日期
status: 已完成
---
# 《XXX》深度精读笔记
## 1. 概述
## 2. 结构拆解
## 3. 关键概念与术语表
## 4. 关键引用
## 5. 批判性分析
## 6. 个人思考与应用
## 7. 延伸阅读
```

## 视频说明

- **统一流水线（去三档）**：目标 = 拿到完整逐字稿再精读。
  1. **有平台字幕**（B站 AI 字幕 / YouTube CC / yt-dlp CC）→ 直接用字幕（=全文，最快、零依赖）。
  2. **无公开字幕** → 用插件自带转写（`scripts/transcribe.ps1`：faster-whisper small / int8 / VAD）得到全文。
  3. 都不行 → 降级提示用户手动提供转写文本，或退回 desc 作背景；**绝不阻塞、绝不自动装重依赖**。
- `options.transcribe`：**默认 true**（无字幕自动转写）；设为 `false` 则跳过转写（只用字幕/desc 或降级）。
- **转写工具链**：脚本自举，本机/用户一致——`uv` 建 Python 3.12 环境 + 清华镜像装 `faster-whisper` + `HF_ENDPOINT=https://hf-mirror.com` 下模型并缓存；faster-whisper 内置 PyAV 解码音频，**无需单独 ffmpeg**。
- **⚠️ 首次转写会先下载 small 模型（约 484MB，hf-mirror，非 GitHub），可能较慢**——执行转写前**先向用户说明**这是正常的一次性下载，之后缓存复用、秒开；不要当成卡死而中断。
- **质量/速度**：small/int8 + VAD 静音过滤，中文质量可用且 CPU 友好；有字幕视频不转写（快）。装不上/失败则降级，不静默。
- YouTube 用 yt-dlp 抓 CC；未装时**绝不下载 exe 二进制**（GitHub 直连易卡死），改用 winget/pip；仍不可用则转写或降级。
- 运行 yt-dlp 加 `--socket-timeout 15 --retries 3` 防超时。
- 默认不标时间戳（`options.includeTimestamps` 可开）

## 参考

项目主页：https://github.com/PensiveFei/deep-read-summarize