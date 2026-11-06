---
title: "《Chain-of-Thought Prompting Elicits Reasoning in Large Language Models》深度精读笔记"
aliases: ["CoT Prompting", "思维链提示"]
author: Jason Wei, Xuezhi Wang, Dale Schuurmans, Maarten Bosma, Brian Ichter, Fei Xia, Ed Chi, Quoc Le, Denny Zhou
year: 2022
type: paper
source: arXiv:2201.11903 (NeurIPS 2022)
url: https://arxiv.org/abs/2201.11903
tags: [精读, 论文, LLM, 思维链, Prompting, 推理]
created: 2026-08-18
status: 已完成
---

# 《Chain-of-Thought Prompting Elicits Reasoning in Large Language Models》深度精读笔记

> **示例说明：** 这是历史阅读笔记的公开副本；生成时的模型、项目版本、耗时和质量检查结果未记录。笔记中的主要数据和引文可对照 [arXiv v2](https://arxiv.org/abs/2201.11903v2)，作者元数据包含后续版本的信息；“第 N 行”指当时提取文本，未必能在当前来源复现。2022 年关于模型规模的观察受当时实验设置限制，不应视为今天的普遍门槛。除下文注明的个别抽查外，内容未逐条核验。

> Google Research / Brain Team 提出思维链（Chain of Thought）提示：仅在 few-shot 示例中加入模拟人类推理的自然语言中间步骤，无需任何微调，就把 PaLM 540B 在 GSM8K 上的准确率从 17.9% 推升至 58.1%（该结果使用外部计算器）（新 SOTA，超越微调+验证器的 55%，逼近 9-12 岁儿童的 60%），并证明思维链推理是模型规模的涌现能力（约 100B 参数以上才出现）。

## 1. 概述

本文发表于 2022 年（arXiv:2201.11903，NeurIPS 2022），是推理提示（reasoning prompting）领域的里程碑工作。研究动机清晰：大规模语言模型（100B+ 参数）在 system-1 任务（情感分析、主题分类等直觉型任务）上表现强劲，但在 system-2 任务（数学、逻辑、常识推理等需要多步思考的任务）上即使扩展到数百亿参数仍然挣扎——许多此类任务呈现"平坦的规模曲线"（flat scaling curve）：单纯增大模型没有实质收益。

作者提出的方法极简：在 few-shot prompting 的每个示例中，除最终答案外附上一段"思维链"（chain of thought）——一系列模拟人类推理过程的短句（如"Jane 先给 2 朵花后剩 10 朵，再给 3 朵给爸爸后剩 7 朵，所以答案是 7"）。通过让模型模仿这种逐步分解的推理模式，足够大的现成（off-the-shelf）模型无需任何训练即可突破平坦的规模曲线。

实验覆盖三大类推理任务：算术推理（6 个数据集，含 GSM8K 新 SOTA）、符号推理（3 个玩具任务，含域外泛化）、常识推理（4 个数据集）。核心发现：思维链提示只在约 100B 参数以上的模型中优于标准提示，小模型会产生"流畅但不合逻辑"的思维链反而更差；消融实验证明收益来自自然语言中间步骤的顺序推理，而非单纯增加计算量或激活预训练知识。

## 2. 结构拆解

### 2.1 研究动机与思维链定义（Introduction + Section 2）
- 用 Stanovich & West (2000) 的 system-1（快速直觉）/ system-2（缓慢刻意）双系统框架定位任务类型；LLM 擅长 system-1，在 system-2 上曲线平坦。
- 思维链提示的 4 个优点：①分解多步问题、为难题分配更多计算；②提供可解释窗口便于调试；③适用于数学/符号/常识推理，原则上覆盖任何人类可用语言解决的任务；④只需在 few-shot 示例中加入思维链，即可在足够大的现成模型上引出，无需训练。
- 关键洞察："我们将会证明，只要在 few-shot 提示的示例中提供思维链推理的示范，足够大的语言模型就能生成思维链"（第 67 行）。

### 2.2 实验设置（Section 3.1）
- 数据集 6 个：SingleOp、SingleEq、AddSub、ASDiv（容易组）+ MultiArith、GSM8K（困难组）。
- 模型：LaMDA（422M/2B/8B/68B/137B，仅预训练 checkpoint）+ PaLM（8B/62B/540B），均为 decoder-only transformer；greedy decoding；LaMDA 报 5 随机种子平均。
- 一组 8 个手工编写的通用 few-shot 示例（含思维链），用于全部数据集，未做 prompt engineering。

### 2.3 算术推理结果（Section 3.2-3.4）
- **GSM8K 新 SOTA（Table 1）**：PaLM 540B 标准提示 17.9% → 思维链提示并使用外部计算器 **58.1%**；对比：微调 GPT-3 175B 33%、微调+验证器（先前 SOTA）55%、9-12 岁儿童 60%。
- 数据集分化：容易组标准提示本身有上升曲线，思维链仅小幅增益；困难组（MultiArith/GSM8K）标准提示曲线平坦，思维链使其随规模显著上升。
- **关键规模现象**：思维链只在 ~100B 参数以上优于标准提示；小模型产生"流畅但不合逻辑"的链，性能反而更差（第 163 行）。
- GSM8K 人工误差分析（LaMDA 137B，50 正 + 50 负样本）：50 个正确样本中 49 个链逻辑与数学均正确（1 个靠错误推理巧合答对）；50 个错误样本中 46% 近乎正确（计算器/符号映射/少一步），54% 有重大语义或连贯性错误。
- **消融实验（Table 3，GSM8K）**：

| 变体 | LaMDA 137B | PaLM 540B |
|------|-----------|-----------|
| Standard prompting | 6.3 | 17.9 |
| **Chain of thought prompting** | **14.8** | **56.5** |
| Equation only（只输出方程） | 5.7 | 21.7 |
| Variable compute only（输出等长点序列） | 6.0 | 17.7 |
| Thought after answer（答案后才给链） | 5.9 | 18.0 |

  消融结论：仅输出方程不够（GSM8K 语义太难直接转方程）；额外 token 计算不是原因；答案之后的链与基线相当——收益来自**自然语言中间步骤的顺序推理**。
- 鲁棒性：3 位标注者独立撰写思维链（不同风格）均显著优于基线（Figure 4）；从 GSM8K 训练集随机采样示例表现相当；GPT-3 davinci 结果与 LaMDA 137B 相当。

### 2.4 符号推理（Section 4）
- 3 个玩具任务：Last letter concatenation（"Amy Brown"→"yn"）、Reverse list、Coin flip。
- in-domain 下标准提示低但非零、思维链解决大多数；**OOD（更多步数）下标准提示在大多数场景完全失败，思维链获得上升规模曲线**。
- 对未见符号做抽象操作的能力只在 ~100B 规模出现；PaLM 540B 不用思维链已能解决 reverse list，但思维链仍显著提升 PaLM 62B（其多数任务优于 LaMDA 137B，作者归因于训练数据质量）。

### 2.5 常识推理（Section 5）
- 4 个数据集：CommonsenseQA、StrategyQA、BIG-bench 的 Date Understanding 与 Sports Understanding。
- PaLM 540B + 思维链：**StrategyQA 75.6% vs 先前 SOTA 69.4%**；**Sports Understanding 95.4% vs 84%**（爱好者基线）；其余数据集亦提升（Figure 6）。
- 常识任务提升幅度明显小于算术任务——思维链对"程序性多步任务"帮助大、对"依赖背景知识"的任务帮助有限。

### 2.6 讨论与相关工作（Section 6-8）
- 思维链推理是模型规模的**涌现属性（emergent property）**："标准提示原则上只是大语言模型能力的下界"。
- 作者自认局限：思维链只是模拟思考过程、不回答是否真推理；依赖大模型+手工示例是主要成本；OOD 实验只是步数外推。
- 与最接近工作的对比：Cobbe et al. 2021（微调+验证器，本文更简单——纯提示不改模型）；Nye et al. 2021（scratchpad，本文把域特定原语泛化到自然语言，可视为"自然语言程序"）。
- 可复现性：公开所有任务精确提示（Table 20-27）、GPT-3 davinci 结果、LaMDA 137B 全部输入/输出（github.com/jasonwei20/chain-of-thought-prompting）。

## 3. 关键概念与术语表

| 术语 | 解释 |
|------|------|
| Chain of Thought (CoT) | 思维链：模拟人类推理的自然语言中间步骤序列，引导模型逐步分解问题 |
| System-1 / System-2 tasks | 直觉快速任务 / 需要缓慢刻意多步思考的推理任务（Stanovich & West 2000） |
| Few-shot prompting | 少样本提示：in-context 示例驱动的零参数学习（Brown et al. 2020） |
| Flat scaling curve | 平坦规模曲线：性能不随模型规模增长的现象 |
| Emergent property | 涌现属性：本文核心命题——CoT 能力随规模达到阈值而突然出现 |
| In-domain / OOD | 与示例步数一致 / 步数更多的测试设置 |
| External calculator | 外部计算器：Table 1 中 CoT 与 verifier 结果均使用，非纯端到端 |
| Verifier | 验证器：Cobbe et al. 2021 中校验中间步骤的独立模型 |
| Scratchpad | 草稿本：Nye et al. 2021 中模型执行中间计算的机制 |
| Ablation study | 消融实验：equation only / variable compute only / thought after answer |
| GSM8K / MultiArith / ASDiv / SingleOp / SingleEq / AddSub | 算术推理数据集（SingleOp 等为容易组，GSM8K 最困难） |
| LaMDA / PaLM / GPT-3 davinci | 被测模型系列（decoder-only transformer） |

## 4. 关键引用（仅关键结论，标注出处）

1. "Experiments show that inducing a chain of thought via prompting can enable sufficiently large language models to better perform reasoning tasks that otherwise have flat scaling curves."（Abstract，第 35 行）——核心命题。
2. "Notably, chain of thought prompting does better than standard prompting only at the scale of ~100B parameters; models of smaller scale produced fluent but illogical chains of thought, leading to lower performance than standard prompting."（Section 3.2，第 163 行）——规模涌现的关键证据。
3. "our work is the first to use a prompting-based approach to show that reasoning can be elicited in off-the-shelf language models of sufficient scale."（Related Work，第 457 行）——贡献定位。

## 5. 批判性分析

**论证强处**
- 方法极简而影响深远：一个提示技巧（加中间步骤）就使 GSM8K 提升 40 个百分点，无需任何训练，可复现性强；公开了全部提示、数据和预测。
- 消融设计巧妙：equation-only（21.7 vs 56.5）证明中间推理步骤的关键性；variable-compute（点序列，17.7）干净地排除了"仅增加输出 token"的廉价解释；thought-after-answer（18.0）证明顺序推理本身有价值而非激活预训练知识。
- 鲁棒性验证较全面：多标注者风格、随机采样示例、GPT-3 跨模型验证。
- 首次将"弱推理"从 finetuning 范式带入纯 prompting 范式，开启了 CoT/self-consistency/ToT 整个研究浪潮。

**论证弱处与局限**
- **"SOTA"的附带条件**：58.1% 与 verifier 的 55% 均使用外部计算器，非纯语言模型原生推理；且 17.9% 的标准基线无计算器，两组口径不完全对齐。
- **数字一致性瑕疵**：第 148 行写 PaLM "8B, 62B, 535B" 而全文其他处写 540B；Table 1 的 58.1% 使用外部计算器，Table 3 的 56.5% 不使用计算器；引用需注明设置。
- **误差分析样本小且主观**：仅 50+50 个 GSM8K 样本、仅 LaMDA 137B，46%/54% 的错误分类是人工归因。
- **涌现的时效性**："~100B 门槛"是 2022 年的观察；后续 instruction tuning（FLAN）、synthetic data + distillation（Orca/Mistral 路线）证明更小模型也能获得 CoT 能力——涌现部分取决于训练与评估设置。
- **58.1% 只是 greedy decoding 下限**：作者自注后续 self-consistency（Wang et al. 2022）多数投票可大幅提升；Kojima et al. 2022 证明 zero-shot CoT（"Let's think step by step"）连示例都不需要。
- **不忠实性早期证据**：50 个正确样本中 1 个（2%）靠错误推理巧合答对，预示后来 Lanham et al. 2023 的发现——模型常不按其思维链行事，CoT 可能是"事后合理化"而非真实推理路径。
- **覆盖范围**：未评估 instruction-tuned 或 encoder-decoder 模型；常识推理提升远小于算术，说明 CoT 的适用范围集中在可程序化分解的任务。

**可质疑之处**
- "涌现"归因可能混淆数据质量因素（PaLM 62B 反超 LaMDA 137B 被归因于训练数据）；OOD 实验被批评为"玩具任务照搬结构"的伪 OOD；思维链忠实性（54% 严重错误）未经验证。

## 6. 个人思考与应用

**与已有知识的联系**
- 这篇论文是"提示工程"从技巧走向科学的分水岭：它证明模型的"推理能力"可以通过引导而非训练来释放，为后来所有 prompting 研究（self-consistency、ToT、least-to-most、zero-shot CoT）提供了范式基础。
- "平坦规模曲线 + 提示即突破"的观察，与 LLM 评测中"能力涌现"的争论直接相关，提醒我们评估方法本身会影响能力测量结果。

**如何应用（行动要点）**
1. **写提示时加入"思维链"结构**：任何需要多步推理的任务（代码调试、数学、逻辑分析），在示例中展示逐步推理过程，可显著提升现成 LLM 的表现——这是最实用的日常技巧。
2. **注意规模门槛**：小模型（<10B）上盲目加思维链可能适得其反（"流畅但不合逻辑"）；大模型（100B+）才受益明显，选择模型时需匹配。
3. **评估要注明设置**：报告 LLM 推理成绩时应注明"是否用外部工具/计算器""采样策略（greedy vs 多数投票）""提示风格"——这些都会大幅改变数字。
4. **警惕思维链不忠实**：模型展示的推理过程未必是真实计算路径，关键决策场景需人工复核，不能盲信"看起来很合理的步骤"。
5. **对后续研究者的启示**：可将"思维链忠实性""小模型蒸馏 CoT 能力""多模态思维链"作为研究切入点——本文留下的开放问题正是后续工作的沃土。

## 7. 延伸阅读

**推理提示研究脉络**
- Wang et al. (2022). Self-Consistency Improves Chain of Thought Reasoning——多数投票改进 CoT。
- Kojima et al. (2022). Large Language Models are Zero-Shot Reasoners——zero-shot CoT。
- Yao et al. (2023). Tree of Thoughts——思维树扩展。
- Zhou et al. (2022). Least-to-Most Prompting——由易到难提示。
- Cobbe et al. (2021). Training Verifiers to Solve Math Word Problems——微调+验证器（先前 SOTA）。
- Nye et al. (2021). Show Your Work: Scratchpads for Intermediate Computation with Language Models。

**规模与能力**
- Chowdhery et al. (2022). PaLM: Scaling Language Modeling with Pathways——PaLM 模型。
- Wei et al. (2022). Emergent Abilities of Large Language Models——涌现能力综述。
- Brown et al. (2020). Language Models are Few-Shot Learners——few-shot prompting 基线。

**LLM 推理评测**
- Stanovich & West (2000). Individual differences in reasoning——system-1/2 框架来源。
- BIG-bench collaboration (2021)——Date/Sports Understanding 任务来源。

---
## 8. 相关笔记

- [LLM 情绪智力精读](emotional-intelligence.md) —— 同批精读的 LLM 论文

---
*笔记整理于 2026-08-18*