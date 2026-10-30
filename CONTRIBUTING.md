# 参与 deep-read-summarize

欢迎提交代码、文档、测试、问题报告和复现材料。较大调整请先开 Issue；安全漏洞请按 [SECURITY.md](SECURITY.md) 私下报告。

## 环境准备

- Git、Node.js **18 或以上**、配套的 npm。建议使用 CI 已覆盖的 Node 24；CI 同时测试 Node 18/20/22/24，以及 Linux、macOS、Windows。
- 在独立源码目录安装，不要在正在使用的 DSH profile 中运行 `npm ci`。
- 普通 fixture 测试不要求 DSH、模型凭据或 Python。`node:test` 中的 Python 桩测试在找不到解释器时会跳过；完整覆盖这些用例需 Python 3（可通过 `PYTHON` 指定），无需真实模型。完整宿主验证需另装兼容 DSH（`engines.dsh` 为 `>=0.1.0-rc.6`），记录实际版本。

```bash
git clone https://github.com/PensiveFei/deep-read-summarize.git
cd deep-read-summarize
npm ci --ignore-scripts
git switch -c fix/short-description
```

仓库用 UTF-8 无 BOM、LF 换行，遵守 `.gitattributes`。改依赖时同步更新 `package-lock.json`，确认干净目录可运行 `npm ci --ignore-scripts`。

只有无字幕音频转写才需要额外工具链：首次自举需 `uv`，脚本创建 Python 3.12 环境并安装 faster-whisper、下载模型，详见 [README](README.md)。这一步会联网并占用磁盘，不属于普通测试。完整精读还依赖宿主模型和工具；测试通过不能代替真机验证。

## 测试与检查

在仓库根目录运行，以下与 CI 对齐：

```bash
npm test
npm run test:node
npm run lint
npm run security
npm run validate
node scripts/transcribe.js --self-check
```

- `npm test`：fixture 驱动的工作流测试。
- `npm run test:node`：Node 原生测试，包括入口、Cordis 契约与发布护栏。
- `npm run lint`：JavaScript 语法、BOM、换行和空白检查。
- `npm run security`：常见密钥及用户路径扫描，不能替代人工脱敏。
- `npm run validate`：快速验证及安全检查。
- `--self-check`：转写平台路径自检，不安装 Python、不下载模型。

修复缺陷请给最小回归用例；涉及宿主、转写或平台行为时，在 PR 写明实际覆盖和未验证部分。纯文档变更可说明测试不适用的原因，仍检查链接、YAML、换行和脱敏。

## 实现与提交规范

- 一次 PR 聚焦一个目的，沿用现有 CommonJS 和代码风格，避免无关格式化或依赖升级。
- 新解析器放入 `parsers/<name>.js`，或使用 `custom-parsers/`、显式配置的 `customParsersDir`。接口为 `{ name, types, buildPrompt(input, opts) }`，可带 `schema`；补 fixture 并检查内联后的工作流可用。
- 修改工作流以源码和现有构建方式为准，不要把 `require('./workflow').script` 的最终产物当模板写回。
- 提交标题用 `type(scope): 简述`，scope 可省略。常用类型：`fix`、`feat`、`docs`、`test`、`refactor`、`chore`。例如 `fix(parser): handle empty video transcript`。
- PR 关联 Issue、填写环境/复现前后行为、列出实际检查命令与结果。用户可见变化补 `CHANGELOG.md`；版本号、tag 和发布由维护者统一处理。
- 协作代码保留作者信息；squash 时核对作者，必要时按贡献者确认的身份保留 `Co-authored-by`，不猜测邮箱或真实姓名。

## Issue、日志与脱敏报告

使用 Bug / Feature 表单。提供插件版本或 commit、DSH/Node/npm 版本、系统版本与架构、最小复现或需求场景、预期与实际行为、日志及脱敏报告。拿不到某项时说明原因，不要只写“最新版”。

- 只提供最少材料，检查正文、日志、配置、截图和附件。移除密钥、Token、Cookie、授权头、个人信息、私有 URL/参数、用户目录和工作区名称；用稳定占位符保留结构与类型。
- 不上传完整会话、私人文档、原始音视频、付费或无权分发的原文。优先使用合成样本或允许公开的最小片段。
- 脱敏报告写明替换的信息类别、已检查的附件、删节是否影响复现；不要再次列出原值。无日志也要说明原因。
- 安全漏洞或不能公开的证据走私密安全渠道，不在公开 Issue/PR 附带攻击细节或未脱敏材料。

## 维护者响应、致谢与归属

- 目标在 **3 个工作日内**首次确认 Issue/PR，感谢具体贡献并说明下一步；暂时无法处理时说明原因和预计时间。这是维护目标，自动回复不能代替审阅。
- 有新结论及时回复，等待超过 **7 个工作日**时更新状态。合并或关闭时说明结果，并感谢报告、复现、修复、测试、文档等贡献。
- 合并前核对 GitHub 用户名、Issue/PR 和贡献内容。默认用公开用户名，尊重匿名或指定署名；安全报告公开致谢前先确认披露范围。
- 发布前把本版本社区贡献的 **`@用户名 + 具体贡献 + Issue/PR 链接` 写入目标 CHANGELOG 小节**。自动脚本从该小节原样生成 Release Notes，归属不能只留在 PR 对话中。
- 按 [Release 模板和清单](docs/RELEASE.md) 复核。GitHub 自动生成说明能帮助核对 PR 作者，报告者和复测者仍需人工补充。没有外部贡献时如实说明，不填虚构署名。
- 发布后复核公开 Release 仍保留署名；遗漏时补充该页面并注明补记，不改已发布 npm 包或移动 tag。

## 发布流程（维护者）

贡献者无需 npm 发布权限或长期 Token。完整步骤和故障处理见 [docs/RELEASE.md](docs/RELEASE.md)。

1. 合并已审阅的变更，等待 CI 全绿，核对兼容性、测试边界和贡献署名。
2. 在 `CHANGELOG.md` 顶部写目标版本、**实际发布日**及致谢。主版本=不兼容、次版本=功能、修订号=修复。本地 `main` 与远端一致，除该文件外工作区干净。
3. `npm run release` 查看计划；确认后运行 `npm run release -- --yes`，需要时加 `--minor`、`--major` 或 `--version X.Y.Z`。此命令会提交、推送、发布 npm 与 GitHub Release，贡献 PR 不运行。
4. 脚本跑门禁、同步版本与版本表、提交、打 tag、推送，再经 `publish.yml` 先 dry-run 后真实 OIDC 发布。需预先配置 npm Trusted Publisher；dry-run 不代表已发布。
5. 核对真实发布日志、npm 版本/provenance、GitHub Release 与资产；npm 和 Release tarball 应同字节并记录 SHA-256，同时复核归属。已发布 tag 保持稳定，错误通过新版本修复。

纯贡献流程文档更新通常无需单独提升包版本或发布 npm。

## 许可

提交贡献即同意按本仓库 MIT License 分发。仅提交你有权贡献的内容，并保留适用的第三方许可与署名。
