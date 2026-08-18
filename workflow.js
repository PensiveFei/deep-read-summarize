// ============================================================================
// deep-read-summarize — Deep reading & summarization workflow for DSH
// Version: 0.1.0
// ============================================================================
// 【用法】meta → workflow meta；script → workflow script；
//   args: { "input": "<url|path>", "type": "auto", "options": { "minWords": 2500, "fastMode": false, "maxChunks": 6, "requireCitations": true, "includeTimestamps": false, "cache": true, "outputDir": "./output", "tempDir": "./.tmp" } }
// ============================================================================

const meta = {
  "name": "deep-read-summarize",
  "description": "Deep reading & summarization of books/papers/videos/web (v3.0)",
  "whenToUse": "User provides a book, paper, video link or web page and wants a deep-read summary saved to Obsidian",
  "phases": [
    {
      "title": "解析器选择",
      "detail": "按类型选择解析器插件"
    },
    {
      "title": "获取与分块",
      "detail": "Parser fetches content, writes temp file, builds chunk plan"
    },
    {
      "title": "并行精读",
      "detail": "N subagents deep-read chunks in parallel (Map)"
    },
    {
      "title": "汇总成稿",
      "detail": "Merge into final note (Reduce) with embedded self-check"
    },
    {
      "title": "质量校验",
      "detail": "Optional QC loop with retries"
    }
  ]
};

// ===== script（复制到 workflow 工具的 script 参数）=====
const script = "// ========== deep-read-summarize v3.0 ==========\n// 3 波次：解析器获取分块 → 并行精读 → 成稿+质量校验\n// 特性：解析器插件化 / 失败纪律(fatal vs 降级) / 幂等 / 成本控制\n\n// ---------- 0. 配置校验（fatal 级错误：必须终止） ----------\nconst input = (args && args.input || \"\").trim();\nif (!input) throw new Error(\"[FATAL] args.input 缺失：请输入内容链接或文件路径\");\nconst forcedType = ((args && args.type) || \"auto\").toLowerCase();\nif ([\"auto\",\"book\",\"paper\",\"video\",\"web\"].indexOf(forcedType) === -1)\n  throw new Error(\"[FATAL] args.type 非法：必须为 auto|book|paper|video|web\");\nconst options = (args && args.options) || {};\nconst minWords = options.minWords || 2500;\nconst fastMode = !!options.fastMode;\nconst maxChunks = Math.max(1, Math.min(options.maxChunks || 6, 12));\nconst requireCitations = options.requireCitations !== false;\nconst includeTimestamps = !!options.includeTimestamps;\nconst maxRetries = options.maxRetries || 1;\nconst cacheEnabled = options.cache !== false;\nconst outputDir = options.outputDir || \"./output\";\nconst tempDir = options.tempDir || \"./.tmp\";\nconst tempFile = tempDir + \"/input.txt\";\n\n// ---------- 0.5 幂等检查：输入指纹缓存 ----------\nlet cacheHit = false;\nif (cacheEnabled && Array.isArray(args._processedKeys)) {\n  const fpKey = input.trim().slice(0, 300);\n  cacheHit = args._processedKeys.indexOf(fpKey) !== -1;\n  if (cacheHit) log(\"幂等命中：该输入已处理过，跳过\");\n}\nif (cacheHit) {\n  return { ok: true, cached: true, kind: forcedType, title: (args && args.title) || \"cached\", filePath: \"\", chunksCount: 0, fastMode: fastMode, qualityPassed: true, qualityIssues: [], failedChunks: 0, note: \"\" };\n}\n\n// ---------- 1. 解析器选择（由 args._parsers 注入） ----------\nphase(\"解析器选择\");\nconst parsers = args._parsers || {};\nconst kindNames = { book: \"书籍\", paper: \"学术论文\", video: \"视频\", web: \"网页/文章\" };\nconst kindFocus = {\n  book: \"按章节主题展开核心论点、论证、关键例子、章节间关系，收集关键概念与可引用原文（含页码/章节）\",\n  paper: \"四维精读：1)研究问题与方法 2)结论与贡献 3)局限与批判 4)与同类工作比较；收集术语与可引用原文（含章节/段落）\",\n  video: \"按主题脉络组织，提取核心论点、证据... (line truncated to 2000 chars)

// ===== parsers 注册表（运行时注入，实现插件化）=====
const parsers = require("./parsers");

module.exports = { meta, script, parsers };