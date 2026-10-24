'use strict';

/** Kept self-contained: the exact same validator is embedded in the workflow. */
function normalizeWorkflowOptions(raw, behavior) {
  const defaults = {
    minWords: 2500, fastMode: false, maxChunks: 4, transcribe: true,
    requireCitations: true, includeTimestamps: false, outputDir: './output',
    tempDir: './.tmp', whisperModel: 'small', language: 'zh', device: 'cpu',
    maxRetries: 0, frontmatter: 'obsidian'
  };
  const settings = behavior || {};
  const tolerant = settings.mode === 'config';
  const warn = typeof settings.warn === 'function' ? settings.warn : function () {};
  const result = Object.assign({}, defaults);
  function invalid(key, reason) {
    if (!tolerant) throw new Error('[FATAL] options' + (key ? '.' + key : '') + ' 非法：' + reason);
    warn('[deep-read-summarize] ignoring config' + (key ? '.' + key : '') + ' — ' + reason);
  }
  if (raw === undefined) return result;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    invalid('', 'expected an options object');
    return result;
  }
  const keys = Object.keys(defaults);
  const unknown = Object.keys(raw).filter(function (key) { return keys.indexOf(key) < 0; });
  if (unknown.length) {
    if (!tolerant) throw new Error('[FATAL] options 未知配置键：' + unknown.join(', ') + '（allowed keys: ' + keys.join(', ') + '）');
    warn('[deep-read-summarize] ignoring unknown config key(s): ' + unknown.join(', '));
    warn('[deep-read-summarize] allowed keys: ' + keys.join(', '));
  }
  const models = [
    'tiny', 'tiny.en', 'base', 'base.en', 'small', 'small.en', 'medium', 'medium.en',
    'large', 'large-v1', 'large-v2', 'large-v3', 'large-v3-turbo', 'turbo',
    'distil-large-v2', 'distil-medium.en', 'distil-small.en', 'distil-large-v3'
  ];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(raw, key) || raw[key] === undefined) continue;
    let value = raw[key];
    let reason = '';
    if (key === 'minWords' || key === 'maxChunks' || key === 'maxRetries') {
      const minimum = key === 'maxRetries' ? 0 : 1;
      const maximum = key === 'minWords' ? 100000 : (key === 'maxRetries' ? 3 : Infinity);
      if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < minimum || value > maximum) {
        reason = 'expected a finite integer in ' + minimum + '..' + (maximum === Infinity ? '12 (larger values are capped)' : maximum);
      } else if (key === 'maxChunks' && value > 12) {
        if (tolerant) warn('[deep-read-summarize] config.maxChunks capped at 12 (received ' + value + ')');
        value = 12;
      }
    } else if (typeof defaults[key] === 'boolean') {
      if (typeof value !== 'boolean') reason = 'expected boolean';
    } else if (typeof value !== 'string' || !value.trim() || /[\u0000\r\n]/.test(value)) {
      reason = 'expected a non-empty string without NUL or line breaks';
    } else if (key !== 'outputDir' && key !== 'tempDir') {
      value = value.trim().toLowerCase();
      if (key === 'frontmatter' && ['obsidian', 'generic', 'minimal'].indexOf(value) < 0) reason = 'expected obsidian|generic|minimal';
      if (key === 'device' && ['cpu', 'auto', 'cuda'].indexOf(value) < 0) reason = 'expected cpu|auto|cuda';
      if (key === 'whisperModel' && models.indexOf(value) < 0) reason = 'unsupported Whisper model';
      if (key === 'language' && !/^[a-z]{2,3}$/.test(value)) reason = 'expected a two- or three-letter language code';
    }
    if (reason) invalid(key, reason);
    else result[key] = value;
  }
  return result;
}

module.exports = { normalizeWorkflowOptions, DEFAULT_OPTIONS: normalizeWorkflowOptions() };
