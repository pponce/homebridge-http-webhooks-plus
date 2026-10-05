'use strict';

class StateError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
function integer(value, max) {
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) value = Number(value);
  if (!Number.isInteger(value) || value < 0 || value > max) throw new StateError('invalid_state');
  return value;
}
function boolean(value) {
  if (value === true || value === 1 || value === 'true' || value === '1') return true;
  if (value === false || value === 0 || value === 'false' || value === '0') return false;
  throw new StateError('invalid_boolean');
}
function choice(value, fallback, choices, field) {
  value = value === undefined ? fallback : value;
  if (!choices.includes(value)) throw new StateError('invalid_config_' + field);
  return value;
}
function bounded(value, fallback, min, max, field) {
  value = value === undefined ? fallback : value;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new StateError('invalid_config_' + field);
  }
  return value;
}
// State bodies are flat objects. A small lexer preserves duplicate keys (which
// JSON.parse alone discards); nested objects/arrays are not part of this API.
function bodyObject(text) {
  const token = /\s*("(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|[{}:,])/gy;
  const parts = []; let end = 0, match;
  while ((match = token.exec(text))) { parts.push(match[1]); end = token.lastIndex; }
  if (text.slice(end).trim() || parts.shift() !== '{' || parts.pop() !== '}') throw new StateError('invalid_json');
  const result = Object.create(null);
  while (parts.length) {
    const keyToken = parts.shift();
    if (!keyToken.startsWith('"') || parts.shift() !== ':') throw new StateError('invalid_json');
    const key = JSON.parse(keyToken), value = parts.shift();
    if (own(result, key)) throw new StateError('duplicate_field');
    if (!value || /^[{}:,]$/.test(value)) throw new StateError('invalid_json');
    try { result[key] = JSON.parse(value); } catch (_) { throw new StateError('invalid_json'); }
    if (parts.length && (parts.shift() !== ',' || !parts.length)) throw new StateError('invalid_json');
  }
  return result;
}
module.exports = {StateError, own, integer, boolean, choice, bounded, bodyObject};
