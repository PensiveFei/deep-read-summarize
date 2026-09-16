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

## npm 发布流程

### 首选：npm Trusted Publishing（OIDC，无 token、无 OTP）

```yaml
.github/workflows/publish.yml  →  在 GitHub Release 被发布时自动发布
```

凭据由 GitHub OIDC 在运行时现场换取，仓库里不存任何 npm token，也不会触发 npm 的 2FA 提示。

```bash
# 1. 本地全绿
npm run lint && npm test && npm run test:node && npm run validate

# 2. 打 tag 并推送
git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z

# 3. 建 Release —— 这一步触发 publish.yml
gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <notes 文件>

# 4. 验证线上
npm view deep-read-summarize --prefer-online
```

**前置（每个包一次性，只能在网页上配）**：
`https://www.npmjs.com/package/<包名>/access` → Trusted Publishers → Add，填
Provider `GitHub Actions` / Organization or user `PensiveFei` / Repository `deep-read-summarize` /
Workflow filename `publish.yml` / Environment 留空。

**历史 tag 里没有这个 workflow 时**（workflow 定义从 main 取，包内容从 tag 取）：

```bash
gh workflow run publish.yml --ref main -f publish_ref=refs/tags/vX.Y.Z
gh run watch
```

### 回退：本地发布（需要交互式 2FA）

> ⚠️ 2026-07 起 npm 已限制「绕过 2FA 的 granular access token」用于**直接发布**，
> 所以本地发布只能靠交互式 OTP —— 不再有「建个长期 token 一劳永逸」这条路。

```bash
cd <项目目录>
npm run lint && npm test && npm run test:node && npm run validate   # 先本地全绿
npm publish --otp=<6位码>                                            # prepublishOnly 自动跑门禁
npm view deep-read-summarize --prefer-online                         # 验证线上（首次查询可能索引延迟）
```

- 本沙箱环境 npm 默认缓存目录可能被拒（EPERM），用 `npm publish --cache <可写目录>`
- 版本号：功能增强 → minor（0.x → 0.y）；修复 → patch；不兼容 → major

## 当前版本速览

| 版本 | 状态 | 说明 |
|------|------|------|
| v0.1.0/v0.1.1 | git tag | 早期迭代，未上 npm |
| v0.2.x | npm 已发布 | 首个 npm 版本，含发布门禁 |
| v1.0.0 | 计划 | API 稳定后发布 |

> 早期迭代用 0.x 表达不稳定；API 稳定后再发 1.0.0。
> Tag 发布后保持稳定，出问题发修复版，不要反复改同一个 Tag。