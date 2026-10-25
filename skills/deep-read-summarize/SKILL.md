---
name: deep-read-summarize
description: 深度精读并总结书籍/学术论文/视频/网页，输出带 YAML frontmatter 的标准 Markdown 笔记（2500+ 字，含术语表/批判分析/行动要点/延伸阅读；可直接放进 Obsidian / Logseq / 静态站点内容目录）
whenToUse: 用户提供一本书、论文（arXiv/PDF）、视频链接（YouTube/B站）或网页，要求深度精读、提取要点、生成可保存的 Markdown 精读笔记时（Obsidian / Logseq 仓库、静态站点内容目录、任意 Markdown 编辑器均可）
---

# deep-read-summarize — 深度精读与总结

把一本书、一篇论文、一个视频或网页，精读成一篇结构化的标准 Markdown 笔记。

正文是通用 CommonMark（**无双链、无 callout、无编辑器专属语法**），所以 Obsidian（配合 Dataview）、Logseq、Jekyll / Hugo / Astro 的内容目录，以及任意 Markdown 编辑器都能直接使用。

## 能力

- 书籍（PDF/EPUB/MOBI）、论文（arXiv/PDF/HTML）、视频（字幕优先，无字幕自动转写）、网页
- 长内容分块后由并行子代理精读（MapReduce），降低单个代理的上下文压力；超长资料仍受宿主上下文和工具读取上限约束
- 获取/分块与质量校验的输出受 JSON Schema 约束，结构稳定、下游可解析
- 分块计划与子代理数量受 `maxChunks` 强制约束（计划失控会顶穿单次调用时限）
- 关键引用标注页码/章节/段落，降低编造风险
- 配置错误终止（FATAL）；内容解析失败降级标记缺口继续
- 输出**标准 Markdown + YAML frontmatter**：正文为通用 CommonMark，frontmatter 的 `type` 字段可配 Dataview 查询

## 输入

用户提供：内容链接或本地文件路径。
可选参数：`type`（auto/book/paper/video/web）、`options`（minWords / fastMode / maxChunks / maxRetries / requireCitations / includeTimestamps / transcribe / whisperModel / language / device / outputDir / tempDir / frontmatter）。

优先调用插件提供的 `deep_read_summarize` 工具，参数为 `{ input, type, options }`。如果当前宿主没有这个工具，按技能末尾提供的 meta / script / args 调用 `workflow` 工具。两种入口执行相同的获取、精读与质量核验。

`options.frontmatter` 决定 frontmatter 用哪套键（默认 `obsidian`，与历史行为一致）：
- `obsidian`：title / aliases / author / year / type / url / tags / created / status —— 配 Dataview 用这套
- `generic`：把 Hugo 的保留键换掉（`type` → `docType`、`url` → `sourceUrl`、`created` → `date`），可直接放进 Hugo / Jekyll
- `minimal`：只留 title / date / sourceUrl / tags

**为什么要分档**：`type`、`aliases`、`url` 在 Hugo 里是保留键且语义不同（分别决定 layout、URL 重定向、页面路径），把 Obsidian 的写法直接丢给 Hugo 会改变渲染行为，而不是多出几个无害字段。

## 执行步骤

1. **配置校验**：缺 input 或 type 非法 → 报 FATAL 终止
2. **幂等检查（由你执行，脚本不做）**：脚本在沙箱内没有文件系统，写不了指纹记录。落盘前先看目标 `filePath` 是否已有同名笔记——已存在就问用户是覆盖还是跳过，别默默重跑一遍烧 token。（要在程序里做去重，可用插件导出的 `lib/cache.js`：fingerprint / hasProcessed / markProcessed。）
3. **解析器选择**：按类型从 parsers 注册表选解析器（book/paper/video/web）。`auto` 对明确视频链接、arXiv 论文链接、电子书扩展名直接分流；同站的图文/频道/帮助页、PDF/未知网页/文本等模糊输入先轻量识别，不能固定当作网页。识别失败返回 `stage: "detect"`，再请用户显式指定类型
4. **波次1 获取+分块**：解析器获取全文 → 写入本次独立的临时子目录 → 生成分块计划（JSON Schema 校验）。`tempDir` 是根目录，不要复用其他 `run-*` 任务的 input/audio/transcript；规范化全部区间并按行数均衡工作量，保持从第 1 行到 totalLines 的完整覆盖，不得截断原文
5. **波次2 并行精读**：每个分块一个子代理深度精读（Map），最多三个槽位同时工作，空闲即领取下一块，输出保持分块顺序
6. **波次3 合并成稿**：整合为完整笔记（Reduce），内嵌质量自检
7. **质量校验**：程序检查 frontmatter 模板、必要章节和篇幅；核验代理必须读取本次原文，逐块提供摘录、对第 4 节逐字引用提供原句与行号。不得只看笔记或仅返回 pass。`qualityEvidence` 可供回查；核验失败必须如实报告。`maxRetries` 为 0–3，修订失败、空结果或结构退化时保留上一份有效成稿。缺总行数、精读失败、仅简介或未知视频来源等问题不能靠改写笔记消除，不进行徒劳全文修订
8. **落盘（必须，别跳过）**：精读工具只返回 `note`（笔记正文）与 `filePath`（建议路径）——**脚本本身没有文件系统权限**。拿到结果后要用 `write` 工具把 `note` 原样写入 `filePath`（目录不存在就先创建）；不写就等于笔记丢了，用户只会看到一段返回文本
9. **如实交代结果**：`ok: false` 要说明卡在哪一步（`stage`）和原因，别拿半成品冒充成品；`qualityPassed: false`、`qualityIssues` 非空、或 `failedChunks > 0`（有块精读失败、笔记存在缺口）时，必须在回复里点出来

## 输出

精读工具返回 `{ ok, filePath, note, qualityPassed, qualityIssues, qualityChecks, qualityEvidence, failedChunks, coverageComplete, sourceComplete, textSource, timings }`。`coverageComplete: false` 表示缺少有效总行数，无法确认尾部覆盖；`sourceComplete: false` 表示视频仅有简介或来源未确认，笔记会保留来源限制且质量降级。来源完整性仍依据获取代理声明，不能当作视频真实内容已全部证明。`timings` 提供 detect/fetch/read/draft/quality/total 毫秒耗时，不能由此推测未提供的 token 用量。

> ⚠️ **`note` 就是完整笔记正文，`filePath` 只是建议路径**：脚本运行在无文件系统的沙箱里（DSH 的 workflow 契约：脚本只负责协调子代理），**它不会替你写文件**。必须由你（主代理）在拿到结果后用 `write` 工具把它写到 `filePath`——默认 `./output/`，可用 `options.outputDir` 指向 Obsidian 仓库或静态站点的内容目录。

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
  2. **无公开字幕** → 用插件自带转写（`scripts/transcribe.js`：faster-whisper small / int8 / VAD）得到全文。
  3. 都不行 → 降级提示用户手动提供转写文本，或退回 desc 作背景；**绝不阻塞、绝不自动装重依赖**。
- `options.transcribe`：**默认 true**（无字幕自动转写）；设为 `false` 则跳过转写（只用字幕/desc 或降级）。
- **转写工具链**：脚本自举，本机/用户一致——`uv` 建 Python 3.12 环境 + 清华镜像装 `faster-whisper` + `HF_ENDPOINT=https://hf-mirror.com` 下模型并缓存；脚本是 **Node** 写的，三平台**同一份实现、同一条命令**（`node <脚本路径> --audio <音频> --out <txt>`）；转写默认 **CPU**（`options.device` 默认 `cpu`），GPU 需自备 CUDA 运行库（设 `options.device: "auto"`，失败自动回退 CPU）；faster-whisper 内置 PyAV 解码音频，**无需单独 ffmpeg**。
- **⚠️ 首次转写会先下载 small 模型（约 484MB，hf-mirror，非 GitHub），可能较慢**——执行转写前**先向用户说明**这是正常的一次性下载，之后缓存复用、秒开；不要当成卡死而中断。
- **质量/速度**：small/int8 + VAD 静音过滤，中文质量可用且 CPU 友好；有字幕视频不转写（快）。装不上/失败则降级，不静默。
- YouTube 用 yt-dlp 抓 CC；未装时**绝不下载 exe 二进制**（GitHub 直连易卡死），按系统装（Windows `winget install yt-dlp.yt-dlp` / macOS `brew install yt-dlp` / 任意平台 `pip install -U yt-dlp`）；仍不可用则转写或降级。
- 运行 yt-dlp 加 `--socket-timeout 15 --retries 3` 防超时。
- **跨平台**：Windows / macOS / Linux **同等支持**（0.3.9 起）。无字幕自动转写走 `scripts/transcribe.js`（Node + `uv` + Python 3.12），三平台命令一致：`node <脚本路径> --audio <音频> --out <txt> [--device cpu]`；脚本定位命令按系统选（Windows `Get-ChildItem -Path $env:USERPROFILE/.dsh -Recurse -Filter transcribe.js`，macOS/Linux `find "$HOME/.dsh" -name transcribe.js`）。缓存目录按平台取：Windows `%LOCALAPPDATA%\deep-read-summarize`、macOS `~/Library/Caches/deep-read-summarize`、Linux `$XDG_CACHE_HOME/deep-read-summarize`。若 `node` 不在 PATH（macOS 从图形界面启动时常见）则直接降级，不要为此安装 Node。
- 默认不标时间戳（`options.includeTimestamps` 可开）
- 开启时间戳时保留字幕 cue 或转写分段的真实起止时间，输出 `[HH:MM:SS.mmm --> HH:MM:SS.mmm]`；关闭时仍逐段换行。原文没有时间信息时注明无法定位，不得推算或编造。

## 参考

项目主页：https://github.com/PensiveFei/deep-read-summarize
