# v0.1.0 — 首个预发布版

> **锁定的 DeepSeek Harness 版本**：workflow 工具语义（`agent()` / `parallel()` / `phase()` / `log()` / `args`），以 CHANGELOG.md 记录为准。
> **兼容性**：本版本为 pre-release（0.x），接口可能变化；已在 `docs/RELEASE.md` 记录升级注意事项。

## 新增

- 四种输入解析器插件：书籍（PDF/EPUB/MOBI）、论文（arXiv/PDF/HTML）、视频（yt-dlp 字幕）、网页——可单独替换，见 `parsers/`
- 三波次 MapReduce 精读：分块 → 并行子代理精读 → 合并成稿，长内容不溢出
- JSON Schema 结构化输出：`schemas/index.js` 约束各子任务结果，不合格自动重试
- 幂等缓存：`lib/cache.js` 对输入指纹去重，已处理的输入直接跳过
- 失败分级：配置错误终止（fatal），内容解析失败降级为缺口标记继续
- 质量校验：关键引用标注出处 + 成稿自检 + 可选重试（`maxRetries`）
- 输出 Obsidian 笔记：YAML frontmatter，可配合 Dataview 查询

## 修复

- 长文本获取不再依赖单次上下文（写入临时文件 + 行范围分块）
- 独立质量校验子代理超时问题（合并进成稿波次）

## 升级提醒

- 这是首个公开版本，无旧版迁移负担
- `options` 参数与 README 示例保持一致即可

## 已知问题

- DSH 为 developer preview，升级后需重跑 `npm test` 验证
- 视频字幕依赖 yt-dlp，未安装时需手动提供转写文本
- 子代理写 Obsidian 可能受权限限制，workflow 会返回内容由主代理落盘

---

## 演示

```bash
npm test    # 17 项离线测试
```