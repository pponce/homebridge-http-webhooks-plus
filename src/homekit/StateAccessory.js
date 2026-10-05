'use strict';
const Constants = require('../Constants');
const StateStore = require('../StateStore');
const CommandRequest = require('../CommandRequest');
const {StateError, own, integer, boolean, choice, bounded} = require('../StateContract');
const pkg = require('../../package.json');

const definitions = {
  garagedooropener: {
    service: 'GarageDoorOpener', model: 'HttpWebHookGarageDoorOpenerAccessory',
    fields: {
      currentState: ['CurrentDoorState', 'currentdoorstate', 'current-door-state', 4, 1],
      targetState: ['TargetDoorState', 'targetdoorstate', 'target-door-state', 1, 1],
      obstruction: ['ObstructionDetected', 'obstructiondetected', 'obstruction-detected', null, false]
    }
  },
  lockmechanism: {
    service: 'LockMechanism', model: 'HttpWebHookLockMechanismAccessory',
    fields: {
      currentState: ['LockCurrentState', 'lockcurrentstate', 'lock-current-state', 3, 1],
      targetState: ['LockTargetState', 'locktargetstate', 'lock-target-state', 1, 1]
    }
  }
};
function unavailable() { return new Error('state_unavailable'); }
class StateAccessory {
  constructor(Service, Characteristic, platform, config, type) {
    this.platform = platform; this.log = require('../Util').accessoryLog(platform, config); this.storage = platform.storage;
    this.id = config.id; this.name = config.name; this.type = type;
    if (!((typeof this.id === 'string' && this.id.length > 0 && this.id.length <= 128) ||
        (Number.isSafeInteger(this.id) && this.id >= 0))) throw new StateError('invalid_config_id');
    if (typeof this.name !== 'string' || !this.name) throw new StateError('invalid_config_name');
    const definition = definitions[type]; this.fields = definition.fields;
    const alias = config.external_state;
    if (alias !== undefined && (type !== 'garagedooropener' || typeof alias !== 'boolean')) throw new StateError('invalid_config_external_state');
    this.mode = choice(config.state_mode, alias === true ? 'external' : 'optimistic', ['optimistic', 'external'], 'state_mode');
    if (alias !== undefined && (alias ? 'external' : 'optimistic') !== this.mode) throw new StateError('conflicting_config_state_mode');
    this.startup = choice(config.startup_state_policy, this.mode === 'external' ? 'await_feedback' : 'use_cache', ['await_feedback', 'use_cache'], 'startup_state_policy');
    this.policy = choice(config.notification_policy, 'changes_only', ['changes_only', 'allow_explicit'], 'notification_policy');
    this.interval = bounded(config.notification_min_interval_ms, 1000, 100, 60000, 'notification_min_interval_ms');
    this.feedbackTimeout = bounded(config.feedback_timeout_seconds, 0, 0, 604800, 'feedback_timeout_seconds');
    this.obstructionMonitoring = config.obstruction_monitoring === undefined ? false : config.obstruction_monitoring;
    if (typeof this.obstructionMonitoring !== 'boolean' ||
        (type !== 'garagedooropener' && (own(config, 'obstruction_monitoring') || own(config, 'obstruction_timeout_seconds')))) {
      throw new StateError('invalid_config_obstruction_monitoring');
    }
    this.obstructionTimeout = bounded(config.obstruction_timeout_seconds, 0, 0, 604800, 'obstruction_timeout_seconds');
    if (this.obstructionTimeout && !this.obstructionMonitoring) throw new StateError('obstruction_timeout_requires_monitoring');
    this.deadlines = {}; this.timers = {}; this.closed = false; this.pendingCommands = new Set();
    this.commands = {open: CommandRequest.configure(config, 'open'), close: CommandRequest.configure(config, 'close')};
    this.responseMode = platform.webhookResponseMode || 'legacy';
    this.store = new StateStore(platform.cacheDirectory || Constants.DEFAULT_CACHE_DIR, type, String(this.id));
    this.values = {}; this.observedAt = {}; this.available = {}; this.source = {};
    this.lastEvent = {}; this.generation = 0; this.storageFailed = false;
    const saved = this.store.read();
    if (saved && (saved.schema !== 1 || !saved.values || !saved.observedAt || Object.keys(saved.values).sort().join() !== Object.keys(this.fields).sort().join())) throw new StateError('invalid_state_snapshot', 503);
    for (const [field, spec] of Object.entries(this.fields)) {
      const value = saved ? saved.values[field] : this.storage.getItemSync('http-webhook-' + spec[2] + '-' + this.id);
      try { this.values[field] = value === undefined ? spec[4] : this.normalize(field, value); }
      catch (_) { throw new StateError('invalid_cached_state', 503); }
      const timestamp = saved ? saved.observedAt[field] : null;
      if (timestamp !== null && (!Number.isSafeInteger(timestamp) || timestamp < 0)) throw new StateError('invalid_state_snapshot', 503);
      this.observedAt[field] = timestamp;
      this.available[field] = field === 'obstruction' ? !this.obstructionMonitoring : this.startup === 'use_cache';
      this.source[field] = value === undefined ? 'default' : 'unverified_cache';
    }
    this.informationService = new Service.AccessoryInformation();
    this.informationService.setCharacteristic(Characteristic.Manufacturer, 'HttpWebHooksPlatform');
    this.informationService.setCharacteristic(Characteristic.Model, definition.model + '-' + this.name);
    this.informationService.setCharacteristic(Characteristic.SerialNumber, definition.model + '-' + this.id);
    this.service = new Service[definition.service](this.name);
    this.characteristics = {};
    for (const [field, spec] of Object.entries(this.fields)) {
      const characteristic = this.service.getCharacteristic(Characteristic[spec[0]]);
      this.characteristics[field] = characteristic;
      characteristic.on('get', callback => this.get(field, callback));
      characteristic.updateValue(this.available[field] ? this.values[field] : unavailable());
    }
    this.characteristics.targetState.on('set', this.command.bind(this));
    for (const field of Object.keys(this.fields)) if (this.available[field]) this.renew(field);
  }
  now() { return Number(process.hrtime.bigint() / 1000000n); }
  timeout(field) {
    return field === 'currentState' ? this.feedbackTimeout :
      field === 'obstruction' && this.obstructionMonitoring ? this.obstructionTimeout : 0;
  }
  reason(field) {
    if (this.storageFailed) return 'storage_error';
    if (this.deadlines[field] !== undefined && this.now() >= this.deadlines[field]) return 'stale';
    return !this.available[field] ? 'awaiting_feedback' : this.source[field];
  }
  usable(field) { return !['storage_error', 'stale', 'awaiting_feedback'].includes(this.reason(field)); }
  renew(field) {
    clearTimeout(this.timers[field]); delete this.timers[field];
    const seconds = this.timeout(field);
    if (!seconds || this.closed) return;
    this.deadlines[field] = this.now() + seconds * 1000;
    const expire = () => {
      if (this.closed || this.storageFailed) return;
      const remaining = this.deadlines[field] - this.now();
      if (remaining > 0) { this.timers[field] = setTimeout(expire, Math.ceil(remaining)); this.timers[field].unref(); return; }
      delete this.timers[field];
      this.characteristics[field].updateValue(unavailable());
      this.log.info?.('Feedback became stale (' + field + ').');
    };
    this.timers[field] = setTimeout(expire, Math.ceil(seconds * 1000));
    this.timers[field].unref();
  }
  close() {
    this.closed = true;
    for (const cancel of this.pendingCommands) cancel();
    for (const timer of Object.values(this.timers)) clearTimeout(timer);
    this.timers = {};
  }
  normalize(field, value) { return this.fields[field][3] === null ? boolean(value) : integer(value, this.fields[field][3]); }
  get(field, callback) {
    if (!this.usable(field)) callback(unavailable());
    else callback(null, this.values[field]);
  }
  getServices() { return [this.service, this.informationService]; }
  status() {
    const availability = {};
    for (const field of Object.keys(this.fields)) availability[field] = this.reason(field);
    return {success: !this.storageFailed, apiVersion: 1, package: {name: pkg.name, version: pkg.version},
      accessoryId: String(this.id), type: this.type, state: {...this.values},
      observedAt: {...this.observedAt}, availability,
      capabilities: {stateMode: this.mode, startupStatePolicy: this.startup, notificationPolicy: this.policy,
        feedbackTimeoutSeconds: this.feedbackTimeout, obstructionMonitoring: this.obstructionMonitoring,
        obstructionTimeoutSeconds: this.obstructionTimeout, feedbackFreshness: true,
        notificationMinIntervalMs: this.interval, fields: Object.keys(this.fields), explicitNotifications: true,
        atomicUpdates: true, feedbackInvokesCommands: false}};
  }
  commit(patch, observed, source) {
    if (this.closed) throw new StateError('accessory_closed', 503);
    if (this.storageFailed) throw new StateError('state_storage_unavailable', 503);
    const values = {...this.values, ...patch}, observedAt = {...this.observedAt};
    if (observed) for (const field of Object.keys(patch)) observedAt[field] = Date.now();
    try { this.store.write({schema: 1, values, observedAt}); }
    catch (_) {
      for (const timer of Object.values(this.timers)) clearTimeout(timer);
      this.timers = {};
      this.storageFailed = true;
      for (const characteristic of Object.values(this.characteristics)) characteristic.updateValue(unavailable());
      throw new StateError('state_storage_unavailable', 503);
    }
    this.values = values; this.observedAt = observedAt;
    for (const field of Object.keys(patch)) {
      // Commands may change assumed values, but never renew observation freshness.
      const wasUnavailable = !this.usable(field);
      this.available[field] = observed || (this.timeout(field) ? this.available[field] : true);
      this.source[field] = source;
      if (observed) {
        this.renew(field);
        if (wasUnavailable && this.timeout(field)) this.log.info?.('Feedback recovered (' + field + ').');
      }
    }
  }
  apply(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new StateError('invalid_state_object');
    const patch = {};
    for (const field of Object.keys(input)) {
      if (own(this.fields, field)) patch[field] = this.normalize(field, input[field]);
      else if (field !== 'notify') throw new StateError('unknown_state_field');
    }
    const notify = own(input, 'notify') ? boolean(input.notify) : false;
    if (!Object.keys(patch).length) throw new StateError('missing_state_fields');
    const previous = {...this.values}, wasAvailable = Object.fromEntries(Object.keys(this.fields).map(field => [field, this.usable(field)]));
    // Entire payload validated before persistence, timestamps or HAP changes.
    this.commit(patch, true, 'observed'); ++this.generation;
    const outcomes = {}, now = Number(process.hrtime.bigint() / 1000000n);
    try {
      for (const field of Object.keys(patch)) {
        const changed = previous[field] !== patch[field] || !wasAvailable[field];
        const permitted = notify && this.policy === 'allow_explicit';
        const limited = permitted && !changed && this.lastEvent[field] !== undefined && now - this.lastEvent[field] < this.interval;
        if (permitted && !limited) {
          this.characteristics[field].sendEventNotification(patch[field], Constants.CONTEXT_FROM_WEBHOOK);
          this.lastEvent[field] = now; outcomes[field] = 'sent';
        } else {
          this.characteristics[field].updateValue(patch[field], undefined, Constants.CONTEXT_FROM_WEBHOOK);
          outcomes[field] = !notify ? 'not_requested' : !permitted ? 'disabled' : 'rate_limited';
        }
      }
    } catch (_) { throw new StateError('hap_update_failed_state_stored', 503); }
    const distinct = [...new Set(Object.values(outcomes))];
    return {...this.status(), previous, notification: {requested: notify, outcome: distinct.length === 1 ? distinct[0] : 'partial', fields: outcomes}};
  }
  changeFromServer(params) {
    const input = {}, previous = {};
    for (const [field, spec] of Object.entries(this.fields)) if (own(params, spec[1])) { input[field] = params[spec[1]]; previous[field] = this.values[field]; }
    if (own(params, 'force_notify')) input.notify = params.force_notify;
    const result = this.apply(input);
    return this.responseMode === 'applied' ? result : {success: true, ...previous,
      ...(own(input, 'notify') ? {notified: result.notification.outcome === 'sent'} : {})};
  }
  command(value, callback, context) {
    let finished = false;
    const done = error => { if (!finished) { finished = true; callback(error || null); } };
    try {
      value = this.normalize('targetState', value);
      if (context === Constants.CONTEXT_FROM_WEBHOOK) { this.apply({targetState: value}); done(); return; }
      this.commit({targetState: value}, false, 'requested');
      this.characteristics.targetState.updateValue(value);
      const generation = ++this.generation;
      let cancel, finished = false;
      cancel = CommandRequest.send(this.commands[value === 0 ? 'open' : 'close'], error => {
        finished = true; this.pendingCommands.delete(cancel);
        try {
          // HAP's SET callback also writes target: reject obsolete completions.
          if (generation !== this.generation) {
            done(this.values.targetState === value ? error : new StateError('command_superseded', 409)); return;
          }
          if (this.mode === 'optimistic' && (!error || this.type === 'lockmechanism')) {
            const current = error ? 3 : value;
            this.commit({currentState: current}, false, 'assumed');
            this.characteristics.currentState.updateValue(this.usable('currentState') ? current : unavailable());
          }
          done(error);
        } catch (failure) { done(failure); }
      });
      if (!finished) this.pendingCommands.add(cancel);
    } catch (error) { done(error); }
  }
}
module.exports = StateAccessory;
