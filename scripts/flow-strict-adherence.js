#!/usr/bin/env node

/**
 * Wogi Flow - Strict Adherence Validator
 *
 * Two-tier enforcement system:
 * 1. AI Actions (BLOCK): Prevent AI from deviating, auto-correct when possible
 * 2. User Code Review (WARN): Flag deviations but don't block user commits
 *
 * Usage:
 *   const { validateCommand, validateFileName, validateAPIRoute } = require('./flow-strict-adherence');
 *
 *   // Check before running a command
 *   const result = validateCommand('npm install axios');
 *   if (result.blocked) {
 *     console.log(result.suggestion); // "pnpm add axios"
 *   }
 */

const fs = require('fs');
const path = require('path');
const {
  getProjectRoot,
  safeJsonParse,
  colors,
  warn,
  error,
  info,
  success
} = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

const PROJECT_ROOT = getProjectRoot();
const STANDARDS_PATH = path.join(PROJECT_ROOT, '.workflow/state/project-standards.json');
const OVERRIDES_PATH = path.join(PROJECT_ROOT, '.workflow/state/adherence-overrides.json');
const CONFIG_PATH = path.join(PROJECT_ROOT, '.workflow/config.json');

// Escape special regex characters for safe dynamic regex construction
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Package manager command mappings for auto-correction
const PACKAGE_COMMANDS = {
  npm: {
    install: 'npm install',
    add: 'npm install',
    remove: 'npm uninstall',
    run: 'npm run',
    exec: 'npx'
  },
  yarn: {
    install: 'yarn install',
    add: 'yarn add',
    remove: 'yarn remove',
    run: 'yarn',
    exec: 'yarn dlx'
  },
  pnpm: {
    install: 'pnpm install',
    add: 'pnpm add',
    remove: 'pnpm remove',
    run: 'pnpm',
    exec: 'pnpm dlx'
  },
  bun: {
    install: 'bun install',
    add: 'bun add',
    remove: 'bun remove',
    run: 'bun run',
    exec: 'bunx'
  }
};

// ============================================================
// Standards Loading
// ============================================================

let _cachedStandards = null;
let _cachedConfig = null;

/**
 * Load project standards from project-standards.json
 */
function loadStandards() {
  if (_cachedStandards) return _cachedStandards;

  if (!fs.existsSync(STANDARDS_PATH)) {
    return null;
  }

  _cachedStandards = safeJsonParse(STANDARDS_PATH, null);
  return _cachedStandards;
}

/**
 * Load strict adherence config
 */
function loadConfig() {
  if (_cachedConfig) return _cachedConfig;

  const config = safeJsonParse(CONFIG_PATH, {});
  _cachedConfig = config.strictAdherence || {
    enabled: false,
    aiMode: 'block',
    userReviewMode: 'warn'
  };
  return _cachedConfig;
}

/**
 * Check if strict adherence is enabled
 */
function isEnabled() {
  const config = loadConfig();
  return config.enabled === true;
}

/**
 * Clear cached standards (for testing or after updates)
 */
function clearCache() {
  _cachedStandards = null;
  _cachedConfig = null;
}

// ============================================================
// Command Validation
// ============================================================

/**
 * Validate a shell command against project standards
 *
 * @param {string} command - The command to validate
 * @returns {{ valid: boolean, blocked: boolean, reason?: string, suggestion?: string, autoCorrect?: string }}
 */
function validateCommand(command) {
  const result = {
    valid: true,
    blocked: false,
    original: command
  };

  if (!isEnabled()) return result;

  const standards = loadStandards();
  if (!standards?.operational?.packageManager) return result;

  const expectedManager = standards.operational.packageManager.tool;
  const config = loadConfig();

  // Check for package manager commands
  const packageManagerPatterns = [
    { regex: /^npm\s+(install|i|add|remove|uninstall|run|exec|ci)\b/, manager: 'npm' },
    { regex: /^yarn\s+(install|add|remove|run|dlx)?\b/, manager: 'yarn' },
    { regex: /^pnpm\s+(install|add|remove|run|dlx)?\b/, manager: 'pnpm' },
    { regex: /^bun\s+(install|add|remove|run|x)?\b/, manager: 'bun' },
    { regex: /^npx\s+/, manager: 'npm' },
    { regex: /^bunx\s+/, manager: 'bun' }
  ];

  for (const { regex, manager } of packageManagerPatterns) {
    if (regex.test(command) && manager !== expectedManager) {
      result.valid = false;
      result.reason = `Project uses ${expectedManager}, not ${manager}`;

      // Generate auto-corrected command
      result.autoCorrect = convertPackageCommand(command, manager, expectedManager);
      result.suggestion = `Use: ${result.autoCorrect}`;

      // Block in AI mode
      if (config.aiMode === 'block') {
        result.blocked = true;
      }

      return result;
    }
  }

  // Check for port in dev commands
  const expectedPort = standards.operational?.devServer?.port;
  if (expectedPort) {
    // Unified regex: non-capturing groups for patterns, single capture group for port value
    // Matches: --port=3000, --port 3000, -p 3000, localhost:3000, 127.0.0.1:3000, 0.0.0.0:3000
    const portMatch = command.match(/(?:--port[=\s]+|-p\s+|localhost:|127\.0\.0\.1:|0\.0\.0\.0:)(\d+)/);
    if (portMatch && portMatch[1]) {
      const usedPort = parseInt(portMatch[1], 10);
      // Validate port is in valid range
      if (usedPort < 1 || usedPort > 65535) return result;
      if (usedPort !== expectedPort) {
        result.valid = false;
        result.reason = `Project uses port ${expectedPort}, not ${usedPort}`;
        result.autoCorrect = command.replace(/--port[=\s]+\d+|-p\s+\d+|localhost:\d+/,
          portMatch[0].includes('localhost') ? `localhost:${expectedPort}` : `--port ${expectedPort}`);
        result.suggestion = `Use: ${result.autoCorrect}`;

        if (config.aiMode === 'block') {
          result.blocked = true;
        }
      }
    }
  }

  return result;
}

/**
 * Convert a package manager command from one manager to another
 */
function convertPackageCommand(command, fromManager, toManager) {
  const from = PACKAGE_COMMANDS[fromManager];
  const to = PACKAGE_COMMANDS[toManager];

  if (!from || !to) return command;

  // Handle npx/bunx/etc
  if (command.startsWith('npx ')) {
    return command.replace(/^npx\s+/, to.exec + ' ');
  }
  if (command.startsWith('bunx ')) {
    return command.replace(/^bunx\s+/, to.exec + ' ');
  }

  // Handle install commands
  if (/^(npm|yarn|pnpm|bun)\s+(install|i|add)\s+/.test(command)) {
    const packages = command.replace(/^(npm|yarn|pnpm|bun)\s+(install|i|add)\s+/, '');
    return packages.trim() ? `${to.add} ${packages}` : to.install;
  }

  // Handle bare install
  if (/^(npm|yarn|pnpm|bun)\s+install\s*$/.test(command)) {
    return to.install;
  }

  // Handle run commands
  if (/^(npm run|yarn|pnpm|bun run)\s+/.test(command)) {
    const script = command.replace(/^(npm run|yarn|pnpm|bun run)\s+/, '');
    return `${to.run} ${script}`;
  }

  // Handle remove commands
  if (/^(npm|yarn|pnpm|bun)\s+(uninstall|remove)\s+/.test(command)) {
    const packages = command.replace(/^(npm|yarn|pnpm|bun)\s+(uninstall|remove)\s+/, '');
    return `${to.remove} ${packages}`;
  }

  // Generic replacement (escape fromManager for regex safety)
  return command.replace(new RegExp(`^${escapeRegExp(fromManager)}\\b`), toManager);
}

// ============================================================
// File Name Validation
// ============================================================

/**
 * Validate a file name against project naming conventions
 *
 * @param {string} fileName - The file name to validate
 * @param {string} fileType - Type: 'component', 'util', 'api', 'test'
 * @returns {{ valid: boolean, blocked: boolean, reason?: string, suggestion?: string }}
 */
function validateFileName(fileName, fileType = 'generic') {
  const result = {
    valid: true,
    blocked: false,
    original: fileName
  };

  if (!isEnabled()) return result;

  const standards = loadStandards();
  if (!standards?.patterns?.fileNaming?.style) return result;

  const expectedStyle = standards.patterns.fileNaming.style;
  const config = loadConfig();

  // Extract base name without extension
  const baseName = path.basename(fileName, path.extname(fileName));

  // Skip special files
  if (['index', 'App', 'main'].includes(baseName)) return result;

  // Detect current style
  const isKebab = baseName.includes('-');
  const isPascal = /^[A-Z][a-zA-Z0-9]*$/.test(baseName);
  const isCamel = /^[a-z][a-zA-Z0-9]*$/.test(baseName) && /[A-Z]/.test(baseName);
  const isSnake = baseName.includes('_');

  let currentStyle = 'unknown';
  if (isKebab) currentStyle = 'kebab-case';
  else if (isPascal) currentStyle = 'PascalCase';
  else if (isCamel) currentStyle = 'camelCase';
  else if (isSnake) currentStyle = 'snake_case';

  // Components typically use PascalCase regardless of file naming
  if (fileType === 'component' && isPascal) {
    return result; // PascalCase is acceptable for components
  }

  // Check if style matches
  if (expectedStyle !== 'mixed' && currentStyle !== 'unknown' && currentStyle !== expectedStyle) {
    result.valid = false;
    result.reason = `Project uses ${expectedStyle} for file names, not ${currentStyle}`;
    result.suggestion = `Rename to: ${convertFileName(baseName, currentStyle, expectedStyle)}${path.extname(fileName)}`;

    if (config.aiMode === 'block') {
      result.blocked = true;
    }
  }

  return result;
}

/**
 * Convert file name from one style to another
 */
function convertFileName(name, fromStyle, toStyle) {
  // First normalize to words
  let words = [];

  if (fromStyle === 'kebab-case') {
    words = name.split('-');
  } else if (fromStyle === 'snake_case') {
    words = name.split('_');
  } else if (fromStyle === 'camelCase' || fromStyle === 'PascalCase') {
    words = name.replace(/([A-Z])/g, '-$1').toLowerCase().split('-').filter(Boolean);
  } else {
    words = [name.toLowerCase()];
  }

  // Convert to target style
  switch (toStyle) {
    case 'kebab-case':
      return words.join('-').toLowerCase();
    case 'snake_case':
      return words.join('_').toLowerCase();
    case 'camelCase':
      return words.map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
    case 'PascalCase':
      return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
    default:
      return name;
  }
}

// ============================================================
// API Route Validation
// ============================================================

/**
 * Validate an API route path against project patterns
 *
 * @param {string} routePath - The API route path (e.g., "/api/getUserData")
 * @returns {{ valid: boolean, blocked: boolean, reason?: string, suggestion?: string }}
 */
function validateAPIRoute(routePath) {
  const result = {
    valid: true,
    blocked: false,
    original: routePath
  };

  if (!isEnabled()) return result;

  const standards = loadStandards();
  if (!standards?.patterns?.apiRoutes?.style) return result;

  const expectedStyle = standards.patterns.apiRoutes.style;
  const config = loadConfig();

  // Extract route segments (skip /api prefix)
  const segments = routePath.replace(/^\/api\/?/, '').split('/').filter(Boolean);

  for (const segment of segments) {
    // Skip dynamic segments like [id] or :id
    if (segment.startsWith('[') || segment.startsWith(':')) continue;

    // Skip single-word lowercase segments - they're valid for any style
    // e.g., "users" is valid for kebab-case, camelCase, etc.
    if (/^[a-z]+$/.test(segment)) continue;

    const isKebab = segment.includes('-');
    const isCamel = /[a-z][A-Z]/.test(segment);
    const isSnake = segment.includes('_');

    let currentStyle = 'lowercase';
    if (isKebab) currentStyle = 'kebab-case';
    else if (isCamel) currentStyle = 'camelCase';
    else if (isSnake) currentStyle = 'snake_case';

    if (currentStyle !== expectedStyle && currentStyle !== 'lowercase') {
      result.valid = false;
      result.reason = `API routes should use ${expectedStyle}, not ${currentStyle}`;

      // Generate corrected route
      const correctedSegments = segments.map(s => {
        if (s.startsWith('[') || s.startsWith(':')) return s;
        return convertFileName(s, currentStyle, expectedStyle);
      });
      result.suggestion = `/api/${correctedSegments.join('/')}`;

      if (config.aiMode === 'block') {
        result.blocked = true;
      }

      break;
    }
  }

  return result;
}

// ============================================================
// Override Management
// ============================================================

/**
 * Request an override for strict adherence
 *
 * @param {string} category - Category being overridden
 * @param {string} deviation - What is being deviated from
 * @param {string} reason - Why the override is needed
 * @returns {{ success: boolean, logged: boolean }}
 */
function requestOverride(category, deviation, reason) {
  const result = { success: false, logged: false };

  if (!reason || reason.trim().length < 10) {
    result.error = 'Override reason must be at least 10 characters';
    return result;
  }

  // Load existing overrides
  let overrides = safeJsonParse(OVERRIDES_PATH, { overrides: [] });
  if (!overrides.overrides) overrides.overrides = [];

  // Load standards for context
  const standards = loadStandards();

  // Create override record
  const override = {
    timestamp: new Date().toISOString(),
    category,
    deviation,
    sourcePattern: standards?.patterns?.[category]?.style || 'unknown',
    reason: reason.trim(),
    approvedBy: 'user'
  };

  overrides.overrides.push(override);
  overrides.lastUpdated = new Date().toISOString();

  // Write overrides file
  try {
    const dir = path.dirname(OVERRIDES_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(overrides, null, 2));
    result.success = true;
    result.logged = true;
  } catch (err) {
    result.error = `Failed to log override: ${err.message}`;
  }

  return result;
}

/**
 * Check if an override exists for a specific deviation
 */
function hasOverride(category, deviation) {
  const overrides = safeJsonParse(OVERRIDES_PATH, { overrides: [] });
  return overrides.overrides.some(o =>
    o.category === category && o.deviation === deviation
  );
}

/**
 * List all recorded overrides
 */
function listOverrides() {
  return safeJsonParse(OVERRIDES_PATH, { overrides: [] }).overrides;
}

// ============================================================
// Batch Validation (for code review)
// ============================================================

/**
 * Validate multiple aspects of code for user review (WARN mode)
 *
 * @param {Object} options - What to validate
 * @returns {{ warnings: Array<{ category: string, file: string, message: string }> }}
 */
function reviewCode(options = {}) {
  const warnings = [];

  if (!isEnabled()) return { warnings };

  const standards = loadStandards();
  const config = loadConfig();

  // Only run in user review mode
  if (config.userReviewMode !== 'warn') return { warnings };

  // Validate file names
  if (options.files) {
    for (const file of options.files) {
      const result = validateFileName(file, options.fileType || 'generic');
      if (!result.valid) {
        warnings.push({
          category: 'fileNaming',
          file,
          message: result.reason,
          suggestion: result.suggestion
        });
      }
    }
  }

  // Validate API routes
  if (options.apiRoutes) {
    for (const route of options.apiRoutes) {
      const result = validateAPIRoute(route);
      if (!result.valid) {
        warnings.push({
          category: 'apiRoutes',
          file: route,
          message: result.reason,
          suggestion: result.suggestion
        });
      }
    }
  }

  return { warnings };
}

/**
 * Format review warnings for display
 */
function formatWarnings(warnings) {
  if (warnings.length === 0) return '';

  const lines = [
    colors.yellow + '\n⚠️  Strict Adherence Warnings' + colors.reset,
    colors.dim + 'These don\'t match imported project standards:\n' + colors.reset
  ];

  for (const w of warnings) {
    lines.push(`${colors.yellow}[${w.category}]${colors.reset} ${w.file}`);
    lines.push(`  ${w.message}`);
    if (w.suggestion) {
      lines.push(`  ${colors.green}Suggestion: ${w.suggestion}${colors.reset}`);
    }
    lines.push('');
  }

  lines.push(colors.dim + 'To override: flow strict-override --reason "Your reason"' + colors.reset);

  return lines.join('\n');
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Core validation
  validateCommand,
  validateFileName,
  validateAPIRoute,

  // Configuration
  isEnabled,
  loadStandards,
  loadConfig,
  clearCache,

  // Override management
  requestOverride,
  hasOverride,
  listOverrides,

  // Code review (batch)
  reviewCode,
  formatWarnings,

  // Utilities
  convertPackageCommand,
  convertFileName
};

// ============================================================
// CLI
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Wogi Flow - Strict Adherence Validator

Usage:
  flow-strict-adherence validate-command "npm install"
  flow-strict-adherence validate-file "myComponent.tsx"
  flow-strict-adherence validate-route "/api/getUserData"
  flow-strict-adherence list-overrides
  flow-strict-adherence override --category apiRoutes --deviation "camelCase route" --reason "Legacy API"

Options:
  validate-command <cmd>    Check if a command follows project standards
  validate-file <file>      Check if a file name follows conventions
  validate-route <route>    Check if an API route follows patterns
  list-overrides            Show all recorded overrides
  override                  Record an override with reason

Flags:
  --json    Output as JSON
  --help    Show this help message
`);
    process.exit(0);
  }

  const command = args[0];
  const jsonOutput = args.includes('--json');

  if (command === 'validate-command') {
    const cmd = args[1];
    if (!cmd) {
      error('Missing command to validate');
      process.exit(1);
    }
    // Input validation: reject excessively long or suspicious input
    if (typeof cmd !== 'string' || cmd.length > 2000 || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(cmd)) {
      error('Invalid command input');
      process.exit(1);
    }
    const result = validateCommand(cmd);
    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.blocked) {
      error(`BLOCKED: ${result.reason}`);
      success(`Auto-correct: ${result.autoCorrect}`);
      process.exit(1);
    } else if (!result.valid) {
      warn(`Warning: ${result.reason}`);
      info(`Suggestion: ${result.suggestion}`);
    } else {
      success('Command is valid');
    }
  } else if (command === 'validate-file') {
    const file = args[1];
    if (!file) {
      error('Missing file name to validate');
      process.exit(1);
    }
    const result = validateFileName(file);
    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.blocked) {
      error(`BLOCKED: ${result.reason}`);
      info(`Suggestion: ${result.suggestion}`);
      process.exit(1);
    } else if (!result.valid) {
      warn(`Warning: ${result.reason}`);
      info(`Suggestion: ${result.suggestion}`);
    } else {
      success('File name is valid');
    }
  } else if (command === 'validate-route') {
    const route = args[1];
    if (!route) {
      error('Missing route to validate');
      process.exit(1);
    }
    const result = validateAPIRoute(route);
    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.blocked) {
      error(`BLOCKED: ${result.reason}`);
      info(`Suggestion: ${result.suggestion}`);
      process.exit(1);
    } else if (!result.valid) {
      warn(`Warning: ${result.reason}`);
      info(`Suggestion: ${result.suggestion}`);
    } else {
      success('API route is valid');
    }
  } else if (command === 'list-overrides') {
    const overrides = listOverrides();
    if (jsonOutput) {
      console.log(JSON.stringify(overrides, null, 2));
    } else if (overrides.length === 0) {
      info('No overrides recorded');
    } else {
      console.log(colors.cyan + '\nRecorded Overrides:' + colors.reset);
      for (const o of overrides) {
        console.log(`\n${colors.yellow}[${o.category}]${colors.reset} ${o.deviation}`);
        console.log(`  Reason: ${o.reason}`);
        console.log(`  ${colors.dim}${o.timestamp}${colors.reset}`);
      }
    }
  } else if (command === 'override') {
    const categoryIdx = args.indexOf('--category');
    const deviationIdx = args.indexOf('--deviation');
    const reasonIdx = args.indexOf('--reason');

    if (categoryIdx === -1 || deviationIdx === -1 || reasonIdx === -1) {
      error('Missing required flags: --category, --deviation, --reason');
      process.exit(1);
    }

    const category = args[categoryIdx + 1];
    const deviation = args[deviationIdx + 1];
    const reason = args[reasonIdx + 1];

    const result = requestOverride(category, deviation, reason);
    if (result.success) {
      success('Override recorded');
    } else {
      error(result.error);
      process.exit(1);
    }
  } else {
    // Default: show status
    if (isEnabled()) {
      success('Strict adherence is ENABLED');
      const standards = loadStandards();
      if (standards) {
        console.log(`  Package manager: ${standards.operational?.packageManager?.tool || 'not set'}`);
        console.log(`  Dev port: ${standards.operational?.devServer?.port || 'not set'}`);
        console.log(`  File naming: ${standards.patterns?.fileNaming?.style || 'not set'}`);
        console.log(`  API routes: ${standards.patterns?.apiRoutes?.style || 'not set'}`);
      }
    } else {
      warn('Strict adherence is DISABLED');
      info('Enable with: flow config set strictAdherence.enabled true');
    }
  }
}
