const {test} = require('node:test');
const assert = require('node:assert/strict');
const A = require('../homebridge-ui/public/api');
const M = require('../homebridge-ui/public/model');
test('API reference covers all device families and sensor subtypes without mutating configuration', () => {
  for (const family of Object.keys(M.labels)) {
    const device = {id: 0, type: 'motion', buttons: [{name: 'First', double_press: false}], brightness_factor: 2.55};
    const before = structuredClone(device);
    const fields = A.fields(family, device);
    assert.ok(fields.length, family);
    for (const field of fields) {
      const value = field.values ? field.values[0][0] : String(field.sample);
      const request = A.build({}, device, family, field, value, 'homebridge.local');
      const params = new URL(request.endpoint).searchParams;
      assert.equal(params.get('accessoryId'), '0');
      assert.equal(params.get(field.key), value);
    }
    assert.deepEqual(device, before);
  }
  for (const type of ['contact','motion','occupancy','smoke','temperature','humidity','airquality','light','leak']) {
    const field = A.fields('sensors', {type})[0];
    assert.equal(field.key, ['contact','motion','occupancy','smoke'].includes(type) ? 'state' : 'value');
  }
});
test('URL and shell examples preserve Unicode, punctuation, zero, false, and omit saved credentials', () => {
  const config = {webhook_port: '51930', https: true, http_auth_user: 'secret-user', http_auth_pass: 'secret-password', state_api_token: 'secret-token'};
  const device = {id: "A/B? café '&$()"};
  const field = A.fields('garagedooropeners', device)[0];
  const request = A.build(config, device, 'garagedooropeners', field, '0', '[::1]', true);
  assert.equal(decodeURIComponent(new URL(request.endpoint).pathname.split('/')[3]), device.id);
  assert.equal(request.endpoint.startsWith('https://[::1]:51930/'), true);
  assert.deepEqual(JSON.parse(request.body), {currentState: 0});
  assert.doesNotMatch(request.curl, /secret-user|secret-password|secret-token/);
  assert.match(request.curl, /YOUR_HTTP_USER:YOUR_HTTP_PASSWORD/);
  assert.match(request.curl, /X-Webhooks-Token: YOUR_STATE_API_TOKEN/);
  const obstruction = A.fields('garagedooropeners', device)[2];
  assert.deepEqual(JSON.parse(A.build(config, device, 'garagedooropeners', obstruction, 'false', 'localhost', true).body), {obstruction: false});
  const webhook = A.build(config, device, 'garagedooropeners', field, '0', 'localhost');
  assert.equal(new URL(webhook.endpoint).searchParams.get('accessoryId'), device.id);
  assert.match(webhook.endpoint, /%27/);
});
test('enabled button events and optional fan controls follow device configuration', () => {
  assert.deepEqual(A.fields('doorbells', {double_press: false})[0].values.map(item => item[0]), ['0','2']);
  const fields = A.fields('statelessswitches', {buttons: [{name: 'A&B', single_press: false, long_press: false}]});
  assert.deepEqual(fields[0].values, [['1','Double press']]);
  assert.equal(new URL(A.build({}, {id:'button'}, 'statelessswitches', fields[0], '1', 'localhost').endpoint).searchParams.get('buttonName'), 'A&B');
  const minimal = A.fields('fanv2s', {});
  assert.deepEqual(minimal.map(field => field.key), ['state','speed','rotationDirection']);
  const all = A.fields('fanv2s', {enableLockPhysicalControls:true, enableSwingModeControls:true, enableTargetStateControls:true});
  const lock = all.find(field => field.key === 'lockstate');
  const params = new URL(A.build({}, {id:'fan'}, 'fanv2s', lock, '0', 'localhost', false, 'true').endpoint).searchParams;
  assert.equal(params.get('state'), 'true');
  assert.equal(params.get('lockstate'), '0');
  assert.equal(params.get('lockState'), '0');
  assert.equal(A.fields('lights', {brightness_factor:2.55})[1].max, 255);
});
test('host input cannot insert URL credentials, paths, or a shell expression', () => {
  for (const host of ['https://host','host:123','host/path','a b','host?x=1',"host'",'user@host','$()']) assert.throws(() => A.origin({},host));
  assert.equal(A.origin({}, '192.0.2.1'), 'http://192.0.2.1:51828');
  assert.equal(A.origin({}, '[2001:db8::1]'), 'http://[2001:db8::1]:51828');
});
