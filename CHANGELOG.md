# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.4.0] — 2026-10-25

保留完整精读与独立原文核验，减少脚本搬运、并发空等和无效修订，并修复来源质量判断与视频分P等问题。

### Added

- **参数直达工具 `deep_read_summarize`**：宿主具有 tools / workflowEngine 服务时，由插件直接提交工作流，模型只传 input/type/options，无需原样重发约 4.6 万字符脚本。转发调用代理和取消信号，完成或失败后释放 workflow run；旧宿主保留原 workflow + skill 入口。
- **阶段耗时 `timings`**：返回识别、获取、精读、成稿、质量核验和总耗时（毫秒），供同资料、模型与质量门槛下比较。测试调度模拟不代表真实 LLM 加速比例。
- **显式自定义解析器目录**：插件顶层 `config.customParsersDir` 可加载独立目录，各 profile 隔离；包内 `custom-parsers/` 纳入 npm 分发。

### Fixed

- **视频来源质量**：只有简介或未确认来源的视频保持质量降级，不能因“简介的所有行都读过”而报告完整精读通过；来源类型进入 QC 上下文，并在笔记中标明限制。
- **B站多P**：保留短链最终 URL 与 p，按 `pages[p-1]` 选择 CID、标题和时长；字幕、音频使用同一分P，非法或越界参数不能默默回退第1P。
- **异常与重试**：类型识别和获取的可恢复调用错误返回对应 stage，真正 FATAL 继续终止；缺总行数、失败精读块、来源不完整等不能靠改写解决的问题不再消耗全文修订轮次。
- **格式与引用**：严格检查模板字符串，拒绝非法 YAML 裸标量和错误字段类型；区分 Markdown 引文的可见原话与强调、行号等展示信息，减少真实引用被误判。
- **文件名**：过滤控制字符、设备保留名与非法尾缀；对清洗或截短的标题增加稳定后缀，限制 UTF-8 文件名长度，避免 NUL、超长标题落盘失败与不同非法标题折叠到同名路径。
- **URL 指纹**：保留可选择不同资料的尾斜杠、空 query 与 fragment；新版键与旧缓存隔离，防止旧版碰撞继续跳过资料。
- **解析器更新**：注册后生成技能和工具调用使用最新注册表，不再引用模块加载时的旧脚本；插件构建阶段定位本版本转写脚本，避免每次递归搜索其他安装目录。
- **转写热启动**：健康环境直接执行一次 Python runner，移除单独 import 探测；仅明确缺依赖或版本不匹配时才要求 uv 并自举，已有可用环境不再被“找不到 uv”提前拒绝。
- **转写版本记录**：固定已验证的 `faster-whisper==1.2.1`，记录实际 Python / 依赖版本；纠正文档“uv / Python补丁 / 全部依赖完全锁定”的不实承诺。

### Performance

- **固定三个并发槽位**：一个任务完成即领取下一块，取消每批三个都结束才启动下一批的屏障，输出仍按原分块顺序合并。
- **均衡分块工作量**：在既有代理数和 maxChunks 上限内按行数均分已知全文，超长逻辑段可拆分，保持每行恰好覆盖一次。
- **缩减 QC 上下文**：保留原文路径、行号、缺口与待核验引文，移除重复的完整 Map 笔记；独立核验仍须读取原文。

### Compatibility

- 默认模型、篇幅、章节与引用门槛不降低；新工具是可选入口，原入口保留。新返回字段为补充元数据。
- 新版缓存指纹可能导致升级后的首次重处理；清洗过或过长标题的建议文件名会改变，正常标题保持不变。
- 原文真实性仍取决于核验代理实际读取原文。逐字稿内容缓存、常驻 ASR worker、分层 QC 和共享转写环境的冷启动互斥留待单独验证，未在本次发布中声称完成。

## [0.3.19] — 2026-10-24

修复 B04–B10，并让质量检查结合程序门禁和可回查的原文证据（O01）。

### Fixed

- **成稿与修订保留（B04）**：拒绝空白和非字符串初稿；修订调用失败、返回空值或格式/篇幅退化时保留上一份有效笔记。质量检查失败不再导致正常初稿丢失。
- **自定义解析器（B05）**：使用 Acorn 解析 CommonJS 模块并打包本地依赖，保留方法简写、模块常量、helper、JSON 和循环依赖。无法在沙箱支持的 Node/外部依赖和动态加载在构建时明确报错；独立的程序化函数仍可直接注册。
- **视频定位（B06）**：`includeTimestamps` 贯穿获取和转写，按真实分段 start/end 输出毫秒时间范围；平台字幕也保留 cue 时间。关闭时间戳仍逐段换行，不再把长逐字稿压成一行。
- **配置边界（B07）**：workflow 与插件 config 共用同一份默认值和校验器。检查有限整数、区间、布尔、路径和枚举；直接调用非法参数 FATAL，profile config 逐项告警回退。重试次数限制为 0–3。
- **转写完成信号（B08）**：复验上一版的修复；仅在本次进程成功、非空产物校验并原子发布后输出 DONE，空结果和所有失败路径均不输出成功信号。
- **缓存中断恢复（B09）**：每条 JSONL 记录以独立前后换行包围，单次 O_APPEND 追加，不读改尾部或留下恢复锁。损坏尾行不再吞掉下一条成功记录；短写明确失败，元数据不能覆盖保留字段。
- **发布身份（B10）**：checkout 前验证完整 tag ref 和远端对象，checkout 后核对 commit/包版本；按 ref、SHA、模式、nonce 和 attempt 精确认领本次 run，不再认领第一个新 ID。版本文件与发布表格先在内存预演，避免坏表格先留下已 bump 的版本；发布时同步更新锁文件的根版本。

### Changed

- **原文核验（O01）**：格式、必要章节和正文长度由程序检查；核验代理读取本次原文，返回全部分块摘录、关键引文原句及行号。缺证据、错行号、引文不匹配或已知精读缺口均不能通过，单独 `pass: true` 无效。新增 `qualityChecks`、`qualityEvidence` 返回字段。
- 中文/日文字符按字、其他文字按词计数；排除元数据、代码块、HTML 注释和链接地址。frontmatter 按提供的标量/列表模板校验，关键逐字引用集中在第 4 节。
- 新增一个锁定的生产依赖 Acorn，用于构建期 JavaScript 解析；CI 与发布工作流通过 `npm ci --ignore-scripts` 安装锁定依赖。

### Compatibility

- 默认配置仍可使用。依赖宽松强转（如字符串布尔值、负数重试）或超出范围的参数现在会报错；自定义解析器须使用纯提示词构造逻辑和静态本地模块依赖。
- 原文核验比仅检查成稿多读取资料，质量状态会更严格；引用真实性仍取决于核验代理实际读取原文，返回的摘录和行号用于回查。

## [0.3.18] — 2026-10-23

修复自动解析器分流、并发临时文件串稿和分块上限导致的全文遗漏。

### Fixed

- **`type: "auto"` 在获取前选择正确解析器**：明确的视频链接、arXiv 论文链接、EPUB/MOBI/AZW/AZW3 直接分流；同站的专栏/频道/帮助页、PDF、未知网页和文本先进行轻量类型识别，再获取全文。无法识别时返回 `stage: "detect"`，避免默默改走网页解析器。显式类型继续优先，成稿类型与实际使用的解析器保持一致。
- **每次运行隔离临时产物**：`options.tempDir` 作为根目录，任务使用独立 `run-*` 子目录，获取、音频、转写和精读共用本次路径，不再相互覆盖。转写使用独立暂存目录，成功退出且产物非空后原子发布；启动时移除旧目标，失败清理暂存文件，不会把旧逐字稿或半成品当成当前结果。成功信号在发布完成后输出，调用方必须核对本次进程退出状态。
- **分块数量收敛保留全部已知内容**：先校验、排序、去掉重复覆盖并补齐头部/中间/尾部缺口，再合并相邻区间至 `maxChunks`，不再丢掉计划尾部。保持 12 个精读代理硬上限；无法确认 `totalLines` 时保留已知区间并明确降级质量状态。

### Added

- 行为回归覆盖自动分流、PDF 书籍/论文分类、显式类型优先、并发 A/B 内容隔离、视频中间文件路径、跨平台临时根目录、超额/乱序/重叠/缺口分块，以及旧转写、空产物、失败清理和原子发布。
- 返回字段 `coverageComplete`：有有效总行数且计划已覆盖全部行号时为 `true`；总行数缺失时为 `false`，同时 `qualityPassed: false` 并附原因。

### Compatibility

- 不需要改配置；最终 Markdown 文件路径和 frontmatter 配置不变。临时文件改在配置根目录下的独立子目录，依赖固定 `tempDir/input.txt` 或 `tempDir/transcript.txt` 的外部脚本需要改为使用本次任务路径。
- 自动模式的模糊输入增加一次类型识别调用；显式设置 `type` 可跳过。

## [0.3.17] — 2026-10-20

修两个「对外暴露、内部没人盯着」的缺陷，并把发布流程自动化。

### Fixed

- **`parsers.resolve()` 在原型链名字上不回退**：它用裸方括号查表，于是 `resolve("constructor")` 返回 `Object` 构造函数、`resolve("toString")` 返回 `toString`、`resolve("__proto__")` 返回 `Object.prototype` —— 这些都没有 `buildPrompt`，调用方拿到的是 `TypeError`，而不是文档承诺的「未知类型回退 web」。现在用 `hasOwnProperty` 守住查表。
  - 影响面：workflow 本身打不到这条路径（它先用 `Object.keys` 校验 type），但 `resolve()` 是公开导出，程序化调用方传入用户输入就会中招。
- **`qualityChecklistSchema` 声明 6 个门，只 `required` 5 个**：漏了 `languageConsistent`，而 workflow 的质量校验提示词问的正是 6 项。夹具测试还写着 `required.length === 5`，等于在断言这个 bug。现在断言改成「`required` == 声明的布尔项集合」，这才是该守的不变量。

### Added

- **`scripts/release.js` + `npm run release`**：发布自动化。发布日期在**运行时**取、CHANGELOG 必须与之一致、`RELEASE.md` 与本地/远端 tag 都不得已有该版本、门禁先跑、先推 tag 再建 Release、成败只认日志里的 `+ 包名@版本`、说明从 CHANGELOG 小节原样生成（发布说明与变更日志不会再各说一套）。
  - 它存在的理由：手工流程踩过三次 —— 发布日期写错两次（0.3.12 与 0.3.16）、`docs/RELEASE.md` 未更新导致 publish 被 tag 校验拦下一次（0.3.13）。
  - 脚本本身**不进 npm 包**（`files[]` 用 `!scripts/release.js` 排除）；`scripts/transcribe.js` 仍随包发布。
- 2 条回归测试（`node:test` 52 → 54）：原型链名字必须回退到 web；质量清单的 `required` 必须等于声明的门数。

### Compatibility

- 无破坏性变更。行为上有两处**变严格**：`resolve()` 对原型链名字从「返回垃圾」改为「回退 web」；质量清单 schema 的 `required` 多了 `languageConsistent`。

### 升级提醒

- 不需要改配置。

## [0.3.16] — 2026-10-19

新增 `options.frontmatter` 三档，解决 frontmatter 在 Hugo 里的语义冲突。**默认档与历史行为逐字一致**，不构成破坏性变更。

### Added

- **`options.frontmatter`：`obsidian`（默认）/ `generic` / `minimal`**。
  - `obsidian`：`title` / `aliases` / `author` / `year` / `type` / `url` / `tags` / `created` / `status` —— 与 0.3.15 及更早逐字一致，现有 Dataview 查询不受影响。
  - `generic`：把 Hugo 的保留键换掉 —— `type` → `docType`、`url` → `sourceUrl`、`created` → `date`，并去掉 `aliases`。
  - `minimal`：只留 `title` / `date` / `sourceUrl` / `tags`。
  - 非法值 → **FATAL 终止**（与 `type` 的失败纪律一致，不静默降级）。

### Why

`type`、`aliases`、`url` 在 Hugo 里都是保留键，语义与 Obsidian 完全不同 —— 把笔记直接丢进 Hugo 会**改变渲染行为**，而不是多出几个无害字段：

| 键 | Hugo 里的含义 |
| --- | --- |
| `type` | 内容类型，决定用哪套 layout（`type: video` 会让它去找 `layouts/video/`） |
| `aliases` | 一组会重定向到本页的旧 URL |
| `url` | 覆盖页面自身的路径 —— 来源链接会变成文章永久链接 |
| `created` | 不是 Hugo/Jekyll 的键；`date` 才是 |

### Changed

- `index.js` 白名单补 `frontmatter`；`cordis.patch.yml` / `SKILL.md` / README ×2 同步说明。
- 修 `screenshots.json`：4 个路径由相对路径改成**绝对 `raw.githubusercontent.com` URL** —— 市场客户端的截图白名单只接受 GitHub 图床的绝对 https 地址，相对路径会被静默丢弃。该文件**不随 npm 包发布**：截图来自 registry（GitHub 侧索引），不是 npm 包。

### Added（测试）

- 4 条回归测试（`node:test` 48 → 52）：默认档保留全部 9 个键；`generic` 必须去掉 `aliases` / `type` / `url` / `created` 并改用 `docType` / `sourceUrl` / `date`；`minimal` 恰好 4 个键；非法档位必须报错而不是静默忽略。

### Compatibility

- **无破坏性变更**：不传 `frontmatter` 时产物与 0.3.15 逐字相同。

### 升级提醒

- 想直接放进 Hugo / Jekyll 又不改渲染行为：设 `options.frontmatter: "generic"`。
- 已生成的笔记不受影响，新选项只作用于之后的生成。

## [0.3.15] — 2026-10-18

这一版动的是**工程卫生**，外加一处提示词措辞。运行时只有一处可感知变化（提示词不再绑定 Obsidian），见「升级提醒」。

### Changed

- **脚本正文不再做成转义字符串**：`workflow.js` 里那条约 10k 字符的 `RAW_SCRIPT` 曾因「转义套转义」被改坏两次，也让每次改动都变成编码练习。现在正文放在 `lib/workflow-script.txt`，`workflow.js` 在加载时读取它。重构前后断言**构建出的 script 逐字节相同**，所以只是搬家、不动行为。
- **成稿提示词改为「标准 Markdown」**：`draftPrompt` 不再写「整合为完整 Obsidian 精读笔记」，改为「完整的结构化精读笔记，只输出标准 Markdown」。这与 0.3.12 起的定位一致——此前只改了对外文档，产物措辞没跟上。
- **`lint` 不再是「只查语法」**：`scripts/lint.js` 原来只跑 `node --check`，现在零依赖地检查 UTF-8 BOM、任何 CR（换行必须 LF）、行尾空白、行首制表符、JS 里的 `var`。2026-09-22 与 2026-10-17 两次「工作区被写成 CRLF 造成整文件假 diff」，当时的 lint 一声不响。
  - 刻意**不做**宽松相等检查：正则分不清代码里的 `x == null` 与字符串里的 `==`，本仓库两者都有，做了只会全是误报。
- **`.gitattributes` 锁定 LF**：有 5 个文件原本以 CRLF 存储（`CHANGELOG.md` / `package.json` / `lib/cache.js` / `parsers/_prompt.js` / `tests/cache.test.js`），此前完全依赖各人的 `core.autocrlf`。新增 `* text=auto eol=lf` 与二进制声明；本版包含一次性换行规范化（`git diff --ignore-cr-at-eol` 为空，未改任何内容）。
- **`.env.example` 重写**：原文列的 `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `OUTPUT_DIR` / `TEMP_DIR` **代码里一个都不读**，且本项目没有 dotenv 加载器——「复制成 .env」不会有任何效果。现在只文档化真正生效的 `DRS_UV_PYTHON_MIRROR`，并说明 `.env` 不会被加载。
- **包瘦身**：`files[]` 去掉 `tests/`（约 49 kB unpacked）与无人引用的 `docs/RELEASE-v0.1.0.md`。tarball 81 038 → 64 945 B，unpacked 213 889 → 164 713 B。
- `lib/cache.js` 的定位在 README 里写清楚了：它是给「自己驱动流程的调用方」用的小工具；workflow 沙箱没有文件系统，用不到它。

### Added

- 2 条回归测试（`node:test` 46 → 48）：成稿提示词不得出现 Obsidian、且必须要求标准 Markdown；脚本正文必须来自独立文件、不得退回转义字符串字面量。

### Compatibility

- 无破坏性变更：`exports`、`engines`、frontmatter 键都未动。
- **唯一可感知变化**：成稿提示词不再点名 Obsidian。对已有笔记格式没有影响（frontmatter 与章节结构不变）。

### 升级提醒

- 不需要改配置。
- **包内不再包含 `tests/`**：若你曾靠 `npm test` 验证安装完整性，请改用仓库。

## [0.3.14] — 2026-10-17

修四个实际缺陷，都属于「声明 / 约定与实际行为不一致」这一类。其中两处**用户可感知**，见「升级提醒」。

### Fixed

- **`outputDir` / `tempDir` 的尾部分隔符处理不对称**：`tempFile` 只去掉尾部正斜杠，`mdPath` 只去掉一个反斜杠。于是 `outputDir: 'out/'` 会拼出 `out//Title.md`，`tempDir: '.tmp\'` 会拼出 `.tmp\/input.txt` —— **在 POSIX 上那个反斜杠会变成目录名的一部分**，抓取代理会去建一个实际不存在的目录。现在两者统一为「去掉任意长度的 `/` 或 `\`，再补一个分隔符」，与 `parsers/_prompt.js` 自己那套回退逻辑一致。
- **frontmatter 的 `created` 用的是 UTC 日期**：`new Date().toISOString().slice(0, 10)` 在 UTC+8 的 00:00–08:00 会写成前一天。改为取本地年月日。
  - 两处改动都在 `workflow.js` 的 `RAW_SCRIPT` 里。该文件按既有教训**整体重建**（解码模板 → 精确替换 → 重新 JSON 编码 → 只替换那一条物理行），并断言成品脚本「只差这三处」、模板反向还原逐字一致、内联标记未被破坏。
- **插件级 config 会静默丢弃未知键**：`normalizeOptions` 只遍历 `DEFAULT_OPTIONS`，所以写进 `cordis.patch.yml` 的 `whisperModel` / `language` / `device` / `maxRetries` **既不生效也不告警**，拼错的键同样无声。现在这四个键进了白名单，未知键会告警并列出可用键。
- **README ×2 的 fixture 测试数停在 25**：实际为 35（两个文件各两处）。

### Added

- 4 条回归测试（`node:test` 42 → 46）：`outputDir` 尾分隔符归一、`tempDir` 尾分隔符归一、`created` 用本地日期（含「不得再用 UTC 切片」的源码断言）、config 白名单与未知键告警。
  - 这几条做过**反证**：把旧版脚本取回来跑同一套断言，`out/`、`out\\`、`./.tmp\`、`./.tmp\\` 四个用例都会失败 —— 证明它们不是空跑。

### Compatibility

- 无破坏性变更；依赖、`exports`、`files`、`engines` 均未动。frontmatter 仍是既有 9 个键。

### 升级提醒

- **`created` 的日期可能比之前大一天**：这正是修复目的（本地日期而非 UTC）。UTC 偏移为负的用户在晚间会看到相反方向的一天差异。
- **带尾分隔符时产物路径字符串变干净了**：此前会产生 `out//Title.md` 这类路径。笔记实际落盘位置不变（多数文件系统把 `//` 当单斜杠），但依赖 `filePath` 字符串做幂等判断的调用方会看到不同的写法。

## [0.3.13] — 2026-10-11

**元数据版本，无运行时改动**：生成的笔记与 0.3.12 一致，工作流脚本未动。本版只修一处**声明**问题。

### Fixed

- **宿主要求此前是「未声明」状态**：`dsh.minVersion: "0.1.0"` 是自定义字段，不属 DSH 公开字段集，**市场不读**。按官方 *Public package manifest fields*，运行时要写在顶层 `engines` 的 `dsh` 键上。此前市场对这个包的判定是 `basis: undeclared`，卡片上连"要求"一栏都没有。现补上 `engines.dsh`。

  本包**没有**任何 `@deepseek-ai/*` 依赖（纯 workflow / skill 插件，源码零导入），所以 peer 这条路走不通——官方文档「Use peer dependencies as the sole host requirement」被否决的理由正是此情形：peer 约束的是安装的 npm 包，**无法识别独立 profile 工程里正在运行的那个 DSH 进程**。对纯 workflow 插件，`engines.dsh` 是唯一的声明通道。

  取值为 `>=0.1.0-rc.6`（**不是** `>=0.1.0`）：semver 只在范围里存在与目标版本 `major.minor.patch` 元组完全一致、且自身带预发布标签的比较符时才放行预发布版，所以 `>=0.1.0` 匹配不到 `0.1.0-rc.6`，会把本插件在 `0.1.0-rc.6` 宿主上标成**不兼容**。刻意**只写下界**：engine 声明走严格路径（没有 peer 那套隐式上界宽容），写上界会让未来的 `0.3.x` 宿主被误判为不兼容。

### Compatibility

- 无破坏性变更；`engines.node` 未动。
- 实测判定（`0.1.0-rc.6` / `0.1.2-rc.1` / `0.2.0-rc.2` / `0.2.1-alpha.2` / `0.3.0`）：全部 `compatible`，`basis` 由 `undeclared` 变为 `manifest`。

## [0.3.12] — 2026-10-10

本轮**没有运行时改动**：生成的笔记与 0.3.11 一致（工作流脚本 `RAW_SCRIPT` 逐位未变，改动前后比对解码脚本哈希相同）。改的是文档定位，以及一处**已验证事实**的同步。

### Changed

- **定位改为「输出标准 Markdown」，不再自我限定为 Obsidian 工具**：正文本来就是通用 CommonMark（无 `[[双链]]`、无 callout、无 Dataview 内联字段），frontmatter 也是标准 YAML。现在 README ×2 / `SKILL.md` / `package.json` description 都如实这么说；技能目录的 `description`、`whenToUse` 与 `workflow.meta.whenToUse` 一并放开，让「要一份 Markdown 笔记」这类请求也能命中本技能。
  - `package.json` keywords 新增 `markdown`，保留 `obsidian` 作为检索入口。
- **README 删除「dsh.so 生态」一节**（中英各一处）及安装段里指向它的引用。**只影响文档**：仓库的 `dsh-plugin` topic 与 `package.json` 的 `dsh` 字段都保留——后者承载 `bundle.patch`，是插件加载所必需，不能删。
- **「尚未在真实 macOS 上验证」改为「已验证」**：README ×2 的「支持平台」一节现在陈述**已在真实 macOS 上跑通一次完整的无字幕转写**（`uv` 自举 Python 3.12 → 装 faster-whisper → 下载模型 → 输出逐字稿，退出码 0）。这条声明此前一直如实写着「尚未验证」，只有拿到真机结果才改。

### Compatibility

- 无破坏性变更。**生成的笔记与 0.3.11 完全一致**：本轮仅动文档与元数据。
- frontmatter 仍是既有的 9 个键，未做增删。**已知的跨工具语义冲突依旧存在**：`aliases` 在 Hugo 中是 URL 重定向、`type` 在 Hugo 中是 layout 选择。按目标工具切换 frontmatter（如 `options.frontmatter: obsidian / generic / minimal`）属于后续工作，本轮未做。

### Verification boundary

- 本次真机验证覆盖：完整转写链路（自举 Python 3.12 → 装 faster-whisper → 下载模型 → CPU 推理出逐字稿）。
- 仍未端到端跑通：`uv` 的 CPython 镜像失效后「自动改直连 GitHub」的回退链路（单测覆盖了尝试序列，但本机已有 Python 3.12，无法强制一次真实下载来贯通）。

## [0.3.11] — 2026-10-05

文档与 CI 补强：**运行时行为与 0.3.10 完全一致**，没有任何解析器 / 脚本 / schema 改动。

### Added

- **`README.md` / `README.en.md` 新增「支持平台」（Platform support）一节**：逐环节列出三平台各自需要的工具（poppler / curl / yt-dlp / uv）、转写默认走 CPU（Apple Silicon 与 Intel Mac 都不需要 CUDA）、三平台缓存目录，并如实写明**尚未在真实 macOS 上跑过一次完整转写推理**（CI 只覆盖到平台路径解析）。

### Changed

- **CI 的 `cross-platform` 作业从「lint + `--self-check`」扩到与 ubuntu 作业同一套门禁**（security / lint / fixture / node:test / validate）。此前 42 项测试套件从未在 macOS 或 Windows 上执行过，而文档一直写着「三平台同等支持」——现在三平台各跑一遍。
- **「已验证的宿主」锚点从 DSH `0.1.2-rc.1` 更新为 `0.2.0-rc.2`**（`README.md` / `README.en.md` / `index.js` 头部注释），依据是 2026-09-30 在 0.2.0-rc.2 上的契约复核。

### Compatibility

- 无破坏性变更：依赖、`exports`、`files` 与全部运行时行为均与 0.3.10 相同。
- 从 npm 安装的用户：包内 `README` 会更新（本次唯一的用户可见变化）；`.github/` 不进包，CI 改动只影响仓库。

## [0.3.10] — 2026-09-24

对**已发布的 0.3.9** 做的一轮审计修复。审计对象是 **npm 上那份字节**（不是工作区）：先确认 29 个文件与 tag `v0.3.9` **逐字节一致**，再在解包目录里跑该包自带的门禁（lint / security / 35 fixture / 38 node:test 全绿），然后逐项找问题。

### Fixed

- **uv 的 CPython 镜像已失效，会让「首次安装」的机器彻底装不上**（P1；继承自 0.3.6 的 PowerShell 脚本，不是 0.3.9 新引入）。镜像写死 `ghproxy.com`，而它现在 **301 到 `ghfast.top` 并丢掉路径** —— 返回的是 HTML 而不是资产，uv 拿到 HTML 报 `Invalid gzip header`，而且**不会自己回退 GitHub**。真机验证：`uv venv --python 3.11` 带该镜像 → 退出码 2 失败；不带镜像（对照）→ 成功。踩到的恰好是**本机没有任何 Python 3.12 的新用户**。
  - 现在：默认镜像换成实测可用的继任服务，**失败自动改用直连 GitHub 重试一次**（并清理失败留下的半个 venv）；另可用环境变量 `DRS_UV_PYTHON_MIRROR` 覆盖（空字符串 = 完全不用镜像）。
- **转写结果为 0 字节时仍返回成功**（P2）。纯静音 / 纯 BGM 视频会被 VAD 全部滤掉，脚本却以退出码 0 结束、只留一条 stderr 警告，并且留下一个 0 字节文件；而调用方按「输出文件非空」判断完成、提示词里又有一条「日志出现 DONE」——**空逐字稿会被当成转写成功**，再拿去做精读。现在：删除空文件、以退出码 **3** 结束，并明确要求按降级处理。
- **`--audio` 指向目录时报错晦涩**（P3）：此前 `existsSync` 直接放行，最后抛出 python 的 `PermissionError: [Errno 13] Permission denied`。现在先校验是否为普通文件，直接报「不是文件（是不是给了目录？）」。

### Changed

- **`docs/RELEASE.md` 两处与实况不符**（P2，会随包发给用户）：
  - 「当前版本速览」停留在 v0.1.x / v0.2.x + 计划中的 v1.0.0，**完全没有 0.3.x**；现在补全，并加了一道断言守着它（发版忘了更新会让 `npm run test:node` 变红）。
  - 发布流程教的是「建 Release → 触发 publish.yml」+「用 `npm view` 验证」—— **恰好就是实测踩到的两个坑**。现在改为：手动 dispatch 为主路径；Release 事件投递不稳、只当记录；并写明判据（看日志的 `+ 包名@版本` 与 provenance；registry 有 1–2 分钟延迟，当场查必然 E404；dry-run 全绿不算发布成功）。
- `README.md` / `README.en.md`：选项示例补上 `maxRetries`（SKILL.md 与代码本来就有它）；转写工具链一节补上「镜像可覆盖 + 失败自动回退直连」。
- `parsers/video.js` 提示词：转写步骤明确「脚本以非 0 退出也算失败」，包含「结果为空」的情况。

### Compatibility

- 无破坏性变更，默认值与既有行为不变（`device` 仍默认 `cpu`、`transcribe` 仍默认 `true`）。
- 唯一可感知的变化：**纯静音音频现在会「失败」而不是「成功返回空文本」** —— 这正是修复目的，调用方本就应该走降级路径。
- `DRS_UV_PYTHON_MIRROR` 是新增的可选环境变量；不设时行为与 0.3.9 相同（只是默认镜像换成了还活着的那个）。

## [0.3.9] — 2026-09-22

**macOS / Linux 支持**。这一版补上最后一块 Windows-only 的拼图：此前「无字幕视频自动转写」依赖 `scripts/transcribe.ps1`（PowerShell），SKILL.md 里明确写着「**目前仅在 Windows 可用**」；现在换成跨平台的 Node 脚本，三平台同一份实现、同一条命令。

### Added

- **`scripts/transcribe.js` 取代 `scripts/transcribe.ps1`**：跨平台转写自举脚本（Windows / macOS / Linux）。平台差异只集中在四个纯函数里（`cacheRoot` / `venvPython` / `uvInstallHint` / `findUv`），它们都接受注入的 `platform/env/home`——因此**任意 OS 上都能跑全平台矩阵单测**，不必依赖 macOS 机器。
  - 缓存目录：Windows `%LOCALAPPDATA%\deep-read-summarize`、macOS `~/Library/Caches/deep-read-summarize`、Linux `$XDG_CACHE_HOME/deep-read-summarize`
  - uv 探测：先扫 PATH，再回退 `~/.local/bin`、`/opt/homebrew/bin`、`/usr/local/bin`、`~/.cargo/bin`（macOS 从图形界面启动时不继承 shell PATH，这一步是必需的）；找不到时按平台给出安装命令（winget / brew / curl 安装器）
  - `--self-check`：只打印解析出的路径，不安装、不下载、不联网——CI 三平台用它做冒烟
- **`options.device` 选项**（默认 `cpu`，可选 `auto`/`cuda`）：从 options → workflow 脚本 → 解析器 → 命令行全程打通（与 `whisperModel` / `language` 同一条路径），不是写死在提示词里。`auto`/`cuda` 需自备 CUDA 运行库，失败自动回退 CPU。
- **CI 新增 `cross-platform` 作业**：在 ubuntu / macos / windows 三个 runner 上跑 lint + `--self-check`，真正在 macOS 上执行一遍平台分支。

### Fixed

- **`device='auto'` 在「有 NVIDIA 显卡但没装 CUDA 运行库」的机器上必崩（真机复现）**：ctranslate2 只要探测到显卡（`get_cuda_device_count() == 1`）就会在 `auto` 下选 CUDA，随后在推理时抛 `Library cublas64_12.dll is not found or cannot be loaded`。这是 0.3.6 起就潜伏在 `transcribe.ps1` 里的问题（本机 RTX 3050 复现）。现在默认 `device=cpu`（与 README 承诺的「CPU 友好、零额外依赖」一致）；设 `options.device: "auto"` 时，失败也会**自动回退 CPU 并打印原因**。
- **转写中途失败会留下半截 `transcript.txt`**：调用方（提示词第 ④ 步）是按「输出文件非空且稳定」判断转写完成的，半截文件会被**误判成成功**。现在先在内存里收集全部分段，成功后才落盘。
- **`parsers/video.js` 提示词里的 PowerShell 路径少了分隔符**：`$env:USERPROFILE\.dsh` 写在 JS 字符串里，`\.` 被当成未知转义退化成 `.`，实际发出去的提示词是 `$env:USERPROFILE.dsh`。改用正斜杠（PowerShell 同样接受）。
- **`parsers/book.js` 让代理用 `pwsh` 调 pdftotext**（第二轮全仓复查才发现，第一轮只盯着转写链路）：macOS 默认没有 PowerShell，**书籍/PDF 这条路在 macOS 上会直接卡住**。现在改成平台中立的 pdftotext 说明，并给出三平台安装方式（macOS `brew install poppler` / Windows `winget install poppler` / Debian·Ubuntu `apt install poppler-utils`）。
- **`--out` 的父目录不存在时失败信息难以理解**：现在脚本自己先把父目录建好（`./.tmp` 这类调用方路径），不再让 python 抛一句难懂的 `No such file or directory`。

### Changed

- **`parsers/video.js` 提示词改为平台中立**：同时给出 Windows 与 macOS/Linux 的脚本定位命令（`Get-ChildItem … -Filter transcribe.js` / `find "$HOME/.dsh" -name transcribe.js`），yt-dlp 安装同时给出 `winget` 与 `brew`；转写命令三平台统一为 `node <脚本路径> --audio … --out … --device cpu --model … --language …`。
  - 提示词**不能**按平台分支：它会被内联进 workflow 沙箱脚本，而沙箱不提供 `process`（`tests/run-tests.js` 有对应断言），所以两套写法都写出来、由执行代理按自己的系统选。
- 转写输出不再带结尾空格（改用 `' '.join(...)`）。
- 提示词里「转写执行」的 ①–⑥ 子步骤此前被模板编号成了一个独立的顶层步骤（`7.   ① 先取音频…`，后续行反而没有编号），现在与标题合并为同一步，编号回到 `6. 转写执行（…）：` + 未编号的 ①–⑥。
- `README.md` / `README.en.md` / `SKILL.md` 同步：删掉「仅 Windows 可用」，补上跨平台命令、平台缓存目录与 `options.device` 说明。

### Compatibility

- **Windows 用户零迁移成本**：缓存目录与 `transcribe.ps1` 逐字一致，**已下载的模型不会重下**（真机验证：复用既有 venv + 模型，未触发下载）。
- 唯一入口改名 `transcribe.ps1` → `transcribe.js`；提示词文本随之变化（脚本名、参数形式、`options.device`），依赖提示词逐字比对的 fork 需要同步。
- 转写默认从 `auto` 变为 `cpu`：原 `auto` 在无 CUDA 运行库的机器上本来就会崩，真正的 GPU 用户可显式传 `--device auto`。

## [0.3.8] — 2026-09-16

又一次「代码审查 + 真机复现」驱动的修复轮。这一轮的核心发现不是某一行写错了，而是**几处「文档承诺」与「代码实际行为」对不上**：选项算出来不用、schema 抄了两份各自漂移、配置文件里的键全是空转。所有 P0 都用 mock 掉 `agent/parallel/phase/log` 的方式**跑真实脚本复现过**，并各自补了回归测试。测试 35 → **62**（fixture 35 + node:test 27）。

### Fixed

- **frontmatter 注入：标题里带引号会产出坏 YAML（P0）**。`title: "《" + finalTitle + "》…"` 是裸拼，内容标题含 `"`（如 *The "Best" Method*）时 frontmatter 直接被截断，Obsidian / Dataview 全部解析失败。现在统一走 `yamlStr()`（JSON 字符串转义，是 YAML double-quoted 风格的子集），`title / aliases / author / year / type / url` 全部转义；标题里的换行/制表也一并折叠，不再污染 `.md` 文件名。
- **幂等命中分支会返回空笔记（P0）**。脚本里那段 `args._processedKeys` 早返回，命中时返回 `note: ""` + `filePath: ""`；而 SKILL.md 第 8 步要求主代理「把 `note` 写入 `filePath`」——命中即写出空文件。宿主实际上**从不注入 `args._processedKeys`**（0.1.x 全仓 0 命中），这段代码永远不会命中，一旦命中就是数据事故。整段删除。
- **分块计划不受 `maxChunks` 约束（P0）**。提示词里写着「块数不超过 N 块」，但脚本原样相信子代理返回的 `chunkPlan`：实测 `maxChunks: 4` 会起 **10 个子代理**——这正是 0.3.x 反复踩的「单次调用超时」的成因。现在按上限截断，并在收敛时记日志。
- **分块行号区间不校验（P0）**。倒置区间（`startLine: 900, endLine: 100`）会原样拼成 `limit=-799` 交给 `read`。现在丢弃倒置/越界的块，并按 `totalLines` 夹紧上界；全部无效时按可降级错误返回，不再空跑。
- **全非法字符的标题会写出隐藏文件**：`///` 之类清洗后为空 → `./output/.md`。现在兜底为 `未命名内容.md`。
- **`options.transcribe: false` 完全无效**。`parsers/video.js` 里 `wantTranscribe` 算完从未被使用，`true` 与 `false` 生成的提示词**逐字相同**，README/SKILL 却都承诺「false 则跳过转写」。现在提示词真的分流：禁用时明确禁止定位/运行 `transcribe.ps1`、禁止下载模型，直接走降级。
- **`options.whisperModel` / `options.language` 文档教用、代码没有**。README 写着「可用 `options.whisperModel` 调整」「纯英文视频可设 `language: "en"`」，但脚本既不读也不透传，转写命令里 `-Model small -Language zh` 是写死的。现在两个选项都从 options → 脚本 → 解析器 → 命令行全程打通，默认值保持 `small` / `zh`（对既有用户零行为变化）。
- **`kind` 会变成 `"auto"` 流进笔记**。`type: auto` 且子代理没回 `kind` 时，`frontmatter` 的 `type` 与 `tags` 会被写成 `auto`。现在 `auto` 只接受解析器表里真实存在的类型，否则退回实际使用的回退解析器。

### Changed

- **插件 config 不再是空转**。`apply(ctx, config)` 此前收了 config 从不读它，`cordis.patch.yml` 里列的 8 个键（`outputDir`/`tempDir`/`minWords`/…）全部无效。现在会做白名单校验（类型不符 → 告警并忽略，不会因为一个拼错的键把整个 profile 拖死），合并进技能里的 args 示例，成为该 profile 的默认值。`cordis.patch.yml` 的注释同步改写（含 `maxChunks` 6 → 4）。
- **schema 不再有两份真相**。脚本里那份手抄的 `fetchSchema` 已删除，改由 `workflow.js` 在构建自包含脚本时从 `schemas/index.js` **注入**；`kind` 的 `enum` 跟着解析器注册表走。此前手抄副本已经漂移（丢了 `enum`）。同时把 `chunkReadSchema` / `qualityChecklistSchema` **没有被 workflow 使用**这件事写进 `schemas/index.js` 头部——它们留给程序化调用方。
- **自定义解析器真正可用**。以前 `type` 白名单写死 `auto|book|paper|video|web`，且自包含脚本只内联这四个，`custom-parsers/` 里的**新类型**端到端不可达。现在内联的是注册表里的全部解析器，白名单与 schema 枚举都从注册表推导；同名覆盖照旧有效。
- **幂等从「脚本假装会做」改成「文档如实说不会做」**。脚本沙箱没有文件系统，写不了指纹记录——`lib/cache.js` 从 0.1.0 起就没被 workflow 调用过。现在 SKILL.md 第 2 步改为：由主代理在落盘前检查目标 `filePath` 是否已存在；程序化去重可用 `deep-read-summarize/lib/cache`（`package.json` 的 `exports` 补上了这个子路径，此前被 exports map 挡住根本 require 不到）。
- SKILL.md 新增第 9 步：`ok: false` 要说明卡在哪一步，`qualityPassed: false` / `failedChunks > 0` 必须在回复里点出来，不许拿半成品冒充成品。
- `prepublishOnly` 补跑 `node --test`（此前发布门禁只跑 fixture 测试，`tests/index.test.js` 不在门禁内）。
- npm 描述去掉 `idempotent cache`（工作流层确实没有这个能力）。

### Added

- **workflow 运行时回归测试（12 → 27 项 `node:test`）**：用 mock 掉 `agent/parallel/phase/log` 的方式跑**真实脚本**，逐条锁住本轮修的 P0/P1——分块收敛、区间夹紧、全无效计划降级、YAML 转义、隐藏文件名兜底、`kind` 兜底、幂等早返回已移除、`transcribe` 分流、`whisperModel`/`language` 透传、config 校验与透传、schema 单一真相、自定义类型端到端（含自定义解析器内联与枚举跟进）、未知类型仍然响亮报错、`lib/cache` 可达。

### Compatibility

- 对既有用户**无破坏性变更**：默认值全部保持不变（`maxChunks` 4、`transcribe` true、`whisperModel` small、`language` zh、`outputDir` `./output`）。
- 行为变化仅在于「以前被静默忽略的东西现在生效了」：超过 `maxChunks` 的计划会被截断（子代理数下降、耗时下降）、非法分块区间会被丢弃（此前会把负数 limit 传给 `read`）。
- 历史文档 `docs/RELEASE-v0.1.0.md` 里 v0.1.0 的「幂等缓存」描述保持原样（它是对当时意图的记录），实际能力以本节与 `schemas/index.js` 的说明为准。

## [0.3.7] — 2026-09-09

针对 **DSH 0.1.2-rc.1** 的一轮兼容性核查与打磨（对使用者无破坏性变更）。

### Fixed

- **笔记落盘步骤缺失（最容易丢数据的一条）**：SKILL.md 写「默认写到 `./output/`」，但 DSH 的 workflow 契约规定脚本只能协调子代理——**沙箱内没有文件系统**，脚本实际只返回 `{ filePath, note }`。照原文档执行，模型会以为文件已经写好，笔记只存在于返回值里。现在 SKILL.md 新增明确的第 8 步「用 `write` 工具把 `note` 写入 `filePath`」，两版 README 同步说明。
- **`npm run test:node` 在 Node 24 上直接失败**：`node --test tests/` 在该版本会把 `tests/` 当模块解析（`MODULE_NOT_FOUND`）。改为 `node --test`（自动发现）。
- **CI 从不运行 `tests/index.test.js`**：里面正是 0.3.3 事故（入口缺 `apply()` → 宿主拒绝启动）的 Cordis 契约回归测试，却因为只在 `node --test` 下跑而从未被执行。CI 新增该步骤，矩阵补上 **Node 24**（宿主实际运行版本）。

### Changed

- **npm 包不再携带 docs 截图**：`files` 由整个 `docs/` 收窄为两份 RELEASE 文档。0.3.6 发布之后仓库才提交的 4 张 showcase 图（合计约 1.14MB）会让下次发版的 tarball 从 99KB 涨到 1.1MB；现在回到约 100KB。图片仍随仓库分发，README 改用 GitHub 绝对地址引用（npm 页面照常显示），顺带把一直没有被任何文档引用的演示图补进 README。
- **技能 `source` 改为 `bundled`**：该字段是技能的「来源桶」（`runtime`/`bundled`/`user-dsh`…），此前填的是自由描述 `plugin:deep-read-summarize`。
- README/README.en.md 的「兼容性」节改写为：已验证宿主（DSH 0.1.2-rc.1）+ 依赖面表格 + 两条契约细节（沙箱无文件系统；违反 schema 子集是**终止**而非降级）。
- `.gitignore` 增加 `*.tgz`（本地 pack 产物不再出现在 `git status`）。

### Added

- **workflow 契约回归测试（零依赖）**：schema 子集递归校验（含反向断言，确保校验器不会空放行）、`agent()` 选项白名单、沙箱禁用 API（`require`/`fs`/`process`/`fetch`/定时器）扫描、脚本四解析器自包含、技能内容包含 meta + script + args 与落盘步骤、插件 Cordis 契约 + 技能登记行为。测试 28 → **35**。

### Compatibility

- 实测证据（0.1.2-rc.1）：两个 `agent()` schema 用宿主真实的 `assertObjectJsonSchema` 校验**通过**，对照用例 `minLength` 被拒（证明校验器有效、不是空放行）；脚本只使用 `agent/parallel/phase/log/args`；`agent()` 失败返回 `null` 已被脚本正确处理。
- 未改动 workflow 脚本本身与解析器行为；本次修复集中在「落盘契约、测试与 CI、打包体积、文档准确性」。

## [0.3.6] — 2026-08-28

### Added
- **统一视频转写工具 `scripts/transcribe.ps1`（关键）**：自举 faster-whisper（`uv` 建 Python 3.11 环境 + 清华镜像安装 + `HF_ENDPOINT=https://hf-mirror.com` 下模型并缓存），small/int8/VAD；**本机与用户使用一致**（只依赖环境变量与标准路径），无需单独 ffmpeg（faster-whisper 内置 PyAV 解码）。

### Fixed
- **视频解析器 yt-dlp 防卡死**：未装 yt-dlp 时**绝不下载 exe 二进制**（GitHub 直连易卡死），改用 `winget install yt-dlp.yt-dlp` 或 `pip install -U yt-dlp -i 镜像`；并加 `--socket-timeout 15 --retries 3` 防超时。
- **workflow 精读防超时中止**：`maxChunks` 默认 6→4、`maxRetries` 默认 1→0；波次2「并行精读」改为**分批并行**（每批 3 个块），降低子代理数与单次调用时长。

### Changed
- **`parsers/video.js` 统一流水线（去三档）**：目标 = 拿到**完整逐字稿**再精读。① 有平台字幕（B站 AI 字幕 / YouTube CC / yt-dlp CC）→ 直接用字幕（快、零依赖）；② 无公开字幕 → 用 `scripts/transcribe.ps1` 转写得到全文；③ 都不行 → 降级提示人工转写文本，或退回 desc 作背景；**绝不阻塞、绝不自动装重依赖**。
- **`options.transcribe` 默认 true**（无字幕自动走本地转写），`false` 则跳过转写。
- **textSource** 标注实际来源：`subtitle / transcription / desc / manual`；来源信息**透出在运行日志 `[source] …` 与返回结果 `textSource`，不写进笔记**（保持笔记美观）。
- `SKILL.md` / `README.md` 同步为「完整逐字稿（字幕优先，无字幕自动转写）」策略与效果预估。

### Fixed
- **DSH rc7（Cordis）兼容修复**：插件入口改为标准 Cordis 插件契约（导出 `name` + `inject: ['skills']` + `apply(ctx)`），apply 时将自带 SKILL.md 注册为运行时技能（含 workflow meta + 自包含 script + args 示例），修复 0.3.3 在 rc7 上「invalid plugin / 插件树加载失败 / harness 无法启动」的问题（旧入口只导出 load/workflow/parsers/schemas，无 apply）。
- **workflow script 自包含**：四个解析器（book/paper/video/web）的 `buildPrompt` 及其依赖的 `buildFetchPrompt` 在构建时内联进 script（修正内联后的 `prompt` 闭包引用），不再依赖宿主注入 `args._parsers`（rc7 的 workflow 工具只暴露 args JSON，不会注入）；保留 `args._parsers` 回退（宿主注入时优先）。
- 旧的 `load()` 接口保留以兼容旧式读取；minVersion 0.1.0。

## [0.3.3] — 2026-08-25

### Fixed
- lib/cache.js：URL 归一化真正去掉尾部空 query（`doc` 与 `doc?` 现在共享指纹；此前 `url.search === "?"` 是死代码，`doc?` 会生成不同指纹导致幂等缓存失效）
- lib/cache.js：`fingerprint` 用 `??` 替代 `||`，空文件（size=0）不再与「无 meta」混淆
- workflow.js：`tempFile` 拼接先去掉 `tempDir` 尾部斜杠，避免 `./.tmp//input.txt` 双斜杠路径（与 parsers/_prompt.js 的 0.3.2 修复对齐）
- tests：+2 用例（URL 尾部 `?` 归一、size=0 指纹区分），25/25 通过；均由 DSH 代码审查发现

## [0.3.2] — 2026-08-23

### Fixed
- parsers/_prompt.js：目标文件路径优先使用调用方传入的 `tempFile`，回退路径统一正斜杠，修复 macOS/Linux 上硬编码 Windows 反斜杠导致的路径错误（issue #1，由 DSH 代码审查发现）
- lib/cache.js：`markProcessed` 写缓存失败不再抛错中断主流程（降级为告警并返回 false）；`hasProcessed` 支持可选 TTL（`maxAgeMs`）过期判定（issue #2，由 DSH 代码审查发现）

## [0.3.1] — 2026-08-21

### Fixed
- 发布前检查：移除 README 中的本地 Obsidian 仓库绝对路径（改为参数化描述）
- 移除 docs/RELEASE.md 中的本机绝对路径（改为通用写法）
- README 同步版本号：tgz 0.2.0 → 0.3.0、测试 17 → 21 项

## [0.3.0] — 2026-08-21

### Added
- 幂等缓存 URL 规范化（normalizeInput）：host 大小写 / 默认端口 / fragment / 尾部斜杠归一，同一 URL 不同写法共享指纹
- 安全扫描覆盖 .env.example 与 forward-slash 用户路径；导出 scanDir 供测试调用
- 测试 17 → 21：parser 模板回归、URL 规范化、安全扫描正/负样本

### Changed
- parsers 四解析器去重：抽取共享提示词模板 parsers/_prompt.js（buildPrompt 输出逐字不变，经新旧对比验证）
- lint 排除 .tmp*/dist/coverage 等临时目录
- CI 增加 Node 18/20/22 版本矩阵
- package.json 增加 publishConfig.access=public（显式公开发布）
- docs/RELEASE.md 增加 npm 发布流程与版本速览；README 开发节补充发布门禁说明

### Fixed
- security-check 对测试样本误报（样本改为拼接构造，源码不含完整密钥模式）

## [0.2.0] — 2026-08-21

### Added
- 首次发布到 npm registry（`npm install deep-read-summarize`），含此前未发布的 0.1.1 变更
- prepublishOnly 质量门禁：发布前自动跑 17 项测试 + lint + 安全检查

### Changed
- package.json version 对齐 git tag（0.1.0 → 0.2.0）
- keywords 移除 `deepseek-harness` 商标词（安全合规要求，与 v0.1.0 决策一致）
- README 补充 npm 安装方式

### Fixed
- git 历史整理：以本地完整开发历史为准 force push 覆盖 API 拼凑历史，补上缺失的 `.github/workflows/ci.yml`

## [0.1.1] — 2026-08-19

### Added
- DSH 插件化：cordis.patch.yml（bundle patch）、index.js 插件入口、skills/ 打包
- node:test 风格测试（tests/index.test.js，`npm run test:node`）

### Changed
- package.json：dsh.bundle 字段、exports、repository、keywords 完善
- 废弃 cordis.yml → 由 cordis.patch.yml 替代

## [0.1.0] — 2026-08-18

### Added
- 首个公开预发布版（pre-release）
- 四种输入解析器插件：书籍/论文/视频/网页
- 三波次 MapReduce 精读流水线
- JSON Schema 结构化输出约束
- 幂等缓存（lib/cache.js）
- 失败分级（FATAL vs 可降级）
- 质量校验循环
- CI（lint + 测试 + Gitleaks 密钥扫描）
- README/SECURITY/CONTRIBUTING/CHANGELOG 文档

## [3.0.0] — 2026-08-18

### Added
- Plugin parser architecture: `parsers/` registry with book/paper/video/web adapters
- JSON Schema structured output constraints (`schemas/index.js`)
- Failure discipline: FATAL (config) vs degradable (content) error classes
- Quality control loop with retry (`maxRetries`)
- Configurable citations (`requireCitations`) and video timestamps (`includeTimestamps`)
- Fixture-driven test suite (`npm test`, 10 tests)
- Quick validation script (`npm run validate`)
- CI workflow (lint + tests)
- cordis.yml plugin tree example

### Changed
- Workflow reduced to 3 serial waves (fetch/chunk → parallel read → merge+QC)
- Subagent count reduced to N+2~3
- Defaults changed to general-purpose: `requireCitations: true`, `includeTimestamps: false`

### Removed
- Standalone quality-check subagent (merged into wave 3 + optional lightweight retry)

## [2.1.0] — 2026-08-18

### Added
- One-click write-to-Obsidian from the draft agent
- fastMode (skip sections 5-7)

## [2.0.0] — 2026-08-18

### Changed
- Merged identify+fetch+chunk into one subagent (3 waves total)
- Removed standalone QC subagent

## [1.1.0] — 2026-08-18

### Fixed
- Long-content overflow: write-to-temp-file + line-range chunking

## [1.0.0] — 2026-08-18

### Added
- Initial deep-reading pipeline (5 serial waves)
- Template prompts for books/papers/videos/web
- Obsidian note template with YAML frontmatter
