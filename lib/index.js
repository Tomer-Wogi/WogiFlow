#!/usr/bin/env node

/**
 * Wogi Flow Library Index
 *
 * Main entry point for the wogi-flow package.
 * Exports all public modules for programmatic usage.
 *
 * @module wogi-flow
 */

const { init } = require('./installer');
const { upgrade } = require('./upgrader');
const { skill } = require('./skill-registry');
const { channel, CHANNELS, getLatestVersion } = require('./release-channel');

module.exports = {
  init,
  upgrade,
  skill,
  channel,

  // Release channel utilities
  CHANNELS,
  getLatestVersion,

  // Version info
  version: require('../package.json').version
};
