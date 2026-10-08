'use strict';
const os = require('node:os');
const http = require('node:http');
const https = require('node:https');
const Api = require('./public/api');
const Actions = require('./public/actions');
const Model = require('./public/model');

function connectionInfo(interfaces = os.networkInterfaces(), hostname = os.hostname()) {
  const entries = Object.values(interfaces).flat().filter(Boolean);
  const external = entries.filter(item => !item.internal && (item.family === 'IPv4' || item.family === 4));
  const defaultHost = external[0]?.address || entries.find(item => !item.internal)?.address || '127.0.0.1';
  return {defaultHost: defaultHost.includes(':') ? '[' + defaultHost + ']' : defaultHost,
    addresses: [...new Set(entries.map(item => item.address.split('%')[0]))], hostname};
}
function savedPlatform(config, payload) {
  if (!payload || typeof payload !== 'object' || !Model.labels[payload.family] || typeof payload.id !== 'string') throw Error('Invalid request.');
  const matches = (config.platforms || []).filter(Model.isPlatform).filter(platform =>
    String(platform.webhook_port || '51828') === String(payload.port) && Boolean(platform.https) === payload.https &&
    Array.isArray(platform[payload.family]) && platform[payload.family].some(device => String(device?.id) === payload.id));
  if (matches.length !== 1) throw Error('The saved device or listener does not match. Save settings and restart the child bridge before testing changed settings.');
  const platform = matches[0];
  return {platform, device: platform[payload.family].find(device => String(device.id) === payload.id)};
}
function prepare(config, payload, network = connectionInfo()) {
  const {platform, device} = savedPlatform(config, payload);
  const host = String(payload.host || '').trim().replace(/^\[|\]$/g, '');
  const local = new Set([...network.addresses, network.hostname, 'localhost', '127.0.0.1', '::1']);
  if (!local.has(host)) throw Error('In-page testing is available for this Homebridge instance. Use its detected IP address, or copy the request to test from your external program.');
  if (!['webhook', 'json', 'status', 'action'].includes(payload.format)) throw Error('Unsupported request format.');
  const action = payload.format === 'action';
  if (action && device.allow_external_actions !== true) throw Error('Enable Allow external actions, save settings and restart the child bridge first.');
  const json = ['json','status'].includes(payload.format);
  if (json && (!['garagedooropeners', 'lockmechanisms'].includes(payload.family) || !platform.state_api_token)) throw Error('Enable the incoming JSON State API, save settings and restart the child bridge first.');
  const fields = action ? Actions.fields(payload.family, device) : Api.fields(payload.family, device);
  const field = fields.find(item => item.key === payload.field && (!item.params || item.params.buttonName === payload.buttonName));
  if (!field) throw Error('This field or button is not supported by the saved device.');
  if (action) {
    const target = Actions.value(field, Object.hasOwn(field, 'fixedValue') ? undefined : payload.value);
    if (!Actions.commandURL(field, target, device)) throw Error('Configure this action’s outgoing URL first.');
  } else if (payload.format !== 'status') {
    if (typeof payload.value !== 'string' || !payload.value || payload.value.length > 64) throw Error('Choose a valid value.');
    if (field.values) {
      if (!field.values.some(item => item[0] === payload.value)) throw Error('Choose an enabled value or event.');
    } else {
      const value = Number(payload.value);
      if (!Number.isFinite(value) || value < field.min || value > field.max || (field.step === 1 && !Number.isInteger(value))) throw Error('Choose a value within the accepted range.');
    }
    if (payload.family === 'fanv2s' && !['true', 'false'].includes(payload.fanPower)) throw Error('Choose the current fan power.');
  }
  const listenHost = platform.webhook_listen_host || '::';
  const destination = ['::', '0.0.0.0'].includes(listenHost) ? '127.0.0.1' : listenHost;
  const address = destination.includes(':') ? '[' + destination.replace(/^\[|\]$/g, '') + ']' : destination;
  const generated = action ? Api.buildAction(platform, device, field, payload.value, address) : Api.build(platform, device, payload.family, field, payload.value, address, json, payload.fanPower, payload.notify === true);
  const endpoint = new URL(payload.format === 'status' ? generated.endpoint.replace(/\/state$/, '') : generated.endpoint);
  const headers = {Accept: 'application/json'};
  if (platform.webhook_bearer_token) {if (device.disable_bearer_auth !== true) headers.Authorization = 'Bearer ' + platform.webhook_bearer_token;}
  else if (platform.http_auth_user && platform.http_auth_pass) headers.Authorization = 'Basic ' + Buffer.from(platform.http_auth_user + ':' + platform.http_auth_pass).toString('base64');
  if (json) headers['X-Webhooks-Token'] = platform.state_api_token;
  const body = payload.format === 'json' ? generated.body : null;
  if (body) {headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(body);}
  return {endpoint, headers, body, method: body ? 'POST' : 'GET', platform};
}
function redactResponse(text, platform) {
  const secrets = [platform.http_auth_user, platform.http_auth_pass, platform.state_api_token, platform.webhook_bearer_token,
    platform.http_auth_user && platform.http_auth_pass ? Buffer.from(platform.http_auth_user + ':' + platform.http_auth_pass).toString('base64') : null].filter(Boolean);
  let result = text;
  for (const secret of secrets) result = result.split(secret).join('[redacted]');
  return result;
}
async function execute(config, payload, network) {
  let request;
  try {request = prepare(config, payload, network);} catch (error) {return {error: error.message};}
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {if (settled) return; settled = true; clearTimeout(timer); resolve(value);};
    const client = request.endpoint.protocol === 'https:' ? https : http;
    const req = client.request(request.endpoint, {method: request.method, headers: request.headers,
      // The target is exclusively this instance's saved listener; automatic self-signed TLS is supported.
      rejectUnauthorized: false}, response => {
      let size = 0; const chunks = [];
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 65536) {finish({error: 'Response exceeded 64 KiB. The request may already have been applied; do not retry automatically.'}); req.destroy(); return;}
        chunks.push(chunk);
      });
      response.on('end', () => {
        let body = redactResponse(Buffer.concat(chunks).toString('utf8'), request.platform);
        try {body = JSON.stringify(JSON.parse(body), null, 2);} catch (_) {}
        finish({status: response.statusCode, body});
      });
      response.on('error', () => finish({error: 'The listener response was interrupted. The request may already have been applied.'}));
    });
    const timer = setTimeout(() => {finish({error: 'The listener did not respond within 10 seconds. The request may already have been applied.'}); req.destroy();}, 10000);
    req.on('error', () => finish({error: 'Could not reach the saved webhook listener. Check that the child bridge is running and the saved listener settings have been applied.'}));
    if (request.body) req.write(request.body);
    req.end();
  });
}
module.exports = {connectionInfo, prepare, execute};
