// ============================================================================
// deep-read-summarize — Deep reading & summarization workflow for DSH
// Version: 3.0.0
// ============================================================================
// 【用法】meta → workflow meta；script → workflow script；
//   args: { "input": "<url|path>", "type": "auto", "options": { "minWords": 2500, "fastMode": false, "maxChunks": 4, "transcribe": true, "requireCitations": true, "includeTimestamps": false, "cache": true, "outputDir": "./output", "tempDir": "./.tmp" } }
// ============================================================================

const meta = {
  "name": "deep-read-summarize",
  "description": "Deep reading & summarization of books/papers/videos/web (v3.0)",
  "whenToUse": "User provides a book, paper, video link or web page and wants a deep-read summary saved as a Markdown note",
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
// 正文放在 lib/workflow-script.txt，不再做成转义字符串。
// 这个脚本曾经被 edit / 字符串替换改坏过两次，根因是「转义套转义」（\n 与 \" 各一层）。
// 现在它是一份普通文本：可以直接读、直接改，不需要任何编码步骤。
const fs = require("node:fs");
const path = require("node:path");
const RAW_SCRIPT = fs.readFileSync(path.join(__dirname, "lib", "workflow-script.txt"), "utf8");

// ===== parsers 注册表（运行时注入，实现插件化）=====
const parsers = require("./parsers");
const promptImpl = require("./parsers/_prompt");
const schemas = require("./schemas");
const parserRegistry = parsers.registry;

/**
 * 把注册表里的解析器（buildPrompt）连同其依赖的 buildFetchPrompt 内联进
 * workflow script，使其自包含 —— DSH rc7 的 workflow 工具只把 args（JSON）
 * 暴露给脚本，不会注入 args._parsers；脚本必须在自身内部解析器可用。
 * 若宿主未来注入 args._parsers，优先使用宿主注入值（向后兼容）。
 *
 * 内联的是 **注册表里的全部解析器**，不是写死的四个：custom-parsers/ 里的
 * 覆盖与自定义类型因此都能真正进入脚本（此前自定义新类型在 type 白名单
 * 和这里两道关都被丢掉）。fetchSchema 同样从 schemas/index.js 注入，
 * 保持单一真相，不再和脚本里的副本各自漂移。
 */
function buildSelfContainedScript() {
  const parserSource = (name) =>
    parserRegistry.parsers[name].buildPrompt
      .toString()
      // buildPrompt 闭包引用模块级 prompt（parsers/_prompt），内联后改指 __prompt
      .replace(/\bprompt\.buildFetchPrompt\b/g, "__prompt.buildFetchPrompt");

  const parserNames = Object.keys(parserRegistry.parsers);
  // kind 的合法取值跟着解析器表走（含自定义类型），不再写死四个内置类型。
  const fetchSchema = JSON.parse(JSON.stringify(schemas.fetchResultSchema));
  if (fetchSchema.properties && fetchSchema.properties.kind) {
    fetchSchema.properties.kind.enum = parserNames.slice();
  }

  const impl = [
    "const __prompt = { buildFetchPrompt: " + promptImpl.buildFetchPrompt.toString() + " };",
    "const __parsers = {",
    parserNames
      .map((name) => "  " + JSON.stringify(name) + ": { buildPrompt: " + parserSource(name) + " }")
      .join(",\n"),
    "};",
    "const fetchSchema = " + JSON.stringify(fetchSchema) + ";"
  ].join("\n");

  const marker = "const parsers = args._parsers || {};";
  if (!RAW_SCRIPT.includes(marker)) {
    throw new Error("workflow script marker not found: " + marker);
  }
  return RAW_SCRIPT.replace(marker, impl + "\nconst parsers = args._parsers || __parsers;");
}

const script = buildSelfContainedScript();

module.exports = { meta, script, parsers, buildSelfContainedScript };