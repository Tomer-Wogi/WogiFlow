#!/usr/bin/env node

/**
 * Wogi Flow - Verification Gates
 *
 * Enhanced verification system with:
 * - Structured gate results
 * - Auto-capture of stderr for LLM analysis
 * - Rich error context for self-healing
 * - Retry with fix suggestions
 *
 * Usage as module:
 *   const { runGate, runGates, GateResult } = require('./flow-verify');
 *   const result = await runGate('lint');
 *
 * Usage as CLI:
 *   flow verify lint                # Run single gate
 *   flow verify all                 # Run all configured gates
 *   flow verify --json              # Output JSON for CI
 */

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { getProjectRoot, getConfig, colors: c } = require('./flow-utils');
const { recordCommandResult } = require('./flow-metrics');

const PROJECT_ROOT = getProjectRoot();
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');

/**
 * Gate result structure
 */
class GateResult {
  constructor(name) {
    this.name = name;
    this.passed = false;
    this.skipped = false;
    this.exitCode = null;
    this.duration = 0;
    this.stdout = '';
    this.stderr = '';
    this.command = '';
    this.errors = [];
    this.warnings = [];
    this.fixSuggestions = [];
    this.timestamp = new Date().toISOString();
  }

  toJSON() {
    return {
      name: this.name,
      passed: this.passed,
      skipped: this.skipped,
      exitCode: this.exitCode,
      duration: this.duration,
      command: this.command,
      errors: this.errors,
      warnings: this.warnings,
      fixSuggestions: this.fixSuggestions,
      timestamp: this.timestamp,
      // Only include output if there are errors
      ...(this.errors.length > 0 && { stdout: this.stdout, stderr: this.stderr })
    };
  }

  /**
   * Format for LLM consumption with rich error context
   */
  toLLMContext() {
    if (this.passed) {
      return `✅ Gate "${this.name}" passed`;
    }

    let context = `❌ Gate "${this.name}" FAILED\n\n`;
    context += `Command: ${this.command}\n`;
    context += `Exit Code: ${this.exitCode}\n`;
    context += `Duration: ${this.duration}ms\n\n`;

    if (this.errors.length > 0) {
      context += `## Errors (${this.errors.length})\n`;
      for (const err of this.errors) {
        context += `\n### ${err.file || 'Unknown'}:${err.line || '?'}\n`;
        context += `**Message**: ${err.message}\n`;
        if (err.code) context += `**Code**: ${err.code}\n`;
        if (err.rule) context += `**Rule**: ${err.rule}\n`;
        if (err.snippet) context += `\`\`\`\n${err.snippet}\n\`\`\`\n`;
      }
    }

    if (this.fixSuggestions.length > 0) {
      context += `\n## Fix Suggestions\n`;
      for (const fix of this.fixSuggestions) {
        context += `- ${fix}\n`;
      }
    }

    if (this.stderr && this.errors.length === 0) {
      context += `\n## Raw stderr\n\`\`\`\n${this.stderr.slice(0, 3000)}\n\`\`\`\n`;
    }

    return context;
  }
}

/**
 * Default gate configurations
 */
const DEFAULT_GATES = {
  lint: {
    name: 'Lint',
    commands: [
      { cmd: 'npx', args: ['eslint', '.', '--ext', '.ts,.tsx,.js,.jsx'], detect: 'eslint' },
      { cmd: 'npx', args: ['biome', 'check', '.'], detect: '@biomejs/biome' }
    ],
    parser: 'eslint',
    autoFix: { cmd: 'npx', args: ['eslint', '.', '--fix'] }
  },
  typecheck: {
    name: 'TypeCheck',
    commands: [
      { cmd: 'npx', args: ['tsc', '--noEmit'], detect: 'typescript' }
    ],
    parser: 'typescript'
  },
  test: {
    name: 'Test',
    commands: [
      { cmd: 'npx', args: ['vitest', 'run'], detect: 'vitest' },
      { cmd: 'npx', args: ['jest'], detect: 'jest' },
      { cmd: 'npm', args: ['test'], detect: null }
    ],
    parser: 'jest'
  },
  build: {
    name: 'Build',
    commands: [
      { cmd: 'npm', args: ['run', 'build'], detect: null }
    ],
    parser: 'generic'
  },
  format: {
    name: 'Format Check',
    commands: [
      { cmd: 'npx', args: ['prettier', '--check', '.'], detect: 'prettier' },
      { cmd: 'npx', args: ['biome', 'format', '--check', '.'], detect: '@biomejs/biome' }
    ],
    parser: 'prettier',
    autoFix: { cmd: 'npx', args: ['prettier', '--write', '.'] }
  },
  securityScan: {
    name: 'Security Scan',
    commands: [
      { cmd: 'npm', args: ['audit', '--json'], detect: null }
    ],
    parser: 'security',
    customChecks: ['secrets', 'injection', 'evalExec']
  }
};

/**
 * Error parsers for different tools
 */
const ERROR_PARSERS = {
  eslint: (output) => {
    const errors = [];
    // ESLint output: /path/file.ts:line:col: message (rule)
    const lines = output.split('\n');
    const errorRegex = /^(.+):(\d+):(\d+):\s*(.+?)\s*(\([\w\/@-]+\))?$/;
    const warningRegex = /warning/i;

    for (const line of lines) {
      const match = line.match(errorRegex);
      if (match) {
        const [, file, lineNum, col, message, rule] = match;
        errors.push({
          file: path.relative(PROJECT_ROOT, file),
          line: parseInt(lineNum),
          column: parseInt(col),
          message: message.trim(),
          rule: rule ? rule.replace(/[()]/g, '') : null,
          severity: warningRegex.test(line) ? 'warning' : 'error'
        });
      }
    }
    return errors;
  },

  typescript: (output) => {
    const errors = [];
    // TypeScript output: file.ts(line,col): error TS1234: message
    const lines = output.split('\n');
    const errorRegex = /^(.+)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.+)$/;

    for (const line of lines) {
      const match = line.match(errorRegex);
      if (match) {
        const [, file, lineNum, col, severity, code, message] = match;
        errors.push({
          file: path.relative(PROJECT_ROOT, file),
          line: parseInt(lineNum),
          column: parseInt(col),
          message,
          code,
          severity: severity.toLowerCase()
        });
      }
    }
    return errors;
  },

  jest: (output) => {
    const errors = [];
    // Jest failure patterns
    const failedTestRegex = /✕\s+(.+)/g;
    const fileRegex = /at\s+(?:Object\.<anonymous>|.*)\s+\((.+):(\d+):(\d+)\)/g;

    let match;
    while ((match = failedTestRegex.exec(output)) !== null) {
      errors.push({
        message: `Test failed: ${match[1]}`,
        severity: 'error'
      });
    }

    while ((match = fileRegex.exec(output)) !== null) {
      const [, file, line, col] = match;
      if (!file.includes('node_modules')) {
        errors.push({
          file: path.relative(PROJECT_ROOT, file),
          line: parseInt(line),
          column: parseInt(col),
          message: 'Test assertion failed',
          severity: 'error'
        });
      }
    }

    return errors;
  },

  prettier: (output) => {
    const errors = [];
    // Prettier check output: Checking formatting...
    // [warn] file.ts
    const warnRegex = /\[warn\]\s+(.+)/g;

    let match;
    while ((match = warnRegex.exec(output)) !== null) {
      errors.push({
        file: match[1],
        message: 'File needs formatting',
        severity: 'warning'
      });
    }

    return errors;
  },

  generic: (output) => {
    const errors = [];
    // Generic error detection
    const errorLines = output.split('\n').filter(line =>
      /error|failed|fatal|exception/i.test(line) &&
      !/warning/i.test(line)
    );

    for (const line of errorLines.slice(0, 10)) {
      errors.push({
        message: line.trim(),
        severity: 'error'
      });
    }

    return errors;
  },

  security: (output) => {
    const errors = [];

    // Parse npm audit JSON output
    try {
      const audit = JSON.parse(output);

      // Validate structure before accessing nested properties
      if (!audit || typeof audit !== 'object') {
        throw new Error('Invalid audit JSON structure');
      }

      const vulns = audit.metadata?.vulnerabilities || {};

      if (vulns.critical > 0) {
        errors.push({
          message: `${vulns.critical} critical vulnerability(s) found`,
          severity: 'error',
          code: 'CRITICAL_VULN'
        });
      }
      if (vulns.high > 0) {
        errors.push({
          message: `${vulns.high} high severity vulnerability(s) found`,
          severity: 'error',
          code: 'HIGH_VULN'
        });
      }
      if (vulns.moderate > 0) {
        errors.push({
          message: `${vulns.moderate} moderate vulnerability(s) found`,
          severity: 'warning',
          code: 'MODERATE_VULN'
        });
      }
      if (vulns.low > 0) {
        errors.push({
          message: `${vulns.low} low severity vulnerability(s) found`,
          severity: 'warning',
          code: 'LOW_VULN'
        });
      }
    } catch {
      // Not JSON, try line-based parsing
      if (output.includes('found 0 vulnerabilities')) {
        // Clean
      } else if (/found \d+ vulnerabilities/.test(output)) {
        const match = output.match(/(\d+) (critical|high|moderate|low)/gi);
        if (match) {
          for (const m of match) {
            const [count, severity] = m.split(' ');
            errors.push({
              message: `${count} ${severity} vulnerability(s)`,
              severity: severity === 'critical' || severity === 'high' ? 'error' : 'warning',
              code: `${severity.toUpperCase()}_VULN`
            });
          }
        }
      }
    }

    return errors;
  }
};


/**
 * Detect which command to use based on installed packages
 */
function detectCommand(gate) {
  const packageJsonPath = path.join(PROJECT_ROOT, 'package.json');
  let deps = {};

  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      deps = { ...pkg.dependencies, ...pkg.devDependencies };
    } catch {
      // Ignore parse errors
    }
  }

  for (const cmdConfig of gate.commands) {
    if (cmdConfig.detect === null) {
      // No detection needed, use this command
      return cmdConfig;
    }
    if (deps[cmdConfig.detect]) {
      return cmdConfig;
    }
  }

  return null;
}

/**
 * Run a command and capture output
 */
const MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB limit per stream

function runCommand(cmd, args, timeout = 120000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;

    const proc = spawn(cmd, args, {
      cwd: PROJECT_ROOT,
      timeout,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    proc.stdout.on('data', (data) => {
      if (stdout.length < MAX_OUTPUT_SIZE) {
        stdout += data.toString();
      } else if (!stdoutTruncated) {
        stdout += '\n[OUTPUT TRUNCATED - exceeded 1MB]';
        stdoutTruncated = true;
      }
    });

    proc.stderr.on('data', (data) => {
      if (stderr.length < MAX_OUTPUT_SIZE) {
        stderr += data.toString();
      } else if (!stderrTruncated) {
        stderr += '\n[OUTPUT TRUNCATED - exceeded 1MB]';
        stderrTruncated = true;
      }
    });

    proc.on('close', (code) => {
      resolve({
        exitCode: code,
        stdout,
        stderr,
        duration: Date.now() - startTime
      });
    });

    proc.on('error', (err) => {
      resolve({
        exitCode: 1,
        stdout,
        stderr: stderr + '\n' + err.message,
        duration: Date.now() - startTime
      });
    });
  });
}

/**
 * TypeScript error code suggestions with self-correction guidance
 */
const TS_ERROR_SUGGESTIONS = {
  // Module/Import errors
  TS2307: {
    pattern: /Cannot find module '(.+)'/,
    suggest: (match, file) => {
      const moduleName = match[1];
      if (moduleName.startsWith('.')) {
        return `Check file path: Does "${moduleName}" exist relative to ${file}? Common issues: wrong extension (.js vs .ts), missing index file, case sensitivity`;
      }
      if (moduleName.startsWith('@')) {
        return `Install missing package: \`npm install ${moduleName}\` or \`npm install -D @types/${moduleName.replace('@', '').split('/')[0]}\``;
      }
      return `Install missing package: \`npm install ${moduleName}\` or for types: \`npm install -D @types/${moduleName}\``;
    }
  },
  TS2305: {
    pattern: /Module '"(.+)"' has no exported member '(.+)'/,
    suggest: (match) => {
      const [, modulePath, memberName] = match;
      return `"${memberName}" is not exported from "${modulePath}". Check: 1) Correct export name (case-sensitive), 2) Named vs default export, 3) Re-export in index.ts`;
    }
  },
  TS2614: {
    pattern: /Module '"(.+)"' has no default export/,
    suggest: (match) => {
      const modulePath = match[1];
      return `Use named import: \`import { something } from "${modulePath}"\` instead of default import. Or add \`export default\` to the source file.`;
    }
  },

  // Type mismatch errors
  TS2322: {
    pattern: /Type '(.+)' is not assignable to type '(.+)'/,
    suggest: (match) => {
      const [, sourceType, targetType] = match;
      if (sourceType === 'undefined' || sourceType.includes('undefined')) {
        return `Handle undefined case: Use optional chaining (?.), nullish coalescing (??), or add a type guard. The value might be undefined but "${targetType}" doesn't allow it.`;
      }
      if (targetType === 'never') {
        return 'Check your type narrowing logic - TypeScript determined this code path is impossible. Verify your conditional checks.';
      }
      return `Type mismatch: "${sourceType}" → "${targetType}". Options: 1) Cast with \`as ${targetType}\` if safe, 2) Add type guard, 3) Update the expected type, 4) Transform the value`;
    }
  },
  TS2345: {
    pattern: /Argument of type '(.+)' is not assignable to parameter of type '(.+)'/,
    suggest: (match) => {
      const [, argType, paramType] = match;
      return `Wrong argument type. Expected "${paramType}" but got "${argType}". Check: 1) Correct function signature, 2) Transform argument before passing, 3) Update function to accept both types`;
    }
  },
  TS2339: {
    pattern: /Property '(.+)' does not exist on type '(.+)'/,
    suggest: (match) => {
      const [, propName, typeName] = match;
      if (typeName.includes('|')) {
        return `"${propName}" doesn't exist on all union members. Use type narrowing: \`if ('${propName}' in obj)\` or discriminated unions.`;
      }
      return `Property "${propName}" not in type "${typeName}". Options: 1) Add property to interface, 2) Use \`(obj as any).${propName}\` (not recommended), 3) Check for typo in property name`;
    }
  },

  // Declaration errors
  TS2304: {
    pattern: /Cannot find name '(.+)'/,
    suggest: (match) => {
      const name = match[1];
      const builtins = ['console', 'setTimeout', 'Promise', 'Array', 'Object', 'JSON'];
      if (builtins.includes(name)) {
        return `Add "dom" and/or "es2020" to compilerOptions.lib in tsconfig.json, or check that @types/node is installed.`;
      }
      return `"${name}" is not defined. Check: 1) Import the symbol, 2) Typo in name, 3) Declaration in scope, 4) Missing type definition`;
    }
  },
  TS2451: {
    pattern: /Cannot redeclare block-scoped variable '(.+)'/,
    suggest: (match) => {
      const varName = match[1];
      return `"${varName}" is declared multiple times. This often happens with global declarations or missing export statements. Wrap in a module: add \`export {}\` to make file a module.`;
    }
  },

  // Async/Promise errors
  TS2705: {
    pattern: /An async function/,
    suggest: () => 'Async function needs Promise. Add "es2017" or higher to compilerOptions.lib in tsconfig.json.'
  },
  TS1064: {
    pattern: /The return type of an async function/,
    suggest: () => 'Async functions must return a Promise. Use `Promise<YourType>` as return type or let TypeScript infer it.'
  },

  // Generic/inference errors
  TS2558: {
    pattern: /Expected (\d+) type arguments?, but got (\d+)/,
    suggest: (match) => {
      const [, expected, got] = match;
      return `Generic type expects ${expected} type argument(s), got ${got}. Check the generic definition and provide correct number of types.`;
    }
  },
  TS7006: {
    pattern: /Parameter '(.+)' implicitly has an 'any' type/,
    suggest: (match) => {
      const paramName = match[1];
      return `Add type annotation to "${paramName}". Example: \`${paramName}: string\` or \`${paramName}: SomeType\`. If truly unknown, use \`${paramName}: unknown\` (safer than any).`;
    }
  },

  // Object literal errors
  TS2353: {
    pattern: /Object literal may only specify known properties/,
    suggest: () => 'Extra property in object literal. Either: 1) Remove the property, 2) Add it to the type definition, 3) Use type assertion to bypass (not recommended)'
  },
  TS2741: {
    pattern: /Property '(.+)' is missing in type/,
    suggest: (match) => {
      const propName = match[1];
      return `Required property "${propName}" is missing. Add it to the object, or make it optional in the type with \`${propName}?: Type\``;
    }
  }
};

/**
 * Generate fix suggestions based on errors
 */
function generateFixSuggestions(gateName, errors) {
  const suggestions = [];

  if (gateName === 'lint') {
    const hasAutoFix = errors.some(e => e.rule);
    if (hasAutoFix) {
      suggestions.push('Run `npx eslint . --fix` to auto-fix some issues');
    }

    // Group by rule for specific suggestions
    const ruleCount = {};
    for (const err of errors) {
      if (err.rule) {
        ruleCount[err.rule] = (ruleCount[err.rule] || 0) + 1;
      }
    }

    for (const [rule, count] of Object.entries(ruleCount)) {
      if (count > 3) {
        suggestions.push(`Rule "${rule}" has ${count} violations - consider reviewing this pattern`);
      }
    }
  }

  if (gateName === 'typecheck') {
    // Enhanced TypeScript suggestions with self-correction guidance
    const seenSuggestions = new Set();

    for (const err of errors) {
      if (err.code && TS_ERROR_SUGGESTIONS[err.code]) {
        const suggestionDef = TS_ERROR_SUGGESTIONS[err.code];
        const match = err.message.match(suggestionDef.pattern);

        if (match) {
          const suggestion = suggestionDef.suggest(match, err.file);
          // Dedupe similar suggestions
          const key = `${err.code}:${suggestion.slice(0, 50)}`;
          if (!seenSuggestions.has(key)) {
            seenSuggestions.add(key);
            suggestions.push(`[${err.code}] ${suggestion}`);
          }
        }
      }
    }

    // Fallback generic suggestions if no specific ones matched
    if (suggestions.length === 0) {
      const missingTypes = errors.filter(e => e.code === 'TS2307');
      if (missingTypes.length > 0) {
        suggestions.push('Some type definitions may be missing - check @types packages');
      }

      const anyErrors = errors.filter(e => e.message.includes('any'));
      if (anyErrors.length > 0) {
        suggestions.push('Consider adding proper type annotations instead of `any`');
      }
    }

    // Limit suggestions to most relevant
    if (suggestions.length > 5) {
      const limited = suggestions.slice(0, 5);
      limited.push(`... and ${suggestions.length - 5} more suggestions`);
      return limited;
    }
  }

  if (gateName === 'test') {
    suggestions.push('Review failing tests and update assertions or implementation');
    if (errors.some(e => e.message.includes('timeout'))) {
      suggestions.push('Some tests timed out - check for async issues or increase timeout');
    }
  }

  if (gateName === 'format') {
    suggestions.push('Run `npx prettier --write .` to fix formatting');
  }

  if (gateName === 'securityScan') {
    const hasCritical = errors.some(e => e.code === 'CRITICAL_VULN');
    const hasHigh = errors.some(e => e.code === 'HIGH_VULN');
    const hasSecrets = errors.some(e => e.code === 'SECRET_DETECTED');
    const hasInjection = errors.some(e => e.code === 'INJECTION_RISK');

    if (hasCritical || hasHigh) {
      suggestions.push('Run `npm audit fix` to auto-fix vulnerabilities');
      suggestions.push('Run `npm audit fix --force` for breaking changes (review carefully)');
    }
    if (hasSecrets) {
      suggestions.push('Remove hardcoded secrets and use environment variables');
      suggestions.push('Add secrets to .gitignore and rotate any exposed credentials');
    }
    if (hasInjection) {
      suggestions.push('Use parameterized queries for database operations');
      suggestions.push('Avoid eval(), new Function(), and exec() with user input');
    }
  }

  return suggestions;
}

// ============================================================
// Security Check Functions
// ============================================================

/**
 * Get staged files for security scanning
 */
function getStagedFiles() {
  try {
    const output = execSync('git diff --cached --name-only', {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8'
    });
    return output.split('\n').filter(f => f.trim() && /\.(ts|tsx|js|jsx|json|env)$/i.test(f));
  } catch {
    return [];
  }
}

/**
 * Find source files recursively (safe alternative to shell find)
 * @param {string} dir - Directory to search
 * @param {string[]} extensions - File extensions to match
 * @param {number} limit - Max files to return
 * @returns {string[]} Array of relative file paths
 */
function findSourceFiles(dir, extensions, limit) {
  const results = [];

  function walk(currentDir, depth = 0) {
    // Prevent infinite recursion
    if (depth > 10 || results.length >= limit) return;

    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (results.length >= limit) break;

        // Skip hidden files/dirs and node_modules
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

        const fullPath = path.join(currentDir, entry.name);
        const relativePath = path.relative(PROJECT_ROOT, fullPath);

        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (extensions.includes(ext)) {
            results.push(relativePath);
          }
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  walk(dir);
  return results;
}

/**
 * Check for hardcoded secrets in files
 */
function checkForSecrets(files) {
  const errors = [];
  const config = getConfig();
  const ignorePatterns = config.security?.ignoreFiles || ['*.test.ts', '*.spec.ts'];

  const secretPatterns = [
    { pattern: /password\s*[:=]\s*['"][^'"]{8,}['"]/gi, name: 'Hardcoded password' },
    { pattern: /api[_-]?key\s*[:=]\s*['"][^'"]{10,}['"]/gi, name: 'Hardcoded API key' },
    { pattern: /secret\s*[:=]\s*['"][^'"]{8,}['"]/gi, name: 'Hardcoded secret' },
    { pattern: /-----BEGIN (RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----/g, name: 'Private key' },
    { pattern: /sk_live_[a-zA-Z0-9]{24,}/g, name: 'Stripe live key' },
    { pattern: /sk_test_[a-zA-Z0-9]{24,}/g, name: 'Stripe test key' },
    { pattern: /ghp_[a-zA-Z0-9]{36}/g, name: 'GitHub personal token' },
    { pattern: /gho_[a-zA-Z0-9]{36}/g, name: 'GitHub OAuth token' },
    { pattern: /xox[baprs]-[a-zA-Z0-9-]{10,}/g, name: 'Slack token' },
    { pattern: /AKIA[0-9A-Z]{16}/g, name: 'AWS access key' },
    { pattern: /mongodb(\+srv)?:\/\/[^:]+:[^@]+@/g, name: 'MongoDB connection string with password' }
  ];

  for (const file of files) {
    // Skip ignored patterns
    const shouldIgnore = ignorePatterns.some(pattern => {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      return regex.test(file);
    });
    if (shouldIgnore) continue;

    const filePath = path.join(PROJECT_ROOT, file);
    if (!fs.existsSync(filePath)) continue;

    try {
      const content = fs.readFileSync(filePath, 'utf-8');

      for (const { pattern, name } of secretPatterns) {
        const matches = content.match(pattern);
        if (matches) {
          errors.push({
            file,
            message: `${name} detected`,
            severity: 'error',
            code: 'SECRET_DETECTED',
            count: matches.length
          });
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return errors;
}

/**
 * Check for injection vulnerabilities
 */
function checkForInjection(files) {
  const errors = [];
  const config = getConfig();
  const ignorePatterns = config.security?.ignoreFiles || ['*.test.ts', '*.spec.ts'];

  const injectionPatterns = [
    { pattern: /eval\s*\([^)]*\$\{/g, name: 'eval() with template literal' },
    { pattern: /new\s+Function\s*\([^)]*\$\{/g, name: 'new Function() with template literal' },
    { pattern: /exec\s*\([^)]*\$\{/g, name: 'exec() with template literal' },
    { pattern: /innerHTML\s*=\s*[^;]*\$\{/g, name: 'innerHTML with template literal (XSS risk)' },
    { pattern: /dangerouslySetInnerHTML/g, name: 'dangerouslySetInnerHTML usage' },
    { pattern: /\$\{[^}]+\}.*(?:SELECT|INSERT|UPDATE|DELETE|DROP)\s/gi, name: 'Potential SQL injection' }
  ];

  for (const file of files) {
    // Skip ignored patterns
    const shouldIgnore = ignorePatterns.some(pattern => {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      return regex.test(file);
    });
    if (shouldIgnore) continue;

    const filePath = path.join(PROJECT_ROOT, file);
    if (!fs.existsSync(filePath)) continue;

    try {
      const content = fs.readFileSync(filePath, 'utf-8');

      const lines = content.split('\n');
      for (const { pattern, name } of injectionPatterns) {
        // Create fresh regex for each pattern to avoid stateful lastIndex issues
        for (let i = 0; i < lines.length; i++) {
          const freshPattern = new RegExp(pattern.source, pattern.flags);
          if (freshPattern.test(lines[i])) {
            errors.push({
              file,
              line: i + 1,
              message: name,
              severity: 'warning',
              code: 'INJECTION_RISK'
            });
          }
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return errors;
}

/**
 * Run all security checks
 */
async function runSecurityChecks(gateResult) {
  const config = getConfig();
  const securityConfig = config.security || {};
  const checkPatterns = securityConfig.checkPatterns || {};

  // Get files to scan
  let files = getStagedFiles();
  if (files.length === 0) {
    // Fall back to src directory if no staged files
    // Use fs.readdirSync instead of shell find to prevent command injection
    try {
      const srcDir = path.join(PROJECT_ROOT, 'src');
      if (fs.existsSync(srcDir)) {
        files = findSourceFiles(srcDir, ['.ts', '.tsx', '.js', '.jsx'], 100);
      }
    } catch {
      files = [];
    }
  }

  // Run secret detection
  if (checkPatterns.secrets !== false) {
    const secretErrors = checkForSecrets(files);
    gateResult.errors.push(...secretErrors);
  }

  // Run injection detection
  if (checkPatterns.injection !== false) {
    const injectionErrors = checkForInjection(files);
    gateResult.errors.push(...injectionErrors.filter(e => e.severity === 'error'));
    gateResult.warnings.push(...injectionErrors.filter(e => e.severity === 'warning'));
  }
}

/**
 * Run a single verification gate
 */
async function runGate(gateName, options = {}) {
  const config = getConfig();
  const gateConfig = config.verifyGates?.[gateName] || DEFAULT_GATES[gateName];

  if (!gateConfig) {
    const result = new GateResult(gateName);
    result.errors = [{ message: `Unknown gate: ${gateName}` }];
    return result;
  }

  const result = new GateResult(gateName);
  const cmdConfig = detectCommand(gateConfig);

  if (!cmdConfig) {
    result.passed = false;
    result.skipped = true;
    result.warnings = [{ message: `No tool detected for ${gateName}, skipping (treated as not passed)` }];
    return result;
  }

  result.command = `${cmdConfig.cmd} ${cmdConfig.args.join(' ')}`;

  if (!options.quiet) {
    console.log(`${c.cyan}▶${c.reset} Running ${gateConfig.name}...`);
  }

  const output = await runCommand(cmdConfig.cmd, cmdConfig.args, options.timeout || 120000);

  result.exitCode = output.exitCode;
  result.duration = output.duration;
  result.stdout = output.stdout;
  result.stderr = output.stderr;
  result.passed = output.exitCode === 0;

  // Parse errors
  const parser = ERROR_PARSERS[gateConfig.parser] || ERROR_PARSERS.generic;
  const combinedOutput = output.stdout + '\n' + output.stderr;
  const parsedErrors = parser(combinedOutput);

  result.errors = parsedErrors.filter(e => e.severity === 'error');
  result.warnings = parsedErrors.filter(e => e.severity === 'warning');

  // Run custom security checks for securityScan gate
  if (gateName === 'securityScan' && gateConfig.customChecks) {
    await runSecurityChecks(result);
    // Update passed status based on errors
    const config = getConfig();
    const blockOnHigh = config.security?.blockOnHigh !== false;
    const hasBlockingErrors = result.errors.some(e =>
      e.code === 'SECRET_DETECTED' ||
      e.code === 'CRITICAL_VULN' ||
      (blockOnHigh && e.code === 'HIGH_VULN')
    );
    if (hasBlockingErrors) {
      result.passed = false;
    }
  }

  // Generate fix suggestions
  if (!result.passed) {
    result.fixSuggestions = generateFixSuggestions(gateName, result.errors);
  }

  // Record metrics
  recordCommandResult(result.command, {
    success: result.passed,
    duration: result.duration,
    exitCode: result.exitCode,
    errorType: result.errors[0]?.code || (result.passed ? null : 'UNKNOWN')
  });

  if (!options.quiet) {
    if (result.passed) {
      console.log(`${c.green}✅ ${gateConfig.name} passed${c.reset} (${result.duration}ms)`);
    } else {
      console.log(`${c.red}❌ ${gateConfig.name} failed${c.reset} (${result.duration}ms)`);
      console.log(`   ${result.errors.length} error(s), ${result.warnings.length} warning(s)`);
    }
  }

  return result;
}

/**
 * Run multiple gates
 */
async function runGates(gateNames, options = {}) {
  const config = getConfig();

  // Use configured gates if 'all' specified
  if (gateNames.includes('all')) {
    gateNames = Object.keys(config.verifyGates || DEFAULT_GATES);
  }

  // If stopOnFailure is set or only one gate, run sequentially
  if (options.stopOnFailure || gateNames.length <= 1) {
    const results = [];
    for (const gateName of gateNames) {
      const result = await runGate(gateName, options);
      results.push(result);
      if (!result.passed && options.stopOnFailure) {
        break;
      }
    }
    return results;
  }

  // Run gates with limited concurrency (max 4 parallel) to avoid resource exhaustion
  const MAX_CONCURRENT = 4;
  const results = [];

  for (let i = 0; i < gateNames.length; i += MAX_CONCURRENT) {
    const batch = gateNames.slice(i, i + MAX_CONCURRENT);
    const batchResults = await Promise.all(
      batch.map(gateName => runGate(gateName, options))
    );
    results.push(...batchResults);
  }

  return results;
}

/**
 * Get summary of gate results
 */
function getSummary(results) {
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  return {
    passed,
    failed,
    total: results.length,
    allPassed: failed === 0,
    duration: totalDuration,
    results: results.map(r => r.toJSON())
  };
}

/**
 * Format results for terminal display
 */
function formatResults(results, options = {}) {
  let output = '';

  output += `\n${c.cyan}${'═'.repeat(60)}${c.reset}\n`;
  output += `${c.bold}Verification Gate Results${c.reset}\n`;
  output += `${c.cyan}${'═'.repeat(60)}${c.reset}\n\n`;

  for (const result of results) {
    const icon = result.passed ? `${c.green}✅${c.reset}` : `${c.red}❌${c.reset}`;
    output += `${icon} ${c.bold}${result.name}${c.reset}`;
    output += ` ${c.dim}(${result.duration}ms)${c.reset}\n`;

    if (!result.passed && result.errors.length > 0) {
      const showCount = options.verbose ? result.errors.length : Math.min(5, result.errors.length);
      for (let i = 0; i < showCount; i++) {
        const err = result.errors[i];
        output += `   ${c.red}•${c.reset} ${err.file || ''}`;
        if (err.line) output += `:${err.line}`;
        output += ` ${err.message}\n`;
      }
      if (result.errors.length > showCount) {
        output += `   ${c.dim}... and ${result.errors.length - showCount} more${c.reset}\n`;
      }
    }

    if (!result.passed && result.fixSuggestions.length > 0) {
      output += `   ${c.yellow}💡 Suggestions:${c.reset}\n`;
      for (const fix of result.fixSuggestions) {
        output += `      ${fix}\n`;
      }
    }

    output += '\n';
  }

  // Summary
  const summary = getSummary(results);
  output += `${c.cyan}${'─'.repeat(60)}${c.reset}\n`;

  if (summary.allPassed) {
    output += `${c.green}✅ All ${summary.total} gates passed${c.reset}`;
  } else {
    output += `${c.red}❌ ${summary.failed}/${summary.total} gates failed${c.reset}`;
  }
  output += ` ${c.dim}(${summary.duration}ms total)${c.reset}\n`;

  return output;
}

/**
 * Save results to run artifacts
 */
function saveResults(runId, results) {
  const runDir = path.join(WORKFLOW_DIR, 'runs', runId);
  if (!fs.existsSync(runDir)) {
    return false;
  }

  const artifactsDir = path.join(runDir, 'artifacts');
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(artifactsDir, 'verify-results.json'),
    JSON.stringify(getSummary(results), null, 2)
  );

  // Generate LLM context for failures
  const failures = results.filter(r => !r.passed);
  if (failures.length > 0) {
    let llmContext = '# Verification Failures\n\n';
    llmContext += 'The following verification gates failed. Please analyze and fix:\n\n';
    for (const failure of failures) {
      llmContext += failure.toLLMContext() + '\n\n---\n\n';
    }
    fs.writeFileSync(
      path.join(artifactsDir, 'verify-failures-context.md'),
      llmContext
    );
  }

  return true;
}

// Module exports
module.exports = {
  GateResult,
  runGate,
  runGates,
  getSummary,
  formatResults,
  saveResults,
  DEFAULT_GATES,
  ERROR_PARSERS
};

// CLI Handler
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
${c.cyan}Wogi Flow - Verification Gates${c.reset}

${c.bold}Usage:${c.reset}
  flow verify <gate>           Run a single gate (lint, typecheck, test, build, format)
  flow verify all              Run all configured gates
  flow verify lint typecheck   Run multiple gates

${c.bold}Options:${c.reset}
  --json                       Output results as JSON
  --verbose                    Show all errors (not just first 5)
  --stop-on-failure            Stop at first failing gate
  --quiet                      Suppress progress output
  --llm-context                Output LLM-friendly error context

${c.bold}Available Gates:${c.reset}
  lint       Run ESLint/Biome
  typecheck  Run TypeScript compiler
  test       Run test suite (Jest/Vitest)
  build      Run build script
  format     Check code formatting

${c.bold}Exit Codes:${c.reset}
  0  All gates passed
  1  One or more gates failed
  2  Configuration error
    `);
    process.exit(0);
  }

  const jsonOutput = args.includes('--json');
  const verbose = args.includes('--verbose');
  const stopOnFailure = args.includes('--stop-on-failure');
  const quiet = args.includes('--quiet') || jsonOutput;
  const llmContext = args.includes('--llm-context');

  const gateNames = args.filter(a => !a.startsWith('--'));

  if (gateNames.length === 0) {
    gateNames.push('all');
  }

  runGates(gateNames, { verbose, stopOnFailure, quiet })
    .then(results => {
      if (jsonOutput) {
        console.log(JSON.stringify(getSummary(results), null, 2));
      } else if (llmContext) {
        const failures = results.filter(r => !r.passed);
        for (const failure of failures) {
          console.log(failure.toLLMContext());
          console.log('\n---\n');
        }
      } else {
        console.log(formatResults(results, { verbose }));
      }

      const summary = getSummary(results);
      process.exit(summary.allPassed ? 0 : 1);
    })
    .catch(err => {
      console.error(`${c.red}Error: ${err.message}${c.reset}`);
      process.exit(2);
    });
}
