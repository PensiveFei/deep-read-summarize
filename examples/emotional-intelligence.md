---
title: "《Emotional Intelligence of Large Language Models》深度精读笔记"
aliases: ["Emotional Intelligence of LLMs", "LLM 情绪智力"]
author: Xuena Wang, Xueting Li, Zi Yin, Yue Wu, Jia Liu
year: 2023
type: paper
source: arXiv:2307.09042
url: https://arxiv.org/abs/2307.09042
tags: [精读, 论文, LLM, 情绪智力, 心理测量]
created: 2026-08-18
status: 已完成
---

# 《Emotional Intelligence of Large Language Models》深度精读笔记

> **示例说明：** 这是历史阅读笔记的公开副本；生成时的模型、项目版本、耗时和质量检查结果未记录。原文中的“第 N 行”指当时提取文本的行号，未必能在当前来源复现；请以原文为准。已抽查摘要中的一处引文并恢复原文笔误，其他内容未逐条核验。

> 清华大学心理学系团队（通讯作者：刘嘉）开发了首个适用于人类与 LLM 的情境式情绪理解测验 SECEU（40 题），以 541 名人类被试建立常模，测出 GPT-4 EQ 达 117（超过 89% 人类、达到专家级）；但发现"分数高"与"机制像人"完全正交——EQ 最低的 Koala 反而表征模式最像人类。

## 1. 概述

本文发表于 2023 年 7 月（arXiv:2307.09042），是首批用传统心理测量学方法系统评估大语言模型（LLM）情绪智力（Emotional Intelligence, EI）的研究之一。研究动机清晰：自 ChatGPT 问世以来，对 LLM 的评测集中在语言生成、知识利用与复杂推理等认知维度（如 GPT-4 在文本版 IQ 测验中超越 99% 人类），但其与人类情绪、价值观的"对齐"（human alignment）——真实世界广泛部署的核心能力——从未被系统检验。

为此，作者以 Mayer-Salovey 能力模型中的"情绪理解"（Emotion Understanding, EU）为核心成分，开发了情境式情绪认知与理解测验 **SECEU**：40 道题、每题给出一个含转折的真实情境（如"王参加数学竞赛自感未发挥全部潜力，成绩公布却发现进入前十"）与 4 种候选情绪，被试将 10 分按情绪强度分配到各选项（如 3、3、1、3 = 30% 惊讶、30% 喜悦、10% 困惑、30% 自豪）。研究者用共识评分法对 541 名中国大学生/研究生（女 339、男 202；均值 22.33 岁）施测建立常模（EQ 均值 100、SD 15；信度 Cronbach α=0.94；专家验证平均超过 99% 人群），再将 14 个主流 LLM 配置（GPT 系列、Claude、LLaMA 系、Pythia 系、ChatGLM、RWKV 等）的作答标准化为 EQ 分数，并用"多题判别力向量"的皮尔逊相关检验 LLM 与人类的表征模式相似性。

核心结论有三：其一，多数被测 LLM 的 EQ 与常人相当，GPT-4 以 EQ 117（超过 89% 人类）达到专家级（>115），而 DaVinci EQ 87 仅超过 18% 人类；其二，反直觉的是，表征模式分析显示部分高分模型的机制与人类质性不同——例如 Koala 虽 EQ 最低（83），模式相似度却最高（r=0.43, p<0.01, 超过 93% 人类）；其三，模型规模、训练方法（尤其 RLHF：text-davinci-002 到 003 从 >23% 跃升到 >83%）与架构（Transformer decoder-only 优于 encoder-decoder，RNN 的 RWKV 完全失败）均显著影响 EQ。

## 2. 结构拆解

### 2.1 研究动机与理论框架（Introduction）
- 以"系统化机制（Systemizing Mechanism）vs 情绪智力"的双能力框架开篇：远古男子做贝壳项链既需要"穿孔穿线的远见"（系统化），也需要"推断女性能感到喜悦"（共情/EI）。
- 论证为何 ToM（心理理论）任务不适合做 EI 标准化测验：①ToM 是异质概念（从错误信念到语用推理），难以满足信效度标准；②对普通成年人太简单，更适合做自闭症谱系等障碍的诊断工具。
- 引用 ToM 研究基准：2022 年前 LLM 几乎无 ToM；text-davinci-002（2022/01）达 70%（约 6 岁儿童水平）；text-davinci-003（2022/11）达 93%（约 7 岁）；GPT-4 在 in-context learning 下达 100%。

### 2.2 测量工具开发与人类常模（Methods + Results 前半）
- SECEU 设计：40 题、中英双语、每题 4 情绪 10 分分配制；JATOS + JsPsych 在线平台。
- 人类样本：N=541 大学生/研究生，共识评分法建立标准分（40×4 矩阵）。
- 心理测量学指标：个体差异显著（M=2.79, SD=0.822）；内部一致性 α=0.94；无天花板/地板效应（均值距离 2.19-3.32）；无显著性别差异（t(539)=1.34, p=0.18）；3 位专家平均超过 99% 人群验证效度。
- 评分公式：SECEU score = 40 题上模型回答与人类标准分欧氏距离的均值（越低越好）；EQ = 15 × (M − SECEU)/SD + 100。

### 2.3 LLM 的 EQ 表现（Results + 表 1/表 S1）
- 直接提示下仅 9/14 配置完成测验；LLaMA、Fastchat、RWKV-v4 及多数早期 API 模型（DaVinci、Curie、Babbage、text-davinci-001/002）失败。
- 排名（SECEU 原始分 / EQ / 百分位）：GPT-4（SECEU 1.89 最低，EQ 117/89% 最高）、text-davinci-003 114/83%、Oasst 107/64%、text-davinci-001 107/64%、Claude 106/61%、Vicuna 105/59%、Alpaca 104/56%、GPT-3.5-turbo 103/52%、Curie 102/50%、Babbage 100/44%、Dolly 98/38%、ChatGLM 94/28%、text-davinci-002 91/23%、DaVinci 87/18%、Koala 83/13%（最低）。
- 分级标准：expert（>115）仅 GPT-4；normal（85-115）为多数；poor（<85）为 Koala 等。

### 2.4 表征模式分析（Results 后半）
- 方法：人类模板 = 全部被试 40 维多题判别力向量的平均（leave-one-out 防相关膨胀）；Human-to-Human 相似度分布作常模（M=0.199, SD=0.166）；LLM-to-Human 相关系数低于人群均值 1 个 SD 即判定"机制质性不同"。
- 关键结果：Koala r=0.43（>93%）最像人类却 EQ 最低；Babbage r=-0.12、text-davinci-002 r=-0.04、Alpaca r=0.03、Vicuna r=-0.02 等高分模型的模式与人类质性不同；GPT-4 r=0.28（>67%）较高，作者推测其架构/训练方法变化使其 EU 更贴近人类。
- 提示工程的作用：Two-shot COT 使 DaVinci（r=0.41, >91%）和 text-davinci-003（r=0.31, >73%）模式相似度超过 GPT-4，而无提示时它们无法完成测验；提示对 GPT-4/GPT-3.5-turbo 影响甚微。

### 2.5 影响因素与讨论（Discussion）
- 模型规模：更大的模型通常 EQ 更高（emergent abilities），但 Oasst、Alpaca 等小模型也取得满意分数，说明规模之外的因素更深刻。
- 训练方法：SFT 提升语言能力与语境把握；RLHF 使回应更类人——text-davinci-002→003（采用 RLHF）的 EU 飞跃（>23%→>83%）是最有力证据。
- 架构：Transformer 系普遍良好；RNN 的 RWKV-v4 在各种提示下仍失败；decoder-only（GPT 系列）优于 encoder-decoder（Fastchat-t5）。
- 未来方向：EI 是多面构念（感知/促进/理解/管理），本文仅测 EU；应扩展至 ToM 式更广评估（但避免其低区分度）；多模态情绪理解（文本+面部表情/语调）；用开源模型直接操控训练变量以建立因果关系。

### 2.6 附录补充（表 S1/S2、提示工程）
- 表 S1（直接提示）与表 S2（提示工程 4 条件 × OpenAI 系列）完整披露，含 FAILED 状态。
- 提示工程细节：4 种策略（Zero-shot / 增强 Zero-shot+逐步思考 / Two-shot CoT / Two-shot CoT+逐步思考）；主实验 temperature=0.1/top_p=1/max_tokens=512，提示实验 0/0.9/2048。
- 数据预处理：空向量 (0,0,0,0) 保留；负值平移归一化（如 (-4,-2,-2,2)→(0,2,2,6)）；比例缩放至总和 10。

## 3. 关键概念与术语表

| 术语 | 解释 |
|------|------|
| Emotional Intelligence (EI) | 情绪智力：感知、促进、理解、管理情绪的多面能力（Mayer-Salovey 能力模型） |
| Emotion Understanding (EU) | 情绪理解：本测验测量的 EI 核心子能力，指理解情绪成分与强度 |
| SECEU | 本文开发的情境式情绪认知与理解测验（40 题、4 情绪、10 分分配制，中英双语） |
| Consensus scoring | 共识评分法：以群体平均作答作为"正确标准"（群体拥有情绪集体知识的前提） |
| EQ (Emotional Quotient) | 情绪商数：SECEU 原始分按人类常模标准化（M=100, SD=15） |
| SECEU score | 模型回答与人类标准分的逐题欧氏距离均值，越低越贴近人类 |
| Discriminability pattern | 多题判别力向量：40 维向量，记录每题回答到人类标准分的距离 |
| Human template | 全体被试判别力向量的平均（表征常模，leave-one-out 构建） |
| Human-to-Human similarity | 个体与人类模板的 Pearson 相关分布（M=0.199, SD=0.166） |
| LLM-to-Human similarity | LLM 判别力向量与人类模板的 Pearson 相关 r |
| Weak vs strong equivalence | 弱等价（分数相当）vs 强等价（加工机制一致） |
| Theory of Mind (ToM) | 心理理论：理解他人信念与意图的能力；本文认为其异质且区分度不足 |
| MSCEIT | Mayer-Salovey-Caruso 情绪智力测验，人类 EI 金标准，SECEU 的设计参照 |
| Two-shot Chain of Thought (COT) | 两样本链式推理提示，多数模型的"救命提示" |
| Step-by-Step Thinking prompts | 分步思考提示，仅对指令微调模型有效 |
| SFT / RLHF | 监督微调 / 基于人类反馈的强化学习 |
| Emergent abilities | 涌现能力：随规模增长突然出现的能力 |
| Null vector | (0,0,0,0)：模型无有效回答时的占位向量 |

## 4. 关键引用（仅关键结论，标注出处）

1. "Most achieved above-average EQ scores, with GPT-4 exceeding 89% of human participants with an EQ of 117."（Abstract，第 25-26 行）——GPT-4 的核心成绩。
2. "Interestingly, a multivariate pattern analysis revealed that some LLMs apparently did not reply on the human-like mechanism to achieve human-level performance, as their representational patterns were qualitatively distinct from humans."（Abstract，第 26-29 行；原文 reply 疑为 rely 的笔误）——全文最核心的机制发现。
3. "This suggests that Koala may represent emotions in the same way as humans do, as it performed well on items where humans excelled and struggled on items where humans faced challenges."（Results，第 303-305 行）——Koala 悖论的解读。
4. "Indeed, there is a giant leap in EU seen between text-davinci-002 (>23%) to text-davinci-003 (>83%), two different versions of the same model with the latter employing RLHF."（Discussion，第 372-374 行）——RLHF 效应的关键证据。
5. "An LLM that has an LLM-to-Human correlation coefficient one SD deviation below the mean of Human-to-Human distribution is considered as employing a qualitatively different mechanism from humans in EU."（Methods，第 288-290 行）——强等价判据。

## 5. 批判性分析

**论证强处**
- 方法学严谨性高：以 541 人建立人类常模、检验信度（α=0.94）与效度（专家验证），让"LLM vs 人类"比较有心理测量学依据；这是区别于多数"为 LLM 造新题"工作的核心特色。
- 提出"弱等价 vs 强等价"的双指标设计（EQ 分数 + 表征模式相关），比单纯比分数更进一步，是重要的方法论贡献。
- 数据披露透明：表 S1/S2 完整列出 FAILED 状态与全部条件结果，未选择性报告；测试、常模、提示词全部开源（emotional-intelligence.github.io），可复现性强。
- 覆盖模型面广：GPT 系列 8 个版本、Claude、LLaMA 系、Pythia 系、GLM、RWKV，甚至含非 Transformer 架构。

**论证弱处与局限**
- **"最佳表现"选择偏差**：论文只报告各模型在最优提示下的成绩（"a set of paraphrases...to get the best performance"），等于评估"理想条件下限"，标题与摘要却易被读作模型自身能力；且仅 OpenAI 系列获得提示工程机会，其余模型以最不利的直接提示定级，存在对照组不对称。
- **测量不稳定 → 构念效度存疑**：同一模型 EQ 随提示条件在 94-117 间大幅漂移（GPT-3.5-turbo 94↔105），测得的更接近"指令跟随+提示适配能力"而非稳定的情绪智力特质。
- **"同机制"推断偏弱**：皮尔逊相关只捕捉线性共变，无法证明因果机制相同；"1 个 SD 以下即质异"的阈值缺乏推断统计支撑；表 S1 中除 Koala 外所有 r 均不显著（GPT-4 的 r=0.28 未达 p<0.05），百分位数字却强化了"模型类人"的观感。
- **SECEU 只测 EU，非完整 EI**："GPT-4 达到专家级情绪智力"的说法有过度引申之嫌（专家级 >115 只是分数区间切分，而人类专家平均超过 99% 人群，两种"专家"口径不一致）。
- **Koala 悖论未充分解释**：EQ 最低却模式最像人，论文未深入讨论训练数据/微调如何造成"像人一样错"，也未讨论其对"EQ 是否适合做 LLM 排名"的警示。
- **样本与时效**：人类常模仅 17-30 岁中国学生；模型为 2023 年 3-5 月版本，具体 EQ 数值已明显过时——应关注其方法论而非排名。

**可质疑之处**
- 归一化三步会改写模型原始输出（负值平移+比例缩放），空向量 (0,0,0,0) 参与距离计算等于把"拒答"当作"四情绪强度均为 0"；中文人类常模 vs 英文模型作答的跨语言错位也未处理。
- 文中 "apparently did not reply on the human-like mechanism" 疑为 "rely" 笔误（第 27 行），措辞保守暗示证据强度有限。

## 6. 个人思考与应用

**与已有知识的联系**
- 本文把心理测量学（psychometrics）方法论系统引入 LLM 评测，与常见的 benchmark 刷分式评测形成鲜明对比——"以人类为参照系 + 双指标"的思路可迁移到任何"评估 AI 类人属性"的场景（如同理心、价值观对齐）。
- "分数等价 ≠ 机制等价"（Koala 悖论）与心理学中"行为表现 vs 潜在机制"的区分一脉相承，也呼应了表征相似性分析（RSA）在神经科学中的用法。

**如何应用（行动要点）**
1. **评测任何"类人能力"时**：先建人类常模，再测模型，用 EQ 分数 + 模式相似度双指标，避免只看单一分数。
2. **警惕提示依赖**：报告中应注明"在条件 C 下测得 EQ=X"，把提示词当作测量的一部分而非可选项。
3. **对模型能力的判断**：不要因 GPT-4 类模型分数高就断言其"像人"；高分可能来自非人类机制，伦理与安全评估应关注机制而非仅结果。
4. **复现实验**：SECEU 测试、常模与提示词已开源，可用来测试 2024 年后的新模型（如 GPT-4o、Claude 3/4、Llama 3）与 2023 年结果对比，观察"情绪智力"随模型迭代的变化趋势。
5. **若做后续研究**：可针对"提示敏感性"做系统性研究——把 EQ 的标准差当作"情绪理解稳定性"的新指标；或给开源模型（Koala 类）同等的提示工程待遇重测排名。

## 7. 延伸阅读

**同主题相关**
- Mayer, Salovey & Caruso (2016). The Ability Model of Emotional Intelligence (Emotion Review)——EI 能力模型的理论源头。
- Salovey & Mayer (1990). Emotional Intelligence (Imagination, Cognition and Personality)——EI 概念开创性论文。
- Kosinski (2023). Theory of Mind May Have Spontaneously Emerged in LLMs (arXiv:2302.02083)——LLM 心理理论的争议性研究。
- Sap et al. (2023). Neural Theory-of-Mind? On the Limits of Social Intelligence in Large LMs (arXiv:2210.13312)——LLM 社会智能的批判视角。
- Amin, Cambria & Schuller (2023). Will Affective Computing Emerge from Foundation Models? (arXiv:2303.03186)——ChatGPT 情感计算能力评估。

**方法论相关**
- Palmer et al. (2005). A Psychometric Evaluation of the MSCEIT V2.0 (Intelligence)——共识评分法的心理测量学基础。
- Tian et al. (2020). Multi-Item Discriminability Pattern (Cerebral Cortex)——多题判别力模式分析来源。
- King (2023). Administration of text-based IQ test to five LLMs——LLM 的 IQ 平行尝试。

**被测模型出处**
- Touvron et al. (2023). LLaMA (arXiv:2302.13971)；Chiang et al. (2023). Vicuna；Geng et al. (2023). Koala；Taori et al. (2023). Alpaca；Köpf et al. (2023). OpenAssistant；Peng et al. (2023). RWKV。

---
## 8. 相关笔记

- [CoT 提示工程精读](chain-of-thought.md) —— 同批精读的 LLM 论文

---
*笔记整理于 2026-08-18*