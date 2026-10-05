const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const Garage = require('../src/homekit/accessories/HttpWebHookGarageDoorOpenerAccessory');
const Lock = require('../src/homekit/accessories/HttpWebHookLockMechanismAccessory');
const transport = require('../src/CommandRequest');
const {bodyObject} = require('../src/StateContract');
class Char extends EventEmitter {
  updateValue(value) { this.value = value; this.emit('update', value); return this; }
  sendEventNotification(value) { this.value = value; this.emit('event', value); return this; }
}
class Service { constructor(name) { this.name = name; this.chars = {}; } setCharacteristic() { return this; }
  getCharacteristic(name) { return this.chars[name] ||= new Char(); }
}
const services = {GarageDoorOpener: Service, LockMechanism: Service, AccessoryInformation: Service};
const chars = Object.fromEntries(['Manufacturer','Model','SerialNumber','CurrentDoorState','TargetDoorState','ObstructionDetected','LockCurrentState','LockTargetState'].map(n => [n,n]));
function fixture(t, Kind = Garage, config = {}, legacy = {}, directory) {
  const cacheDirectory = directory || fs.mkdtempSync(path.join(os.tmpdir(), 'webhooks-state-'));
  if (!directory) t.after(() => { fs.rmSync(cacheDirectory, {recursive:true, force:true}); fs.rmSync(cacheDirectory + '.plus-state-v1', {recursive:true, force:true}); });
  const platform = {cacheDirectory, log: Object.assign(()=>{}, {debug(){},error(){}}), storage: {getItemSync: k => legacy[k]}};
  return new Kind(services, chars, platform, {id:'sample', name:'Sample', ...config});
}
function get(a, field) { let result; a.get(field,(err,value)=>{if(err)throw err;result=value;});return result; }
module.exports={fixture,services,chars};
