// ============================================================================
// JSON Schemas — 结构化输出约束
// ============================================================================
// 所有子任务产出（获取分块 / 精读 / 成稿元数据）都用 JSON Schema 校验，
// 不合格自动重试，保证下游（Markdown/Notion/数据库导出）可稳定消费。
//
// 注意：本 schema 子集遵循 DSH workflow agent() 的约束
// （type/properties/required/additionalProperties/items/enum/const/oneOf）。
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
