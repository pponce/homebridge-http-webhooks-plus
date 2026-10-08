(function (root) {
  'use strict';
  const enumField = (key, label, values, extra = {}) => ({key, label, values, ...extra});
  const numberField = (key, label, min, max, sample, step = 'any') => ({key, label, min, max, sample, step});
  const power = () => enumField('state', 'Power', [['true', 'On'], ['false', 'Off']]);
  const press = config => [['0', 'Single press', 'single_press'], ['1', 'Double press', 'double_press'], ['2', 'Long press', 'long_press']]
    .filter(value => config[value[2]] !== false).map(value => value.slice(0, 2));
  function fields(family, device) {
    switch (family) {
      case 'sensors': {
        const binary = {contact: ['Contact detected / closed', 'No contact / open'], motion: ['Motion detected', 'No motion'],
          occupancy: ['Occupied', 'Unoccupied'], smoke: ['Smoke detected', 'No smoke']};
        if (binary[device.type]) return [enumField('state', 'Sensor state', [['true', binary[device.type][0]], ['false', binary[device.type][1]]])];
        const numeric = {temperature: numberField('value', 'Temperature (°C)', -100, 140, 21.5),
          humidity: numberField('value', 'Relative humidity (%)', 0, 100, 45),
          light: numberField('value', 'Light level (lux)', 0.0001, 100000, 100),
          airquality: enumField('value', 'Air quality', [['0', 'Unknown'], ['1', 'Excellent'], ['2', 'Good'], ['3', 'Fair'], ['4', 'Inferior'], ['5', 'Poor']]),
          leak: enumField('value', 'Leak', [['0', 'Dry'], ['1', 'Leak detected']])};
        return numeric[device.type] ? [numeric[device.type]] : [];
      }
      case 'switches': case 'outlets': case 'lights': case 'fanv2s': case 'valves': {
        const result = [power()];
        if (family === 'outlets') result.push(enumField('stateOutletInUse', 'Outlet in use', [['true', 'In use'], ['false', 'Not in use']]));
        if (family === 'lights') {
          const factor = Number(device.brightness_factor) || 1;
          result.push({...numberField('value', 'Brightness', 0, Math.floor(100 * factor + 1e-9), Math.round(50 * factor), 1),
            note: 'Incoming value is divided by brightness_factor (' + factor + ') and rounded up for HomeKit (0–100%).'});
        }
        if (family === 'valves') result.push(enumField('statusFault', 'Fault', [['true', 'Fault detected'], ['false', 'No fault']]));
        if (family === 'fanv2s') {
          result.push(numberField('speed', 'Rotation speed (%)', 0, 100, 50, 1),
            enumField('rotationDirection', 'Rotation direction', [['0', 'Clockwise'], ['1', 'Counterclockwise']]));
          if (device.enableSwingModeControls) result.push(enumField('swingMode', 'Swing', [['0', 'Disabled'], ['1', 'Enabled']]));
          if (device.enableTargetStateControls) result.push(enumField('targetState', 'Fan mode', [['0', 'Manual'], ['1', 'Auto']]));
          if (device.enableLockPhysicalControls) result.push(enumField('lockstate', 'Physical controls', [['0', 'Unlocked'], ['1', 'Locked']],
            {note: 'Include lockstate and lockState with the same value; the current handler uses both spellings.'}));
        }
        return result;
      }
      case 'pushbuttons': return [enumField('state', 'Press button', [['true', 'Press (automatically releases after one second)']])];
      case 'doorbells': return [enumField('event', 'Ring doorbell', press(device))];
      case 'statelessswitches': return (device.buttons || []).filter(item => item && typeof item.name === 'string')
        .map(item => enumField('event', 'Press ' + item.name, press(item), {params: {buttonName: item.name}}));
      case 'co2sensors': return [numberField('value', 'CO₂ level (ppm)', 0, 100000, 600)];
      case 'thermostats': return [numberField('currenttemperature', 'Current temperature (°C)', 0, 100, 21),
        numberField('targettemperature', 'Target temperature (°C)', device.minTemp || 15, device.maxTemp || 30, device.minTemp || 15, device.minStep || 0.5),
        enumField('currentstate', 'Current heating/cooling state', [['0', 'Off'], ['1', 'Heating'], ['2', 'Cooling']]),
        enumField('targetstate', 'Target heating/cooling state', [['0', 'Off'], ['1', 'Heat'], ['2', 'Cool'], ['3', 'Auto']])];
      case 'security': return [enumField('currentstate', 'Current security state', [['0', 'Stay'], ['1', 'Away'], ['2', 'Night'], ['3', 'Disarmed'], ['4', 'Alarm triggered']]),
        enumField('targetstate', 'Target security state', [['0', 'Stay'], ['1', 'Away'], ['2', 'Night'], ['3', 'Disarm']])];
      case 'garagedooropeners': return [enumField('currentdoorstate', 'Current door state', [['0', 'Open'], ['1', 'Closed'], ['2', 'Opening'], ['3', 'Closing'], ['4', 'Stopped']], {jsonKey: 'currentState'}),
        enumField('targetdoorstate', 'Target door state', [['0', 'Open'], ['1', 'Closed']], {jsonKey: 'targetState'}),
        enumField('obstructiondetected', 'Obstruction', [['false', 'Clear'], ['true', 'Detected']], {jsonKey: 'obstruction'})];
      case 'lockmechanisms': return [enumField('lockcurrentstate', 'Current lock state', [['0', 'Unsecured'], ['1', 'Secured'], ['2', 'Jammed'], ['3', 'Unknown']], {jsonKey: 'currentState'}),
        enumField('locktargetstate', 'Target lock state', [['0', 'Unsecured'], ['1', 'Secured']], {jsonKey: 'targetState'})];
      case 'windowcoverings': return [numberField('currentposition', 'Current position (%)', 0, 100, 50, 1),
        numberField('targetposition', 'Target position (%)', 0, 100, 50, 1),
        enumField('positionstate', 'Movement', [['0', 'Decreasing / closing'], ['1', 'Increasing / opening'], ['2', 'Stopped']])];
      default: return [];
    }
  }
  const quote = value => "'" + String(value).replaceAll("'", "'\"'\"'") + "'";
  const encode = value => encodeURIComponent(String(value)).replace(/[!'()*]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase());
  function origin(platform, host) {
    const name = host.trim();
    if (!/^(?:[a-z0-9._-]+|\[[0-9a-f:]+\])$/i.test(name)) throw Error('Enter a hostname, IPv4 address, or bracketed IPv6 address, without a scheme or port.');
    return (platform.https === true ? 'https://' : 'http://') + name + ':' + (platform.webhook_port || '51828');
  }
  function build(platform, device, family, field, value, host, json = false, fanPower = 'false', notify = false) {
    const base = origin(platform, host);
    const auth = platform.http_auth_user && platform.http_auth_pass ? ' --user ' + quote('YOUR_HTTP_USER:YOUR_HTTP_PASSWORD') : '';
    let endpoint, body;
    if (json) {
      endpoint = base + '/v1/accessories/' + encode(device.id) + '/state';
      body = {[field.jsonKey]: value === 'true' ? true : value === 'false' ? false : Number(value)};
      if (notify) body.notify = true;
    } else {
      const params = {accessoryId: String(device.id), ...field.params};
      if (family === 'fanv2s') params.state = field.key === 'state' ? value : fanPower;
      params[field.key] = String(value);
      if (family === 'fanv2s' && field.key === 'lockstate') params.lockState = String(value);
      if (notify) params.force_notify = 'true';
      endpoint = base + '/?' + Object.entries(params).map(([key, item]) => encode(key) + '=' + encode(item)).join('&');
    }
    const token = json ? ' --header ' + quote('X-Webhooks-Token: YOUR_STATE_API_TOKEN') : '';
    const bodyText = body ? JSON.stringify(body, null, 2) : null;
    return {endpoint, body: bodyText, curl: 'curl --request ' + (json ? 'POST' : 'GET') + auth + token +
      (json ? ' --header ' + quote('Content-Type: application/json') + ' --data ' + quote(bodyText) : '') + ' ' + quote(endpoint)};
  }
  function defaultHost(platform, network = {}, browserHost = '') {
    const bound = platform.webhook_listen_host;
    let host = bound && !['::', '0.0.0.0'].includes(bound) ? bound :
      network.addresses?.includes(browserHost.replace(/^\[|\]$/g, '')) ? browserHost : network.defaultHost || browserHost || 'homebridge.local';
    if (host.includes(':') && !host.startsWith('[')) host = '[' + host + ']';
    return host;
  }
  function render(container, family, device, platform, homebridge, settings = {}) {
    const el = (tag, text, className) => { const result = document.createElement(tag); if (text !== undefined) result.textContent = text; if (className) result.className = className; return result; };
    const refreshHeight = () => homebridge.fixScrollHeight();
    const options = fields(family, device).filter(field => !field.values || field.values.length);
    container.replaceChildren();
    container.append(el('p', 'These calls report state to HomeKit. They do not call the device’s outgoing command URLs. Button and doorbell events can run automations configured in Home.', 'notice'));
    container.append(el('p', 'Examples use the current settings shown in this configuration. Save changes and restart the child bridge before using changed IDs or connection settings.', 'field-help'));
    const grid = el('div', undefined, 'field-grid api-controls');
    function control(labelText, input) { const wrapper = el('div', undefined, 'field'); const label = el('label', labelText); label.htmlFor = input.id; wrapper.append(label, input); grid.append(wrapper); return input; }
    const host = el('input'); host.id = 'api-host'; host.type = 'text'; host.value = defaultHost(platform, settings.network, window.location.hostname); host.autocomplete = 'off';
    control('Homebridge hostname or IP', host);
    container.append(grid, el('p', 'The address defaults to this Homebridge instance. Use an address reachable from your external program. The webhook port and HTTP/HTTPS scheme come from Webhook settings.', 'field-help'));
    const listenHost = platform.webhook_listen_host;
    if (listenHost === '127.0.0.1' || listenHost === '::1' || listenHost === 'localhost') container.append(el('p', 'The listener is bound to loopback. Calls must originate on the Homebridge machine unless you configure a reachable listener or proxy.', 'notice'));
    const jsonSupported = ['garagedooropeners', 'lockmechanisms'].includes(family);
    if (platform.http_auth_user && platform.http_auth_pass) container.append(el('p', 'Basic authentication is required. Replace YOUR_HTTP_USER and YOUR_HTTP_PASSWORD in the curl example. Saved credentials are never included.', 'field-help'));
    else container.append(el('p', 'These webhook calls do not require authentication with the current settings.', 'field-help'));
    if (!options.length) { container.append(el('p', 'No supported calls are available. Choose a supported sensor type or configure a button with at least one enabled press event.', 'notice')); return; }
    const method = el('select'); method.id = 'api-format';
    for (const [value, label] of [['webhook', 'Webhook · GET with query parameters'], ...(jsonSupported ? [['json', 'JSON State API · POST']] : [])]) { const option = el('option', label); option.value = value; method.append(option); }
    control('Request format', method);
    const call = el('select'); call.id = 'api-call'; options.forEach((field, index) => {const option = el('option', field.label); option.value = index; call.append(option);});
    control('State or event to report', call);
    const valueWrapper = el('div', undefined, 'field'); grid.append(valueWrapper);
    let value;
    function chooseValue() {
      const field = options[Number(call.value)];
      value = el(field.values ? 'select' : 'input'); value.id = 'api-value';
      if (field.values) field.values.forEach(([item, label]) => {const option = el('option', item + ' · ' + label); option.value = item; value.append(option);});
      else {value.type = 'number'; value.min = field.min; value.max = field.max; value.step = field.step; value.value = field.sample;}
      const label = el('label', 'Value'); label.htmlFor = value.id; valueWrapper.replaceChildren(label, value);
      value.addEventListener(field.values ? 'change' : 'input', update);
    }
    const fan = el('select'); fan.id = 'api-fan-power';
    for (const [item, label] of [['false', 'Off'], ['true', 'On']]) {const option = el('option', label); option.value = item; fan.append(option);}
    control('Current fan power (included in updates)', fan).parentElement.hidden = family !== 'fanv2s';
    if (family === 'fanv2s') container.append(el('p', 'Every fan example includes state. Select the current power when reporting another field so the legacy handler does not inadvertently change power. Incoming speed uses 0–100%; speed_factor applies to outgoing commands.', 'notice'));
    const notify = el('input'); notify.type = 'checkbox'; notify.id = 'api-notify';
    control('Request repeated HomeKit notification', notify).parentElement.hidden = !jsonSupported || device.notification_policy !== 'allow_explicit';
    if (jsonSupported) container.append(el('p', 'Current and target states are independent reports. Updating a target does not issue an open/close or lock/unlock command. Obstruction accepts true/false or 1/0. Repeat notifications require “Allow explicit notifications” and remain rate limited.', 'field-help'));
    const tableWrap = el('div', undefined, 'api-table-wrap');
    const table = el('table', undefined, 'api-table'); const header = el('tr'); ['Field', 'Accepted values'].forEach(text => header.append(el('th', text))); const thead = el('thead'); thead.append(header); table.append(thead);
    const tbody = el('tbody'); for (const field of options) {const row = el('tr'); row.append(el('td', field.key + (field.jsonKey ? ' / JSON: ' + field.jsonKey : '')),
      el('td', field.label + ': ' + (field.values ? field.values.map(([item, label]) => item + ' = ' + label).join('; ') : field.min + '–' + field.max + (field.step === 1 ? ' (integer)' : ' (number)')) + (field.note ? '. ' + field.note : ''))); tbody.append(row);} table.append(tbody); tableWrap.append(table); container.append(tableWrap);
    const status = el('p', undefined, 'notice'); status.setAttribute('role', 'status'); status.hidden = true; container.append(status);
    const examples = el('div', undefined, 'api-examples'); container.append(examples);
    const runner = el('section', undefined, 'api-runner');
    const send = el('button', 'Send state report', 'primary'); send.type = 'button'; send.id = 'api-execute';
    const read = el('button', 'Read status', 'secondary'); read.type = 'button'; read.id = 'api-read-status';
    const runButtons = el('div', undefined, 'editor-actions'); runButtons.append(send, read); runner.append(runButtons);
    runner.append(el('p', 'Sends the displayed report to this Homebridge instance using saved credentials. Button and doorbell reports can trigger your Home automations. No request is sent until you click a button.', 'field-help'));
    const output = el('pre', undefined, 'api-output'); output.id = 'api-output'; output.setAttribute('role', 'status'); output.hidden = true; runner.append(output); container.append(runner);
    let executing = false, valid = false;
    async function run(format) {
      if (executing || !valid) return;
      const field = options[Number(call.value)];
      const payload = {family, id: String(device.id), port: String(platform.webhook_port || '51828'), https: platform.https === true,
        host:host.value, format, field:field.key, buttonName:field.params?.buttonName, value:value.value, fanPower:fan.value, notify:notify.checked};
      executing = true; send.disabled = true; read.disabled = true;
      const controls = [host, method, call, value, fan, notify]; controls.forEach(input => {input.disabled = true;});
      output.hidden = false; output.textContent = 'Sending…'; refreshHeight();
      try {
        const result = await homebridge.request('/api/execute', payload);
        output.textContent = result.error || 'HTTP ' + result.status + '\n\n' + (result.body || '(empty response)');
      } catch (_) {output.textContent = 'Could not contact the plugin UI server. Close and reopen settings, then check that the child bridge is running.';}
      finally {executing = false; controls.forEach(input => {input.disabled = false;}); updateButtons(); refreshHeight();}
    }
    send.addEventListener('click', () => run(method.value));
    read.addEventListener('click', () => run('status'));
    function updateButtons() {
      const localHost = host.value.trim().replace(/^\[|\]$/g, '');
      const network = settings.network;
      const local = network && [...network.addresses, network.hostname, 'localhost', '127.0.0.1', '::1'].includes(localHost);
      const available = Boolean(local && settings.canExecute && typeof homebridge.request === 'function' && valid);
      send.disabled = executing || !available || (method.value === 'json' && !platform.state_api_token);
      read.disabled = executing || !available || !platform.state_api_token;
      read.hidden = !jsonSupported;
      send.textContent = ['doorbells','statelessswitches','pushbuttons'].includes(family) ? 'Send event' : 'Send state report';
      runner.title = !settings.canExecute ? 'Save settings and restart the child bridge before testing changed settings.' : !local ? 'Use this Homebridge instance’s detected IP address for in-page testing.' : '';
    }
    async function copy(text, button) {
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
        else {const input = el('textarea'); input.value = text; input.className = 'api-copy-fallback'; container.append(input); input.select(); const ok = document.execCommand('copy'); input.remove(); button.focus(); if (!ok) throw Error();}
        status.textContent = 'Copied.';
      } catch (_) {status.textContent = 'Copy unavailable. Select and copy the example text.';}
      status.hidden = false; refreshHeight();
    }
    function example(label, text) {const box = el('section', undefined, 'api-example'); const heading = el('div', undefined, 'button-row-heading'); const button = el('button', 'Copy ' + label.toLowerCase(), 'secondary'); button.type = 'button'; button.addEventListener('click', () => copy(text, button)); heading.append(el('h3', label), button); box.append(heading, el('pre', text)); examples.append(box);}
    function update() {
      examples.replaceChildren(); status.hidden = true;
      valid = false;
      const field = options[Number(call.value)];
      try {
        if (!value.checkValidity() || value.value === '' || (field.values && !field.values.some(item => item[0] === value.value))) throw Error('Choose a valid value within the accepted range.');
        const json = method.value === 'json';
        if (json && !platform.state_api_token) {status.textContent = 'The JSON State API is disabled. Configure a token in Webhook settings → Incoming State API, save and restart the child bridge. Examples below use a placeholder.'; status.hidden = false;}
        const request = build(platform, device, family, field, value.value, host.value, json, fan.value, notify.checked);
        valid = true;
        example('URL', request.endpoint); example('curl', request.curl); if (request.body) example('JSON body', request.body);
        if (json) {
          const endpoint = request.endpoint.replace(/\/state$/, '');
          example('Read status', 'curl --request GET' + (platform.http_auth_user && platform.http_auth_pass ? ' --user ' + quote('YOUR_HTTP_USER:YOUR_HTTP_PASSWORD') : '') + ' --header ' + quote('X-Webhooks-Token: YOUR_STATE_API_TOKEN') + ' ' + quote(endpoint));
        }
      } catch (error) {status.textContent = error.message; status.hidden = false;}
      updateButtons();
      refreshHeight();
    }
    call.addEventListener('change', () => {chooseValue(); update();});
    [host, method, fan, notify].forEach(input => input.addEventListener(input === host ? 'input' : 'change', update));
    const response = el('details', undefined, 'field-group'); response.append(el('summary', 'Responses and errors'), el('p', 'Successful updates return JSON with success: true. Legacy response fields vary by device and may contain previous values; they are not proof that hardware moved. JSON state updates return the applied snapshot, availability, and notification outcome. A notification outcome of sent means HomeKit publication was requested, not that a phone rendered it.'),
      el('p', 'Common HTTP errors: 400 invalid input; 401 missing or incorrect authentication; 404 accessory or route not found; 405 wrong method; 408 request timeout; 413 body too large; 415 JSON content type required; 503 state storage or publication failed. Legacy devices can also report errors inside a 200 JSON response. Check the response body.'));
    response.addEventListener('toggle', refreshHeight); container.append(response);
    chooseValue(); update();
  }
  const api = {fields, build, origin, defaultHost, render};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WebhooksApi = api;
}(typeof window === 'object' ? window : globalThis));
