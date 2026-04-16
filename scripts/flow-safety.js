#!/usr/bin/env node

/**
 * Wogi Flow - Safety Guardrails
 *
 * Provides permission models and hard limits to prevent unintended operations.
 * Includes file/command allow/deny lists and bounded execution limits.
 *
 * Usage as module:
 *   const { SafetyGuard, SafetyError } = require('./flow-safety');
 *   const guard = new SafetyGuard(config);
 *   guard.checkFilePermission('/path/to/file');
 *
 * Usage as CLI:
 *   flow safety check-file <path>     # Check if file access is allowed
 *   flow safety check-command <cmd>   # Check if command is allowed
 *   flow safety status                # Show current limits and permissions
 */

const _fs = require('node:fs');
const path = require('node:path');
const { getConfig, colors: c, PATHS } = require('./flow-utils');
const { success: printSuccess, error: printError } = require('./flow-output');

/**
 * Custom error for safety violations
 */
class SafetyError extends Error {
  constructor(message, type = 'general') {
    super(message);
    this.name = 'SafetyError';
    this.type = type;
    this.isSafetyViolation = true;
  }
}

/**
 * Default safety configuration
 */
const DEFAULT_SAFETY_CONFIG = {
  enabled: true,
  limits: {
    maxSteps: 50,
    maxFilesModified: 20,
    maxFilesCreated: 10,
    maxFilesDeleted: 5,
    maxTokens: null,
    checkpointInterval: 5,
    maxCommandsRun: 30
  },
  permissions: {
    files: {
      allow: [
        'src/**',
        'lib/**',
        'tests/**',
        'test/**',
        '__tests__/**',
        'scripts/**',
        '.workflow/**',
        'templates/**',
        'config/**',
        '*.json',
        '*.md',
        '*.ts',
        '*.tsx',
        '*.js',
        '*.jsx',
        '*.css',
        '*.scss',
        '*.html',
        '*.yaml',
        '*.yml'
      ],
      deny: [
        '**/.env',
        '**/.env.*',
        '**/.env.local',
        '**/secrets/**',
        '**/credentials/**',
        '**/*.pem',
        '**/*.key',
        '**/*.crt',
        '**/id_rsa*',
        '**/id_ed25519*',
        '**/.ssh/**',
        '**/.aws/**',
        '**/.gcloud/**',
        '**/package-lock.json',
        '**/yarn.lock',
        '**/pnpm-lock.yaml',
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/build/**'
      ]
    },
    commands: {
      allow: [
        'npm',
        'npx',
        'yarn',
        'pnpm',
        'bun',
        'node',
        'tsc',
        'tsx',
        'ts-node',
        'eslint',
        'prettier',
        'biome',
        'jest',
        'vitest',
        'mocha',
        'pytest',
        'git',
        'echo',
        'cat',
        'ls',
        'mkdir',
        'cp',
        'mv',
        'touch',
        'head',
        'tail',
        'grep',
        'find',
        'wc',
        'sort',
        'uniq',
        'diff'
      ],
      deny: [
        'rm -rf /',
        'rm -rf ~',
        'rm -rf .',
        'rm -rf ..',
        'rm -rf *',
        'sudo',
        'su',
        'chmod 777',
        'curl',
        'wget',
        'ssh',
        'scp',
        'rsync',
        'nc',
        'netcat',
        'telnet',
        'ftp',
        'eval',
        'exec',
        ':(){:|:&};:'
      ]
    },
    network: false
  },
  onViolation: 'abort'
};

/**
 * Safety guard class for enforcing limits and permissions
 */
class SafetyGuard {
  constructor(config = {}) {
    const safetyConfig = config.safety || {};
    this.config = this.mergeConfig(DEFAULT_SAFETY_CONFIG, safetyConfig);
    this.enabled = this.config.enabled;

    // Counters
    this.counters = {
      steps: 0,
      filesModified: 0,
      filesCreated: 0,
      filesDeleted: 0,
      commandsRun: 0,
      tokensUsed: 0
    };

    // Track modified files to prevent double-counting
    this.modifiedFiles = new Set();
    this.createdFiles = new Set();
    this.deletedFiles = new Set();
  }

  /**
   * Deep merge configuration with defaults
   */
  mergeConfig(defaults, override) {
    const result = { ...defaults };
    for (const key of Object.keys(override)) {
      if (override[key] && typeof override[key] === 'object' && !Array.isArray(override[key])) {
        result[key] = this.mergeConfig(defaults[key] || {}, override[key]);
      } else if (override[key] !== undefined) {
        result[key] = override[key];
      }
    }
    return result;
  }

  /**
   * Check if file access is allowed
   */
  checkFilePermission(filePath, _operation = 'read') {
    if (!this.enabled) return true;

    const permissions = this.config.permissions?.files || {};
    const allowPatterns = permissions.allow || ['**/*'];
    const denyPatterns = permissions.deny || [];

    // Normalize path
    const normalizedPath = filePath.startsWith('/')
      ? path.relative(PATHS.root, filePath)
      : filePath;

    // Check deny list first (takes precedence)
    for (const pattern of denyPatterns) {
      if (this.matchPattern(normalizedPath, pattern)) {
        throw new SafetyError(
          `File access denied by safety policy: ${normalizedPath} (matches deny pattern: ${pattern})`,
          'file_permission'
        );
      }
    }

    // Check allow list
    let allowed = false;
    for (const pattern of allowPatterns) {
      if (this.matchPattern(normalizedPath, pattern)) {
        allowed = true;
        break;
      }
    }

    if (!allowed) {
      throw new SafetyError(
        `File access denied: ${normalizedPath} (not in allow list)`,
        'file_permission'
      );
    }

    return true;
  }

  /**
   * Check if command is allowed
   */
  checkCommandPermission(command) {
    if (!this.enabled) return true;

    const permissions = this.config.permissions?.commands || {};
    const allowList = permissions.allow || ['*'];
    const denyPatterns = permissions.deny || [];

    // Get base command
    const baseCmd = command.trim().split(/\s+/)[0];

    // Check deny list first
    for (const pattern of denyPatterns) {
      if (command.includes(pattern) || command.startsWith(pattern)) {
        throw new SafetyError(
          `Command blocked by safety policy: "${command}" (matches deny pattern: "${pattern}")`,
          'command_permission'
        );
      }
    }

    // Check allow list
    const allowed = allowList.includes('*') || allowList.includes(baseCmd);

    if (!allowed) {
      throw new SafetyError(
        `Command not allowed: "${baseCmd}" (not in allow list)`,
        'command_permission'
      );
    }

    return true;
  }

  /**
   * Check all limits
   */
  checkLimits() {
    if (!this.enabled) return true;

    const limits = this.config.limits || {};

    if (limits.maxSteps && this.counters.steps >= limits.maxSteps) {
      throw new SafetyError(
        `Step limit reached (${limits.maxSteps})`,
        'limit_exceeded'
      );
    }

    if (limits.maxFilesModified && this.counters.filesModified >= limits.maxFilesModified) {
      throw new SafetyError(
        `File modification limit reached (${limits.maxFilesModified})`,
        'limit_exceeded'
      );
    }

    if (limits.maxFilesCreated && this.counters.filesCreated >= limits.maxFilesCreated) {
      throw new SafetyError(
        `File creation limit reached (${limits.maxFilesCreated})`,
        'limit_exceeded'
      );
    }

    if (limits.maxFilesDeleted && this.counters.filesDeleted >= limits.maxFilesDeleted) {
      throw new SafetyError(
        `File deletion limit reached (${limits.maxFilesDeleted})`,
        'limit_exceeded'
      );
    }

    if (limits.maxCommandsRun && this.counters.commandsRun >= limits.maxCommandsRun) {
      throw new SafetyError(
        `Command execution limit reached (${limits.maxCommandsRun})`,
        'limit_exceeded'
      );
    }

    if (limits.maxTokens && this.counters.tokensUsed >= limits.maxTokens) {
      throw new SafetyError(
        `Token limit reached (${limits.maxTokens})`,
        'limit_exceeded'
      );
    }

    return true;
  }

  /**
   * Record a step execution
   */
  recordStep() {
    this.counters.steps++;
    this.checkLimits();
    return this.counters.steps;
  }

  /**
   * Record a file modification
   */
  recordFileModification(filePath, isNew = false) {
    // Check permission first
    this.checkFilePermission(filePath, isNew ? 'create' : 'modify');

    if (isNew) {
      if (!this.createdFiles.has(filePath)) {
        this.createdFiles.add(filePath);
        this.counters.filesCreated++;
      }
    } else {
      if (!this.modifiedFiles.has(filePath)) {
        this.modifiedFiles.add(filePath);
        this.counters.filesModified++;
      }
    }

    this.checkLimits();
  }

  /**
   * Record a file deletion
   */
  recordFileDeletion(filePath) {
    this.checkFilePermission(filePath, 'delete');

    if (!this.deletedFiles.has(filePath)) {
      this.deletedFiles.add(filePath);
      this.counters.filesDeleted++;
    }

    this.checkLimits();
  }

  /**
   * Record a command execution
   */
  recordCommand(command) {
    this.checkCommandPermission(command);
    this.counters.commandsRun++;
    this.checkLimits();
  }

  /**
   * Record token usage
   */
  recordTokens(count) {
    this.counters.tokensUsed += count;
    this.checkLimits();
  }

  /**
   * Check if checkpoint is needed
   */
  needsCheckpoint() {
    const interval = this.config.limits?.checkpointInterval || 5;
    return this.counters.steps > 0 && this.counters.steps % interval === 0;
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      enabled: this.enabled,
      counters: { ...this.counters },
      limits: this.config.limits,
      filesModified: Array.from(this.modifiedFiles),
      filesCreated: Array.from(this.createdFiles),
      filesDeleted: Array.from(this.deletedFiles)
    };
  }

  /**
   * Reset counters (for new run)
   */
  reset() {
    this.counters = {
      steps: 0,
      filesModified: 0,
      filesCreated: 0,
      filesDeleted: 0,
      commandsRun: 0,
      tokensUsed: 0
    };
    this.modifiedFiles.clear();
    this.createdFiles.clear();
    this.deletedFiles.clear();
  }

  /**
   * Match path against glob pattern
   */
  matchPattern(str, pattern) {
    // Handle ** (match anything including /)
    // Handle * (match anything except /)
    // Handle ? (match single character)
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
      .replace(/\*\*/g, '<<<GLOBSTAR>>>') // Temporarily replace **
      .replace(/\*/g, '[^/]*') // * matches anything except /
      .replace(/<<<GLOBSTAR>>>/g, '.*') // ** matches anything
      .replace(/\?/g, '.'); // ? matches single char

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(str);
  }
}

/**
 * Load safety configuration from config.json
 */
function loadSafetyConfig() {
  try {
    const config = getConfig();
    return config.safety || {};
  } catch (_err) {
    return {};
  }
}

/**
 * Format status for display
 */
function formatStatus(status) {
  const limits = status.limits || {};

  let output = `${c.cyan}${c.bold}Safety Guardrails Status${c.reset}\n`;
  output += `${'─'.repeat(50)}\n\n`;

  output += `${c.bold}Status:${c.reset} ${status.enabled ? `${c.green}ENABLED${c.reset}` : `${c.yellow}DISABLED${c.reset}`}\n\n`;

  output += `${c.bold}Current Counters:${c.reset}\n`;
  output += `  Steps:            ${status.counters.steps}/${limits.maxSteps || '∞'}\n`;
  output += `  Files Modified:   ${status.counters.filesModified}/${limits.maxFilesModified || '∞'}\n`;
  output += `  Files Created:    ${status.counters.filesCreated}/${limits.maxFilesCreated || '∞'}\n`;
  output += `  Files Deleted:    ${status.counters.filesDeleted}/${limits.maxFilesDeleted || '∞'}\n`;
  output += `  Commands Run:     ${status.counters.commandsRun}/${limits.maxCommandsRun || '∞'}\n`;
  output += `  Tokens Used:      ${status.counters.tokensUsed}/${limits.maxTokens || '∞'}\n`;
  output += `  Checkpoint Every: ${limits.checkpointInterval || 5} steps\n`;

  return output;
}

// Module exports
module.exports = {
  SafetyGuard,
  SafetyError,
  loadSafetyConfig,
  DEFAULT_SAFETY_CONFIG
};

// CLI Handler
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  const safetyConfig = loadSafetyConfig();
  const guard = new SafetyGuard({ safety: safetyConfig });

  try {
    switch (command) {
      case 'check-file': {
        const filePath = args[1];
        if (!filePath) {
          console.error(`${c.red}Error: File path required${c.reset}`);
          process.exit(1);
        }
        guard.checkFilePermission(filePath);
        printSuccess(`File access allowed: ${filePath}`);
        break;
      }

      case 'check-command': {
        const cmd = args.slice(1).join(' ');
        if (!cmd) {
          console.error(`${c.red}Error: Command required${c.reset}`);
          process.exit(1);
        }
        guard.checkCommandPermission(cmd);
        printSuccess(`Command allowed: ${cmd}`);
        break;
      }

      case 'status': {
        console.log(formatStatus(guard.getStatus()));
        break;
      }

      case 'config': {
        console.log(JSON.stringify(guard.config, null, 2));
        break;
      }

      default: {
        console.log(`
${c.cyan}Wogi Flow - Safety Guardrails${c.reset}

${c.bold}Usage:${c.reset}
  flow safety check-file <path>     Check if file access is allowed
  flow safety check-command <cmd>   Check if command is allowed
  flow safety status                Show current limits and permissions
  flow safety config                Show safety configuration (JSON)

${c.bold}Configuration:${c.reset}
  Add to .workflow/config.json:
  {
    "safety": {
      "enabled": true,
      "limits": {
        "maxSteps": 50,
        "maxFilesModified": 20,
        "checkpointInterval": 5
      },
      "permissions": {
        "files": {
          "allow": ["src/**", "tests/**"],
          "deny": ["**/.env", "**/secrets/**"]
        },
        "commands": {
          "allow": ["npm", "node", "git"],
          "deny": ["rm -rf"]
        }
      }
    }
  }
        `);
      }
    }
  } catch (err) {
    if (err.isSafetyViolation) {
      printError(`Safety Violation: ${err.message}`);
      process.exit(5); // Safety violation exit code
    }
    throw err;
  }
}
