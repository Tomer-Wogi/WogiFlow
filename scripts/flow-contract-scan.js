#!/usr/bin/env node

/**
 * Wogi Flow - Contract Surface Scanner CLI
 *
 * TEAMS-ONLY feature: Scans a project's integration surface and generates
 * contract-surface.json for the wogiflow-cloud orchestration agent.
 *
 * Usage:
 *   flow contract-scan                    # Scan and save to default path
 *   flow contract-scan --output <path>    # Custom output path
 *   flow contract-scan --type backend     # Force project type
 *   flow contract-scan --json             # Output JSON to stdout
 *   flow contract-scan --verbose          # Show scan progress
 */

const fs = require('node:fs');
const path = require('node:path');
const { getConfig, PATHS } = require('./flow-utils');

const DEFAULT_OUTPUT = path.join(PATHS.state, 'contract-surface.json');

function parseArgs(args) {
  const options = {
    output: DEFAULT_OUTPUT,
    type: null,
    json: false,
    verbose: false
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--output':
      case '-o':
        options.output = args[++i];
        break;
      case '--type':
      case '-t':
        options.type = args[++i];
        break;
      case '--json':
        options.json = true;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        showHelp();
        process.exit(0);
    }
  }

  return options;
}

function showHelp() {
  console.log(`
Contract Surface Scanner

Scans a project's integration surface (HTTP endpoints, events, shared types,
environment variables) and generates contract-surface.json.

Usage: flow contract-scan [options]

Options:
  --output, -o <path>   Output path (default: .workflow/state/contract-surface.json)
  --type, -t <type>     Force project type (frontend|backend|fullstack|library|monorepo)
  --json                Output JSON to stdout instead of saving to file
  --verbose, -v         Show scan progress
  --help, -h            Show this help

Examples:
  flow contract-scan                          # Scan with defaults
  flow contract-scan --verbose                # Scan with progress output
  flow contract-scan --json                   # Output to stdout
  flow contract-scan --type backend --json    # Force type, output to stdout
`);
}

function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  // Check teams config
  const config = getConfig();
  const contractConfig = config.contractSurface || {};

  if (!contractConfig.enabled && !options.json) {
    console.log('Contract surface scanning is not enabled.');
    console.log('This feature activates when connected to a team (wogi login).');
    console.log('');
    console.log('To scan anyway, use: flow contract-scan --json');
    process.exit(0);
  }

  // Lazy-load the scanner to keep startup fast
  const { scanContracts } = require('./registries/contract-scanner');

  const scanOptions = {
    projectName: path.basename(PATHS.root),
    projectType: options.type || contractConfig.projectType || undefined,
    maxFiles: contractConfig.maxFiles || 500,
    maxDepth: contractConfig.maxDepth || 6,
    verbose: options.verbose
  };

  if (options.verbose) {
    console.log(`Scanning ${PATHS.root}...`);
    console.log('');
  }

  const surface = scanContracts(PATHS.root, scanOptions);

  if (options.json) {
    console.log(JSON.stringify(surface, null, 2));
    return;
  }

  // Save to file
  const outputDir = path.dirname(options.output);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(options.output, JSON.stringify(surface, null, 2));

  const relOutput = path.relative(PATHS.root, options.output);
  console.log(`Contract surface saved to ${relOutput}`);
  console.log('');
  console.log('Summary:');
  console.log(`  Project type:      ${surface.projectType}`);
  console.log(`  Consumed endpoints: ${surface.endpoints.consumes.length}`);
  console.log(`  Exposed endpoints:  ${surface.endpoints.exposes.length}`);
  console.log(`  Event emits:        ${surface.events.emits.length}`);
  console.log(`  Event listeners:    ${surface.events.listensTo.length}`);
  console.log(`  Shared type imports:${surface.sharedTypes.imports.length}`);
  console.log(`  Shared type exports:${surface.sharedTypes.exports.length}`);
  console.log(`  Env vars required:  ${surface.environment.requires.length}`);
  console.log(`  Env vars defined:   ${surface.environment.exposes.length}`);
}

main();
