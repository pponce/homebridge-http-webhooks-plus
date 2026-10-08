'use strict';
const Actions = require('../homebridge-ui/public/actions');
const {StateError} = require('./StateContract');
const properties = require('../config.schema.json').schema.properties;
class ActionApi {
  constructor(config, Characteristic) {
    this.Characteristic = Characteristic;
    this.devices = new Map();
    for (const [family, schema] of Object.entries(properties)) {
      if (!schema.items?.properties?.id || !Array.isArray(config[family])) continue;
      for (const device of config[family]) {
        if (!device || device.id === undefined) continue;
        if (device.allow_external_actions !== undefined && typeof device.allow_external_actions !== 'boolean') throw new StateError('invalid_config_allow_external_actions');
        if (device.disable_bearer_auth !== undefined && typeof device.disable_bearer_auth !== 'boolean') throw new StateError('invalid_config_disable_bearer_auth');
        this.devices.set(String(device.id), {family, device});
      }
    }
  }
  prepare(accessory, params) {
    const saved = this.devices.get(String(accessory.id));
    if (!saved || saved.device.allow_external_actions !== true) throw new StateError('external_actions_disabled', 403);
    const keys = Object.keys(params).filter(key => !['accessoryId', 'action'].includes(key));
    if (keys.length !== 1) throw new StateError('one_action_field_required');
    const candidates = Actions.fields(saved.family, saved.device).filter(item => Actions.parameter(item) === keys[0]);
    const raw = params[keys[0]];
    const field = candidates.find(item => !Object.hasOwn(item, 'fixedValue') || Actions.inputValue(item) === raw);
    if (!field) throw new StateError('unsupported_action_or_value');
    let value;
    try {value = Actions.value(field, Object.hasOwn(field, 'fixedValue') ? undefined : raw);} catch (error) {throw new StateError(error.message);}
    if (!Actions.commandURL(field, value, saved.device)) throw new StateError('action_url_not_configured', 409);
    // Never add a new characteristic or bypass the accessory's HomeKit handler.
    const type = this.Characteristic[field.characteristic];
    const characteristic = accessory.service?.characteristics.find(item => item.UUID === type?.UUID);
    if (!characteristic) throw new StateError('action_characteristic_unavailable', 503);
    return () => new Promise((resolve, reject) => {
      characteristic.setValue(value, error => {
        if (error) {reject(new StateError('action_failed', 502)); return;}
        resolve({success: true, accessoryId: String(accessory.id), action: 'on', command: field.key,
          value, commandCompleted: true, physicalCompletionConfirmed: false});
      }, 'external_action');
    });
  }
}
module.exports = ActionApi;
