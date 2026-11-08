# 工作流与配置参考

[返回中文首页](https://github.com/PensiveFei/deep-read-summarize/blob/main/README.md) · [English reference](README-reference.en.md)

此页保存完整参数、转写和扩展细节。安装及快速开始请使用首页；工作流调用结果中的笔记需由主代理写入磁盘。

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
Markdown 笔记
```

三个波次，默认约 N+3 次子代理调用（获取、N 块精读、成稿、质量校验）。`auto` 遇到 PDF、未知网页或文本等模糊输入时，额外进行一次轻量类型识别；显式指定 `type` 可跳过识别。

`auto` 会将明确的视频链接、arXiv 论文链接和电子书扩展名直接分发到对应解析器；同站的专栏、频道与帮助页仍先分类，PDF 会根据内容区分书籍与论文。无法识别时返回 `stage: "detect"`，请显式指定类型。`options.tempDir` 作为临时根目录，每次调用在其中创建独立的 `run-*` 子目录，获取、音频和转写文件不与其他任务共用。

分块计划会排序、裁掉重复区间并补齐缺口，超过 `maxChunks` 时合并相邻块以保留全文。获取代理运行内置脚本，按保存文本的字符数计算整行分界，尽量在不明显牺牲均衡的情况下选择段落边界；若脚本无法运行或分界无效，则回退按行数均衡。字符数只是 token 数和工作量的近似值，超长单行不会拆分。返回的 `coverageComplete` 表示是否依据有效的 `totalLines` 覆盖全部行号；缺少总行数时保留已知范围，同时将 `qualityPassed` 置为 `false` 并说明覆盖无法确认。

质量检查分两部分：程序按提供的标量/列表 frontmatter 模板检查字段、必要章节和篇幅（汉字按字、其他文字按词，排除 frontmatter、代码块、HTML 注释及链接地址）；独立核验代理读取本次原文文件，逐块检查覆盖，并为第 4 节的逐字引用返回原句和行号。单独的 `pass: true` 无法通过检查。`qualityChecks` 返回检查项，`qualityEvidence` 返回原文路径、分块摘录和引用证据；原文真实性判断仍由读取原文的代理完成，无法核实就报告未通过。修订为空、调用失败或结构退化时保留上一份有效成稿。

直接调用 workflow 的 options 必须类型正确：`minWords` 为 1–100000 的整数，`maxChunks` 为正整数（大于 12 仍夹到 12），`readConcurrency` 为 1–12 的整数，`maxRetries` 为 0–3 的整数；非法值和未知键在启动时 FATAL。插件 profile 的 config 则逐项告警并回退默认值，避免阻止宿主启动。

```
parsers/         各输入类型的解析器，按类型分发
  book.js        书籍：PDF/EPUB/MOBI 文本提取、章节分块
  paper.js       论文：arXiv/PDF/HTML 结构识别
  video.js       视频：字幕优先、可选转写，获取失败时降级
  web.js         网页：正文提取
  index.js       注册表：解析器发现与回退
schemas/         输出约束的 JSON Schema（波次1 由 workflow.js 注入脚本，单一真相）
scripts/         lint（含换行/空白卫生检查）、安全检查、跨平台转写引导（transcribe.js）
lib/             独立可用的小工具
  cache.js         输入指纹与幂等记录（供自己驱动流程的调用方使用；workflow 沙箱没有文件系统，用不到它）
  workflow-script.txt  workflow 脚本正文（普通文本，可直接读改，不需要任何转义）
tests/           测试与验证脚本（**不随 npm 包发布**，仓库里才有）
workflow.js      workflow 的 meta 与组装逻辑（解析器内联、schema 注入）
```

> 脚本正文单独放 `lib/workflow-script.txt`：这个文件曾经因为「转义套转义」被改坏过两次，现在它是普通文本，读改都不需要编码步骤。

想换某个输入类型的处理方式，在插件包的 `custom-parsers/` 放一个同接口的解析器即可，该目录会随 npm 包分发。也可在插件顶层 config 中指定 `customParsersDir`，使用自己的解析器目录；它不是 workflow options。相同类型会覆盖内置实现，也可新增 `podcast` 等类型。程序化注册后重新生成技能会使用最新注册表；各 profile 的专属目录相互隔离。接口为 `name`、`types`、`buildPrompt(input, opts)`。

解析器的 CommonJS 模块会连同字面量相对路径的 `.js` / `.cjs` / `.json` 依赖一起打包，保留模块级常量、helper、方法简写和循环依赖。构建时使用 Acorn 解析 JavaScript；它由 npm 自动安装，不进入 workflow 沙箱。沙箱中的解析器只负责生成提示词，不支持 Node 内置模块、外部包或动态 `require` / `import`；这些依赖会在构建时明确报错。程序化注册的函数须自包含，模块闭包请使用文件解析器。

---

## 用法

`deep_read_summarize` 工具只需要以下参数；旧宿主将其作为 `workflow` 的 args，并使用技能中的 meta + script：

```jsonc
{
  "input": "https://arxiv.org/abs/2307.09042",  // 链接或文件路径
  "type": "auto",   // auto | book | paper | video | web
  "options": {
    "minWords": 2500,
    "fastMode": false,        // true 时跳过 5-7 节，速度快一些
    "maxChunks": 4,           // 分块上限，1-12
    "readConcurrency": 3,     // 精读和分块核验的并发上限，1-12
    "parallelQuality": false, // 显式启用并行原文核验；默认使用原有核验路径
    "readCache": false,        // 仅插件工具支持：启用跨次精读缓存
    "readCacheIdentity": "",   // 启用缓存时必填：provider/固定模型版本/影响输出的设置
    "transcribe": true,       // 视频：无字幕时自动本地转写（faster-whisper）；false 则跳过转写，见「视频」节
    "whisperModel": "small",  // 视频转写模型档位：small | base | medium
    "language": "zh",         // 视频转写语言：纯英文视频可设 "en"
    "device": "cpu",          // 转写设备：cpu（默认）| auto | cuda；auto/cuda 需自备 CUDA 运行库，失败自动回退 cpu
    "cpuThreads": 0,          // 0 保持转写库默认值；1-64 可按实际硬件调优
    "transcriptCache": true,  // 音频内容与配置一致时复用本地逐字稿；false 强制每次推理
    "maxRetries": 0,          // 质量校验重试次数（默认 0 = 不重试，重试会明显变慢）
    "frontmatter": "obsidian", // frontmatter 键集：obsidian（默认，配 Dataview）| generic（换掉 Hugo 保留键）| minimal
    "requireCitations": true, // 关键结论是否必须标注出处
    "includeTimestamps": false,
    "outputDir": "./output",    // 笔记输出目录（可指向 Obsidian 仓库或静态站点内容目录）
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

返回的 `filePath` 建议使用 `options.outputDir` 指定的目录（默认 `./output`），文件名取自内容标题；工作流不会直接写笔记，必须由主代理负责落盘。

### frontmatter 三档（`options.frontmatter`）

默认 `obsidian`，键集与历史版本一致，标量和列表值使用安全引号。之所以要分档：`type`、`aliases`、`url` 在 Hugo 里是**保留键**，语义和 Obsidian 完全不同——直接丢进 Hugo 会改变渲染行为，而不是多几个无害字段。

| 键 | `obsidian`（默认） | `generic` | `minimal` |
|---|---|---|---|
| `title` | ✓ | ✓ | ✓ |
| `aliases` | ✓ | — | — |
| `author` / `year` | ✓ | ✓ | — |
| `type` | ✓ | — | — |
| `docType` | — | ✓ | — |
| `url` | ✓ | — | — |
| `sourceUrl` | — | ✓ | ✓ |
| `tags` | ✓ | ✓ | ✓ |
| `created` | ✓ | — | — |
| `date` | — | ✓ | ✓ |
| `status` | ✓ | ✓ | — |

为什么 `generic` 要换键：

- `type` 在 Hugo 里决定**用哪套 layout**（`type: video` 会让它去找 `layouts/video/`）
- `aliases` 在 Hugo 里是**一组会重定向到本页的旧 URL**
- `url` 在 Hugo 里会**覆盖页面自身的路径**——来源链接会变成文章的永久链接
- `date` 才是 Hugo/Jekyll 都认的时间键；`created` 只是自定义字段

非法值直接 FATAL 终止（与 `type` 的失败纪律一致，不静默降级）。

### 视频来源与转写

视频优先使用取得的字幕；没有可用字幕时，默认尝试转写。`options.transcribe: false` 可跳过转写。字幕获取和转写可能失败或不完整；退回简介时，输出会说明来源限制，不能作为完整视频精读。字幕和转写都可能有错漏，关键内容须对照音频。

**转写工具链**：脚本用 `uv` 创建 **Python 3.12** 环境，从清华镜像安装 **`faster-whisper==1.2.1`**，通过 `HF_ENDPOINT=https://hf-mirror.com` 下载并缓存模型。健康的缓存环境直接运行，不要求 uv 仍在 PATH，也不再启动单独的 Python 导入探测。实际解释器和依赖版本记录在缓存目录的 `runtime.json`；Python 补丁版本、uv 和传递依赖未全部锁定，不能据此声称环境逐字一致。PyAV 可直接解码音频，无需单独 ffmpeg。三平台使用同一条命令 `node scripts/transcribe.js --audio <音频> --out <txt>`，默认 CPU；`options.device: "auto"` 可尝试自备的 CUDA，失败回退 CPU。缓存目录：Windows `%LOCALAPPDATA%\deep-read-summarize`、macOS `~/Library/Caches/deep-read-summarize`、Linux `$XDG_CACHE_HOME/deep-read-summarize`（未设置时用 `~/.cache`）。创建 Python 环境默认先用镜像，失败再直连 GitHub；`DRS_UV_PYTHON_MIRROR` 可覆盖镜像，空字符串表示直连。

> ⚠️ **首次转写会先下载模型（small 约 484MB，走 hf-mirror，非 GitHub），可能需要几分钟**。之后复用模型文件；新音频仍需完整推理。同一音频命中经过校验的逐字稿缓存时，才会跳过推理。**只有「无字幕」视频才会触发转写**（有字幕的视频直接用字幕，不触发、不下载）。

**逐字稿缓存与线程**：`options.transcriptCache` 默认开启。缓存键包含音频 SHA-256、受管理的本地模型快照、已安装依赖及解码配置；存储真实分段和起止时间，切换时间戳展示不必重转写。更改内容、配置或本地模型/依赖会失效；自定义本地模型目录、无法确认环境、损坏和过期记录均跳过缓存。缓存复用本地已有快照，不在线探测模型上游是否更新。逐字稿保存在上述缓存根目录的 `transcripts-v1`，单条上限 8 MiB、总量上限 128 MiB、有效期 30 天；清理在写入时执行。它不保存音频，也不会跳过后续精读与原文核验。

`options.cpuThreads` 为 0–64 的整数，默认 `0` 保持库的 CPU 线程策略。可用同一音频对比 4/6/8 线程，线程越多不一定越快。CLI 可直接使用：

```bash
node scripts/transcribe.js --audio sample.m4a --out transcript.txt --cpu-threads 8
node scripts/transcribe.js --audio sample.m4a --out transcript.txt --refresh-cache
node scripts/transcribe.js --audio sample.m4a --out transcript.txt --no-cache
node scripts/transcribe.js --clear-cache
```

`--clear-cache` 只清理逐字稿，不删除模型或 Python 环境。`--refresh-cache` 强制推理并更新缓存，`--no-cache` 禁用读写。成功调用输出一行 `metrics` JSON，报告 `cacheHit`、实际设备、音频时长，以及哈希、环境准备、依赖安装、Python、发布和总毫秒耗时；未命中时还报告导入、模型加载、准备（含解码/VAD）与完整分段迭代耗时。缓存命中不会冒用上次推理耗时。

笔记的 `qualityPassed` 核验笔记与取得的原文，不证明 ASR 听写准确；调整转写路径仍须对照音频检查误字、漏段、数字、否定句与时间戳。

来源类型可从运行日志的 `[source]` 和返回的 `textSource` 查看；来源不完整时笔记也会包含限制说明。

## 影响结果与隐私的因素

- 模型、输入长度、格式、所选章节、并发及网络会影响耗时、费用和结果；不要将单次调度测试外推为真实加速比例。
- 转写在本地执行，但精读使用 DSH 配置的模型。若使用云端模型，提取文本、字幕和笔记内容等可能发送给模型服务商。临时原文、逐字稿及可选缓存可能保留在本机。
- 扫描件通常需要先进行 OCR；公式、表格和图像密集的材料可能无法完整提取。视频中出现的字幕和声音也可能不一致。

## 失败与降级

缺少输入、非法选项等配置错误会终止执行。获取或成稿失败会返回相应失败阶段；部分分块失败时可保留成稿并标记缺口，不应把它当成完整笔记。`qualityPassed` 检查程序规则和核验代理结果，并不证明所有结论或语音识别正确。

## 保持质量的提速

- 支持的新宿主优先使用 `deep_read_summarize`，模型只提交参数，省去复制整份工作流脚本。旧宿主自动保留原入口。
- 精读计划覆盖已知原文行号；实际阅读成功和来源完整性仍须核验。并发数默认最多为三个任务；空闲槽位立即领取下一块。优先按字符数均衡工作量，统计不可用时回退按行数均衡。
- QC 继续独立读取原文；可通过 `parallelQuality: true` 让多个分块并行核验原文和全部引文，另行检查整篇术语与语言；默认仍使用原有核验路径。缺总行数、精读失败或只有视频简介等问题不能靠改写笔记解决，不再浪费全文修订轮次。
- 视频 `textSource: "desc"` 明确为降级来源，不能取得完整精读的质量通过状态。B站多 P 链接按 `p` 选择对应 CID、分 P 标题和时长。
- 返回 `timings` 提供各阶段毫秒耗时，`readTimings` 提供每个精读块的行号、耗时和是否成功。用同一资料、模型、篇幅和质量门槛比较；调度测试不能当成真实 LLM 加速比例。
- `readConcurrency` 控制精读并发，不改变分块或质量核验的要求；启用 `parallelQuality` 时也限制核验任务数，默认为 3。实际分块数至少为 4 且宿主支持时，可尝试设为 4，比较总耗时、限流及失败情况；并发越高不一定越快。

**跨次精读缓存**默认关闭，仅 `deep_read_summarize` 插件工具入口支持，裸 workflow 不启用。设 `readCache: true` 时必须同时设置 `readCacheIdentity`，包含供应商、固定模型版本和所有影响输出的设置；宿主无法验证该身份，模型或设置变化时必须更换。缓存按原文内容、分块提示及身份匹配，仅在质量检查通过后写入；命中后仍执行独立原文核验。`readTimings` 的 `cacheHit` 表示是否命中。缓存是明文，位于 `tempDir/.read-cache-v1`，可能包含原文摘录；超过 30 天、64 MiB 总量或 1 MiB 单条限制会被清理或跳过，不需要时可删除该目录。

默认保持 small/int8、既有解码设置、篇幅与独立原文核验。逐字稿缓存主要加速重复处理，新视频可用线程配置和分阶段计时调优；常驻 ASR 模型和批量推理仍需独立基准，不自动启用。

## 成本

Token 用量取决于原文长度、分块数和成稿篇幅。原文核验会再次读取资料，每轮修订还会增加一次修订和一次核验调用。`fastMode` 减少输出章节；调低 `maxChunks` 限制代理数，同时保留分块计划的已知行号覆盖，但不证明来源获取完整。

使用 `lib/cache` 的程序化调用方请注意：URL 尾斜杠、空 query 与 fragment 可能选择不同资料，现在会保留；新版指纹自动与旧版缓存隔离，升级后可能需要重新处理一次。该工具不负责证明远程内容未更新，复用前仍须由调用方确认来源与配置。

---

## 兼容性

项目历史上曾在 **DSH 0.2.0-rc.2**（Node 24）检查部分宿主契约；新版本的全部组合和真实模型效果尚未因此得到验证。以下是两个重要的工作流契约：

| 依赖面 | 现行契约 | 本仓库的用法 |
| --- | --- | --- |
| workflow 脚本钩子 | `agent()` / `pipeline()` / `parallel()` / `phase()` / `log()` / `args` | 只用了 `agent/parallel/phase/log/args`；`agent()` 选项只用 `label/phase/schema`（引擎只接受 `label/phase/schema/provider/model`，其它选项会被判为 fatal） |
| JSON Schema 子集 | `type / properties / required / additionalProperties / items / enum / const / oneOf` + 注解键 | 历史实现中的部分 `agent()` schema 曾通过宿主的 `assertObjectJsonSchema` 检查；新 schema 仍需对实际宿主单独验证 |

两点容易踩的契约细节：

- **脚本沙箱没有文件系统/网络/定时器/require**——只能协调子代理；笔记落盘由主代理完成。
- **违反上述子集不是降级而是终止**：引擎抛 `UNSUPPORTED_SCHEMA`，整条 workflow 直接失败。仓库的 `npm test` 里有对应回归（含反向断言，确保校验器不是空放行）。

升级 DSH 后先跑 `npm test` + `npm run test:node`；坏了对照 CHANGELOG.md 排查。

---
