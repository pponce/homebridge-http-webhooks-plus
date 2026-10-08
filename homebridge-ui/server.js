'use strict';
const fs = require('node:fs/promises');
const {connectionInfo, execute} = require('./requests');

// plugin-ui-utils 2 uses ESM; dynamic import keeps this plugin compatible with Node 18.
async function start() {
  const {HomebridgePluginUiServer} = await import('@homebridge/plugin-ui-utils');
  class UiServer extends HomebridgePluginUiServer {
    constructor() {
      super();
      this.onRequest('/api/connection', () => connectionInfo());
      this.onRequest('/api/execute', async payload => {
        try {
          const config = JSON.parse(await fs.readFile(this.homebridgeConfigPath, 'utf8'));
          return await execute(config, payload);
        } catch (_) {return {error: 'Could not read the saved Homebridge configuration.'};}
      });
      this.ready();
    }
  }
  return new UiServer();
}
start().catch(() => {process.exitCode = 1;});
