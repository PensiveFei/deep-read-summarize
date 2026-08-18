# v0.1.0 — 首个预发布版

> **锁定的 DeepSeek Harness 版本**：workflow 工具语义（`agent()` / `parallel()` / `phase()` / `log()` / `args`）。
> **兼容性**：0.x 为早期迭代，接口可能变化；升级前重跑 `npm test`。

## 发布说明

deep-read-summarize 是一个给 DSH（DeepSeek Harness）用的精读工作流：输入一本书、一篇论文、一个视频链接或网页，输出一份带 YAML frontmatter 的结构化 Obsidian 笔记。本版本是首个公开预发布版，核心流程已可用，接口细节在 1.0.0 前可能调整。

## 新增

- **四种输入解析器插件**（`parsers/`）：书籍（PDF/EPUB/MOBI）、论文（arXiv/PDF/HTML）、视频（yt-dlp 字幕抓取）、网页正文——每种可单独替换，fork 后只改自己的解析器
- **三波次 MapReduce 精读**：解析器获取分块 → 并行子代理精读（Map）→ 合并成稿（Reduce），长内容不溢出上下文
- **JSON Schema 结构化输出**（`schemas/`）：各子任务结果受 schema 约束，不合格自动重试
- **幂等缓存**（`lib/cache.js`）：对输入指纹去重，已处理过的输入直接跳过，省 token
- **失败分级**：配置错误直接终止（FATAL）；内容解析失败降级为缺口标记继续（可降级）
- **质量校验**：关键引用标注出处 + 成稿自检 + 可选重试（`maxRetries`）
- **Obsidian 输出**：YAML frontmatter（type 字段可配合 Dataview 查询），输出目录可配置（`outputDir`）
- **工程配套**：CI（lint + 17 项 fixture 测试 + Gitleaks 密钥扫描）、SECURITY.md、CONTRIBUTING.md、CHANGELOG.md

## 修复

- 长文本获取不再依赖单次上下文（写入临时文件 + 行范围分块）
- 独立质量校验子代理超时问题（合并进成稿波次）
- 硬编码本地路径全部参数化（`outputDir` / `tempDir`），通过 6/6 安全检查

## 升级提醒

- 首个公开版本，无旧版迁移负担
- `options` 参数与 README「用法」示例保持一致即可

## 已知问题

- DSH 为 developer preview，升级后需重跑 `npm test` 验证
- 视频字幕依赖 yt-dlp，未安装时需手动提供转写文本
- 子代理写文件可能受权限限制，workflow 会返回内容由主代理落盘

## 验证

```bash
npm test        # 17 项离线测试（不依赖真实 API）
npm run lint    # 13 个 JS 文件语法检查
npm run validate
```

**当前功能列表（v0.1.0）**

| 能力 | 状态 |
|------|------|
| 书籍解析器（PDF/EPUB/MOBI） | ✅ |
| 论文解析器（arXiv/PDF/HTML） | ✅ |
| 视频解析器（yt-dlp 字幕） | ✅ |
| 网页解析器 | ✅ |
| 分块 + 并行精读（MapReduce） | ✅ |
| JSON Schema 输出约束 | ✅ |
| 幂等缓存 | ✅ |
| 失败分级 | ✅ |
| 质量校验循环 | ✅ |
| Obsidian 输出（Dataview 兼容） | ✅ |
| CI + 密钥扫描 | ✅ |
| 自定义解析器插件（custom-parsers/） | ✅ |