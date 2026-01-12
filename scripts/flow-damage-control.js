#!/usr/bin/env node

/**
 * Wogi Flow - Damage Control System
 *
 * Event-based pattern matching for destructive command protection.
 * Supports multiple event types: bash, file, stop, prompt.
 *
 * Inspired by Hookify plugin patterns, adapted for multi-CLI compatibility.
 *
 * LIMITATION: The 'prompt' event type's AI analysis hook is not yet implemented.
 * Currently returns 'allow' for all prompts. See evaluatePromptWithAI() around line 734.
 * TODO: Integrate with an AI API for prompt safety evaluation.
 *
 * Usage:
 *   flow damage-control check "<command>"   Check if command is allowed
 *   flow damage-control event <type> <ctx>  Check event against rules
 *   flow damage-control status              Show damage control status
 *   flow damage-control rules               Show all rules
 *   flow dc check "rm -rf node_modules"     Shorthand
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot, colors, getConfig } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const PATTERNS_FILE = path.join(WORKFLOW_DIR, 'damage-control.yaml');

// ============================================================
// Event Types and Actions
// ============================================================

const EVENT_TYPES = ['bash', 'file', 'stop', 'prompt', 'all'];
const ACTIONS = ['block', 'warn', 'ask', 'allow'];

// Maximum allowed regex pattern length to prevent abuse
// Reduced from 500 to prevent ReDoS attacks with complex patterns
const MAX_REGEX_LENGTH = 100;

// Maximum input length to test against regex (prevents slow matching)
const MAX_INPUT_LENGTH = 10000;

/**
 * Create a RegExp safely, rejecting patterns that could cause ReDoS
 * @param {string} pattern - The regex pattern string
 * @param {string} flags - Optional regex flags
 * @returns {RegExp|null} - Compiled regex or null if unsafe/invalid
 */
function safeRegExp(pattern, flags = '') {
  // Reject overly long patterns
  if (pattern.length > MAX_REGEX_LENGTH) {
    console.error(`Regex pattern too long (${pattern.length} > ${MAX_REGEX_LENGTH}): ${pattern.substring(0, 50)}...`);
    return null;
  }

  // Check for common ReDoS patterns (nested quantifiers)
  // These patterns can cause exponential backtracking
  const redosPatterns = [
    /\([^)]*\+[^)]*\)\+/,  // (a+)+ nested quantifiers
    /\([^)]*\*[^)]*\)\+/,  // (a*)+
    /\([^)]*\+[^)]*\)\*/,  // (a+)*
    /\([^)]*\*[^)]*\)\*/,  // (a*)*
    /\([^)]*\+[^)]*\)\{/, // (a+){n}
    /\([^)]*\*[^)]*\)\{/, // (a*){n}
    /\.\*\.\*/,           // .*.* greedy wildcards
    /\.\+\.\+/,           // .+.+ greedy wildcards
    /\([^)]*\|[^)]*\)\+/, // (a|b)+ alternation with quantifier
  ];

  for (const redos of redosPatterns) {
    if (redos.test(pattern)) {
      console.error(`Potentially unsafe regex pattern (ReDoS risk): ${pattern}`);
      return null;
    }
  }

  try {
    return new RegExp(pattern, flags);
  } catch (err) {
    console.error(`Invalid regex pattern: ${pattern} - ${err.message}`);
    return null;
  }
}

/**
 * Safely test a regex against input with length limits
 * @param {RegExp} regex - The compiled regex
 * @param {string} input - The input string to test
 * @returns {boolean} - True if matches, false otherwise
 */
function safeRegexTest(regex, input) {
  if (!regex) return false;

  // Truncate overly long inputs to prevent slow matching
  const safeInput = typeof input === 'string' && input.length > MAX_INPUT_LENGTH
    ? input.substring(0, MAX_INPUT_LENGTH)
    : String(input);

  return regex.test(safeInput);
}

function log(color, ...args) {
  console.log(colors[color] + args.join(' ') + colors.reset);
}

// Commands that are always safe (read-only)
const SAFE_COMMANDS = [
  /^ls\b/,
  /^cat\b/,
  /^head\b/,
  /^tail\b/,
  /^grep\b/,
  /^rg\b/,
  /^find\b/,
  /^git\s+(status|log|diff|branch|show|remote|tag)\b/,
  /^npm\s+(test|run|list|ls|view|search|info)\b/,
  /^node\s+--check\b/,
  /^node\s+-c\b/,
  /^echo\b/,
  /^pwd\b/,
  /^which\b/,
  /^type\b/,
  /^whoami\b/,
  /^hostname\b/,
  /^date\b/,
  /^wc\b/,
  /^sort\b/,
  /^uniq\b/,
  /^diff\b/,
  /^file\b/,
  /^tree\b/,
  /^du\b/,
  /^df\b/
];

/**
 * Process YAML escape sequences in double-quoted strings
 * Handles: \\ -> \, \n -> newline, \t -> tab, \" -> "
 */
function processYamlEscapes(str) {
  return str
    .replace(/\\\\/g, '\x00')      // Temporarily replace \\ with placeholder
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\x00/g, '\\');        // Restore \\ as single \
}

/**
 * Simple YAML parser for our specific format
 * Handles: comments, key-value, arrays, nested objects with conditions
 */
function parseSimpleYaml(content) {
  const result = { rules: [], blocked: [], ask: [], paths: {} };
  const lines = content.split('\n');

  let currentSection = null;
  let currentSubSection = null;
  let currentObject = null;
  let currentConditions = null;
  let currentCondition = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Check indentation level
    const indent = line.search(/\S/);

    // Top-level key (no indent): rules:, blocked:, ask:, paths:
    if (indent === 0 && trimmed.endsWith(':')) {
      // Save any pending object
      if (currentObject && currentSection) {
        if (currentConditions) {
          currentObject.conditions = currentConditions;
          currentConditions = null;
        }
        result[currentSection].push(currentObject);
        currentObject = null;
      }

      currentSection = trimmed.slice(0, -1);
      currentSubSection = null;

      if (currentSection === 'paths' && !result.paths) {
        result.paths = {};
      } else if (!result[currentSection]) {
        result[currentSection] = [];
      }
      continue;
    }

    // Sub-section under paths (indent 2): zeroAccess:, readOnly:, noDelete:
    if (currentSection === 'paths' && indent === 2 && trimmed.endsWith(':')) {
      currentSubSection = trimmed.slice(0, -1);
      result.paths[currentSubSection] = result.paths[currentSubSection] || [];
      continue;
    }

    // Handle rules section specially (supports nested conditions array)
    if (currentSection === 'rules') {
      // New rule object (- name: xxx)
      if (indent === 2 && trimmed.startsWith('-')) {
        // Save previous rule
        if (currentObject) {
          if (currentConditions) {
            currentObject.conditions = currentConditions;
            currentConditions = null;
          }
          result.rules.push(currentObject);
        }

        const value = trimmed.slice(1).trim();
        if (value.includes(':')) {
          const colonIndex = value.indexOf(':');
          const key = value.slice(0, colonIndex).trim();
          const val = value.slice(colonIndex + 1).trim().replace(/^["']|["']$/g, '');
          currentObject = { [key]: val };
        }
        continue;
      }

      // Rule property (indent 4): event:, action:, message:
      if (currentObject && indent === 4 && trimmed.includes(':') && !trimmed.startsWith('-')) {
        const colonIndex = trimmed.indexOf(':');
        const key = trimmed.slice(0, colonIndex).trim();
        const rawVal = trimmed.slice(colonIndex + 1).trim();

        if (key === 'conditions' && rawVal === '') {
          // Start conditions array
          currentConditions = [];
          continue;
        }

        const val = rawVal.replace(/^["']|["']$/g, '');
        currentObject[key] = rawVal.startsWith('"') ? processYamlEscapes(val) : val;
        continue;
      }

      // Condition array item (indent 6): - field: xxx
      if (currentConditions !== null && indent === 6 && trimmed.startsWith('-')) {
        // Save previous condition
        if (currentCondition) {
          currentConditions.push(currentCondition);
        }

        const value = trimmed.slice(1).trim();
        if (value.includes(':')) {
          const colonIndex = value.indexOf(':');
          const key = value.slice(0, colonIndex).trim();
          const val = value.slice(colonIndex + 1).trim().replace(/^["']|["']$/g, '');
          currentCondition = { [key]: val };
        }
        continue;
      }

      // Condition property (indent 8): pattern: xxx
      if (currentCondition && indent === 8 && trimmed.includes(':')) {
        const colonIndex = trimmed.indexOf(':');
        const key = trimmed.slice(0, colonIndex).trim();
        const rawVal = trimmed.slice(colonIndex + 1).trim();
        const val = rawVal.replace(/^["']|["']$/g, '');
        currentCondition[key] = rawVal.startsWith('"') ? processYamlEscapes(val) : val;

        // Check if next line is still part of condition
        const nextLine = lines[i + 1];
        const nextIndent = nextLine ? nextLine.search(/\S/) : 0;
        if (!nextLine || nextIndent < 8 || (nextLine.trim().startsWith('-') && nextIndent <= 6)) {
          currentConditions.push(currentCondition);
          currentCondition = null;
        }
        continue;
      }

      continue;
    }

    // Array item (starts with -)
    if (trimmed.startsWith('-')) {
      const value = trimmed.slice(1).trim();

      // Check if this is a key-value pair in the array item: - pattern: "..."
      if (value.includes(':') && !value.startsWith('"') && !value.startsWith("'")) {
        // Start of an object in array - split only on first colon to preserve colons in values
        const colonIndex = value.indexOf(':');
        const key = value.slice(0, colonIndex).trim();
        const val = value.slice(colonIndex + 1).trim();
        const rawVal = val.replace(/^["']|["']$/g, '');
        currentObject = { [key]: val.startsWith('"') ? processYamlEscapes(rawVal) : rawVal };
      } else {
        // Simple string value
        const rawValue = value.replace(/^["']|["']$/g, '');
        const cleanValue = value.startsWith('"') ? processYamlEscapes(rawValue) : rawValue;

        if (currentSection === 'paths' && currentSubSection) {
          result.paths[currentSubSection].push(cleanValue);
        } else if (currentSection && currentObject === null) {
          result[currentSection].push(cleanValue);
        }
        currentObject = null;
      }
      continue;
    }

    // Continuation of object in array (indent 4+): reason: "..."
    if (currentObject && trimmed.includes(':')) {
      const colonIndex = trimmed.indexOf(':');
      const key = trimmed.slice(0, colonIndex).trim();
      const rawVal = trimmed.slice(colonIndex + 1).trim();
      const strippedVal = rawVal.replace(/^["']|["']$/g, '');
      currentObject[key] = rawVal.startsWith('"') ? processYamlEscapes(strippedVal) : strippedVal;

      // Check if next line continues this object
      const nextLine = lines[i + 1];
      const nextIndent = nextLine ? nextLine.search(/\S/) : 0;
      const nextTrimmed = nextLine ? nextLine.trim() : '';

      // If next line is a new array item or less indented, push current object
      if (!nextLine || nextIndent <= 2 || nextTrimmed.startsWith('-')) {
        if (currentSection && currentSection !== 'rules') {
          result[currentSection].push(currentObject);
        }
        currentObject = null;
      }
    }
  }

  // Don't forget the last object
  if (currentObject && currentSection === 'rules') {
    if (currentConditions) {
      currentObject.conditions = currentConditions;
    }
    result.rules.push(currentObject);
  } else if (currentObject && currentSection && currentSection !== 'rules') {
    result[currentSection].push(currentObject);
  }

  return result;
}

/**
 * Load damage control patterns from YAML file
 * Supports both new event-based format and legacy format
 */
function loadPatterns() {
  const config = getConfig();
  const dcConfig = config.damageControl || {};
  const patternsPath = dcConfig.patternsFile
    ? path.join(PROJECT_ROOT, dcConfig.patternsFile)
    : PATTERNS_FILE;

  if (!fs.existsSync(patternsPath)) {
    return {
      rules: [],
      blocked: [],
      ask: [],
      paths: { zeroAccess: [], readOnly: [], noDelete: [] }
    };
  }

  try {
    const content = fs.readFileSync(patternsPath, 'utf-8');
    const parsed = parseSimpleYaml(content);
    // Ensure rules array exists
    parsed.rules = parsed.rules || [];
    return parsed;
  } catch (err) {
    console.error('Error loading damage-control.yaml:', err.message);
    return {
      rules: [],
      blocked: [],
      ask: [],
      paths: { zeroAccess: [], readOnly: [], noDelete: [] }
    };
  }
}

// ============================================================
// Event-Based Rule Checking
// ============================================================

/**
 * Check if an event matches a rule (AND logic for conditions)
 *
 * @param {object} rule - Rule definition with event, action, conditions
 * @param {string} eventType - Event type (bash/file/stop/prompt)
 * @param {object} context - Event context
 * @returns {string|null} - Action to take or null if no match
 */
function checkEventRule(rule, eventType, context) {
  // Check event type match
  if (rule.event !== 'all' && rule.event !== eventType) {
    return null;
  }

  // If no conditions, rule matches all events of this type
  if (!rule.conditions || rule.conditions.length === 0) {
    return rule.action;
  }

  // Check all conditions (AND logic)
  for (const condition of rule.conditions) {
    const value = context[condition.field];

    if (value === undefined) {
      return null; // Field doesn't exist
    }

    const regex = safeRegExp(condition.pattern, 'i');
    if (!regex) {
      return null; // Invalid or unsafe regex, skip this condition
    }
    if (!safeRegexTest(regex, value)) {
      return null; // Condition not met
    }
  }

  // All conditions matched
  return rule.action;
}

/**
 * Main event check function - checks event against all rules
 *
 * @param {string} eventType - Event type (bash/file/stop/prompt)
 * @param {object} context - Event context
 * @returns {object} - { allowed: boolean, action: string, message: string }
 */
function checkEvent(eventType, context = {}) {
  const config = getConfig();
  const dcConfig = config.damageControl || {};

  // Check if damage control is enabled
  if (!dcConfig.enabled) {
    return { allowed: true, action: 'allow', message: 'Damage control disabled' };
  }

  // Check if this event type is enabled
  const events = dcConfig.events || { bash: true };
  if (events[eventType] === false) {
    return { allowed: true, action: 'allow', message: `Event type '${eventType}' disabled` };
  }

  const patterns = loadPatterns();

  // Check event-based rules first (new format)
  for (const rule of patterns.rules || []) {
    const action = checkEventRule(rule, eventType, context);
    if (action) {
      const result = {
        allowed: action === 'allow',
        action,
        message: rule.message || `Rule '${rule.name}' matched`,
        rule: rule.name,
      };

      // Log if configured
      if (dcConfig.logging) {
        logDamageControl(eventType, context, result);
      }

      if (action === 'block') {
        return result;
      }
      if (action === 'ask') {
        return { ...result, requiresConfirmation: true };
      }
      if (action === 'warn') {
        console.log(colors.yellow + `Warning: ${result.message}` + colors.reset);
        return { allowed: true, action: 'warn', message: result.message };
      }
    }
  }

  // Fall back to legacy patterns for bash events
  if (eventType === 'bash') {
    const cmd = context.command || '';
    const legacyResult = checkCommand(cmd);
    if (legacyResult.action !== 'allow') {
      return {
        allowed: legacyResult.action === 'allow',
        ...legacyResult,
        requiresConfirmation: legacyResult.action === 'ask'
      };
    }
  }

  // Fall back to legacy path patterns for file events
  if (eventType === 'file') {
    const filePath = context.file_path || context.filePath || '';
    const operation = context.operation || 'edit';
    const pathResult = checkPath(filePath, operation);
    if (!pathResult.allowed) {
      return {
        allowed: false,
        action: 'block',
        message: pathResult.reason,
        level: pathResult.level
      };
    }
  }

  return { allowed: true, action: 'allow', message: 'No rules matched' };
}

/**
 * Log damage control actions
 */
function logDamageControl(eventType, context, result) {
  const config = getConfig();
  const dcConfig = config.damageControl || {};

  if (!dcConfig.logging) return;

  const logDir = path.join(PROJECT_ROOT, '.workflow', 'logs');
  const logPath = path.join(logDir, 'damage-control.log');

  // Ensure log directory exists
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const timestamp = new Date().toISOString();
  const action = result.action.toUpperCase().padEnd(7);
  const contextStr = JSON.stringify(context).substring(0, 100);

  const entry = `${timestamp} | ${action} | ${eventType} | ${contextStr} | ${result.message}\n`;

  fs.appendFileSync(logPath, entry);
}

// ============================================================
// Convenience Functions for Event Checking
// ============================================================

/**
 * Check a bash command (convenience wrapper)
 */
function checkBashEvent(command) {
  return checkEvent('bash', { command });
}

/**
 * Check a file operation (convenience wrapper)
 */
function checkFileEvent(filePath, operation = 'edit', content = '') {
  return checkEvent('file', { file_path: filePath, filePath, operation, content });
}

/**
 * Check session stop (convenience wrapper)
 */
function checkStopEvent() {
  return checkEvent('stop', {});
}

/**
 * Check user prompt (convenience wrapper)
 */
function checkPromptEvent(prompt) {
  return checkEvent('prompt', { user_prompt: prompt });
}

/**
 * Check if command is safe (read-only)
 */
function isSafeCommand(cmd) {
  const normalizedCmd = cmd.trim();
  return SAFE_COMMANDS.some(pattern => pattern.test(normalizedCmd));
}

/**
 * Check command against patterns
 * Returns: { action: 'allow' | 'block' | 'ask', reason?: string }
 */
function checkCommand(cmd) {
  const config = getConfig();
  const dcConfig = config.damageControl || {};

  if (!dcConfig.enabled) {
    return { action: 'allow' };
  }

  // Skip safe commands
  if (isSafeCommand(cmd)) {
    return { action: 'allow', reason: 'Safe command' };
  }

  const patterns = loadPatterns();

  // Check blocked patterns
  for (const pattern of patterns.blocked || []) {
    const regex = safeRegExp(pattern, 'i');
    if (!regex) continue; // Skip invalid/unsafe patterns
    if (regex.test(cmd)) {
      return {
        action: 'block',
        reason: `Matches blocked pattern: ${pattern}`,
        pattern
      };
    }
  }

  // Check ask patterns
  for (const item of patterns.ask || []) {
    const pattern = typeof item === 'string' ? item : item.pattern;
    const reason = typeof item === 'object' ? item.reason : 'Matches sensitive pattern';

    const regex = safeRegExp(pattern, 'i');
    if (!regex) continue; // Skip invalid/unsafe patterns
    if (regex.test(cmd)) {
      return {
        action: 'ask',
        reason,
        pattern
      };
    }
  }

  return { action: 'allow' };
}

/**
 * Check if a path matches a pattern using proper path segment matching
 * Prevents false positives like "node_modules" matching "node_modules_backup"
 */
function pathMatchesPattern(normalizedPath, pattern) {
  // Normalize pattern too
  const normalizedPattern = pattern.replace(/\\/g, '/');

  // If pattern is an absolute path or contains path separators, do exact segment matching
  if (normalizedPattern.includes('/')) {
    // Check if the path contains the pattern as a segment sequence
    return normalizedPath.includes(normalizedPattern) &&
           (normalizedPath === normalizedPattern ||
            normalizedPath.startsWith(normalizedPattern + '/') ||
            normalizedPath.endsWith('/' + normalizedPattern) ||
            normalizedPath.includes('/' + normalizedPattern + '/'));
  }

  // For simple names (no path separator), match as directory/file name segment
  const segments = normalizedPath.split('/');
  return segments.some(segment => segment === normalizedPattern);
}

/**
 * Check if path operation is allowed
 * Returns: { allowed: boolean, reason?: string, level?: string }
 */
function checkPath(filePath, operation) {
  const config = getConfig();
  const dcConfig = config.damageControl || {};

  if (!dcConfig.enabled) {
    return { allowed: true };
  }

  const patterns = loadPatterns();
  const paths = patterns.paths || {};

  // Normalize path (handle both forward and backslashes)
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Zero access - block all operations (read, write, delete)
  for (const p of paths.zeroAccess || []) {
    if (pathMatchesPattern(normalizedPath, p)) {
      return {
        allowed: false,
        reason: `Zero access path: ${p}`,
        level: 'zeroAccess'
      };
    }
  }

  // Read-only - block write/delete
  if (operation === 'write' || operation === 'delete') {
    for (const p of paths.readOnly || []) {
      if (pathMatchesPattern(normalizedPath, p)) {
        return {
          allowed: false,
          reason: `Read-only path: ${p}`,
          level: 'readOnly'
        };
      }
    }
  }

  // No-delete - block delete only
  if (operation === 'delete') {
    for (const p of paths.noDelete || []) {
      if (pathMatchesPattern(normalizedPath, p)) {
        return {
          allowed: false,
          reason: `No-delete path: ${p}`,
          level: 'noDelete'
        };
      }
    }
  }

  return { allowed: true };
}

/**
 * AI prompt hook for unknown dangerous commands
 * Returns: { action: 'allow' | 'block' | 'ask', reason?: string }
 *
 * Note: Full implementation requires API integration.
 * This is a stub that can be enhanced with actual AI call.
 */
async function promptHookCheck(cmd) {
  const config = getConfig();
  const dcConfig = config.damageControl || {};
  const promptConfig = dcConfig.promptHook || {};

  if (!dcConfig.enabled || !promptConfig.enabled) {
    return { action: 'allow' };
  }

  // Skip if already caught by patterns
  const patternResult = checkCommand(cmd);
  if (patternResult.action !== 'allow') {
    return patternResult;
  }

  // Skip safe commands
  if (isSafeCommand(cmd)) {
    return { action: 'allow', reason: 'Safe command' };
  }

  // TODO: Implement actual AI API call
  // For now, return allow with a note
  return {
    action: 'allow',
    reason: 'Prompt hook enabled but API not yet integrated'
  };
}

/**
 * Get status of damage control system
 */
function getStatus() {
  const config = getConfig();
  const dcConfig = config.damageControl || {};
  const patterns = loadPatterns();

  return {
    enabled: dcConfig.enabled || false,
    promptHook: {
      enabled: dcConfig.promptHook?.enabled || false,
      model: dcConfig.promptHook?.model || 'haiku'
    },
    patternsFile: dcConfig.patternsFile || '.workflow/damage-control.yaml',
    events: dcConfig.events || { bash: true, file: false, stop: false, prompt: false },
    patternsLoaded: {
      rules: (patterns.rules || []).length,
      blocked: (patterns.blocked || []).length,
      ask: (patterns.ask || []).length,
      paths: {
        zeroAccess: (patterns.paths?.zeroAccess || []).length,
        readOnly: (patterns.paths?.readOnly || []).length,
        noDelete: (patterns.paths?.noDelete || []).length
      }
    },
    safeCommandPatterns: SAFE_COMMANDS.length
  };
}

// CLI handling
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (args.includes('--help') || args.includes('-h') || !command) {
    console.log(`
Wogi-Flow Damage Control

Event-based pattern matching for destructive command protection.
Supports multiple event types: bash, file, stop, prompt.

Usage:
  flow damage-control check "<command>"   Check if bash command is allowed
  flow damage-control event <type> <ctx>  Check event against all rules
  flow damage-control path "<path>" <op>  Check if path operation is allowed
  flow damage-control status              Show damage control status
  flow damage-control rules               Show all rules (event-based + legacy)

Event Types: bash, file, stop, prompt
Operations for path check: read, write, delete

Examples:
  flow dc check "rm -rf node_modules"
  flow dc check "git reset --hard"
  flow dc event bash '{"command": "rm -rf /"}'
  flow dc event file '{"file_path": ".env", "operation": "edit"}'
  flow dc path "/home/user/.ssh/id_rsa" read
  flow dc status
  flow dc rules

Configuration (config.json):
  "damageControl": {
    "enabled": false,
    "patternsFile": ".workflow/damage-control.yaml",
    "events": {
      "bash": true,
      "file": true,
      "stop": true,
      "prompt": false
    },
    "promptHook": {
      "enabled": false,
      "model": "haiku"
    },
    "logging": true
  }
`);
    process.exit(0);
  }

  switch (command) {
    case 'check': {
      const cmd = args.slice(1).join(' ');
      if (!cmd) {
        log('red', 'Error: Command to check is required');
        log('dim', 'Usage: flow dc check "<command>"');
        process.exit(1);
      }
      // Use event-based check (covers both new rules and legacy)
      const result = checkEvent('bash', { command: cmd });
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'event': {
      const eventType = args[1];
      const contextStr = args[2];
      if (!eventType || !EVENT_TYPES.includes(eventType)) {
        log('red', `Error: Event type must be one of: ${EVENT_TYPES.join(', ')}`);
        process.exit(1);
      }
      let context = {};
      if (contextStr) {
        try {
          context = JSON.parse(contextStr);
        } catch (err) {
          log('red', 'Error: Context must be valid JSON');
          process.exit(1);
        }
      }
      const result = checkEvent(eventType, context);
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.allowed ? 0 : 1);
      break;
    }

    case 'path': {
      const filePath = args[1];
      const operation = args[2] || 'read';
      if (!filePath) {
        log('red', 'Error: Path is required');
        log('dim', 'Usage: flow dc path "<path>" <operation>');
        process.exit(1);
      }
      const result = checkPath(filePath, operation);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'status': {
      const status = getStatus();
      console.log('');
      log('cyan', 'Damage Control Status');
      console.log('');
      log('white', `  Enabled: ${status.enabled ? colors.green + 'Yes' : colors.yellow + 'No'}${colors.reset}`);
      log('white', `  Prompt Hook: ${status.promptHook.enabled ? colors.green + 'Yes' : colors.dim + 'No'}${colors.reset}`);
      log('white', `  Patterns File: ${status.patternsFile}`);
      console.log('');
      log('cyan', 'Event Types:');
      log('white', `  bash: ${status.events.bash ? colors.green + 'ON' : colors.dim + 'OFF'}${colors.reset}`);
      log('white', `  file: ${status.events.file ? colors.green + 'ON' : colors.dim + 'OFF'}${colors.reset}`);
      log('white', `  stop: ${status.events.stop ? colors.green + 'ON' : colors.dim + 'OFF'}${colors.reset}`);
      log('white', `  prompt: ${status.events.prompt ? colors.green + 'ON' : colors.dim + 'OFF'}${colors.reset}`);
      console.log('');
      log('cyan', 'Rules Loaded:');
      log('white', `  Event Rules: ${status.patternsLoaded.rules}`);
      log('white', `  Legacy Blocked: ${status.patternsLoaded.blocked}`);
      log('white', `  Legacy Ask: ${status.patternsLoaded.ask}`);
      log('white', `  Zero Access Paths: ${status.patternsLoaded.paths.zeroAccess}`);
      log('white', `  Read-Only Paths: ${status.patternsLoaded.paths.readOnly}`);
      log('white', `  No-Delete Paths: ${status.patternsLoaded.paths.noDelete}`);
      log('white', `  Safe Command Patterns: ${status.safeCommandPatterns}`);
      console.log('');

      if (!status.enabled) {
        log('dim', 'To enable: Set damageControl.enabled to true in config.json');
      }
      break;
    }

    case 'patterns':
    case 'rules': {
      const patterns = loadPatterns();
      console.log('');

      // Show event-based rules first (new format)
      if (patterns.rules && patterns.rules.length > 0) {
        log('cyan', 'Event-Based Rules:');
        for (const rule of patterns.rules) {
          const eventColor = rule.event === 'all' ? 'cyan' : 'yellow';
          const actionColor = rule.action === 'block' ? 'red' : rule.action === 'warn' ? 'yellow' : 'green';
          log(eventColor, `  [${rule.event}] ${rule.name}`);
          log(actionColor, `    Action: ${rule.action}`);
          if (rule.conditions && rule.conditions.length > 0) {
            log('dim', '    Conditions:');
            for (const c of rule.conditions) {
              log('dim', `      ${c.field}: /${c.pattern}/`);
            }
          }
          if (rule.message) {
            log('dim', `    Message: ${rule.message}`);
          }
        }
        console.log('');
      }

      // Show legacy patterns
      log('cyan', 'Legacy Blocked Patterns:');
      (patterns.blocked || []).forEach(p => log('red', `  - ${p}`));
      console.log('');
      log('cyan', 'Legacy Ask Patterns:');
      (patterns.ask || []).forEach(p => {
        if (typeof p === 'object') {
          log('yellow', `  - ${p.pattern}`);
          log('dim', `    Reason: ${p.reason}`);
        } else {
          log('yellow', `  - ${p}`);
        }
      });
      console.log('');
      log('cyan', 'Protected Paths:');
      log('white', '  Zero Access:');
      (patterns.paths?.zeroAccess || []).forEach(p => log('red', `    - ${p}`));
      log('white', '  Read-Only:');
      (patterns.paths?.readOnly || []).forEach(p => log('yellow', `    - ${p}`));
      log('white', '  No-Delete:');
      (patterns.paths?.noDelete || []).forEach(p => log('yellow', `    - ${p}`));
      break;
    }

    default:
      log('red', `Unknown command: ${command}`);
      log('dim', 'Run: flow dc --help for usage');
      process.exit(1);
  }
}

// Export for use by other modules
module.exports = {
  // Event-based checking (new)
  checkEvent,
  checkEventRule,
  checkBashEvent,
  checkFileEvent,
  checkStopEvent,
  checkPromptEvent,
  EVENT_TYPES,
  ACTIONS,
  // Legacy functions (still supported)
  loadPatterns,
  parseSimpleYaml,
  isSafeCommand,
  checkCommand,
  checkPath,
  promptHookCheck,
  getStatus,
  SAFE_COMMANDS,
  // Regex safety utilities (for use by other modules)
  safeRegExp,
  safeRegexTest,
  MAX_REGEX_LENGTH,
  MAX_INPUT_LENGTH
};
