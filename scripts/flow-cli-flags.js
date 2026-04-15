#!/usr/bin/env node

/**
 * Wogi Flow - CLI Flag Parsing
 *
 * Standardized flag parsing for all `flow *` commands. Extracted from
 * flow-utils.js (wf-94cc3b72 epic — flow-utils decomposition).
 *
 * Recognizes common boolean flags (--json, --quiet, --verbose, --help,
 * --dry-run, --deep), known valued flags (--priority, --format, etc.),
 * and treats unknown --key style flags as booleans by default with
 * --key=value escape hatch.
 */

'use strict';

// Known flags that take values (--flag value style)
const VALUED_FLAGS = [
  'priority', 'from', 'severity', 'limit', 'format', 'output',
  'strategy', 'type', 'file', 'analysis', 'model', 'domain', 'task-type'
];

/**
 * Parse common CLI flags from arguments.
 *
 * @param {string[]} args - Command line arguments (process.argv.slice(2))
 * @returns {{ flags: Object, positional: string[] }}
 *
 * @example
 *   const { flags, positional } = parseFlags(process.argv.slice(2));
 *   if (flags.json) outputJson(result);
 *   if (flags.help) showHelp();
 */
function parseFlags(args) {
  const flags = {
    json: false,
    quiet: false,
    verbose: false,
    help: false,
    dryRun: false,
    deep: false
  };

  const positional = [];
  const namedFlags = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--json') {
      flags.json = true;
    } else if (arg === '--quiet' || arg === '-q') {
      flags.quiet = true;
    } else if (arg === '--verbose' || arg === '-v') {
      flags.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      flags.help = true;
    } else if (arg === '--dry-run') {
      flags.dryRun = true;
    } else if (arg === '--deep') {
      flags.deep = true;
    } else if (arg.startsWith('--')) {
      // Handle --key=value style flags
      const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
      if (match) {
        const [, key, value] = match;
        if (value !== undefined) {
          // Has explicit value: --key=value
          namedFlags[key] = value;
        } else if (VALUED_FLAGS.includes(key) && i + 1 < args.length && !args[i + 1].startsWith('-')) {
          // Known valued flag: --key value (consume next arg)
          namedFlags[key] = args[++i];
        } else if (VALUED_FLAGS.includes(key)) {
          // Valued flag without value - warn in debug mode, treat as boolean
          if (process.env.DEBUG) {
            console.warn(`[DEBUG] Flag --${key} expects a value but none provided`);
          }
          namedFlags[key] = true;
        } else {
          // Boolean flag: --flag
          namedFlags[key] = true;
        }
      }
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  return { flags: { ...flags, ...namedFlags }, positional };
}

module.exports = {
  parseFlags,
  VALUED_FLAGS,
};
