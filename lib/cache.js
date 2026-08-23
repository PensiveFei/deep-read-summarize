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
    if (url.search === "?") url.search = "";
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
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
    ? "|" + (fileMeta.size || "") + "|" + (fileMeta.mtimeMs || "")
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

/** 标记已处理（追加 JSONL 记录）；写缓存失败仅告警，不中断主流程 */
function markProcessed(cacheFile, key, outputPath, meta) {
  if (!key) return false;
  try {
    const dir = path.dirname(cacheFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const rec = { key, outputPath, ts: new Date().toISOString(), ...(meta || {}) };
    fs.appendFileSync(cacheFile, JSON.stringify(rec) + "\n", "utf8");
    return true;
  } catch (e) {
    console.warn("[cache] markProcessed failed:", e.message);
    return false;
  }
}

module.exports = { fingerprint, normalizeInput, readCache, hasProcessed, markProcessed };
