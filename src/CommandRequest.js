'use strict';
const http = require('http');
const https = require('https');
const {URL, URLSearchParams} = require('url');
const {StateError, bounded} = require('./StateContract');

function object(value, field) {
  try {
    const result = typeof value === 'string' ? JSON.parse(value) : value;
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    if (Object.entries(result).some(([k, v]) => !k || typeof v !== 'string' || /[\r\n]/.test(k + v))) throw new Error();
    return result;
  } catch (_) { throw new StateError('invalid_config_' + field); }
}
function configure(config, direction) {
  const field = name => direction + '_' + name;
  const address = config[field('url')] === undefined ? '' : config[field('url')];
  let url;
  try {
    if (typeof address !== 'string' || address.length > 8192) throw new Error();
    if (address) {
      url = new URL(address);
      if (!['http:', 'https:'].includes(url.protocol) || url.hash) throw new Error();
    }
  } catch (_) { throw new StateError('invalid_config_' + field('url')); }
  const method = config[field('method')] === undefined ? 'GET' : config[field('method')];
  if (typeof method !== 'string' || !/^[A-Z]{1,20}$/.test(method)) throw new StateError('invalid_config_' + field('method'));
  const headers = object(config[field('headers')] === undefined ? '{}' : config[field('headers')], field('headers'));
  let body = config[field('body')] === undefined ? '' : config[field('body')];
  if (typeof body !== 'string') throw new StateError('invalid_config_' + field('body'));
  const form = config[field('form')];
  if (form !== undefined && form !== '') {
    if (body !== '') throw new StateError('conflicting_config_' + direction + '_body_form');
    body = new URLSearchParams(object(form, field('form'))).toString();
    if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  try { for (const [key, value] of Object.entries(headers)) { http.validateHeaderName(key); http.validateHeaderValue(key, value); } }
  catch (_) { throw new StateError('invalid_config_' + field('headers')); }
  if (Buffer.byteLength(body) > 65536 || Buffer.byteLength(JSON.stringify(headers)) > 8192) throw new StateError('command_config_too_large');
  if (config.rejectUnauthorized !== undefined && typeof config.rejectUnauthorized !== 'boolean') throw new StateError('invalid_config_rejectUnauthorized');
  return {url, method, headers, body, rejectUnauthorized: config.rejectUnauthorized !== false,
    timeout: bounded(config.request_timeout_ms, 10000, 100, 60000, 'request_timeout_ms'),
    limit: bounded(config.response_max_bytes, 65536, 1024, 1048576, 'response_max_bytes')};
}
function send(options, callback) {
  if (!options.url) { callback(null); return; }
  let done = false, request, timer;
  const finish = error => {
    if (done) return;
    done = true; clearTimeout(timer);
    if (error && request) request.destroy();
    callback(error);
  };
  try {
    request = (options.url.protocol === 'https:' ? https : http).request(options.url, {
      method: options.method, headers: options.headers, rejectUnauthorized: options.rejectUnauthorized,
      maxHeaderSize: 16384
    }, response => {
      let size = 0;
      response.on('data', data => { size += data.length; if (size > options.limit) finish(new StateError('command_response_too_large', 502)); });
      response.on('aborted', () => finish(new StateError('command_response_aborted', 502)));
      response.on('error', () => finish(new StateError('command_transport_failed', 502)));
      response.on('end', () => finish(response.statusCode >= 200 && response.statusCode < 300 ? null : new StateError('command_http_status', 502)));
    });
    request.on('error', () => finish(new StateError('command_transport_failed', 502)));
    timer = setTimeout(() => finish(new StateError('command_timeout', 504)), options.timeout);
    request.end(options.body);
  } catch (_) { finish(new StateError('command_transport_failed', 502)); }
}
module.exports = {configure, send};
