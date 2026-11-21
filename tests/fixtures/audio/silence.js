// tests/fixtures/audio/silence.js — 纯 Node 生成静音 WAV
//
// 不往仓库里塞二进制：10 秒 16kHz 单声道 WAV 是 320KB，而它只是一个全零数组，
// 生成比下载、提交、LFS 都便宜。转写链路要测的正是「纯静音必须按设计失败」，
// 所以这段音频本身就是判据的一部分。
'use strict';

const fs = require('node:fs');

function writeSilenceWav(file, seconds) {
  const rate = 16000;
  const channels = 1;
  const bits = 16;
  const frames = Math.round(rate * (seconds || 10));
  const dataBytes = frames * channels * (bits / 8);
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);                    // fmt 块长度
  buf.writeUInt16LE(1, 20);                     // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * channels * bits / 8, 28); // byte rate
  buf.writeUInt16LE(channels * bits / 8, 32);   // block align
  buf.writeUInt16LE(bits, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  // 数据区保持全 0 —— 那就是静音本身。
  fs.writeFileSync(file, buf);
  return { file: file, seconds: frames / rate, bytes: buf.length };
}

module.exports = { writeSilenceWav };
