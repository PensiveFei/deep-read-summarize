// ============================================================================
// lib/cache.js — idempotency: input fingerprint cache
// ============================================================================
// 对输入内容计算指纹（URL 或文件路径 + 文件大小/修改时间），
// 已处理过的输入直接跳过，避免重复消耗 token。
// 指纹记录以 JSONL 追加式存储，支持断点恢复。
// ============================================================================
// 用法：
//   const cache = require("./lib/cache");
//   const key = cache.fingerprint(input, fileMeta);
//   if (cache.hasProcessed(cacheFile, key)) { skip; }
//   cache.markProcessed(cacheFile, key, outputPath);
// ============================================================================

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/**
 * 规范化输入：只采用 URL 标准的 host、默认端口等归一化。
 * 保留尾斜杠、空 query 与 fragment：它们可能选择不同文档、路由或阅读范围。
 * 非 URL（本地路径/纯文本）原样返回。
 */
function normalizeInput(input) {
  const s = typeof input === "string" ? input.trim() : "";
  if (!/^https?:\/\//i.test(s)) return s;
  try {
    const url = new URL(s);
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
      url.port = "";
    }
    return url.toString();
  } catch (e) {
    return s; // 非法 URL 原样处理
  }
}

/** 计算输入指纹：URL 规范化后 hash；本地文件加大小 + 修改时间 */
function fingerprint(input, fileMeta) {
  const base = normalizeInput(input);
  if (!base) return null;
  const metaStr = fileMeta
    ? "|" + (fileMeta.size ?? "") + "|" + (fileMeta.mtimeMs ?? "")
    : "";
  // v2 不复用旧版过度归一化后的记录，避免旧碰撞继续导致错误跳过。
  return crypto.createHash("sha256").update("drs-input-v2|" + base + metaStr).digest("hex").slice(0, 16);
}

/** 从缓存文件读取已处理记录（JSONL） */
function readCache(cacheFile) {
  if (!fs.existsSync(cacheFile)) return new Map();
  const map = new Map();
  try {
    const lines = fs.readFileSync(cacheFile, "utf8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (rec && rec.key) map.set(rec.key, rec);
      } catch (e) { /* 跳过损坏行 */ }
    }
  } catch (e) { /* 缓存不可读则视为空 */ }
  return map;
}

/** 是否已处理过该指纹；opts.maxAgeMs 提供时，过期（记录时间早于阈值）视为未处理 */
function hasProcessed(cacheFile, key, opts) {
  if (!key) return false;
  const rec = readCache(cacheFile).get(key);
  if (!rec) return false;
  const maxAgeMs = opts && opts.maxAgeMs;
  if (maxAgeMs && rec.ts) {
    const age = Date.now() - new Date(rec.ts).getTime();
    if (!isFinite(age) || age > maxAgeMs) return false;
  }
  return true;
}

/**
 * 标记已处理：每条记录前后带换行，以一次 O_APPEND write 写入。
 * 前导换行隔开无结尾 LF 的合法旧记录和崩溃留下的残行；不读取/改写文件尾，
 * 并发调用无需争抢恢复锁，也不会因进程崩溃留下永久残锁。
 * 依赖本地文件系统的 append 写入语义，不提供网络文件系统事务保证。
 * 写失败或短写仅告警并返回 false；残行由下一条记录的前导换行隔离。
 */
function markProcessed(cacheFile, key, outputPath, meta) {
  if (!key) return false;
  try {
    const dir = path.dirname(cacheFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // 元数据只扩展记录，不能伪造指纹、产物路径、处理时间或 JSON 序列化行为。
    const rec = Object.create(null);
    for (const name of Object.keys(meta || {})) {
      if (name !== "key" && name !== "outputPath" && name !== "ts" && name !== "toJSON") rec[name] = meta[name];
    }
    rec.key = key;
    rec.outputPath = outputPath;
    rec.ts = new Date().toISOString();
    const record = Buffer.from("\n" + JSON.stringify(rec) + "\n", "utf8");
    const fd = fs.openSync(cacheFile, "a", 0o600);
    try {
      const written = fs.writeSync(fd, record, 0, record.length, null);
      if (written !== record.length) throw new Error("short append: " + written + "/" + record.length + " bytes");
    } finally {
      fs.closeSync(fd);
    }
    return true;
  } catch (e) {
    console.warn("[cache] markProcessed failed:", e.message);
    return false;
  }
}

module.exports = { fingerprint, normalizeInput, readCache, hasProcessed, markProcessed };
