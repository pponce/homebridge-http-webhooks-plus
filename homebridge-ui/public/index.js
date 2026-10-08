(function () {
  'use strict';
  const M = window.WebhooksConfig;
  const $ = id => document.getElementById(id);
  let properties, blocks, baseline, activeIndex, editing, ready = false, saving = false;
  let platformControls = [], deviceControls = [], apiTrigger, networkInfo, apiGeneration = 0;
  const config = () => blocks[activeIndex];
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  };
  function button(text, className, action) {
    const element = node('button', className, text);
    element.type = 'button';
    element.addEventListener('click', action);
    return element;
  }
  function message(text, kind = '') {
    $('page-message').textContent = text;
    $('page-message').className = 'notice ' + kind;
    $('page-message').hidden = !text;
    window.homebridge?.fixScrollHeight();
  }
  function changed() {
    if (!ready) return;
    $('save-status').textContent = 'Unsaved changes';
    $('save-settings').disabled = saving;
    message('');
  }
  function theme() {
    const chosen = [...document.body.classList].some(name => /^config-ui-x-/.test(name));
    const dark = document.body.classList.contains('dark-mode') ||
      (!chosen && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }
  function defaultLabel(key, schema, target) {
    if (schema.required && key !== 'webhook_port') return 'Choose an option';
    if (key === 'state_mode') return target.external_state ? 'Default · External feedback (legacy option)' : 'Default · Optimistic';
    if (key === 'startup_state_policy') return 'Automatic · Based on state source';
    if (key === 'rejectUnauthorized') return 'Default · Verify certificates';
    if (key === 'double_press' || key === 'long_press') return 'Default · Enabled';
    if (schema.type === 'boolean') return 'Default · ' + (schema.default ? 'Enabled' : 'Disabled');
    return schema.default !== undefined ? 'Default · ' + friendly(schema.default) : 'Default';
  }
  function friendly(value) {
    const names = {optimistic: 'Optimistic', external: 'External feedback', await_feedback: 'Wait for fresh feedback',
      use_cache: 'Use cached state', changes_only: 'State changes only', allow_explicit: 'Allow explicit notifications'};
    return names[value] || String(value).replaceAll('_', ' ').replace(/^./, character => character.toUpperCase());
  }
  function helpText(key, schema) {
    if (key === 'id') return 'Unique across all devices. Keep this unchanged to preserve webhook URLs and accessory identity.';
    if (key === 'webhook_port') return 'The port clients use to send webhooks. Default: 51828.';
    if (key === 'webhook_listen_host') return 'Leave empty to listen on all interfaces (::).';
    if (key === 'webhook_bearer_token') return 'Optional shared Bearer token for all incoming reports and actions. Use a random 32–256 character token. Individual devices can opt out. Choose Bearer or Basic authentication.';
    if (key === 'state_api_token') return 'Optional credential for incoming garage and lock state reports. Use 32–256 letters, numbers, underscores, or hyphens. It can stay configured even if all garages and locks are removed.';
    if (key === 'http_auth_pass') return 'Provide both an HTTP auth user and password, or leave both empty.';
    if (key === 'rejectUnauthorized') return 'Verify the certificate of outgoing HTTPS requests. The default is enabled.';
    if (key === 'extra_redaction_keys') return 'One extra field name per line. These values are also redacted from logs.';
    if (key.endsWith('_headers')) return 'Optional JSON object of HTTP headers.';
    if (key.endsWith('_body')) return 'Optional raw request body. Leave empty when using a form.';
    return schema.description || '';
  }
  function field(key, schema, target, controls, prefix, onChange) {
    if (key === 'buttons') return buttonsField(schema, target, controls, prefix, onChange);
    const wrapper = node('div', 'field');
    if (/(_url|_headers|_body|_form)$/.test(key) || ['state_api_token', 'webhook_bearer_token', 'extra_redaction_keys'].includes(key)) wrapper.classList.add('wide');
    const id = prefix + '-' + key;
    const label = node('label', '', key === 'rejectUnauthorized' ? 'Verify HTTPS certificates' : schema.title || key);
    label.htmlFor = id;
    wrapper.append(label);
    let input;
    if (schema.enum || schema.type === 'boolean') {
      input = node('select');
      const option = node('option', '', defaultLabel(key, schema, target));
      option.value = '';
      input.append(option);
      for (const value of schema.enum || [true, false]) {
        const option = node('option', '', typeof value === 'boolean' ? (value ? 'Enabled' : 'Disabled') : friendly(value));
        option.value = String(value);
        input.append(option);
      }
      // Keep unrecognized values visible until the user deliberately changes them.
      if (M.own(target, key) && ![...input.options].some(option => option.value === String(target[key]))) {
        const option = node('option', '', 'Existing value (choose to change)');
        option.value = String(target[key]);
        input.append(option);
      }
    } else if (/(_headers|_body|_form)$/.test(key) || schema.type === 'array') {
      input = node('textarea');
      input.rows = key.endsWith('_headers') ? 2 : 3;
      input.spellcheck = false;
    } else {
      input = node('input');
      input.type = ['integer', 'number'].includes(schema.type) ? 'number' : 'text';
      if (input.type === 'number') input.step = schema.type === 'integer' ? '1' : 'any';
      if (key === 'webhook_port') input.inputMode = 'numeric';
    }
    input.id = id;
    input.name = key;
    input.autocomplete = 'off';
    if (schema.format === 'password' || key === 'http_auth_pass') input.type = 'password';
    input.value = target[key] === undefined || target[key] === null ? '' :
      (Array.isArray(target[key]) ? target[key].join('\n') :
        M.isObject(target[key]) ? JSON.stringify(target[key], null, 2) : String(target[key]));
    if (input.tagName !== 'SELECT') {
      input.placeholder = schema.default !== undefined ? 'Default: ' + schema.default :
        key.endsWith('_url') ? 'https://device.example/command' :
          key.endsWith('_method') ? 'Default: GET' : String(schema.placeholder ?? '');
    }
    const record = {key, target, schema, input, wrapper, parseError: '', error: node('p', 'field-error')};
    record.error.id = id + '-error';
    record.error.hidden = true;
    if (input.type === 'password') {
      const row = node('div', 'secret-control');
      const reveal = button('Show', '', () => {
        input.type = input.type === 'password' ? 'text' : 'password';
        reveal.textContent = input.type === 'password' ? 'Show' : 'Hide';
        reveal.setAttribute('aria-pressed', String(input.type === 'text'));
      });
      reveal.setAttribute('aria-label', 'Show or hide ' + (schema.title || key));
      reveal.setAttribute('aria-pressed', 'false');
      row.append(input, reveal);
      wrapper.append(row);
    } else wrapper.append(input);
    const help = helpText(key, schema);
    input.setAttribute('aria-describedby', id + '-help ' + record.error.id);
    const description = node('p', 'field-help', help);
    description.id = id + '-help';
    description.hidden = !help;
    wrapper.append(description, record.error);
    input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
      try {
        const value = M.readField(input.value, schema, key);
        if (value === undefined) delete target[key];
        else target[key] = value;
        if (key === 'state_mode' && value !== undefined && M.own(target, 'external_state')) target.external_state = value === 'external';
        record.parseError = '';
      } catch (error) { record.parseError = error.message; }
      showFieldError(record, record.parseError);
      onChange();
    });
    controls.push(record);
    return wrapper;
  }
  function showFieldError(record, error) {
    record.error.textContent = error;
    record.error.hidden = !error;
    record.input.setAttribute('aria-invalid', String(Boolean(error)));
  }
  function buttonsField(schema, target, controls, prefix, onChange) {
    const wrapper = node('div', 'field wide');
    wrapper.append(node('h3', '', 'Buttons'), node('p', 'field-help', 'Add buttons in their webhook order. Removing a button changes the indexes of those after it.'));
    const list = node('div');
    wrapper.append(list);
    let records = [];
    function render() {
      for (const record of records) {
        const index = controls.indexOf(record);
        if (index >= 0) controls.splice(index, 1);
      }
      records = [];
      list.replaceChildren();
      if (target.buttons !== undefined && !Array.isArray(target.buttons)) {
        list.append(node('p', 'field-error', 'The buttons value is not a list. Repair it in the JSON configuration editor.'));
        add.disabled = true;
        return;
      }
      (target.buttons || []).forEach((item, index) => {
        const row = node('div', 'button-row');
        const heading = node('div', 'button-row-heading');
        heading.append(node('strong', '', 'Button ' + (index + 1)), button('Remove button', 'quiet', () => {
          target.buttons.splice(index, 1);
          onChange(); render();
        }));
        row.append(heading);
        if (M.isObject(item)) {
          const grid = node('div', 'field-grid');
          for (const [key, definition] of Object.entries(schema.items.properties)) {
            grid.append(field(key, definition, item, records, prefix + '-button-' + index, onChange));
          }
          row.append(grid);
        } else row.append(node('p', 'field-error', 'Invalid button. Remove it or repair the JSON configuration.'));
        list.append(row);
      });
      controls.push(...records);
      window.homebridge.fixScrollHeight();
    }
    const add = button('+ Add button', 'secondary', () => {
      if (target.buttons === undefined) target.buttons = [];
      target.buttons.push({});
      onChange(); render();
    });
    wrapper.append(add);
    render();
    return wrapper;
  }
  function renderGroups(container, groups, schemas, target, controls, prefix, onChange) {
    container.replaceChildren();
    for (const group of groups) {
      const section = node(group.open ? 'section' : 'details', group.open ? 'field-section' : 'field-group');
      section.append(node(group.open ? 'h3' : 'summary', '', group.title));
      const grid = node('div', 'field-grid');
      for (const key of group.keys) grid.append(field(key, schemas[key], target, controls, prefix, onChange));
      section.append(grid);
      section.addEventListener('toggle', () => window.homebridge.fixScrollHeight());
      container.append(section);
    }
  }
  function focusError(record) {
    for (let parent = record.wrapper.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS') parent.open = true;
    }
    record.input.focus();
    record.wrapper.scrollIntoView({block: 'center', behavior: 'smooth'});
    window.homebridge.fixScrollHeight();
  }
  function validateControls(controls, target, schemas, platform) {
    const errors = M.validate(target, schemas, platform);
    let first;
    for (const record of controls) {
      const error = record.parseError || (record.target === target ? errors[record.key] : M.fieldError(record.target[record.key], record.schema, record.key)) || '';
      showFieldError(record, error);
      if (error && !first) first = record;
    }
    if (first) focusError(first);
    return !first;
  }
  function renderPlatform() {
    platformControls = [];
    renderGroups($('platform-fields'), M.platformGroups, properties, config(), platformControls, 'platform', changed);
    $('platform-picker').replaceChildren();
    const indexes = blocks.map((block, index) => M.isPlatform(block) ? index : -1).filter(index => index >= 0);
    $('platform-picker').hidden = indexes.length < 2;
    if (indexes.length > 1) {
      const label = node('label', '', 'Platform configuration');
      label.htmlFor = 'choose-platform';
      const select = node('select'); select.id = 'choose-platform';
      for (const index of indexes) {
        const option = node('option', '', blocks[index].name || 'Platform ' + (indexes.indexOf(index) + 1));
        option.value = index; select.append(option);
      }
      select.value = activeIndex;
      select.addEventListener('change', () => {
        if (!validateControls(platformControls, config(), properties, true)) { select.value = activeIndex; return; }
        activeIndex = Number(select.value); renderPlatform(); renderDevices();
      });
      $('platform-picker').append(label, select);
    }
  }
  function renderDevices() {
    const rows = M.devices(config(), properties);
    $('device-count').textContent = rows.length;
    $('device-list').replaceChildren();
    for (const family of M.families(properties)) {
      if (config()[family] !== undefined && !Array.isArray(config()[family])) {
        $('device-list').append(node('p', 'notice error', M.labels[family] + ' configuration is not a list. Repair this field in Homebridge’s JSON configuration editor.'));
      }
    }
    if (!rows.length) {
      const empty = node('div', 'empty-state');
      empty.append(node('h3', '', 'No devices yet'), node('p', '', 'Add a device when you’re ready. Empty device lists stay empty.'));
      $('device-list').append(empty);
    }
    rows.forEach(row => {
      const element = node('div', 'device-row');
      const data = M.isObject(row.data) ? row.data : {};
      const name = data.name || (data.id !== undefined ? String(data.id) : 'Incomplete device');
      const symbol = node('div', 'device-symbol', M.labels[row.family].slice(0, 2).toUpperCase());
      symbol.setAttribute('aria-hidden', 'true');
      const info = node('div', 'device-info');
      info.append(node('strong', '', name), node('p', 'device-meta', M.labels[row.family] + ' · ' + (data.id !== undefined ? 'ID: ' + data.id : 'ID needed')));
      const actions = node('div', 'row-actions');
      const edit = button('Edit', 'secondary', () => openEditor(row.family, row.index));
      edit.setAttribute('aria-label', 'Edit ' + name);
      const api = button('API calls', 'secondary', () => openApi(row, api));
      api.setAttribute('aria-label', 'API calls for ' + name);
      api.disabled = !M.isObject(row.data) || data.id === undefined || data.id === null || data.id === '';
      actions.append(edit, api, button('Remove', 'quiet', () => {
        actions.replaceChildren(button('Keep device', 'secondary', renderDevices), button('Confirm removal', 'danger', () => {
          if (!validateControls(platformControls, config(), properties, true)) return;
          blocks[activeIndex] = M.removeDevice(config(), row.family, row.index);
          // Rebind platform inputs to the new draft after a structural edit.
          renderPlatform(); renderDevices(); changed();
        }));
        window.homebridge.fixScrollHeight();
      }));
      element.append(symbol, info, actions);
      $('device-list').append(element);
    });
    window.homebridge.fixScrollHeight();
  }
  async function openApi(row, trigger) {
    const generation = ++apiGeneration;
    apiTrigger = trigger;
    $('overview').hidden = true;
    $('api-reference').hidden = false;
    $('api-title').textContent = (row.data.name || M.labels[row.family]) + ' · API calls';
    $('api-type').textContent = M.labels[row.family] + ' · ID: ' + row.data.id;
    $('api-content').textContent = 'Detecting Homebridge address…';
    $('api-title').focus();
    window.homebridge.fixScrollHeight();
    try {networkInfo ||= await window.homebridge.request('/api/connection');} catch (_) {}
    if (generation !== apiGeneration) return;
    window.WebhooksApi.render($('api-content'), row.family, row.data, config(), window.homebridge,
      {network: networkInfo, canExecute: JSON.stringify(blocks) === baseline && !platformControls.some(record => record.parseError)});
  }
  function openEditor(family, index = null) {
    if (!validateControls(platformControls, config(), properties, true)) return;
    if (config()[family] !== undefined && !Array.isArray(config()[family])) {
      message('This device list needs repair in the JSON configuration editor.', 'error'); return;
    }
    const original = index === null ? {} : config()[family][index];
    if (!M.isObject(original)) { message('This device row needs repair in the JSON configuration editor, or can be removed here.', 'error'); return; }
    editing = {family, index, data: M.clone(original), modified: false};
    deviceControls = [];
    $('overview').hidden = true;
    $('editor').hidden = false;
    $('editor-title').textContent = index === null ? 'Add ' + M.labels[family].toLowerCase() : original.name || M.labels[family] + ' settings';
    $('editor-type').textContent = M.labels[family];
    $('editor-message').hidden = true;
    $('apply-device').textContent = index === null ? 'Add device' : 'Apply changes';
    const schemas = properties[family].items.properties;
    renderGroups($('device-fields'), M.deviceGroups(schemas), schemas, editing.data, deviceControls, 'device', () => { editing.modified = true; });
    message('');
    $('editor-title').focus();
    window.homebridge.fixScrollHeight();
  }
  function closeEditor(discard = true) {
    if (discard && editing?.modified && !window.confirm('Discard the changes to this device?')) return;
    editing = null;
    $('editor').hidden = true;
    $('overview').hidden = false;
    $('type-picker').hidden = true;
    $('add-device').hidden = false;
    renderPlatform(); renderDevices();
    $('add-device').focus();
  }
  function applyDevice(event) {
    event.preventDefault();
    const schemas = properties[editing.family].items.properties;
    if (!validateControls(deviceControls, editing.data, schemas, false)) return;
    if (M.duplicateId(config(), properties, editing.data, editing.index === null ? null : editing)) {
      const record = deviceControls.find(record => record.key === 'id');
      showFieldError(record, 'Another device already uses this ID. Choose a unique ID.'); focusError(record); return;
    }
    if (editing.data.buttons !== undefined && (!Array.isArray(editing.data.buttons) || editing.data.buttons.some(item => !M.isObject(item)))) {
      $('editor-message').textContent = 'Repair or remove invalid buttons before applying this device.';
      $('editor-message').hidden = false; return;
    }
    blocks[activeIndex] = M.applyDevice(config(), editing.family, editing.index, editing.data);
    closeEditor(false); changed();
  }
  async function save() {
    if (!ready || saving || editing) return;
    if (!validateControls(platformControls, config(), properties, true)) return;
    // Validate every configured platform, including those not currently selected.
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index];
      if (!M.isPlatform(block)) continue;
      let issue = Object.keys(M.validate(block, properties, true)).length > 0;
      for (const family of M.families(properties)) if (block[family] !== undefined && !Array.isArray(block[family])) issue = true;
      for (const row of M.devices(block, properties)) {
        if (!M.isObject(row.data) || Object.keys(M.validate(row.data, properties[row.family].items.properties)).length || M.duplicateId(block, properties, row.data, row)) issue = true;
      }
      if (issue) { message('A configured device or platform needs attention. Check required IDs, duplicate IDs, and invalid settings before saving.', 'error'); return; }
    }
    saving = true;
    $('save-settings').disabled = true;
    $('save-status').textContent = 'Saving…';
    window.homebridge.showSpinner();
    try {
      await window.homebridge.updatePluginConfig(M.clone(blocks));
      await window.homebridge.savePluginConfig();
      baseline = JSON.stringify(blocks);
      $('save-status').textContent = 'All changes saved';
      message('Settings saved. Restart the child bridge to apply your changes.', 'success');
    } catch (_) {
      // Never include transport errors, configuration values or credentials in UI logs.
      $('save-status').textContent = 'Changes not saved';
      $('save-settings').disabled = false;
      message('Could not save settings. Your edits are still here. Check the Homebridge connection and try again.', 'error');
    } finally { saving = false; window.homebridge.hideSpinner(); }
  }
  let started = false;
  async function init() {
    if (started) return;
    started = true;
    theme();
    new MutationObserver(theme).observe(document.body, {attributes: true, attributeFilter: ['class']});
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', theme);
    if (!window.homebridge) { message('Open this configuration page from the plugin’s Settings in Homebridge UI.', 'error'); return; }
    // This UI owns validation and saving; the host's generic Save must not bypass it.
    window.homebridge.disableSaveButton();
    window.homebridge.hideSchemaForm();
    try {
      const [loaded, schema] = await Promise.all([window.homebridge.getPluginConfig(), window.homebridge.getPluginConfigSchema()]);
      if (!Array.isArray(loaded) || !schema?.schema?.properties) throw Error('Invalid response');
      properties = schema.schema.properties;
      blocks = M.clone(loaded);
      activeIndex = blocks.findIndex(M.isPlatform);
      if (activeIndex < 0) { blocks.push({platform: 'HttpWebHooks'}); activeIndex = blocks.length - 1; }
      baseline = JSON.stringify(blocks);
      $('version').textContent = 'v' + window.homebridge.plugin.installedVersion;
      for (const family of M.families(properties)) $('device-types').append(button(M.labels[family], 'type-option', () => openEditor(family)));
      renderPlatform(); renderDevices();
      $('overview').hidden = false;
      $('webhooks-app').setAttribute('aria-busy', 'false');
      ready = true;
      message('');
    } catch (_) {
      message('Could not load your current configuration. Close and reopen Settings to try again.', 'error');
      return;
    }
    $('add-device').addEventListener('click', () => {
      $('type-picker').hidden = false; $('add-device').hidden = true;
      $('device-types').querySelector('button').focus(); window.homebridge.fixScrollHeight();
    });
    $('cancel-add').addEventListener('click', () => { $('type-picker').hidden = true; $('add-device').hidden = false; $('add-device').focus(); });
    $('back-devices').addEventListener('click', () => closeEditor());
    $('back-api').addEventListener('click', () => {
      apiGeneration++;
      $('api-reference').hidden = true;
      $('overview').hidden = false;
      apiTrigger?.focus();
      window.homebridge.fixScrollHeight();
    });
    $('cancel-edit').addEventListener('click', () => closeEditor());
    $('device-form').addEventListener('submit', applyDevice);
    $('platform-form').addEventListener('submit', event => { event.preventDefault(); save(); });
    $('save-settings').addEventListener('click', save);
    window.addEventListener('beforeunload', event => {
      if (editing?.modified || JSON.stringify(blocks) !== baseline || platformControls.some(record => record.parseError)) {
        event.preventDefault(); event.returnValue = '';
      }
    });
    if (window.ResizeObserver) new ResizeObserver(() => window.homebridge.fixScrollHeight()).observe($('webhooks-app'));
    window.homebridge.fixScrollHeight();
  }
  if (window.homebridge) window.homebridge.addEventListener('ready', init, {once: true});
  else init();
}());

