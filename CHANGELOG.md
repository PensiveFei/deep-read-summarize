# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/).

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