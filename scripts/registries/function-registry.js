'use strict';

/**
 * Function Registry Plugin
 *
 * Wraps the existing FunctionScanner as a RegistryPlugin.
 * The actual scanning logic remains in flow-function-index.js — this adapter
 * adds plugin metadata and activation interface for the RegistryManager.
 */

const { RegistryPlugin } = require('../flow-registry-manager');
const { FunctionScanner } = require('../flow-function-index');

class FunctionRegistry extends RegistryPlugin {
  static id = 'functions';
  static name = 'Function Registry';
  static mapFile = 'function-map.md';
  static indexFile = 'function-index.json';
  static category = 'code';
  static type = 'functions';

  constructor() {
    super();
    this.scanner = new FunctionScanner();
  }

  activateWhen(_stack) {
    // Functions are always relevant — every project has utility functions
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

module.exports = { FunctionRegistry };
