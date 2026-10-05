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
.github/workflows/publish.yml  ←  手动 dispatch（首选，可靠）/ Release 被发布 / 历史 tag 补发
```

凭据由 GitHub OIDC 在运行时现场换取，仓库里不存任何 npm token，也不会触发 npm 的 2FA 提示。

```bash
# 1. 本地全绿
npm run lint && npm test && npm run test:node && npm run validate

# 2. 打 tag 并推送（publish.yml 只接受 tag ref）
git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z

# 3. 触发发布：手动 dispatch（可靠）。先干跑一次也行：加 -f dry_run=true
gh workflow run publish.yml --ref main -f publish_ref=refs/tags/vX.Y.Z
gh run watch

# 4. 建 Release（记录用；见下方「别把建 Release 当主路径」）
gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <notes 文件> <从 npm 拉回的 tgz>
```

> ⚠️ **别把「建 Release」当发布主路径**：`release: published` 事件的投递**不稳**
> （实测：同一天里，给一个历史 tag 补建 Release 没触发，另一个又正常触发）。
> Release 仍然要建——用户看的是它——但**发布动作交给第 3 步的 dispatch**。
> 两条都跑时 workflow 是幂等的：第二次会跳过发布步骤并留一条 warning，不会变红。

**怎么算发成功了（判据，2026-09-24 实测）**：

1. **只看运行日志**：出现 `+ deep-read-summarize@X.Y.Z` 与 `Signed provenance statement`
   （另有一条 sigstore 透明日志链接）。
2. **不要用 `npm view` 的即时结果判断**：registry 要 **1–2 分钟**才对外可见，
   当场查必然是 **E404**、看着像失败（实测 t+40s 仍是 404，t+120s 才可见）。
3. **`--dry-run` 全绿不等于发布成功**：npm 的 OIDC 换票失败会被 CLI 静默吞掉，
   真正的校验发生在写 registry 的那一刻（未配 Trusted Publisher 时报 404）。
4. 最后再 `npm view deep-read-summarize dist-tags --json --prefer-online` 复核 `latest`。

**发完别忘了**：用 `npm pack <包>@<版本>` 拉回 registry 那一份字节，挂成 Release 资产
（本地构建的 tarball 与 CI 的不保证同字节），并把 SHA-256 写进 release notes。

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
| v0.1.0 / v0.1.1 | git tag | 早期迭代，未上 npm |
| v0.2.x | npm 已发布 | 首个 npm 版本，含发布门禁 |
| v0.3.0 – v0.3.7 | npm 已发布 | 解析器插件化、幂等缓存、视频转写流水线 |
| v0.3.8 | **仅 GitHub** | 打了 tag 与 Release 但漏发到 npm（Trusted Publishing 迁移期的缺口；修复已随 0.3.9 交付） |
| v0.3.9 | npm 已发布 | macOS / Linux 支持（转写链路跨平台） |
| v0.3.10 | npm 已发布 | 修：失效的 uv 镜像、空转写被当成成功、发布文档过时 |
| **v0.3.11** | **npm 已发布（当前）** | 文档：README 补「支持平台」；CI：三平台跑全套门禁 |
| v1.0.0 | 计划 | API 稳定后发布 |

> 早期迭代用 0.x 表达不稳定；API 稳定后再发 1.0.0。
> Tag 发布后保持稳定，出问题发修复版，不要反复改同一个 Tag。