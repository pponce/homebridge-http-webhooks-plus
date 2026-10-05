const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../config.schema.json');

function fields(node, result = []) {
  if (typeof node === 'string') result.push(node);
  else if (Array.isArray(node)) node.forEach(n => fields(n, result));
  else if (node && node.items) fields(node.items, result);
  return result;
}

test('explicit Homebridge form exposes each native option once at the correct scope', () => {
  const paths = fields(schema.layout);
  for (const name of ['state_api_token', 'webhook_response_mode']) {
    assert.equal(paths.filter(p => p === name).length, 1, name);
    assert.ok(schema.schema.properties[name]);
  }
  for (const family of ['garagedooropeners', 'lockmechanisms']) {
    const entry = schema.layout[1].items.find(group => fields(group).includes(`${family}[].id`));
    const groups = entry.items[0].items.filter(item => typeof item === 'object');
    for (const name of ['state_mode', 'startup_state_policy', 'notification_policy',
      'notification_min_interval_ms', 'request_timeout_ms', 'response_max_bytes']) {
      const path = `${family}[].${name}`;
      assert.equal(paths.filter(p => p === path).length, 1, path);
      assert.ok(groups.some(group => fields(group).includes(path)), path);
      assert.ok(schema.schema.properties[family].items.properties[name]);
    }
    assert.equal(paths.includes(`${family}[].state_api_token`), false);
  }
  assert.equal(paths.includes('garagedooropeners[].external_state'), false);
});

test('all form field paths resolve and defaults preserve external-state compatibility', () => {
  for (const path of fields(schema.layout)) {
    let node = schema.schema;
    for (const part of path.split('.')) {
      const array = part.endsWith('[]');
      node = node.properties[part.replace(/\[\]$/, '')];
      assert.ok(node, path);
      if (array) node = node.items;
    }
  }
  for (const family of ['garagedooropeners', 'lockmechanisms']) {
    const props = schema.schema.properties[family].items.properties;
    assert.equal(Object.hasOwn(props.state_mode, 'default'), false);
    assert.equal(Object.hasOwn(props.startup_state_policy, 'default'), false);
    assert.equal(props.notification_policy.default, 'changes_only');
    assert.equal(props.request_timeout_ms.default, 10000);
    assert.equal(props.response_max_bytes.default, 65536);
  }
  assert.equal(schema.schema.properties.state_api_token.format, 'password');
  assert.equal(Object.hasOwn(schema.schema.properties.state_api_token, 'default'), false);
  assert.equal(schema.schema.properties.webhook_response_mode.default, 'legacy');
  assert.equal(Object.hasOwn(schema.schema.properties.garagedooropeners.items.properties.external_state, 'default'), false);
});
