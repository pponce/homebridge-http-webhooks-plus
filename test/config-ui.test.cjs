const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../config.schema.json');
const props = schema.schema.properties;
const families = Object.keys(props).filter(key => props[key].items?.properties?.id);

test('custom UI retains a safe zero-row schema fallback', () => {
  assert.equal(families.length, 15);
  // An explicit layout item is counted as a real row by ng-formworks, even if
  // listItems is zero. Schema-generated templates remain in the Add library.
  assert.equal(schema.customUi, true);
  assert.deepEqual(schema.layout, ['*']);
  for (const family of families) {
    assert.equal(props[family].minItems, 0, family);
    assert.deepEqual(props[family].default, [], family);
    assert.equal(props[family]['ui:widget'].listItems, 0, family);
    const id = props[family].items.properties.id;
    assert.equal(id.required, true);
    assert.equal(id.minLength, 1);
    assert.equal(id.maxLength, 128);
  }
  assert.equal(props.statelessswitches.items.properties.buttons['ui:widget'].listItems, 0);
  assert.equal(props.extra_redaction_keys['ui:widget'].listItems, 0);
});

test('generated form exposes all settings and preserves state defaults and token scope', () => {
  const order = schema.schema['ui:order'];
  assert.deepEqual([...order].sort(), Object.keys(props).sort());
  assert.deepEqual(order.slice(-families.length), families);
  for (const family of ['garagedooropeners', 'lockmechanisms']) {
    const fields = props[family].items.properties;
    for (const name of ['state_mode', 'startup_state_policy', 'notification_policy',
      'notification_min_interval_ms', 'request_timeout_ms', 'response_max_bytes']) {
      assert.ok(fields[name], `${family}.${name}`);
    }
    assert.equal(Object.hasOwn(fields, 'state_api_token'), false);
    assert.equal(Object.hasOwn(fields.state_mode, 'default'), false);
    assert.equal(Object.hasOwn(fields.startup_state_policy, 'default'), false);
    assert.equal(fields.notification_policy.default, 'changes_only');
    assert.equal(fields.request_timeout_ms.default, 10000);
    assert.equal(fields.response_max_bytes.default, 65536);
  }
  assert.equal(props.state_api_token.format, 'password');
  assert.equal(Object.hasOwn(props.state_api_token, 'default'), false);
  assert.equal(props.webhook_response_mode.default, 'legacy');
  assert.equal(props.garagedooropeners.items['ui:order'].includes('external_state'), false);
});
