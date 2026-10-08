'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const {accessoryRows} = require('../src/AccessoryConfig');
const Server = require('../src/Server');
const {services, chars} = require('./fixture.cjs');
const schema = require('../config.schema.json');
const httpDefaults = {rejectUnauthorized:false, log_level:'inherit',
  request_timeout_ms:10000, response_max_bytes:65536, max_redirects:0};
// Synthetic reproduction of the default-only rows saved by the settings UI.
const savedRows = {
  sensors:[{autoRelease:false,log_level:'inherit'}],
  switches:[{...httpDefaults}], pushbuttons:[{...httpDefaults}],
  doorbells:[{double_press:false,long_press:false,log_level:'inherit'}],
  co2sensors:[{log_level:'inherit'}], thermostats:[{...httpDefaults}],
  outlets:[{...httpDefaults}], security:[{...httpDefaults}],
  statelessswitches:[{buttons:[{double_press:false,long_press:false}],log_level:'inherit'}],
  windowcoverings:[{...httpDefaults}],
  fanv2s:[{...httpDefaults,enableLockPhysicalControls:false,enableTargetStateControls:false,enableSwingModeControls:false}],
  valves:[{...httpDefaults}]
};

function loadPlatform(t, config) {
  const warnings = [];
  const log = Object.assign(()=>{}, {warn:message=>warnings.push(message),error(){},debug(){}});
  const load = Module._load;
  let platform;
  // Exercise the real platform and constructors without disk storage, HomeKit
  // publication, listeners, or device requests.
  Module._load = function(name, ...rest) {
    if (name === 'node-persist') return {initSync(){},getItemSync(){}};
    return load.call(this, name, ...rest);
  };
  try {
    const Platform = require('../src/homekit/HttpWebHooksPlatform');
    platform = new Platform(log, config, {hap:{
      Service:{...services,Switch:services.AccessoryInformation,Lightbulb:services.AccessoryInformation},
      Characteristic:chars
    },on(){}});
  } finally { Module._load = load; }
  let started = 0;
  t.mock.method(platform.server, 'start', () => { started++; });
  let accessories;
  platform.accessories(value => {accessories=value;});
  return {platform,accessories,warnings,started};
}

test('phantom rows no longer prevent startup; retained API token is independent', t => {
  const config = {...structuredClone(savedRows),state_api_token:'a'.repeat(64)};
  const before = structuredClone(config);
  const result = loadPlatform(t, config);
  assert.deepEqual(result.accessories, []);
  assert.equal(result.started, 1);
  assert.equal(result.warnings.length, 12);
  assert.equal(result.platform.server.stateApiToken, config.state_api_token);
  assert.deepEqual(config, before, 'startup must not rewrite the user config');
});

test('remaining real devices retain identity and settings beside phantom rows', t => {
  const light = {id:'desk-light',name:'Desk Light',on_url:'http://127.0.0.1:1/light'};
  const switchRow = {id:0,name:'Virtual Switch'};
  const config = {...structuredClone(savedRows),lights:[light],switches:[...savedRows.switches,switchRow]};
  const {platform,accessories} = loadPlatform(t, config);
  assert.deepEqual(accessories.map(a=>a.id),[0,'desk-light']);
  assert.equal(platform.lights[0],light);
  assert.equal(platform.switches[0],switchRow);
  assert.equal(platform.server.byId.get('desk-light').onURL,light.on_url);
  assert.equal(platform.server.byId.get('0').name,'Virtual Switch');
});

test('all absent or empty device lists start successfully', t => {
  assert.deepEqual(loadPlatform(t, {}).accessories, []);
  const config = Object.fromEntries(Object.entries(schema.schema.properties)
    .filter(([,s])=>s.items?.properties?.id).map(([key])=>[key,[]]));
  assert.deepEqual(loadPlatform(t, config).accessories, []);
});

test('partially configured devices are not discarded; errors locate the row without secrets', () => {
  const log = {warn(){throw Error('unexpected skip');}};
  for (const row of [{name:'Intended device'},{on_url:'http://secret.example/?token=do-not-log'},
    {request_timeout_ms:2000},{rejectUnauthorized:true},{custom_field:'x'}, {id:'x'.repeat(129)}]) {
    assert.throws(()=>accessoryRows({switches:[row]},'switches',log), error =>
      error.code.startsWith('invalid_accessory_id: switches[0]') && !error.message.includes('secret.example'));
  }
  assert.throws(()=>accessoryRows({statelessswitches:[{buttons:[{name:'Real button'}]}]},'statelessswitches',log), /invalid_accessory_id/);
  assert.throws(()=>accessoryRows({switches:{}},'switches',log), /invalid_config_switches_array/);
  assert.throws(()=>accessoryRows({switches:[null]},'switches',log), /invalid_config_switches\[0\]_object/);
});

test('duplicate configured IDs still fail instead of being silently removed', () => {
  const rows = accessoryRows({switches:[{id:'same'},{id:'same'}]},'switches',{warn(){}});
  assert.throws(()=>Server.prototype.setAccessories.call({}, rows), /duplicate_accessory_id/);
});
