# Release 模板

发布新版本时，把下面内容填好贴到 GitHub Releases 的 Release Notes 里。
不要直接抄 commit message（"fix bug"、"update deps" 没人看得懂），要写**结果**：修了什么场景的问题、新增能力解决什么需求、升级要不要改配置。

---

## vX.Y.Z（版本号规则：主版本=不兼容变更，次版本=新功能，修订号=修复）

**锁定的 DeepSeek Harness 版本**：`<版本号或 commit>`
**兼容性变化**：<有破坏性变更？是否影响已有配置？能否回退？>

### 新增

- <新功能，说明解决什么需求>
- ...

### 修复

- <修复了什么场景下的问题>
- ...

### 升级提醒

- <升级后要不要改配置 / 输入格式 / 输出路径>
- ...

### 已知问题

- <未解决的问题或限制>
- ...

---

## npm 发布流程（v0.2.0 起）

```bash
cd <椤圭洰鐩綍>
npm run lint && npm test && npm run validate   # 先本地全绿
npm pkg fix                                   # 规范化 package.json（npm 建议）
npm publish                                   # prepublishOnly 自动跑门禁（测试+lint+安全）
npm view deep-read-summarize --prefer-online  # 验证线上（注意：发布后首次查询可能 404，索引有延迟）
```

- token 存在用户级 ~/.npmrc（//registry.npmjs.org/:_authToken=...），npm whoami 可验证
- 本沙箱环境 npm 默认缓存目录可能被拒（EPERM），用 npm publish --cache <工作区内目录>
- 版本号：功能增强 → minor（0.x → 0.y）；修复 → patch；不兼容 → major

## 当前版本速览

| 版本 | 状态 | 说明 |
|------|------|------|
| v0.1.0/v0.1.1 | git tag | 早期迭代，未上 npm |
| v0.2.x | npm 已发布 | 首个 npm 版本，含发布门禁 |
| v1.0.0 | 计划 | API 稳定后发布 |

> 早期迭代用 0.x 表达不稳定；API 稳定后再发 1.0.0。
> Tag 发布后保持稳定，出问题发修复版，不要反复改同一个 Tag。