'use strict';
const {format} = require('util');
const {StateError, choice} = require('./StateContract');
const levels = ['error', 'warn', 'info', 'debug'];
const mandatory = ['authorization','cookie','set-cookie','password','pass','token','secret','apikey','api_key','key','pin','credential','x-webhooks-token'];
function keys(config) {
  const extra = config.extra_redaction_keys === undefined ? [] : config.extra_redaction_keys;
  if (!Array.isArray(extra) || extra.length > 32 || extra.some(k => typeof k !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(k))) throw new StateError('invalid_config_extra_redaction_keys');
  return [...mandatory, ...extra.map(k => k.toLowerCase())];
}
function redact(text, names, secrets = []) {
  let result = String(text).replace(/[\r\n\x00-\x1f\x7f]/g, ' ');
  for (const secret of secrets) if (secret) result = result.split(secret).join('[redacted]');
  result = result.replace(/https?:\/\/[^\s"'<>]+/gi, raw => {
    try { const url = new URL(raw); url.username = ''; url.password = ''; url.search = url.search ? '?[redacted]' : ''; url.hash = ''; return url.toString(); }
    catch (_) { return '[redacted-url]'; }
  });
  result = result.replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, '[redacted-auth]');
  result = result.replace(/\b(?:authorization|cookie|set-cookie)\s*[:=].*$/gi, '[redacted-headers]');
  const pattern = names.join('|');
  result = result.replace(new RegExp('("?(?:' + pattern + ')"?\\s*[:=]\\s*)(?:"[^"\\n]*"|[^,;\\s}]+)', 'gi'), '$1[redacted]');
  result = result.replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, '[redacted-auth]');
  return result.slice(0, 1024);
}
function create(raw, config = {}, parent = {}) {
  const inherited = choice(parent.log_level, 'inherit', ['inherit', ...levels], 'log_level');
  const selected = choice(config.log_level, inherited, ['inherit', ...levels], 'log_level');
  const level = selected === 'inherit' ? inherited : selected;
  const names = [...new Set([...keys(parent), ...keys(config)])];
  const secrets = [];
  function collect(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 8) return;
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        if (names.some(k => key.toLowerCase().includes(k)) && value.length >= 3) secrets.push(value);
        if (key.endsWith('_headers') || key.endsWith('_body') || key.endsWith('_form')) {
          try { collect(JSON.parse(value), depth + 1); } catch (_) { if (value) secrets.push(value); }
        }
      } else collect(value, depth + 1);
    }
  }
  collect(parent); collect(config);
  const emit = (severity, args) => {
    if (level !== 'inherit' && levels.indexOf(severity) > levels.indexOf(level)) return;
    const message = redact(format(...args), names, secrets);
    const target = raw[severity] || (severity === 'info' && typeof raw === 'function' ? raw : null);
    // Always call the original debug method: the Homebridge debug gate remains authoritative.
    if (typeof target === 'function') target.call(raw, message);
  };
  const log = (...args) => emit('info', args);
  for (const severity of levels) log[severity] = (...args) => emit(severity, args);
  return log;
}
module.exports = {create, redact};
