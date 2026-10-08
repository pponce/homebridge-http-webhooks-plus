const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const baseline = require('./upstream-runtime.json');
const pkg = require('../package.json');

// Only the reviewed state families and shared routing changed in 0.3.0.
const changed = new Set([...Object.keys(require('./legacy-state-source.json')), 'src/Util.js', 'config.schema.json', 'src/Server.js', 'src/homekit/HttpWebHooksPlatform.js',
  'src/homekit/accessories/HttpWebHookGarageDoorOpenerAccessory.js',
  'src/homekit/accessories/HttpWebHookLockMechanismAccessory.js']);
test('unchanged shared files retain upstream fingerprints', () => {
  const actual = [];
  function visit(folder) {
    for (const entry of fs.readdirSync(folder, {withFileTypes: true})) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) visit(full);
      else actual.push(path.relative(root, full).split(path.sep).join('/'));
    }
  }
  visit(path.join(root, 'src'));
  actual.push('config.schema.json');
  for (const file of Object.keys(baseline.sha256)) assert.ok(actual.includes(file), file);
  for (const [file, expected] of Object.entries(baseline.sha256)) {
    if (changed.has(file)) continue;
    const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
    assert.equal(digest, expected, file);
  }
});

test('all original registration aliases remain attached to the new package', () => {
  const calls = [];
  const constructors = new Map();
  const sandbox = {module: {exports: {}}, require(name) {
    const constructor = {source: name};
    constructors.set(name, constructor);
    return constructor;
  }};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'index.js'), 'utf8'), sandbox);
  sandbox.module.exports({
    registerPlatform(...args) { calls.push(['platform', ...args]); },
    registerAccessory(...args) { calls.push(['accessory', ...args]); }
  });
  const expected = [
    ['HttpWebHooks', 'HttpWebHooksPlatform'],
    ['HttpWebHookSensor', 'HttpWebHookSensorAccessory'],
    ['HttpWebHookSwitch', 'HttpWebHookSwitchAccessory'],
    ['HttpWebHookPushButton', 'HttpWebHookPushButtonAccessory'],
    ['HttpWebHookDoorbell', 'HttpWebHookDoorbellAccessory'],
    ['HttpWebHookLight', 'HttpWebHookLightBulbAccessory'],
    ['HttpWebHookThermostat', 'HttpWebHookThermostatAccessory'],
    ['HttpWebHookOutlet', 'HttpWebHookOutletAccessory'],
    ['HttpWebHookSecurity', 'HttpWebHookSecurityAccessory'],
    ['HttpWebHookGarageDoorOpener', 'HttpWebHookGarageDoorOpenerAccessory'],
    ['HttpWebHookStatelessSwitch', 'HttpWebHookStatelessSwitchAccessory'],
    ['HttpWebHookLockMechanism', 'HttpWebHookLockMechanismAccessory'],
    ['HttpWebHookWindowCovering', 'HttpWebHookWindowCoveringAccessory'],
    ['HttpWebHookFanv2', 'HttpWebHookFanv2Accessory'],
    ['HttpWebHookCarbonDioxideSensor', 'HttpWebHookCarbonDioxideSensorAccessory'],
    ['HttpWebHookValve', 'HttpWebHookValveAccessory']
  ];
  assert.equal(calls.length, expected.length);
  expected.forEach(([alias, file], i) => {
    assert.equal(calls[i][0], i === 0 ? 'platform' : 'accessory');
    assert.equal(calls[i][1], 'homebridge-http-webhooks-plus');
    assert.equal(calls[i][2], alias);
    const source = './src/homekit/' + (i === 0 ? '' : 'accessories/') + file;
    assert.equal(calls[i][3], constructors.get(source));
  });
});

test('package is independently publishable with only required runtime dependencies', () => {
  assert.equal(pkg.name, 'homebridge-http-webhooks-plus');
  assert.equal(pkg.version, '0.6.3');
  assert.equal(pkg.license, 'GPL-3.0');
  assert.equal(pkg.author, 'benzman81');
  assert.deepEqual(pkg.dependencies, {'@homebridge/plugin-ui-utils':'2.2.6', 'node-persist':baseline.dependencies['node-persist'], selfsigned:baseline.dependencies.selfsigned});
  assert.equal(pkg.engines.node, '>=18');
  assert.equal(pkg.engines.homebridge, baseline.engines.homebridge);
  assert.equal(pkg.publishConfig.registry, 'https://registry.npmjs.org/');
  assert.equal(pkg.publishConfig.access, 'public');
  assert.deepEqual(pkg.files, ['index.js', 'src/', 'config.schema.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'docs/COMPATIBILITY.md', 'docs/STATE_API.md', 'homebridge-ui/', 'THIRD_PARTY_NOTICES.md']);
  assert.match(pkg.repository.url, /pponce\/homebridge-http-webhooks-plus\.git$/);
});

test('legacy state logic and identity inputs are unchanged outside logging wiring', () => {
  for (const [file, expected] of Object.entries(require('./legacy-state-source.json'))) {
    const text = fs.readFileSync(path.join(root, file), 'utf8').split('\n')
      .filter(line => !/^\s*(?:this\.log(?:\.(?:debug|warn|info|error))?\(|this\.log =|const Util =)/.test(line))
      .map(line => line.trim()).join('\n').trim();
    assert.equal(crypto.createHash('sha256').update(text).digest('hex'), expected, file);
  }
});
