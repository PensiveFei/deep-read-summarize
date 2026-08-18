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

/** 计算输入指纹：URL 直接 hash；本地文件加大小 + 修改时间 */
function fingerprint(input, fileMeta) {
  const base = typeof input === "string" ? input.trim() : "";
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

/** 是否已处理过该指纹 */
function hasProcessed(cacheFile, key) {
  if (!key) return false;
  return readCache(cacheFile).has(key);
}

/** 标记已处理（追加 JSONL 记录） */
function markProcessed(cacheFile, key, outputPath, meta) {
  if (!key) return false;
  const dir = path.dirname(cacheFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const rec = { key, outputPath, ts: new Date().toISOString(), ...(meta || {}) };
  fs.appendFileSync(cacheFile, JSON.stringify(rec) + "\n", "utf8");
  return true;
}

module.exports = { fingerprint, readCache, hasProcessed, markProcessed };
