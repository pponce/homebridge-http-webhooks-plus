'use strict';
const http = require('http');
const https = require('https');
const {URL, URLSearchParams} = require('url');
const {StateError, bounded} = require('./StateContract');

function object(value, field, form = false) {
  try {
    const result = typeof value === 'string' ? JSON.parse(value) : value;
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    if (Object.entries(result).some(([k, v]) => !k || (form ? !['string', 'number', 'boolean'].includes(typeof v) || (typeof v === 'number' && !Number.isFinite(v)) : typeof v !== 'string') || /[\r\n]/.test(k + v))) throw new Error();
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
  const method = config[field('method')] === undefined || config[field('method')] === '' ? 'GET' : config[field('method')];
  if (typeof method !== 'string' || !/^[A-Z]{1,20}$/.test(method)) throw new StateError('invalid_config_' + field('method'));
  const headers = object(config[field('headers')] === undefined || config[field('headers')] === '' ? '{}' : config[field('headers')], field('headers'));
  let body = config[field('body')] === undefined ? '' : config[field('body')];
  if (typeof body !== 'string') throw new StateError('invalid_config_' + field('body'));
  const form = config[field('form')];
  if (form !== undefined && form !== '') {
    if (body !== '') throw new StateError('conflicting_config_' + direction + '_body_form');
    body = new URLSearchParams(object(form, field('form'), true)).toString();
    if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  try { for (const [key, value] of Object.entries(headers)) { http.validateHeaderName(key); http.validateHeaderValue(key, value); } }
  catch (_) { throw new StateError('invalid_config_' + field('headers')); }
  if (Buffer.byteLength(body) > 65536 || Buffer.byteLength(JSON.stringify(headers)) > 8192) throw new StateError('command_config_too_large');
  if (config.rejectUnauthorized !== undefined && typeof config.rejectUnauthorized !== 'boolean') throw new StateError('invalid_config_rejectUnauthorized');
  const redirects = bounded(config.max_redirects, 0, 0, 5, 'max_redirects');
  if (!Number.isInteger(redirects)) throw new StateError('invalid_config_max_redirects');
  return {url, method, headers, body, redirects, rejectUnauthorized: config.rejectUnauthorized !== false,
    timeout: bounded(config.request_timeout_ms, 10000, 100, 60000, 'request_timeout_ms'),
    limit: bounded(config.response_max_bytes, 65536, 1024, 1048576, 'response_max_bytes')};
}
function send(options, callback) {
  if (!options.url) { callback(null); return () => {}; }
  let done = false, request, response, timer, received = 0;
  const finish = error => {
    if (done) return;
    done = true; clearTimeout(timer);
    if (error) { response?.destroy(); request?.destroy(); }
    callback(error);
  };
  const fail = (code, status = 502) => finish(new StateError(code, status));
  const visit = (address, method, body, headers, remaining) => {
    try {
      request = (address.protocol === 'https:' ? https : http).request(address, {
        method, headers, rejectUnauthorized: options.rejectUnauthorized, maxHeaderSize: 16384,
        agent: false
      }, reply => {
        response = reply;
        reply.on('data', data => { received += data.length; if (received > options.limit) fail('command_response_too_large'); });
        reply.on('aborted', () => fail('command_response_aborted'));
        reply.on('error', () => fail('command_transport_failed'));
        reply.on('end', () => {
          if (done) return;
          if ([301,302,303,307,308].includes(reply.statusCode) && reply.headers.location && remaining > 0) {
            let next;
            try { next = new URL(reply.headers.location, address); }
            catch (_) { fail('command_invalid_redirect'); return; }
            // Command bodies/custom credentials cannot be safely forwarded to another origin.
            if (next.origin !== address.origin || (next.username && next.username !== address.username) || (next.password && next.password !== address.password) || next.hash) {
              fail('command_unsafe_redirect'); return;
            }
            next.username = address.username; next.password = address.password;
            if (reply.statusCode === 303 && method !== 'HEAD' || [301,302].includes(reply.statusCode) && method === 'POST') {
              method = 'GET'; body = '';
              headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !['content-length','content-type','transfer-encoding'].includes(k.toLowerCase())));
            }
            visit(next, method, body, headers, remaining - 1);
          } else finish(reply.statusCode >= 200 && reply.statusCode < 300 ? null : new StateError('command_http_status', 502));
        });
      });
      request.on('error', () => fail('command_transport_failed'));
      request.end(body);
    } catch (_) { fail('command_transport_failed'); }
  };
  timer = setTimeout(() => fail('command_timeout', 504), options.timeout);
  visit(options.url, options.method, options.body, options.headers, options.redirects || 0);
  return () => fail('command_cancelled', 503);
}
module.exports = {configure, send};
