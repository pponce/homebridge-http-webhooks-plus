'use strict';
const {isDeepStrictEqual} = require('node:util');
const {StateError} = require('./StateContract');
const properties = require('../config.schema.json').schema.properties;

// Homebridge's form can save unchecked booleans and schema defaults in an
// otherwise untouched array row. Only recognise those values: a name, command,
// non-default setting or unknown field means the row needs the user's attention.
function onlyFormDefaults(value, schema) {
  if (value === undefined || value === null || value === '') return true;
  if (Object.hasOwn(schema, 'default') && isDeepStrictEqual(value, schema.default)) return true;
  if (schema.type === 'boolean') return value === false;
  if (schema.type === 'array') {
    return Array.isArray(value) && value.every(item => onlyFormDefaults(item, schema.items));
  }
  if (schema.type === 'object') {
    return typeof value === 'object' && !Array.isArray(value) &&
      Object.entries(value).every(([key, item]) =>
        Object.hasOwn(schema.properties, key) && onlyFormDefaults(item, schema.properties[key]));
  }
  return false;
}

function accessoryRows(config, family, log) {
  const rows = config[family];
  if (rows === undefined || rows === null) return [];
  if (!Array.isArray(rows)) throw new StateError('invalid_config_' + family + '_array');
  return rows.filter((row, index) => {
    const location = family + '[' + index + ']';
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new StateError('invalid_config_' + location + '_object');
    }
    const id = row.id;
    if ((id === undefined || id === null || id === '') && onlyFormDefaults(row, properties[family].items)) {
      log.warn('Ignoring empty accessory settings row %s. Remove this unused row from the plugin configuration.', location);
      return false;
    }
    if (id === undefined || id === null || String(id) === '' || String(id).length > 128) {
      // Include the config location, never URLs, headers, IDs or credentials.
      throw new StateError('invalid_accessory_id: ' + location + ' requires an ID of 1 to 128 characters');
    }
    return true;
  });
}

module.exports = {accessoryRows};
