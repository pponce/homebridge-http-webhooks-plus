// Browser integration against Homebridge's documented injected config API.
// Synthetic configuration only. Outbound network requests are blocked.
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const schema = require('../config.schema.json');
const root = path.join(__dirname, '../homebridge-ui/public');
const artifacts = path.join(__dirname, 'ui-artifacts');
const fixture = [
  {accessory: 'HttpWebHookSwitch', name: 'Standalone', id: 'standalone', future: true},
  {platform: 'HttpWebHooks', webhook_port: '51928', state_api_token: 'synthetic_fixture_token_0123456789',
    _bridge: {username: 'AA:BB:CC:DD:EE:FF', port: 51900}, future: {zero: 0, disabled: false},
    sensors: [{id: 0, name: 'Hall motion', type: 'motion', future: {value: 0}}],
    lights: [{id: 'desk', name: 'Desk light', on_url: 'http://light.example/on', off_url: 'http://light.example/off'}],
    garagedooropeners: [{id: 'garage', name: 'Garage door', external_state: true, feedback_timeout_seconds: 0}],
    lockmechanisms: [{id: 'lock', name: 'Front door', state_mode: 'external'}]},
  {platform: 'homebridge-http-webhooks-plus.HttpWebHooks', name: 'Second platform', webhook_port: '51929'}
];
let browser, server, url;
before(async () => {
  fs.mkdirSync(artifacts, {recursive: true});
  server = http.createServer((req, res) => {
    const file = req.url === '/' ? 'index.html' : req.url.slice(1);
    if (!['index.html', 'index.js', 'model.js', 'styles.css'].includes(file)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html');
    if (file !== 'index.html') { res.end(fs.readFileSync(path.join(root, file))); return; }
    res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + fs.readFileSync(path.join(root, file), 'utf8') + '</body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({headless: true});
});
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });
async function pageFor(config = fixture, options = {}) {
  const context = await browser.newContext({viewport: {width: 920, height: 1000}, colorScheme: 'light'});
  await context.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
  const page = await context.newPage();
  page.on('dialog', dialog => dialog.accept());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({config, schema, options}) => {
    const copy = value => JSON.parse(JSON.stringify(value));
    window.mock = {config: copy(config), saved: null, updates: 0, saves: 0, failSave: false, hostDisabled: false};
    const api = new EventTarget();
    Object.assign(api, {
      plugin: {installedVersion: '0.6.0'}, disableSaveButton() { mock.hostDisabled = true; },
      hideSchemaForm() {}, fixScrollHeight() {}, showSpinner() {}, hideSpinner() {},
      async getPluginConfig() { if (options.failLoad) throw Error('synthetic'); return copy(mock.config); },
      async getPluginConfigSchema() { return copy(schema); },
      async updatePluginConfig(value) { mock.updates++; mock.config = copy(value); return copy(value); },
      async savePluginConfig() { mock.saves++; if (mock.failSave) throw Error('synthetic secret must not be shown'); mock.saved = copy(mock.config); }
    });
    window.homebridge = api;
    window.addEventListener('load', () => { document.body.className = 'config-ui-x-teal'; api.dispatchEvent(new Event('ready')); });
  }, {config, schema, options});
  await page.goto(url);
  if (!options.failLoad) await page.waitForSelector('#overview:not([hidden])');
  else await page.waitForFunction(() => document.querySelector('#page-message').textContent.includes('Could not load'));
  return {page, context, errors};
}
async function screenshot(page, name) {
  await page.screenshot({path: path.join(artifacts, name + '.jpg'), fullPage: true, type: 'jpeg', quality: 72});
}
async function openGroup(page, text) {
  const summary = page.locator('summary').filter({hasText: text}).first();
  if (!(await summary.evaluate(element => element.parentElement.open))) await summary.click();
}
test('opening is read-only; no-op device edit preserves every block, unknown key and value type', async () => {
  const {page, context, errors} = await pageFor();
  assert.equal(await page.locator('.device-row').count(), 4);
  assert.equal(await page.evaluate(() => mock.updates), 0);
  assert.equal(await page.evaluate(() => mock.saves), 0);
  assert.equal(await page.evaluate(() => mock.hostDisabled), true);
  await screenshot(page, 'overview-light');
  await page.getByRole('button', {name: 'Edit Hall motion', exact: true}).click();
  assert.equal(await page.locator('#device-id').inputValue(), '0');
  await page.getByRole('button', {name: 'Apply changes', exact: true}).click();
  await page.getByRole('button', {name: 'Save settings', exact: true}).click();
  await page.waitForFunction(() => mock.saved !== null);
  assert.deepEqual(await page.evaluate(() => mock.saved), fixture);
  assert.deepEqual(errors, []);
  await context.close();
});
test('delete garage and lock, retain token, save and reopen without generating any other families', async () => {
  const initial = structuredClone(fixture);
  const {page, context, errors} = await pageFor(initial);
  for (const name of ['Garage door', 'Front door']) {
    const row = page.locator('.device-row').filter({has: page.locator('strong', {hasText: name})});
    await row.getByRole('button', {name: 'Remove', exact: true}).click();
    await row.getByRole('button', {name: 'Confirm removal', exact: true}).click();
  }
  await page.getByRole('button', {name: 'Save settings', exact: true}).click();
  await page.waitForFunction(() => mock.saved !== null);
  initial[1].garagedooropeners = []; initial[1].lockmechanisms = [];
  const saved = await page.evaluate(() => mock.saved);
  assert.deepEqual(saved, initial);
  assert.deepEqual(errors, []);
  await context.close();
  const reopened = await pageFor(saved);
  assert.equal(await reopened.page.locator('.device-row').count(), 2);
  assert.equal(await reopened.page.evaluate(() => mock.updates), 0);
  await reopened.context.close();
});
test('all 15 types add explicitly, cancel creates nothing, validation blocks duplicate IDs and invalid payloads', async () => {
  const {page, context, errors} = await pageFor([{platform: 'HttpWebHooks'}]);
  await page.locator('#add-device').click();
  await page.getByRole('button', {name: 'Switch', exact: true}).click();
  await page.locator('#cancel-edit').click();
  assert.equal(await page.locator('.device-row').count(), 0);
  assert.equal(await page.evaluate(() => mock.updates), 0);
  const labels = require('../homebridge-ui/public/model').labels;
  for (const [family, label] of Object.entries(labels)) {
    await page.locator('#add-device').click();
    await page.getByRole('button', {name: label, exact: true}).click();
    await page.locator('#apply-device').click();
    assert.equal(await page.locator('#device-id').getAttribute('aria-invalid'), 'true');
    await page.locator('#device-id').fill(family);
    await page.locator('#device-name').fill('Example ' + label);
    if (family === 'sensors') await page.locator('#device-type').selectOption('motion');
    if (family === 'statelessswitches') {
      assert.equal(await page.locator('.button-row').count(), 0);
      await page.getByRole('button', {name: '+ Add button', exact: true}).click();
      await page.locator('#device-button-0-name').fill('First button');
    }
    await page.locator('#apply-device').click();
    await page.waitForSelector('#overview:not([hidden])');
  }
  assert.equal(await page.locator('.device-row').count(), 15);
  await page.getByRole('button', {name: 'Edit Example Switch', exact: true}).click();
  await page.locator('#device-id').fill('sensors');
  await page.locator('#apply-device').click();
  assert.match(await page.locator('#device-id-error').textContent(), /already uses/);
  await page.locator('#device-id').fill('switches');
  await openGroup(page, 'On command');
  await page.locator('#device-on_headers').fill('{bad');
  await page.locator('#apply-device').click();
  assert.equal(await page.locator('#device-on_headers').getAttribute('aria-invalid'), 'true');
  await page.locator('#device-on_headers').fill('{"X-Example":"test"}');
  await page.locator('#apply-device').click();
  await page.locator('#save-settings').click();
  await page.waitForFunction(() => mock.saved !== null);
  const saved = await page.evaluate(() => mock.saved[0]);
  for (const family of Object.keys(labels)) assert.equal(saved[family].length, 1, family);
  assert.deepEqual(saved.statelessswitches[0].buttons, [{name: 'First button'}]);
  assert.equal(Object.hasOwn(saved.sensors[0], 'autoRelease'), false);
  assert.equal(Object.hasOwn(saved.garagedooropeners[0], 'state_mode'), false);
  assert.deepEqual(errors, []);
  await context.close();
});
test('theme follows Homebridge, mobile fits, legacy alias edits remain consistent', async () => {
  const {page, context, errors} = await pageFor();
  await page.emulateMedia({colorScheme: 'dark'});
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.evaluate(() => document.body.classList.add('dark-mode'));
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await screenshot(page, 'overview-dark');
  await page.getByRole('button', {name: 'Edit Garage door', exact: true}).click();
  assert.equal(await page.locator('#device-state_mode').inputValue(), '');
  assert.match(await page.locator('#device-state_mode option:checked').textContent(), /External/);
  await page.locator('#device-state_mode').selectOption('optimistic');
  await screenshot(page, 'garage-editor');
  await page.setViewportSize({width: 390, height: 844});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await screenshot(page, 'garage-mobile');
  await page.locator('#apply-device').click();
  await page.locator('#save-settings').click();
  await page.waitForFunction(() => mock.saved !== null);
  const saved = await page.evaluate(() => mock.saved[1].garagedooropeners[0]);
  assert.equal(saved.state_mode, 'optimistic'); assert.equal(saved.external_state, false);
  assert.equal(saved.feedback_timeout_seconds, 0);
  assert.deepEqual(errors, []);
  await context.close();
});
test('failed save keeps edits for retry; failed load cannot overwrite config; secrets stay masked', async () => {
  const {page, context, errors} = await pageFor();
  await openGroup(page, 'Incoming State API');
  assert.equal(await page.locator('#platform-state_api_token').getAttribute('type'), 'password');
  await page.locator('#platform-state_api_token').fill('short');
  await page.locator('#save-settings').click();
  assert.equal(await page.evaluate(() => mock.updates), 0);
  await page.locator('#platform-state_api_token').fill('');
  await page.locator('#platform-webhook_port').fill('51930');
  await page.evaluate(() => { mock.failSave = true; });
  await page.locator('#save-settings').click();
  await page.waitForFunction(() => document.querySelector('#save-status').textContent === 'Changes not saved');
  assert.equal(await page.locator('#platform-webhook_port').inputValue(), '51930');
  assert.doesNotMatch(await page.locator('#page-message').textContent(), /synthetic secret/);
  await page.evaluate(() => { mock.failSave = false; });
  await page.locator('#save-settings').click();
  await page.waitForFunction(() => mock.saved !== null);
  assert.equal(await page.evaluate(() => Object.hasOwn(mock.saved[1], 'state_api_token')), false);
  assert.deepEqual(errors, []);
  await context.close();
  const failed = await pageFor(fixture, {failLoad: true});
  assert.equal(await failed.page.locator('#overview').isVisible(), false);
  assert.equal(await failed.page.evaluate(() => mock.updates), 0);
  await failed.context.close();
});
