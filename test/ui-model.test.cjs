const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../homebridge-ui/public/model');
const properties = require('../config.schema.json').schema.properties;

test('every device field and global setting has a group, with only the legacy alias hidden', () => {
  for (const family of M.families(properties)) {
    const props = properties[family].items.properties;
    const keys = M.deviceGroups(props).flatMap(group => group.keys);
    assert.deepEqual(keys.sort(), Object.keys(props).filter(key => key !== 'external_state').sort(), family);
    assert.equal(keys.length, new Set(keys).size, family);
  }
  assert.deepEqual(M.platformGroups.flatMap(group => group.keys).sort(), Object.keys(properties).filter(key => !M.families(properties).includes(key)).sort());
});

test('removing the last garage and lock preserves a token, other blocks, identities and opaque settings', () => {
  const blocks = [{accessory: 'HttpWebHookSwitch', id: 'standalone'}, {
    platform: 'homebridge-http-webhooks-plus.HttpWebHooks', name: 'Example', webhook_port: '51928',
    state_api_token: 'synthetic_fixture_token_0123456789', _bridge: {username: 'AA:BB:CC:DD:EE:FF', port: 51900},
    future: {enabled: false}, sensors: [{id: 0, type: 'contact'}],
    garagedooropeners: [{id: 'garage', external_state: true, custom: {zero: 0}}], lockmechanisms: [{id: 'lock'}]
  }, {platform: 'HttpWebHooks', webhook_port: '51929'}];
  const original = M.clone(blocks);
  blocks[1] = M.removeDevice(blocks[1], 'garagedooropeners', 0);
  blocks[1] = M.removeDevice(blocks[1], 'lockmechanisms', 0);
  const expected = M.clone(original); expected[1].garagedooropeners = []; expected[1].lockmechanisms = [];
  assert.deepEqual(blocks, expected);
  assert.equal(M.devices(blocks[1], properties).length, 1);
  assert.equal(M.validate(blocks[1], properties, true).state_api_token, undefined);
  assert.equal(M.validate({...blocks[1], sensors: []}, properties, true).state_api_token, undefined);
});

test('only explicit additions create an array and edits retain opaque device properties', () => {
  const initial = {platform: 'HttpWebHooks', _bridge: {username: 'AA:BB:CC:DD:EE:FF'}};
  for (const family of M.families(properties)) {
    const data = {id: family, opaque: {zero: 0, flag: false}};
    const next = M.applyDevice(initial, family, null, data);
    assert.deepEqual(Object.keys(next), ['platform', '_bridge', family]);
    assert.deepEqual(initial, {platform: 'HttpWebHooks', _bridge: {username: 'AA:BB:CC:DD:EE:FF'}});
    const edit = M.clone(next[family][0]); edit.name = 'Renamed';
    assert.deepEqual(M.applyDevice(next, family, 0, edit)[family][0], {...data, name: 'Renamed'});
  }
  assert.throws(() => M.applyDevice({sensors: {}}, 'sensors', null, {id: 'x'}));
});

test('validation accepts numeric zero IDs, explicit false/zero and omitted contextual defaults', () => {
  assert.deepEqual(M.validate({id: 0, obstruction_monitoring: false, feedback_timeout_seconds: 0}, properties.garagedooropeners.items.properties), {});
  assert.deepEqual(M.validate({id: 'garage', external_state: true}, properties.garagedooropeners.items.properties), {});
  assert.ok(M.validate({id: 'garage', external_state: true, state_mode: 'optimistic'}, properties.garagedooropeners.items.properties).state_mode);
  const config = {sensors: [{id: 0}], switches: [{id: 'switch'}]};
  assert.equal(M.duplicateId(config, properties, {id: '0'}), true);
  assert.equal(M.duplicateId(config, properties, {id: 0}, {family: 'sensors', index: 0}), false);
});

test('invalid listener pairs, IDs, command payloads and limits are caught before saving', () => {
  assert.ok(M.validate({state_api_token: 'short'}, properties, true).state_api_token);
  assert.ok(M.validate({webhook_port: '65536'}, properties, true).webhook_port);
  assert.ok(M.validate({http_auth_user: 'user'}, properties, true).http_auth_pass);
  assert.ok(M.validate({https_keyfile: '/example/key'}, properties, true).https_certfile);
  const schema = properties.switches.items.properties;
  for (const [key, value] of Object.entries({id: '', on_headers: '{bad}', on_url: 'javascript:bad',
    on_method: 'get', request_timeout_ms: 0, max_redirects: 1.5, on_form: '{"nested":{}}'})) {
    assert.ok(M.validate({id: 'switch', [key]: value}, schema)[key], key);
  }
  assert.ok(M.validate({id: 'switch', on_body: 'raw', on_form: '{}'}, schema).on_form);
  assert.ok(M.validate({id: 'multi', buttons: [null]}, properties.statelessswitches.items.properties).buttons);
  assert.throws(() => M.readField('[1]', schema.on_headers, 'on_headers'));
  assert.equal(M.readField('', properties.state_api_token, 'state_api_token'), undefined);
});
