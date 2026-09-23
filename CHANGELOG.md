# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/).

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
