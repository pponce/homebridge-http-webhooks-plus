'use strict';
const StateAccessory = require('../StateAccessory');
class HttpWebHookGarageDoorOpenerAccessory extends StateAccessory {
  constructor(Service, Characteristic, platform, config) { super(Service, Characteristic, platform, config, 'garagedooropener'); }
  getCurrentDoorState(callback) { this.get('currentState', callback); }
  getTargetDoorState(callback) { this.get('targetState', callback); }
  setTargetDoorState(value, callback, context) { this.command(value, callback, context); }
  getObstructionDetected(callback) { this.get('obstruction', callback); }
}
module.exports = HttpWebHookGarageDoorOpenerAccessory;
