#!/usr/bin/env node

/**
 * Wogi Flow - Script Resolver
 *
 * Centralized resolver for project script commands.
 * Replaces hardcoded `npm run typecheck`, `npm run lint`, etc.
 * across all flow scripts with auto-detected, config-overridable commands.
 *
 * Resolution order:
 *   1. User override in .workflow/config.json → scripts.{name}
 *   2. Auto-detect from package.json → scripts (with alias matching)
 *   3. Return null (caller decides how to handle)
 *
 * Usage:
 *   const { getCommand, detectPackageManager, validateScripts } = require('./flow-script-resolver');
 *
 *   const cmd = getCommand('typecheck');  // e.g. "pnpm type-check" or null
 *   const pm = detectPackageManager();     // e.g. "pnpm"
 *   const warnings = validateScripts();    // drift detection for session start
 */

const fs = require('fs');
const path = require('path');

/**
 * Validate a script name is safe for shell usage.
 * Rejects names containing shell metacharacters.
 */
const UNSAFE_CHARS = /[;&|$`()"'\\<>!\n\r/]/;
function isSafeScriptName(name) {
  return typeof name === 'string' && name.length > 0 && name.length < 100 && !UNSAFE_CHARS.test(name);
}

// Module-level caches. These are not invalidated because each hook invocation
// runs in a fresh Node process. For long-running processes, call clearCache().
let _projectRoot = null;
function getProjectRoot() {
  if (!_projectRoot) {
    const { getProjectRoot: gpr } = require('./flow-utils');
    _projectRoot = gpr();
  }
  return _projectRoot;
}

let _config = null;
function getConfig() {
  if (!_config) {
    try {
      const { safeJsonParse } = require('./flow-utils');
      const configPath = path.join(getProjectRoot(), '.workflow', 'config.json');
      _config = safeJsonParse(configPath, null);
    } catch {
      // Graceful fallback — no config
    }
  }
  return _config || {};
}

/**
 * Alias map: canonical name → known variants in package.json scripts
 *
 * When resolving "typecheck", we look for these script names in order.
 * First match wins.
 */
const SCRIPT_ALIASES = {
  typecheck: ['typecheck', 'type-check', 'tsc', 'check-types', 'types:check'],
  lint:      ['lint', 'eslint', 'lint:check'],
  test:      ['test', 'tests', 'jest', 'vitest', 'mocha'],
  build:     ['build', 'compile', 'bundle'],
  fix:       ['fix', 'lint:fix', 'eslint:fix', 'format:fix'],
  coverage:  ['coverage', 'test:coverage', 'test:cov'],
  format:    ['format', 'prettier', 'format:check'],
};

/**
 * Package manager detection from lockfiles.
 * Reuses the same logic as flow-workflow.js detectProjectType() but
 * returns just the package manager string for simplicity.
 */
function detectPackageManager(projectRoot) {
  const root = projectRoot || getProjectRoot();
  try {
    if (fs.existsSync(path.join(root, 'bun.lockb')) || fs.existsSync(path.join(root, 'bun.lock'))) return 'bun';
    if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  } catch {
    // Fall through to default
  }
  return 'npm';
}

/**
 * Get the "run" prefix for a package manager.
 * npm needs "npm run X", but yarn/pnpm/bun can do "yarn X" directly.
 */
function getRunPrefix(pm) {
  switch (pm) {
    case 'npm':  return 'npm run';
    case 'yarn': return 'yarn';
    case 'pnpm': return 'pnpm';
    case 'bun':  return 'bun run';
    default:     return 'npm run';
  }
}

/**
 * Get the "exec" command for a package manager (for running binaries).
 * npm → npx, yarn → yarn dlx, pnpm → pnpm dlx, bun → bunx
 */
function getExecCommand(pm) {
  switch (pm) {
    case 'npm':  return 'npx';
    case 'yarn': return 'yarn dlx';
    case 'pnpm': return 'pnpm dlx';
    case 'bun':  return 'bunx';
    default:     return 'npx';
  }
}

/**
 * Read package.json scripts from the project root.
 */
function getPackageScripts(projectRoot) {
  const root = projectRoot || getProjectRoot();
  try {
    const { safeJsonParse } = require('./flow-utils');
    const pkgPath = path.join(root, 'package.json');
    const pkg = safeJsonParse(pkgPath, null);
    if (!pkg) return {};
    return pkg.scripts || {};
  } catch {
    return {};
  }
}

/**
 * Resolve a canonical script name to the actual package.json script name.
 * Uses the alias map to find the best match.
 *
 * @param {string} name - Canonical name (e.g., "typecheck")
 * @param {object} [packageScripts] - Optional pre-loaded scripts object
 * @returns {{ scriptName: string, command: string } | null}
 */
function resolveScriptName(name, packageScripts) {
  const scripts = packageScripts || getPackageScripts();
  const aliases = SCRIPT_ALIASES[name];

  if (!aliases) {
    // No aliases defined — try exact match
    if (scripts[name]) return { scriptName: name, command: scripts[name] };
    return null;
  }

  for (const alias of aliases) {
    if (scripts[alias]) {
      return { scriptName: alias, command: scripts[alias] };
    }
  }

  return null;
}

/**
 * Get the full shell command for a canonical script name.
 *
 * Resolution order:
 *   1. Config override: .workflow/config.json → scripts.{name}
 *   2. Auto-detect: package.json scripts with alias matching
 *   3. null (script not available)
 *
 * @param {string} name - Canonical name: "lint", "typecheck", "test", "build", "fix", "coverage", "format"
 * @param {object} [options]
 * @param {string} [options.projectRoot] - Override project root
 * @param {boolean} [options.bare] - Return just the script name without pm prefix (for test-specific handling)
 * @returns {string | null} Full command (e.g., "pnpm type-check") or null
 */
function getCommand(name, options = {}) {
  const { projectRoot, bare } = options;
  const config = getConfig();
  const pm = detectPackageManager(projectRoot);

  // 1. Check config override
  const configScripts = config.scripts || {};
  if (configScripts[name] && typeof configScripts[name] === 'string') {
    // Validate entire config override — reject if any part contains shell metacharacters
    const overrideParts = configScripts[name].trim().split(/\s+/).filter(Boolean);
    if (!overrideParts.every(part => isSafeScriptName(part))) return null;
    return configScripts[name];
  }

  // 2. Auto-detect from package.json
  const scripts = getPackageScripts(projectRoot);
  const resolved = resolveScriptName(name, scripts);

  if (!resolved) return null;

  // Validate resolved script name is safe for shell usage
  if (!isSafeScriptName(resolved.scriptName)) return null;

  if (bare) return resolved.scriptName;

  // Special case: "test" uses `npm test` not `npm run test` for npm
  if (resolved.scriptName === 'test' && pm === 'npm') {
    return 'npm test';
  }

  return `${getRunPrefix(pm)} ${resolved.scriptName}`;
}

/**
 * Get an exec-style command (for running binaries like tsc, eslint).
 * Adapts to detected package manager.
 *
 * @param {string} binary - Binary name (e.g., "tsc", "eslint")
 * @param {string[]} [args] - Arguments
 * @param {object} [options]
 * @param {string} [options.projectRoot] - Override project root
 * @returns {string} Full command (e.g., "pnpm dlx tsc --noEmit")
 */
function getExec(binary, args = [], options = {}) {
  const pm = detectPackageManager(options.projectRoot);
  const exec = getExecCommand(pm);
  const argStr = args.length > 0 ? ' ' + args.join(' ') : '';
  return `${exec} ${binary}${argStr}`;
}

/**
 * Get exec command parts as an array (for execFileSync usage).
 *
 * @param {string} binary - Binary name
 * @param {string[]} [args] - Arguments
 * @param {object} [options]
 * @returns {{ cmd: string, args: string[] }} Command and args for execFileSync
 */
function getExecParts(binary, args = [], options = {}) {
  // Validate binary name to prevent injection
  if (!isSafeScriptName(binary)) {
    return { cmd: 'npx', args: [binary, ...args] }; // Safe fallback — execFileSync won't interpret metacharacters
  }

  const pm = detectPackageManager(options.projectRoot);
  const exec = getExecCommand(pm);

  // For npx/bunx: single command, binary is first arg
  if (exec === 'npx' || exec === 'bunx') {
    return { cmd: exec, args: [binary, ...args] };
  }

  // For yarn dlx / pnpm dlx: command is yarn/pnpm, "dlx" is first arg
  const parts = exec.split(' ');
  if (parts.length !== 2) {
    // Unexpected format — safe fallback
    return { cmd: exec, args: [binary, ...args] };
  }
  const [pmCmd, dlx] = parts;
  return { cmd: pmCmd, args: [dlx, binary, ...args] };
}

/**
 * Validate that expected scripts exist in package.json.
 * Returns warnings for missing scripts with suggested aliases.
 *
 * Used by SessionStart hook for drift detection.
 *
 * @param {object} [options]
 * @param {string} [options.projectRoot] - Override project root
 * @returns {Array<{ name: string, message: string }>} Array of warnings
 */
function validateScripts(options = {}) {
  const scripts = getPackageScripts(options.projectRoot);
  const config = getConfig();
  const configScripts = config.scripts || {};
  const warnings = [];

  // Only validate scripts that WogiFlow actually uses
  const expectedScripts = ['lint', 'typecheck', 'test', 'build'];

  for (const name of expectedScripts) {
    // Skip if config has an explicit override (user knows what they're doing)
    if (configScripts[name] && typeof configScripts[name] === 'string') continue;

    const resolved = resolveScriptName(name, scripts);
    if (!resolved) {
      // Script not found — check if there's a close match
      const aliases = SCRIPT_ALIASES[name] || [];
      const scriptNames = Object.keys(scripts);

      // Look for partial matches
      const partial = scriptNames.find(s =>
        aliases.some(a => s.includes(a) || a.includes(s))
      );

      if (partial) {
        warnings.push({
          name,
          message: `No '${name}' script found. Did you mean '${partial}'? Add to .workflow/config.json scripts.${name} to fix.`
        });
      } else {
        warnings.push({
          name,
          message: `No '${name}' script found in package.json. Quality gate for '${name}' will be skipped.`
        });
      }
    }
  }

  return warnings;
}

/**
 * Clear cached config and project root (useful for testing).
 */
function clearCache() {
  _projectRoot = null;
  _config = null;
}

module.exports = {
  getCommand,
  getExec,
  getExecParts,
  detectPackageManager,
  getRunPrefix,
  getExecCommand,
  resolveScriptName,
  validateScripts,
  getPackageScripts,
  SCRIPT_ALIASES,
  clearCache,
};

// CLI: flow script-resolver [check|resolve <name>]
if (require.main === module) {
  const { colors: c } = require('./flow-utils');
  const args = process.argv.slice(2);
  const subcmd = args[0];

  if (subcmd === 'check' || !subcmd) {
    // Validate scripts
    const pm = detectPackageManager();
    const scripts = getPackageScripts();
    const warnings = validateScripts();

    console.log(`${c.bold}Script Resolver Status${c.reset}`);
    console.log(`Package manager: ${c.cyan}${pm}${c.reset}`);
    console.log(`Scripts in package.json: ${Object.keys(scripts).length}\n`);

    const canonical = ['lint', 'typecheck', 'test', 'build', 'fix', 'coverage', 'format'];
    for (const name of canonical) {
      const cmd = getCommand(name);
      if (cmd) {
        console.log(`  ${c.green}✓${c.reset} ${name}: ${cmd}`);
      } else {
        console.log(`  ${c.yellow}–${c.reset} ${name}: not available`);
      }
    }

    if (warnings.length > 0) {
      console.log(`\n${c.yellow}Warnings:${c.reset}`);
      for (const w of warnings) {
        console.log(`  ${c.yellow}⚠${c.reset} ${w.message}`);
      }
    }
  } else if (subcmd === 'resolve' && args[1]) {
    const cmd = getCommand(args[1]);
    if (cmd) {
      console.log(cmd);
    } else {
      console.error(`No script found for: ${args[1]}`);
      process.exit(1);
    }
  } else {
    console.log('Usage: flow script-resolver [check|resolve <name>]');
  }
}
