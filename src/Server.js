const Constants = require('./Constants');

const crypto = require('crypto');
const {StateError, bodyObject, choice, bounded} = require('./StateContract');
var http = require('http');
var https = require('https');
var url = require('url');
var fs = require('fs');
var Service, Characteristic;

function Server(ServiceParam, CharacteristicParam, platform, platformConfig) {
  Service = ServiceParam;
  Characteristic = CharacteristicParam;

  this.platform = platform;
  this.log = platform.log;
  this.storage = platform.storage;
  this.actionApi = new (require('./ActionApi'))(platformConfig, CharacteristicParam);

  const port = platformConfig.webhook_port === undefined || platformConfig.webhook_port === '' ? Constants.DEFAULT_PORT : platformConfig.webhook_port;
  if (!/^[0-9]+$/.test(String(port)) || Number(port) < 1 || Number(port) > 65535) throw new StateError('invalid_config_webhook_port');
  this.webhookPort = Number(port);
  this.bodyLimit = bounded(platformConfig.webhook_body_max_bytes, 65536, 1024, 1048576, 'webhook_body_max_bytes');
  this.stateBodyLimit = bounded(platformConfig.state_api_body_max_bytes, 8192, 1024, 65536, 'state_api_body_max_bytes');
  this.deadline = bounded(platformConfig.webhook_timeout_ms, 10000, 1000, 60000, 'webhook_timeout_ms');
  this.webhookListenHost = platformConfig["webhook_listen_host"] || Constants.DEFAULT_LISTEN_HOST;
  this.webhookEnableCORS = platformConfig["webhook_enable_cors"] || false;
  for (const key of ['webhook_enable_cors','https']) if (platformConfig[key] !== undefined && typeof platformConfig[key] !== 'boolean') throw new StateError('invalid_config_' + key);
  if (typeof this.webhookListenHost !== 'string' || !this.webhookListenHost || this.webhookListenHost.length > 253 || /[\s/]/.test(this.webhookListenHost)) throw new StateError('invalid_config_webhook_listen_host');
  for (const key of ['http_auth_user','http_auth_pass','https_keyfile','https_certfile']) if (platformConfig[key] !== undefined && typeof platformConfig[key] !== 'string') throw new StateError('invalid_config_' + key);
  if (Boolean(platformConfig.https_keyfile) !== Boolean(platformConfig.https_certfile)) throw new StateError('incomplete_config_tls_files');
  this.httpAuthUser = platformConfig["http_auth_user"] || null;
  this.httpAuthPass = platformConfig["http_auth_pass"] || null;
  if ((this.httpAuthUser === null) !== (this.httpAuthPass === null) ||
      (this.httpAuthUser !== null && (typeof this.httpAuthUser !== 'string' || typeof this.httpAuthPass !== 'string'))) {
    throw new StateError('incomplete_or_invalid_basic_auth');
  }
  this.stateApiToken = platformConfig.state_api_token;
  this.bearerToken = platformConfig.webhook_bearer_token === '' ? undefined : platformConfig.webhook_bearer_token;
  if (this.bearerToken !== undefined && (typeof this.bearerToken !== 'string' ||
      !/^[A-Za-z0-9_-]{32,256}$/.test(this.bearerToken))) throw new StateError('invalid_config_webhook_bearer_token');
  if (this.bearerToken && this.httpAuthUser !== null) throw new StateError('choose_basic_or_bearer_auth');
  if (this.stateApiToken !== undefined && (typeof this.stateApiToken !== 'string' ||
      !/^[A-Za-z0-9_-]{32,256}$/.test(this.stateApiToken))) throw new StateError('invalid_config_state_api_token');
  this.platform.webhookResponseMode = choice(platformConfig.webhook_response_mode, 'legacy', ['legacy', 'applied'], 'webhook_response_mode');
  this.https = platformConfig["https"] === true;
  this.httpsKeyFile = platformConfig["https_keyfile"];
  this.httpsCertFile = platformConfig["https_certfile"];
}

Server.prototype.setAccessories = function(accessories) {
  this.accessories = accessories;
  this.byId = new Map();
  for (const accessory of accessories) {
    const id = String(accessory.id);
    if (accessory.id === undefined || accessory.id === null || !id || id.length > 128) throw new StateError('invalid_accessory_id');
    if (this.byId.has(id)) throw new StateError('duplicate_accessory_id');
    this.byId.set(id, accessory);
  }
};

Server.prototype.createSSLCertificate = function() {
  this.log("Generating new ssl certificate.");
  var selfsigned = require('selfsigned');
  var certAttrs = [{ name: 'homebridgeHttpWebhooks', value: 'homebridgeHttpWebhooks.com' , type: 'homebridgeHttpWebhooks'}];
  var certOpts = { days: Constants.CERT_DAYS};
  certOpts.extensions = [{
    name: 'subjectAltName',
    altNames: [{
            type: 2,
            value: 'homebridgeHttpWebhooks.com'
    }, {
            type: 2,
            value: 'localhost'
    }]
  }];
  var pems = selfsigned.generate(certAttrs, certOpts);
  var cachedSSLCert = pems;
  cachedSSLCert.timestamp = Date.now();
  cachedSSLCert.certVersion = Constants.CERT_VERSION;
  return cachedSSLCert;
};

Server.prototype.getSSLServerOptions = function() {
  var sslServerOptions = {};
  if(this.https) {
    if(!this.httpsKeyFile || !this.httpsCertFile) {
      this.log("Using automatic created ssl certificate.");
      var cachedSSLCert = this.storage.getItemSync("http-webhook-ssl-cert");
      if(cachedSSLCert) {
        var certVersion = cachedSSLCert.certVersion;
        var timestamp = Date.now() - cachedSSLCert.timestamp;
        var diffInDays = timestamp/1000/60/60/24;
        if(diffInDays > Constants.CERT_DAYS - 1 || certVersion !== Constants.CERT_VERSION) {
          cachedSSLCert = null;
        }
      }
      if(!cachedSSLCert) {
        cachedSSLCert = this.createSSLCertificate();
        this.storage.setItemSync("http-webhook-ssl-cert", cachedSSLCert);
      }

      sslServerOptions = {
          key: cachedSSLCert.private,
          cert: cachedSSLCert.cert
      };
    }
    else {
      sslServerOptions = {
          key: fs.readFileSync(this.httpsKeyFile),
          cert: fs.readFileSync(this.httpsCertFile)
      };
    }
  }
  return sslServerOptions;
};


function equalSecret(a, b) {
  return typeof a === 'string' && typeof b === 'string' &&
    crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest());
}
Server.prototype.createServerCallback = function() {
  return (request, response) => {
    let ended = false, timer;
    const finish = (status, value) => {
      if (ended) return;
      ended = true; clearTimeout(timer);
      response.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
      response.end(JSON.stringify(value), () => { if (status >= 400) request.socket?.destroy(); });
    };
    const failure = error => { if (ended) return; response.setHeader('Connection', 'close'); finish(error instanceof StateError ? error.status : 500,
      {success: false, error: error instanceof StateError ? error.code : 'internal_error'}); };
    response.on('error', () => { ended = true; clearTimeout(timer); });
    response.on('close', () => { ended = true; clearTimeout(timer); });
    request.on('error', () => { ended = true; clearTimeout(timer); });
    request.on('aborted', () => { ended = true; clearTimeout(timer); });
    try {
      if (!request.url || request.url.length > 8192) throw new StateError('request_url_too_large', 414);
      const parsed = url.parse(request.url, true);
      if (this.webhookEnableCORS) {
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, POST');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Webhooks-Token');
        if (request.method === 'OPTIONS') { finish(200, {success: true}); request.resume(); return; }
      }
      if (this.httpAuthUser !== null) {
        const expected = 'Basic ' + Buffer.from(this.httpAuthUser + ':' + this.httpAuthPass).toString('base64');
        if (!equalSecret(request.headers.authorization, expected)) {
          response.setHeader('WWW-Authenticate', 'Basic realm="HttpWebHooks"');
          throw new StateError('authentication_required', 401);
        }
      }
      if (this.bearerToken) {
        let id = parsed.query.accessoryId;
        const route = /^\/v1\/accessories\/([^/]+)(?:\/state)?$/.exec(parsed.pathname);
        if (route) {try {id = decodeURIComponent(route[1]);} catch (_) {id = undefined;}}
        const exempt = this.actionApi.devices.get(id)?.device.disable_bearer_auth === true;
        if (!exempt && !equalSecret(request.headers.authorization, 'Bearer ' + this.bearerToken)) {
          response.setHeader('WWW-Authenticate', 'Bearer realm="HttpWebHooks"');
          throw new StateError('authentication_required', 401);
        }
      }
      const isV1 = parsed.pathname.startsWith('/v1/');
      let accessory, stateWrite = false, runAction;
      if (isV1) {
        if (!this.stateApiToken || !equalSecret(request.headers['x-webhooks-token'], this.stateApiToken)) throw new StateError('state_api_authentication_required', 401);
        const route = /^\/v1\/accessories\/([^/]+)(\/state)?$/.exec(parsed.pathname);
        if (!route || parsed.search) throw new StateError('invalid_state_route', 404);
        let id;
        try { id = decodeURIComponent(route[1]); } catch (_) { throw new StateError('invalid_accessory_id'); }
        accessory = this.byId.get(id);
        if (!accessory || typeof accessory.apply !== 'function') throw new StateError('state_accessory_not_found', 404);
        stateWrite = Boolean(route[2]);
        if (request.method !== (stateWrite ? 'POST' : 'GET')) throw new StateError('method_not_allowed', 405);
        if (stateWrite && (request.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw new StateError('json_content_type_required', 415);
      } else {
        if (!['GET', 'POST'].includes(request.method)) throw new StateError('method_not_allowed', 405);
        if (Object.values(parsed.query).some(Array.isArray)) throw new StateError('duplicate_query_field');
        if (typeof parsed.query.accessoryId !== 'string' || !parsed.query.accessoryId) throw new StateError('accessory_not_found', 404);
        accessory = this.byId.get(parsed.query.accessoryId);
        if (!accessory) throw new StateError('accessory_not_found', 404);
        if (Object.hasOwn(parsed.query, 'action')) {
          if (!['on', 'off'].includes(parsed.query.action)) throw new StateError('invalid_action');
          if (parsed.query.action === 'on') runAction = this.actionApi.prepare(accessory, parsed.query);
          else delete parsed.query.action;
        }
      }
      let size = 0; const chunks = [], limit = isV1 ? this.stateBodyLimit : this.bodyLimit;
      timer = setTimeout(() => { response.setHeader('Connection', 'close'); finish(408, {success: false, error: 'request_timeout'}); request.resume(); }, this.deadline);
      request.on('data', chunk => {
        if (ended) return;
        size += chunk.length;
        if (size > limit) { response.setHeader('Connection', 'close'); finish(413, {success: false, error: 'request_body_too_large'}); return; }
        if (isV1 && stateWrite) chunks.push(chunk);
      });
      request.on('end', () => {
        if (ended) return;
        try {
          if (runAction) {
            // Alarm POST bodies contain UniFi event metadata; commands live in the query.
            // The request must finish within size/deadline limits before executing.
            runAction().then(result => finish(200, result), failure);
          } else if (isV1) {
            if (!stateWrite && size) throw new StateError('status_body_not_allowed');
            const result = stateWrite ? accessory.apply(bodyObject(Buffer.concat(chunks).toString('utf8'))) : accessory.status();
            finish(result.success ? 200 : 503, result);
          } else finish(200, accessory.changeFromServer(parsed.query));
        } catch (error) { failure(error); }
      });
    } catch (error) { failure(error); request.resume(); }
  };
};

Server.prototype.start = function() {
  const callback = this.createServerCallback();
  this.listener = this.https ? https.createServer({...this.getSSLServerOptions(), maxHeaderSize: 16384}, callback) : http.createServer({maxHeaderSize: 16384}, callback);
  this.listener.requestTimeout = this.deadline;
  this.listener.headersTimeout = this.deadline;
  this.listener.setTimeout(this.deadline, socket => socket.destroy());
  this.listener.keepAliveTimeout = 5000;
  this.listener.on('clientError', (_error, socket) => { socket.destroy(); });
  this.listener.on('error', () => { this.log.error('HTTP Webhooks listener failed; check listener configuration.'); });
  this.listener.listen(this.webhookPort, this.webhookListenHost);
};
Server.prototype.close = function() {
  require('./Util').close(this.platform);
  for (const accessory of this.accessories || []) if (typeof accessory.close === 'function') accessory.close();
  if (this.listener) { this.listener.close(); if (this.listener.closeAllConnections) this.listener.closeAllConnections(); }
};
module.exports = Server;
