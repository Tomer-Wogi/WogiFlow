#!/usr/bin/env node

/**
 * Wogi Flow Release Channel Management
 *
 * Handles release channel configuration for updates.
 * Supports stable, beta, and canary channels.
 *
 * @module lib/release-channel
 */

const fs = require('fs');
const path = require('path');

// Shared utilities
const { findProjectRoot, safeReadJson, safeJsonParse, httpsGet } = require('./utils');

// Available release channels
const CHANNELS = {
  stable: {
    name: 'stable',
    description: 'Production-ready releases',
    npmTag: 'latest'
  },
  beta: {
    name: 'beta',
    description: 'Pre-release features for testing',
    npmTag: 'beta'
  },
  canary: {
    name: 'canary',
    description: 'Cutting-edge development builds',
    npmTag: 'canary'
  }
};

// npm registry URL
const NPM_REGISTRY = 'https://registry.npmjs.org/wogi-flow';

/**
 * Parse command line arguments
 * @param {string[]} args - Command line arguments
 * @returns {Object} Parsed options
 */
function parseArgs(args) {
  const options = {
    command: args[0] || 'show',
    channel: args[1] || null,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') {
      options.help = true;
    }
  }

  return options;
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`
Usage: flow channel <command> [options]

Manage release channel for updates.

Commands:
  show                   Show current release channel
  set <channel>          Set release channel (stable, beta, canary)
  list                   List available channels
  check                  Check for updates on current channel

Options:
  --help, -h             Show this help message

Examples:
  flow channel show                # Show current channel
  flow channel set beta            # Switch to beta channel
  flow channel list                # List all channels
  flow channel check               # Check for updates
`);
}

// findProjectRoot and httpsGet are imported from ./utils

/**
 * Get project configuration
 * @param {string} projectRoot - Project root directory
 * @returns {Object} Configuration
 */
function getConfig(projectRoot) {
  const configPath = path.join(projectRoot, '.workflow', 'config.json');
  const config = safeReadJson(configPath);
  return config || { releaseChannel: 'stable' };
}

/**
 * Save project configuration
 * @param {string} projectRoot - Project root directory
 * @param {Object} config - Configuration to save
 */
function saveConfig(projectRoot, config) {
  const configPath = path.join(projectRoot, '.workflow', 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

/**
 * Get latest version from npm for a channel
 * @param {string} channel - Release channel
 * @returns {Promise<string>} Latest version
 */
async function getLatestVersion(channel) {
  try {
    const data = await httpsGet(NPM_REGISTRY);
    const pkg = safeJsonParse(data);
    if (!pkg) {
      return null;
    }

    const channelConfig = CHANNELS[channel];
    if (!channelConfig) {
      throw new Error(`Unknown channel: ${channel}`);
    }

    // Get version for the channel's npm tag
    const distTags = pkg['dist-tags'] || {};
    return distTags[channelConfig.npmTag] || distTags.latest || pkg.version;
  } catch (err) {
    return null;
  }
}

/**
 * Show current release channel
 * @param {string} projectRoot - Project root directory
 */
function showChannel(projectRoot) {
  const config = getConfig(projectRoot);
  const channel = config.releaseChannel || 'stable';
  const channelInfo = CHANNELS[channel] || CHANNELS.stable;

  console.log(`\n📡 Release Channel: ${channel}`);
  console.log(`   ${channelInfo.description}`);
  console.log('');
}

/**
 * Set release channel
 * @param {string} channel - Channel to set
 * @param {string} projectRoot - Project root directory
 */
function setChannel(channel, projectRoot) {
  if (!CHANNELS[channel]) {
    console.error(`Error: Unknown channel '${channel}'`);
    console.error('Available channels: stable, beta, canary');
    process.exit(1);
  }

  const config = getConfig(projectRoot);
  const previousChannel = config.releaseChannel || 'stable';

  config.releaseChannel = channel;
  saveConfig(projectRoot, config);

  console.log(`\n✓ Release channel changed: ${previousChannel} → ${channel}`);
  console.log(`  ${CHANNELS[channel].description}`);
  console.log('\nRun `flow upgrade` to update to the latest version on this channel.');
}

/**
 * List available channels
 */
function listChannels() {
  console.log('\n📡 Available Release Channels\n');

  for (const [key, channel] of Object.entries(CHANNELS)) {
    console.log(`  ${key.padEnd(10)} ${channel.description}`);
    console.log(`             npm tag: ${channel.npmTag}`);
  }

  console.log('\nUse `flow channel set <channel>` to switch channels.');
}

/**
 * Check for updates
 * @param {string} projectRoot - Project root directory
 */
async function checkUpdates(projectRoot) {
  const config = getConfig(projectRoot);
  const channel = config.releaseChannel || 'stable';
  const currentVersion = config.version || require('../package.json').version;

  console.log(`\n🔍 Checking for updates on ${channel} channel...\n`);

  const latestVersion = await getLatestVersion(channel);

  if (!latestVersion) {
    console.log('  Unable to check for updates (network error)');
    return;
  }

  console.log(`  Current version: ${currentVersion}`);
  console.log(`  Latest version:  ${latestVersion}`);

  if (currentVersion === latestVersion) {
    console.log('\n✓ You are on the latest version');
  } else {
    console.log('\n↑ Update available!');
    console.log('  Run `flow upgrade` to update');
  }
}

/**
 * Main release channel function
 * @param {string[]} args - Command line arguments
 */
async function channel(args) {
  const options = parseArgs(args);

  if (options.help) {
    showHelp();
    return;
  }

  const projectRoot = findProjectRoot();

  if (!projectRoot && options.command !== 'list') {
    console.error('Error: Not in a Wogi Flow project');
    console.error('Use `flow init` to initialize a new project');
    process.exit(1);
  }

  switch (options.command) {
    case 'show':
      showChannel(projectRoot);
      break;

    case 'set':
      if (!options.channel) {
        console.error('Error: Please specify a channel');
        console.error('Usage: flow channel set <channel>');
        process.exit(1);
      }
      setChannel(options.channel, projectRoot);
      break;

    case 'list':
      listChannels();
      break;

    case 'check':
      await checkUpdates(projectRoot);
      break;

    default:
      console.error(`Unknown command: ${options.command}`);
      showHelp();
      process.exit(1);
  }
}

module.exports = {
  channel,
  CHANNELS,
  getLatestVersion
};
