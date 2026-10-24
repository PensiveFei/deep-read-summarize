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
 * 规范化输入：对 http(s) URL 做归一化（host 小写、去默认端口、去 fragment、
 * 去空 query 的 "?"、去尾部斜杠），避免同一 URL 的不同写法产生不同指纹；
 * 非 URL（本地路径/纯文本）原样返回。
 */
function normalizeInput(input) {
  const s = typeof input === "string" ? input.trim() : "";
  if (!/^https?:\/\//i.test(s)) return s;
  try {
    const url = new URL(s);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
      url.port = "";
    }
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    // 去掉 URL 尾部的空 query "?"（new URL("...doc?").search 返回 ""，无法靠 search 判断，
    // 需检查 toString() 输出；同一 URL 的 "doc" 与 "doc?" 两种写法应共享指纹）
    let normalized = url.toString();
    if (normalized.endsWith("?")) normalized = normalized.slice(0, -1);
    return normalized;
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
  return crypto.createHash("sha256").update(base + metaStr).digest("hex").slice(0, 16);
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
