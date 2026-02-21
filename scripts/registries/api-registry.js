'use strict';

/**
 * API Registry Plugin
 *
 * Wraps the existing APIScanner as a RegistryPlugin.
 * The actual scanning logic remains in flow-api-index.js — this adapter
 * adds plugin metadata and activation interface for the RegistryManager.
 */

const { RegistryPlugin } = require('../flow-registry-manager');
const { APIScanner } = require('../flow-api-index');

class APIRegistry extends RegistryPlugin {
  static id = 'apis';
  static name = 'API Registry';
  static mapFile = 'api-map.md';
  static indexFile = 'api-index.json';
  static category = 'code';
  static type = 'apis';

  constructor() {
    super();
    this.scanner = new APIScanner();
  }

  activateWhen(_stack) {
    // APIs are always relevant — most projects have API calls
    return true;
  }

  async scan() {
    return this.scanner.scan();
  }

  prune() {
    return this.scanner.prune();
  }

  save() {
    this.scanner.save();
  }

  generateMap() {
    this.scanner.generateMap();
  }

  _getActivateWhenLabel() {
    return 'always';
  }
}

module.exports = { APIRegistry };
