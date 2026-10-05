'use strict';
const Constants = require('./Constants');
const CommandRequest = require('./CommandRequest');
const SafeLog = require('./SafeLog');
const {StateError} = require('./StateContract');

function accessoryLog(platform, config) {
  const log = SafeLog.create(platform.rawLog || platform.log, config, platform.logConfig || {});
  // Validate optional transport settings even on accessories with no command URL.
  CommandRequest.configure(config, '_validation');
  const directions = new Set(Object.keys(config).filter(k => /_(url|headers|form|body|method)$/.test(k)).map(k => k.replace(/_(url|headers|form|body|method)$/, '')));
  for (const direction of directions) CommandRequest.configure(config, direction);
  log.transportConfig = config;
  log.pendingCommands = new Set();
  platform.commandLogs ||= new Set(); platform.commandLogs.add(log);
  return log;
}
function close(platform) {
  for (const log of platform.commandLogs || []) for (const cancel of log.pendingCommands) cancel();
}
function callHttpApi(log, url, method, body, form, headers, rejectUnauthorized, callback, context, success, failure, timeout) {
  let called = false;
  const finish = error => {
    if (called) return; called = true;
    try { if (error) { if (failure) failure(); } else if (success) success(); }
    catch (_) { error = new StateError('command_state_update_failed', 503); }
    if (error) log.error?.(error instanceof StateError ? error.code : 'command_failed');
    else log.debug?.('HTTP command completed.');
    callback(error || null);
  };
  if (url === '' || context === Constants.CONTEXT_FROM_WEBHOOK) { finish(null); return; }
  let options;
  try {
    // Legacy families only sent body/form on these methods; preserve that behavior.
    const payload = ['POST','PUT','PATCH'].includes(method);
    options = CommandRequest.configure({...log.transportConfig,
      request_timeout_ms: timeout === undefined ? log.transportConfig?.request_timeout_ms : timeout,
      command_url: url, command_method: method, command_body: payload && !form ? body : '',
      command_form: payload ? form : '', command_headers: headers, rejectUnauthorized}, 'command');
  } catch (error) { finish(error); return; }
  let cancel;
  cancel = CommandRequest.send(options, error => { log.pendingCommands?.delete(cancel); finish(error); });
  if (!called) log.pendingCommands?.add(cancel);
}
module.exports = {callHttpApi, accessoryLog, close};
