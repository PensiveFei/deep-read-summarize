// ============================================================================
// JSON Schemas — 结构化输出约束
// ============================================================================
// 谁在用哪一份（别凭印象——此前 workflow 脚本里有一份手抄副本，已经漂移）：
//   - fetchResultSchema：**真的在用**。workflow.js 构建自包含脚本时把它注入进去
//     （kind 的 enum 按解析器注册表补齐），脚本里不再有第二份副本。
//   - chunkReadSchema：**workflow 没用**。波次2 的子代理直接返回自由文本，
//     成稿时按 Markdown 拼接；这份留给程序化调用方（自建管线要结构化块输出时）。
//   - qualityChecklistSchema：**workflow 没用**。波次3 的内嵌自检走脚本内的
//     { pass, issues } 轻量 schema。
// 改这个文件会直接影响波次1 —— 改完跑 npm test（内含 schema 子集回归）。
//
// 注意：本 schema 子集遵循 DSH workflow agent() 的约束
// （type/properties/required/additionalProperties/items/enum/const/oneOf）。
// 违反子集 = 引擎抛 UNSUPPORTED_SCHEMA = 整条 workflow 终止（不是降级）。
// ============================================================================

/** 波次1：获取+分块 的结构化输出 */
const fetchResultSchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["book", "paper", "video", "web"] },
    saved: { type: "boolean" },
    message: { type: "string" },
    totalLines: { type: "number" },
    metadata: {
      type: "object",
      properties: {
        title: { type: "string" },
        author: { type: "string" },
        year: { type: "string" },
        language: { type: "string", enum: ["zh", "en", "other", ""] }
      },
      required: [],
      additionalProperties: true
    },
    chunkPlan: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "number" },
          topic: { type: "string" },
          startLine: { type: "number" },
          endLine: { type: "number" }
        },
        required: ["id", "topic", "startLine", "endLine"],
        additionalProperties: false
      }
    }
  },
  required: ["saved"],
  additionalProperties: false
};

/** 波次2：单块精读的结构化输出（可选启用，默认自由文本 + 关键字段） */
const chunkReadSchema = {
  type: "object",
  properties: {
    chunkId: { type: "number" },
    topic: { type: "string" },
    keyPoints: { type: "array", items: { type: "string" } },
    concepts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          term: { type: "string" },
          definition: { type: "string" }
        },
        required: ["term", "definition"],
        additionalProperties: false
      }
    },
    citations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          quote: { type: "string" },
          location: { type: "string" },
          page: { type: "string" },
          chapter: { type: "string" },
          timestamp: { type: "string" }
        },
        required: ["quote", "location"],
        additionalProperties: false
      }
    },
    critique: { type: "string" },
    note: { type: "string" }
  },
  required: ["chunkId", "keyPoints"],
  additionalProperties: false
};

/** 成稿质量自检清单（波次3 内嵌） */
const qualityChecklistSchema = {
  type: "object",
  properties: {
    coverage: { type: "boolean" },
    citationsReal: { type: "boolean" },
    terminologyConsistent: { type: "boolean" },
    formatComplete: { type: "boolean" },
    lengthMet: { type: "boolean" },
    languageConsistent: { type: "boolean" },
    issues: { type: "array", items: { type: "string" } }
  },
  required: ["coverage", "citationsReal", "terminologyConsistent", "formatComplete", "lengthMet"],
  additionalProperties: false
};

module.exports = {
  fetchResultSchema,
  chunkReadSchema,
  qualityChecklistSchema
};
