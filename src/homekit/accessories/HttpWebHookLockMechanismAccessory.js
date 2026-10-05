'use strict';
const StateAccessory = require('../StateAccessory');
class HttpWebHookLockMechanismAccessory extends StateAccessory {
  constructor(Service, Characteristic, platform, config) { super(Service, Characteristic, platform, config, 'lockmechanism'); }
  getLockCurrentState(callback) { this.get('currentState', callback); }
  getLockTargetState(callback) { this.get('targetState', callback); }
  setLockTargetState(value, callback, context) { this.command(value, callback, context); }
}
module.exports = HttpWebHookLockMechanismAccessory;
