(function (root) {
  'use strict';
  // One contract for the listener, reference page and UI request validation.
  const fixed = (key, label, characteristic, value, urlKey) => ({key, label, characteristic, fixedValue: value, urlKey});
  const numeric = (key, label, characteristic, min, max, sample, step, urlKey) => ({key, label, characteristic, min, max, sample, step, urlKey});
  function fields(family, device = {}) {
    const power = characteristic => [fixed('on', 'Turn on', characteristic, characteristic === 'On' ? true : 1, 'on_url'),
      fixed('off', 'Turn off', characteristic, characteristic === 'On' ? false : 0, 'off_url')];
    switch (family) {
      case 'switches': case 'outlets': return power('On');
      case 'lights': return [...power('On'), numeric('brightness', 'Set brightness (%)', 'Brightness', 0, 100, 50, 1, 'brightness_url')];
      case 'valves': return power('Active');
      case 'pushbuttons': return [fixed('press', 'Press button', 'On', true, 'push_url')];
      case 'garagedooropeners': return [fixed('open', 'Open garage', 'TargetDoorState', 0, 'open_url'), fixed('close', 'Close garage', 'TargetDoorState', 1, 'close_url')];
      case 'lockmechanisms': return [fixed('unlock', 'Unlock', 'LockTargetState', 0, 'open_url'), fixed('lock', 'Lock', 'LockTargetState', 1, 'close_url')];
      case 'windowcoverings': return [
        fixed('open', 'Run configured open command', 'TargetPosition', 0, 'open_url'),
        fixed('close', 'Run configured close command', 'TargetPosition', 100, 'close_url'),
        {...numeric('position', 'Set target position', 'TargetPosition', 0, 100, 40, 1),
          note: 'Uses the existing HomeKit handler: 0 selects open_url; 1–25 open_20_url; 26–45 open_40_url; 46–65 open_60_url; 66–94 open_80_url; 95–100 close_url. This legacy mapping is preserved.'}];
      case 'thermostats': return [numeric('temperature', 'Set target temperature (°C)', 'TargetTemperature', device.minTemp || 15, device.maxTemp || 30, device.minTemp || 15, device.minStep || 0.5, 'set_target_temperature_url'),
        ...['off', 'heat', 'cool', 'auto'].map((key, value) => fixed(key, 'Set mode: ' + key, 'TargetHeatingCoolingState', value, 'set_target_heating_cooling_state_url'))];
      case 'security': return ['arm_stay', 'arm_away', 'arm_night', 'disarm'].map((key, value) => fixed(key, key.replaceAll('_', ' '), 'SecuritySystemTargetState', value, 'set_state_url'));
      case 'fanv2s': return [...power('Active'), numeric('speed', 'Set speed (%)', 'RotationSpeed', 0, 100, 50, 1, 'speed_url'),
        {...numeric('direction', 'Set rotation direction', 'RotationDirection', 0, 1, 0, 1, 'rotation_direction_url'), values: [['0','Clockwise'], ['1','Counterclockwise']]},
        ...(device.enableLockPhysicalControls ? [fixed('lock_controls', 'Lock physical controls', 'LockPhysicalControls', 1, 'lock_url'), fixed('unlock_controls', 'Unlock physical controls', 'LockPhysicalControls', 0, 'unlock_url')] : []),
        ...(device.enableTargetStateControls ? [{...numeric('mode', 'Set fan mode', 'TargetFanState', 0, 1, 0, 1, 'target_state_url'), values: [['0','Manual'], ['1','Auto']]}] : []),
        ...(device.enableSwingModeControls ? [{...numeric('swing', 'Set swing mode', 'SwingMode', 0, 1, 1, 1, 'swing_mode_url'), values: [['0','Disabled'], ['1','Enabled']]}] : [])];
      default: return [];
    }
  }
  function value(field, raw) {
    if (Object.hasOwn(field, 'fixedValue')) {
      if (raw !== undefined) throw Error('action_value_not_allowed');
      return field.fixedValue;
    }
    if (typeof raw !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(raw) || raw.length > 64) throw Error('invalid_action_value');
    const number = Number(raw);
    if (!Number.isFinite(number) || number < field.min || number > field.max ||
        (field.step === 1 && !Number.isInteger(number)) ||
        (field.values && !field.values.some(item => item[0] === raw))) throw Error('invalid_action_value');
    const steps = (number - field.min) / field.step;
    if (Math.abs(steps - Math.round(steps)) > 1e-7) throw Error('invalid_action_step');
    return number;
  }
  function commandURL(field, target, device) {
    if (field.key !== 'position') return device[field.urlKey];
    return device[target === 0 ? 'open_url' : target <= 25 ? 'open_20_url' : target <= 45 ? 'open_40_url' :
      target <= 65 ? 'open_60_url' : target <= 94 ? 'open_80_url' : 'close_url'];
  }
  function parameter(field) {
    return {On: 'state', Active: 'state', Brightness: 'value', RotationSpeed: 'speed', RotationDirection: 'rotationDirection',
      LockPhysicalControls: 'lockstate', TargetFanState: 'targetState', SwingMode: 'swingMode', TargetDoorState: 'targetdoorstate',
      LockTargetState: 'locktargetstate', TargetPosition: 'targetposition', TargetTemperature: 'targettemperature',
      TargetHeatingCoolingState: 'targetstate', SecuritySystemTargetState: 'targetstate'}[field.characteristic];
  }
  function inputValue(field) {
    return parameter(field) === 'state' ? String(Boolean(field.fixedValue)) : String(field.fixedValue);
  }
  const api = {fields, value, commandURL, parameter, inputValue};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WebhooksActions = api;
}(typeof window === 'object' ? window : globalThis));
