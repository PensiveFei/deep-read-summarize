# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/).

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