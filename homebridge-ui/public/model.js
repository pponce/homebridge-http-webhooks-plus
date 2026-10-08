/* Configuration editing only. No device requests or configuration migration. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WebhooksConfig = factory();
}(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const families = properties => Object.keys(properties).filter(key => properties[key].items?.properties?.id);
  const isPlatform = block => isObject(block) && typeof block.platform === 'string' &&
    (block.platform === 'HttpWebHooks' || block.platform.endsWith('.HttpWebHooks'));
  const labels = {
    sensors: 'Sensor', switches: 'Switch', pushbuttons: 'Push button', doorbells: 'Doorbell',
    lights: 'Light', co2sensors: 'CO₂ sensor', thermostats: 'Thermostat', outlets: 'Outlet',
    security: 'Security system', garagedooropeners: 'Garage door', statelessswitches: 'Stateless switch',
    windowcoverings: 'Window covering', lockmechanisms: 'Lock', fanv2s: 'Fan', valves: 'Valve'
  };
  function deviceGroups(properties) {
    const used = new Set(['external_state']); // Legacy alias is retained, not rendered as a conflicting checkbox.
    const groups = [];
    function group(title, keys, open = false) {
      keys = keys.filter(key => own(properties, key) && !used.has(key));
      keys.forEach(key => used.add(key));
      if (keys.length) groups.push({title, keys, open});
    }
    group('Device details', ['name', 'id', 'type', 'buttons'], true);
    group('State and feedback', ['state_mode', 'startup_state_policy', 'feedback_timeout_seconds'], true);
    group('Notifications', ['notification_policy', 'notification_min_interval_ms']);
    group('Obstruction feedback', ['obstruction_monitoring', 'obstruction_timeout_seconds']);
    // Each command keeps its URL, method, headers and payload together.
    for (const key of Object.keys(properties).filter(key => key.endsWith('_url'))) {
      const prefix = key.slice(0, -4);
      group(properties[key].title.replace(/ URL$/i, '') + ' command',
        ['url', 'method', 'headers', 'body', 'form'].map(suffix => prefix + '_' + suffix));
    }
    const advanced = ['rejectUnauthorized', 'log_level', 'request_timeout_ms', 'response_max_bytes', 'max_redirects'];
    group('Device options', Object.keys(properties).filter(key => !advanced.includes(key)));
    group('Logging and HTTP settings', advanced);
    return groups;
  }
  const platformGroups = [
    {title: 'Listener', keys: ['webhook_port', 'webhook_listen_host'], open: true},
    {title: 'Incoming State API', keys: ['state_api_token']},
    {title: 'Authentication and HTTPS', keys: ['http_auth_user', 'http_auth_pass', 'https', 'https_keyfile', 'https_certfile']},
    {title: 'Logging and request limits', keys: ['log_level', 'extra_redaction_keys', 'webhook_timeout_ms', 'webhook_body_max_bytes', 'state_api_body_max_bytes']},
    {title: 'Advanced and compatibility', keys: ['cache_directory', 'webhook_enable_cors', 'webhook_response_mode']}
  ];
  function readField(raw, schema, key) {
    if (raw === '') return undefined;
    if (schema.type === 'boolean') return raw === 'true';
    if (schema.type === 'integer' || schema.type === 'number') {
      const number = Number(raw);
      if (!Number.isFinite(number) || (schema.type === 'integer' && !Number.isInteger(number))) throw Error('Enter a valid number.');
      return number;
    }
    if (schema.type === 'array') return raw.split('\n').map(line => line.trim()).filter(Boolean);
    if (/_headers$|_form$/.test(key)) {
      let parsed;
      try { parsed = JSON.parse(raw); } catch (_) { throw Error('Enter a valid JSON object.'); }
      if (!isObject(parsed)) throw Error('Enter a JSON object, not a list or single value.');
      if (key.endsWith('_form') && Object.values(parsed).some(value =>
        !['string', 'number', 'boolean'].includes(typeof value) || value === null)) {
        throw Error('Form values must be text, numbers, or true/false.');
      }
    }
    return raw;
  }
  function fieldError(value, schema, key) {
    if (value === undefined || value === null || value === '') {
      // The listener uses a runtime default when omitted, despite the legacy schema's required flag.
      return schema.required && key !== 'webhook_port' ? 'This field is required.' : '';
    }
    if (key === 'id') return String(value).length > 128 ? 'Use 1–128 characters.' : '';
    if (schema.type === 'boolean' && typeof value !== 'boolean') return 'Choose a valid option.';
    if (schema.enum && !schema.enum.includes(value)) return 'Choose a valid option.';
    if (schema.type === 'integer' || schema.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value))) return 'Enter a valid number.';
      if (schema.minimum !== undefined && value < schema.minimum) return 'Minimum: ' + schema.minimum + '.';
      if (schema.maximum !== undefined && value > schema.maximum) return 'Maximum: ' + schema.maximum + '.';
    }
    if (schema.minLength && String(value).length < schema.minLength) return 'Use at least ' + schema.minLength + ' characters.';
    if (schema.maxLength && String(value).length > schema.maxLength) return 'Use at most ' + schema.maxLength + ' characters.';
    if (schema.pattern && !new RegExp(schema.pattern).test(String(value))) return 'Use letters, numbers, underscores, and hyphens only.';
    if (key === 'webhook_port' && (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 65535)) return 'Use a port from 1 to 65535.';
    if (key === 'webhook_listen_host' && (typeof value !== 'string' || value.length > 253 || /[\s/]/.test(value))) return 'Enter a host or IP address without spaces or a path.';
    if (key.endsWith('_url')) {
      try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.hash || String(value).length > 8192) throw Error();
      } catch (_) { return 'Enter a complete HTTP or HTTPS URL without a fragment.'; }
    }
    if (key.endsWith('_method') && !/^[A-Z]{1,20}$/.test(value)) return 'Use an uppercase HTTP method, such as GET or POST.';
    if (/_headers$|_form$/.test(key)) {
      let parsed;
      try { parsed = typeof value === 'string' ? JSON.parse(value) : value; }
      catch (_) { return 'Enter a valid JSON object.'; }
      if (!isObject(parsed)) return 'Enter a JSON object.';
      for (const [name, item] of Object.entries(parsed)) {
        if (!name || /[\r\n]/.test(name + item)) return 'Keys and values must not contain line breaks.';
        if (key.endsWith('_headers') && (typeof item !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[^\t\x20-\x7e\x80-\xff]/.test(item))) return 'Use valid HTTP header names and text values.';
        if (key.endsWith('_form') && (!['string', 'number', 'boolean'].includes(typeof item) || (typeof item === 'number' && !Number.isFinite(item)))) return 'Form values must be text, numbers, or true/false.';
      }
    }
    return '';
  }
  function validate(data, properties, platform = false) {
    const errors = {};
    for (const [key, schema] of Object.entries(properties)) {
      if (schema.type === 'array' && schema.items?.properties?.id) continue;
      const error = fieldError(data[key], schema, key);
      if (error) errors[key] = error;
      if (key.endsWith('_form') && data[key] && data[key.replace(/_form$/, '_body')]) errors[key] = 'Use a form or a raw body, not both.';
      if (key === 'buttons' && data[key] !== undefined && (!Array.isArray(data[key]) || data[key].some(item => !isObject(item) || Object.keys(validate(item, schema.items.properties)).length))) errors[key] = 'Repair or remove invalid buttons.';
    }
    if (platform) {
      for (const [a, b] of [['http_auth_user', 'http_auth_pass'], ['https_keyfile', 'https_certfile']]) {
        if (Boolean(data[a]) !== Boolean(data[b])) errors[data[a] ? b : a] = 'Supply both fields in this pair, or leave both empty.';
      }
    }
    if (data.state_mode && own(data, 'external_state') && data.state_mode !== (data.external_state ? 'external' : 'optimistic')) {
      errors.state_mode = 'The legacy external_state setting conflicts. Choose a state source to update both together.';
    }
    return errors;
  }
  function devices(config, properties) {
    return families(properties).flatMap(family => Array.isArray(config[family]) ?
      config[family].map((data, index) => ({family, index, data})) : []);
  }
  function duplicateId(config, properties, device, excluding) {
    return devices(config, properties).some(row =>
      !(excluding && excluding.family === row.family && excluding.index === row.index) &&
      isObject(row.data) && row.data.id !== undefined && String(row.data.id) === String(device.id));
  }
  function applyDevice(config, family, index, device) {
    const next = clone(config);
    if (next[family] !== undefined && !Array.isArray(next[family])) throw Error('The device list is not an array. Repair it in the JSON configuration editor.');
    if (!next[family]) next[family] = [];
    if (index === null) next[family].push(clone(device));
    else next[family][index] = clone(device);
    return next;
  }
  function removeDevice(config, family, index) {
    const next = clone(config);
    next[family].splice(index, 1);
    return next;
  }
  return {clone, own, isObject, families, isPlatform, labels, deviceGroups, platformGroups,
    readField, fieldError, validate, devices, duplicateId, applyDevice, removeDevice};
}));
