// ============================================================================
// Parser registry — 解析器插件注册表
// ============================================================================
// 解析器按类型分发，每个输入类型一个文件：
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
    this.parsers = Object.create(null);
    this._sources = new WeakMap();
    for (const type of Object.keys(builtins)) this.register(builtins[type], require.resolve('./' + type));
    this._loadCustom();
  }

  /** Remember the module, not just its function: module factories preserve helpers and closures. */
  register(mod, filename) {
    if (!mod || typeof mod.name !== 'string' || !mod.name.trim() || typeof mod.buildPrompt !== 'function') {
      throw new Error('parser must expose a name and buildPrompt(input, options) function');
    }
    const types = mod.types === undefined ? [mod.name] : mod.types;
    if (!Array.isArray(types) || !types.length || types.some(function (type) { return typeof type !== 'string' || !type.trim(); })) {
      throw new Error('parser.types must be a non-empty array of type names');
    }
    if (filename) this._sources.set(mod, { filename: filename, buildPrompt: mod.buildPrompt });
    for (const type of types) this.parsers[type] = mod;
    return mod;
  }

  sourceFor(mod) {
    const known = this._sources.get(mod);
    if (known) return known.buildPrompt === mod.buildPrompt ? known.filename : undefined;
    // Also preserve modules supplied programmatically through registry.parsers.
    for (const filename of Object.keys(require.cache)) {
      if (require.cache[filename].exports === mod) return filename;
    }
    return undefined;
  }

  _loadCustom() {
    const customDir = path.join(__dirname, "..", "custom-parsers");
    if (!fs.existsSync(customDir)) return;
    for (const file of fs.readdirSync(customDir)) {
      if (!file.endsWith(".js")) continue;
      try {
        const filename = path.join(customDir, file);
        const mod = require(filename);
        if (mod && mod.name && mod.buildPrompt) {
          this.register(mod, filename);
          console.log("[parsers] loaded custom parser:", mod.name);
        }
      } catch (e) {
        console.error("[parsers] failed to load", file, e.message);
      }
    }
  }

  /**
   * 按类型解析解析器；未知类型回退到 web。
   *
   * 必须走 hasOwnProperty：直接 `this.parsers[type]` 会把原型链上的键也当成解析器
   * 返回 —— `resolve("constructor")` 拿到的是 Object 构造函数、`resolve("toString")`
   * 拿到 toString，两者都没有 buildPrompt，调用方会拿到 TypeError 而不是回退到 web。
   * 也就是说「未知类型回退 web」这条契约会在十来个名字上静默失效。
   */
  resolve(type) {
    if (!Object.prototype.hasOwnProperty.call(this.parsers, type)) return this.parsers.web;
    return this.parsers[type];
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
  registry,
  ParserRegistry
};
