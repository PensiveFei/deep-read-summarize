# deep-read-summarize

[![MIT license](https://img.shields.io/github/license/PensiveFei/deep-read-summarize)](https://github.com/PensiveFei/deep-read-summarize/blob/main/LICENSE)
[![release](https://img.shields.io/github/v/release/PensiveFei/deep-read-summarize)](https://github.com/PensiveFei/deep-read-summarize/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/PensiveFei/deep-read-summarize/ci.yml)](https://github.com/PensiveFei/deep-read-summarize/actions/workflows/ci.yml)
[![npm downloads](https://badgen.net/npm/dw/deep-read-summarize)](https://www.npmjs.com/package/deep-read-summarize)

> **Disclaimer**: This is an **unofficial third-party tool**. It is not affiliated with, endorsed by, or sponsored by DeepSeek or the DeepSeek Harness project. "DeepSeek" and "DeepSeek Harness" are trademarks of their respective owners. This project only orchestrates the workflow tool available in your DSH environment; it does not redistribute any DeepSeek software.

> **⚠️ 最重要：本工具是「辅助精读」工具，不能代替自主学习。** 它帮你快速提取、归纳、结构化阅读内容，但**真正的理解、思考与批判仍需你自己完成**；请始终以原文为准，不要把它当作学习成果本身。

给 DSH（DeepSeek Harness）写的一个精读工作流：输入一本书、一篇论文、一个视频链接或网页，输出一份结构化的 Obsidian 笔记。

内容会被拆成若干块，由多个子代理并行精读，再合并成一篇带 YAML frontmatter 的 Markdown。关键结论附原文出处，成稿前有一道质量校验。

> 使用中遇到问题、或觉得哪里能更好，**欢迎随时在 GitHub issue 反馈**。

> 注意：DSH 目前是 developer preview，接口可能变化。本仓库针对特定版本的 workflow 工具语义编写，见下文[兼容性](#兼容性)。

---

## 能做什么

- 书籍（PDF/EPUB/MOBI）、论文（arXiv/PDF/HTML）、视频（**字幕优先，无字幕自动转写**，出品完整逐字稿精读）、网页
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
  video.js       视频：完整逐字稿（字幕优先，无字幕自动转写，走 scripts/transcribe.ps1）
  web.js         网页：正文提取
  index.js       注册表：解析器发现与回退
schemas/         子任务输出的 JSON Schema
scripts/         lint、安全检查
tests/           fixture 测试与验证脚本
workflow.js      workflow 脚本本体（meta + script）
```

想换某个输入类型的处理方式，在 `custom-parsers/` 放一个同接口的解析器即可，同名类型会覆盖内置实现。接口只有三个字段：`name`、`types`、`buildPrompt(input, opts)`。

---

## dsh.so 生态

本仓库带 `dsh-plugin` topic 和 `package.json` 的 `dsh` 字段，可被 dsh.so 注册表索引。

dsh.so 收录要求：公开仓库、`dsh-plugin` topic（或 dsh 字段）、README 安装说明、SPDX 许可证（MIT）。
提交后标记为 **Declared**（自声明兼容）；如果你实际使用并验证兼容，请在官方 Discussions 报告结果，这是唯一升 **Verified** 的途径。

---
## 安装（DSH 插件）

deep-read-summarize 是 DSH 插件，可通过 npm、dsh.so 生态或本地安装：

```bash
# npm 安装（已发布到 registry，无第三方依赖）
npm install deep-read-summarize

# 或本地安装（dsh profile 目录）
pnpm add ./deep-read-summarize-0.3.6.tgz
# 然后在 dsh 配置的 dsh.profile.bundles 追加:
#   - deep-read-summarize
# 重启 dsh web 即可（POST /dsh-market/restart）
```

安装后自动注册：
- `deep-read-summarize` workflow（meta + script）
- `deep-read-summarize` 技能（`skills/deep-read-summarize/SKILL.md`）
- 四种解析器（`parsers/`）与 JSON Schema（`schemas/`）

---
## 快速开始（约 5 分钟）

### 1. 安装

```bash
# 方式 A：npm 直接安装（无需 clone）
npm install deep-read-summarize

# 方式 B：从源码开发
git clone https://github.com/<your-org>/deep-read-summarize.git
cd deep-read-summarize
npm install        # 无第三方依赖，仅初始化
```

### 2. 验证环境（离线，不需要任何 API key）

```bash
npm test           # 25 项 fixture 测试，全部离线跑通
```

看到 `TOTAL: 25 passed, 0 failed` 即环境就绪。

### 3. 一行命令喂入 demo 文件

```bash
node -e "const wf = require('./workflow.js'); console.log('meta:', wf.meta.name); console.log('parsers:', wf.parsers.list().map(p => p.name).join(', '));"
```

输出类似：

```
meta: deep-read-summarize
parsers: book, paper, video, web
```

### 4. 真实运行（需要 DSH workflow 工具）

把下面的 JSON 传给 DSH 的 workflow 工具（见下节「用法」）：

```jsonc
{ "input": "https://arxiv.org/abs/2307.09042", "type": "paper", "options": { "maxChunks": 4, "fastMode": true } }
```

工作流会返回结构化结果：`{ ok, kind, title, filePath, qualityPassed, note }`，`note` 即最终 Markdown 笔记。

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
    "maxChunks": 4,           // 分块上限，1-12（默认调低，控制子代理数与耗时）
    "transcribe": true,       // 视频：无字幕时自动本地转写（faster-whisper）；false 则跳过转写，见「视频」节
    "requireCitations": true, // 关键结论是否必须标注出处
    "includeTimestamps": false,
    "outputDir": "./output",    // 笔记输出目录（可指向 Obsidian 仓库）
    "tempDir": "./.tmp"        // 临时文件目录
  }
}
```

示例：

| 类型 | input |
|------|-------|
| 论文 | `https://arxiv.org/abs/2307.09042` |
| 书籍 | 本地路径，如 `~/books/xxx.pdf` |
| 视频 | `https://youtube.com/watch?v=xxx` |
| 网页 | `https://example.com/article` |

笔记写到 `options.outputDir` 指定的目录（默认 `./output`，可指向你的 Obsidian 仓库），文件名取自内容标题。

### 视频：完整逐字稿（字幕优先，无字幕自动转写）

视频取文本是**统一流水线**（已去掉「三档」）：目标 = 拿到**完整逐字稿**再精读。

> **⚠️ 为保证精读质量，处理时间可能略长（刻意取舍，不是卡死）**：**无字幕**视频会先做一次转写（CPU 上约为视频时长的 0.5–2×）再精读，所以这类视频整体会**明显比有字幕视频慢**；换来的是**完整逐字稿 + 真正的精读**。**有字幕**视频仍是秒级。请勿把转写的较慢误判为卡死。

1. **有平台字幕**（B站官方 API 的 AI 字幕 / YouTube CC）→ **直接用字幕**（=全文，最快、零依赖）。
2. **无公开字幕** → 用插件自带转写 `scripts/transcribe.ps1`（faster-whisper small / int8 / VAD / 中文）得到全文。
3. 都不行 → **降级**：提示手动提供转写文本，或退回 `desc` 作背景；**绝不阻塞**。

`options.transcribe`：**默认 `true`**（无字幕自动转写）；设为 `false` 则跳过转写（只用字幕/desc 或降级）。

**转写工具链（本机/用户一致）**：脚本**自举**——用 `uv` 建 **Python 3.12** 环境 + **清华镜像**装 `faster-whisper` + `HF_ENDPOINT=https://hf-mirror.com` 下模型并**缓存复用**；faster-whisper 内置 PyAV 解码音频，**无需单独 ffmpeg**；**版本已锁定**（Python 3.12 / faster-whisper / uv），保证本机与用户环境一致。

> ⚠️ **首次转写会先下载模型（small 约 484MB，走 hf-mirror，非 GitHub），可能需要几分钟**，请耐心等待；**本机只下这一次**，之后所有视频转写用缓存、秒开。**只有「无字幕」视频才会触发转写**（有字幕的视频直接用字幕，不触发、不下载）。

**质量/速度**：`small` + `int8` 量化 + `VAD` 静音过滤，中文质量可用且 CPU 友好。**有字幕的视频不转写（快）**；无字幕视频转写，CPU 上约为视频时长的 0.5–2×。

**失败处理**：安装/下载失败则**明确报错并降级**（提示手动提供转写文本），不静默、不长期阻塞。此时可用 `options.transcribe: false` 跳过转写。

**怎么知道本次用了什么来源**：来源信息**不写进笔记**（保证笔记干净），透出在：① 运行日志的 `[source] <值> -> <标签>` 行；② 返回结果里的 `textSource` 字段（`subtitle / transcription / desc / manual`）。

---

## 差异与影响因素（时长与内容为何可能不同）

**输出时长与内容会因「模型」和「输入」不同而有明显差异，属正常现象**，请知悉：

### 模型
- **ASR 模型档位**：`small`（默认，中文可用）→ `base`（更快、质量略降）→ `medium`（更好、更慢）。可用 `options.whisperModel` 调整；下载量与速度随模型变大而增长。
- **语言/口音**：中/英/混合语言、方言、口音、重音 → 转写**准确度与耗时不同**；纯英文视频可设 `language: "en"`。
- **精读 LLM**：用宿主 DSH 的模型，不同上下文/推理模型 → 输出**质量、篇幅、速度**不同。
- **非确定性**：LLM 与 ASR 均带随机性，**同一输入重复跑可能得到略有差异**的结果（内容/篇幅）。

### 输入
- **视频**：
  - 有无**公开字幕**是最大差异点——有公开字幕 = 秒级；只有登录态 AI 字幕/无字幕 = 触发转写，**明显变慢**。
  - **时长**：越长转写越久（CPU 约 0.5–2× 视频时长）。
  - **音质/噪杂/低音量/纯 BGM/无人声**：转写易错或**结果空**，此时请手动提供转写文本。
- **论文/书籍/网页**：
  - 格式：PDF/EPUB/MOBI/HTML/arXiv；**扫描版 OCR、坏 PDF、公式/图表密集** → 提取质量与耗时不同。
  - **术语密度/篇幅** → 分块数与精读深度不同。
- **分块结构**：不同类型分块方式不同（章节/主题/段落），影响**输出结构**与覆盖。

### 硬件
- **GPU vs CPU**：GPU 转写可比 CPU 快一个数量级（`device='auto'` 自动选）。CPU 上无字幕视频约 0.5–2× 时长。

### 其他
- **首次 vs 复用**：首次要下模型（约 484MB），之后缓存复用。
- **Token/成本**：分块数/篇幅/引证决定 token 消耗；`fastMode`/`maxChunks` 可省。
- **引用/编造**：转写或 OCR 的错词可能被当作「原文」引用，**关键引用请复核**。
- **边界**：纯 BGM、失真音频 → 转写空/差；无字幕且转写不可用 → 降级提示人工提供转写文本。

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
- **本地转写**：视频转写（faster-whisper）在**本机**运行，音频/字幕**不出本地**；抓取视频元数据/字幕/音频时才会向对应平台发起网络请求。
- 这个仓库只有流程本身：workflow 定义、解析器代码、提示词模板、schema。**不含任何受版权保护内容的提取结果。** 测试用的 fixture 是自写的公共领域寓言。用本工作流处理有版权的材料时，产出物的使用责任在你。

---

## 开发

```bash
npm install
npm run lint       # node --check 全部 JS
npm test           # fixture 测试（25 项，全部离线）
npm run validate   # 发布前验证（含安全检查）
```

npm publish 会自动先跑 prepublishOnly（测试 + lint + 安全检查），任何一项失败都不会发布。

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