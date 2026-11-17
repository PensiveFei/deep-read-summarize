# 精读质量基准 v1

这个离线基准用于比较同一批材料在不同版本中的**关键事实覆盖、可定位逐字引文、无原文支持的结论和耗时**。它提供样本、参考要点、引文位置、复核模板和计分脚本；运行真实模型与人工审阅需要使用者完成。

## 范围与证据边界

- 16 个文本样本：论文、网页、书籍片段、视频逐字稿各 4 个；其中 **12 个是本项目自编的模拟文本，4 个是有出处的真实短摘录**。视频样本测试逐字稿处理，不测试下载、音频识别或视频字幕是否完整。
- 每条关键事实和参考引文都标了样本内行号，覆盖数字、否定词、条件和局限。样本与参考标注由 AI 助手逐条整理并经程序检查引文位置；**尚未经独立人工复核**。其中的研究、地址、人物和数据均为模拟内容，不能作为现实证据。
- 真实短摘录的作者、链接、授权及截取方式见 `cases.json`。原文中没有摘取的内容不属于这个任务的输入，不能把它当作已处理全文。论文摘录按 CC BY 4.0 署名；书籍为公有领域；NASA 资料标明来源及其使用说明。
- 文本较短、样本量小，不能代表整本书、复杂 PDF、图表、OCR、长视频或所有语言。不要将此基准的得分解释成项目整体准确率；不要用公开样本当作唯一的防过拟合评估。
- 参考事实的语义正确性、摘要是否覆盖、哪些结论无依据都需要**人核对**。脚本不会用关键词匹配冒充语义判分；未经完整人工复核的项目显示为 `null`，不会记作通过。引文只检查笔记第 4 节提取出的显式逐字引用及其原文行号，不判断改写是否符合原意。

## 准备并运行

在源码目录运行，选择一个新的空目录，脚本不会覆盖已有内容：

```bash
node benchmarks/quality/prepare.js --out /path/to/empty-run
```

生成 `sources/`（每个样本的 UTF-8 文本）、`results/`（空目录）、`reviews/`（待填写模板）和 `manifest.json`。每个样本用清单中的类型调用 `deep_read_summarize`，输入对应的本地文本路径；视频样本走用户提供的逐字稿入口，不需要联网下载视频。将每次工具返回的**完整 JSON 结果**保存到 `results/<id>.json`，不得只保存聊天中的摘要。样本是短片段，建议固定 `lengthMode: "concise"`，必要时统一显式设置较小的 `minWords`；修改默认值时要在运行记录里写明。

在 `results/run.json` 记录实际配置，例如：

```json
{
  "model": "provider/model@immutable-version",
  "dshVersion": "实际宿主版本",
  "pluginVersion": "0.6.5",
  "settings": { "lengthMode": "concise", "minWords": 1, "maxChunks": 4 }
}
```

不要把密钥、私人路径或原始私人文档提交到仓库。重复两版时使用同一来源、模型及生成设置，尽可能在同样宿主和负载下运行；耗时受网络、缓存与系统负载影响，建议多次测量。样本仍然可能触发模型或第三方 API 费用。

## 人工复核

对照 `cases.json` 和实际生成的笔记，逐个填写 `reviews/<id>.json`：

1. 由审阅者逐条核实参考事实对应原文。对每个事实填写 `covered`（表意和条件正确）、`missing` 或 `unclear`。反转否定词、数字、因果或适用范围不能算覆盖。
2. 在 `claims` 中列出笔记所有需要来源支持的实质性结论，每条标 `supported`、`unsupported` 或 `unclear`。完成后才设 `claimsComplete: true`；`unsupported` 是已审结论中无原文依据的条数，不能证明其余未审内容正确。
3. 完成上述复核后，将 `reviewerType` 从 `pending` 改为 `human`。自动生成的模板不是人工复核。建议记录评审人和争议处理方式，但无需上传个人信息。

填写示例（事实键以对应样本为准）：

```json
{
  "caseId": "paper-s01",
  "reviewerType": "human",
  "facts": { "sample": "covered", "dose": "missing", "result": "unclear" },
  "claimsComplete": true,
  "claims": [
    { "text": "笔记中的一条结论", "status": "supported" },
    { "text": "笔记中的另一条结论", "status": "unsupported" }
  ]
}
```

## 计分与比较

```bash
node benchmarks/quality/score.js --results /path/to/empty-run/results --reviews /path/to/empty-run/reviews --out /path/to/report.json
node benchmarks/quality/score.js --results /path/to/next-run/results --reviews /path/to/next-run/reviews --baseline /path/to/report.json --out /path/to/next-report.json
```

输出文件必须不存在。报告包含完成样本数、经复核的关键事实覆盖率、引文通过数/总数、人工标记的无依据结论数和用时中位数；未提供结果或复核的样本会列出，但不会冒充满分。覆盖率分母包含 `unclear`，并单列该数量。没有显式引文时比例为 `null`，不是 100%。

比较要求样本内容哈希与已运行样本完全一致、所有运行样本都完成两类人工复核，并且两个 `run.json` 的模型、DSH 版本和设置相同；插件版本可以不同。用时中位数差只在两次每个样本均有耗时时给出。即使满足这些条件，差异仍需要结合样本和重复试验解释。
