// ============================================================================
// Parser registry — 解析器插件注册表
// ============================================================================
// 模拟 Harness 的 ctx.tools.register() 插件哲学：
//   - 每个解析器是独立文件（parsers/*.js），可按需增删替换
//   - 本文件负责「按类型发现 + 分发」，workflow 脚本只依赖本接口
// ============================================================================
// 用法：
//   const parsers = require("./parsers");
//   const p = parsers.resolve("paper");   // 按类型取解析器
//   const prompt = p.buildPrompt(input, opts);
//   const schema = p.schema;               // 结构化输出约束（可选）
// ============================================================================

const fs = require("fs");
const path = require("path");

// 内置解析器（可被用户自定义解析器覆盖）
const builtins = {
  book: require("./book"),
  paper: require("./paper"),
  video: require("./video"),
  web: require("./web")
};

/**
 * 解析器注册表
 * 支持在项目根目录创建 custom-parsers/ 目录放置自定义解析器，
 * 同名类型会覆盖内置解析器（用户按需替换）。
 */
class ParserRegistry {
  constructor() {
    this.parsers = { ...builtins };
    this._loadCustom();
  }

  _loadCustom() {
    const customDir = path.join(__dirname, "..", "custom-parsers");
    if (!fs.existsSync(customDir)) return;
    for (const file of fs.readdirSync(customDir)) {
      if (!file.endsWith(".js")) continue;
      try {
        const mod = require(path.join(customDir, file));
        if (mod && mod.name && mod.buildPrompt) {
          // 支持自定义类型名，或覆盖内置类型
          for (const t of mod.types || [mod.name]) {
            this.parsers[t] = mod;
          }
          console.log("[parsers] loaded custom parser:", mod.name);
        }
      } catch (e) {
        console.error("[parsers] failed to load", file, e.message);
      }
    }
  }

  /** 按类型解析解析器；未知类型回退到 web */
  resolve(type) {
    return this.parsers[type] || this.parsers.web;
  }

  /** 列出所有已注册解析器 */
  list() {
    return Object.values(this.parsers).map((p) => ({
      name: p.name,
      types: p.types,
      description: p.description
    }));
  }
}

const registry = new ParserRegistry();

module.exports = {
  resolve: (type) => registry.resolve(type),
  list: () => registry.list(),
  registry
};
