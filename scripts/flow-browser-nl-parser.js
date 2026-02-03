#!/usr/bin/env node

/**
 * Wogi Flow - Natural Language to Browser Actions Parser
 *
 * Converts natural language descriptions like "click Login, expect dashboard"
 * into structured browser actions for the debug loop.
 *
 * Supports:
 * - Action verbs: click, type, fill, press, submit, wait, scroll
 * - Expectations: expect, see, verify, should, check
 * - Target resolution: text, selectors, app-map components
 *
 * Usage:
 *   flow browser-nl-parse "click Login, expect to see dashboard"
 *   flow browser-nl-parse --json "type email into login form, click submit"
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot, getConfig, color, safeJsonParse } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();

// ============================================================
// Action Verb Patterns
// ============================================================

const ACTION_PATTERNS = {
  click: {
    verbs: ['click', 'press', 'tap', 'hit', 'select', 'choose'],
    pattern: /(?:click|press|tap|hit|select|choose)\s+(?:on\s+)?(?:the\s+)?["']?([^"',]+)["']?/i,
    type: 'click'
  },
  type: {
    verbs: ['type', 'enter', 'input', 'fill', 'write'],
    pattern: /(?:type|enter|input|fill|write)\s+["']?([^"']+)["']?\s+(?:in(?:to)?|in the)\s+["']?([^"',]+)["']?/i,
    type: 'type',
    extractValue: true
  },
  navigate: {
    verbs: ['go', 'navigate', 'visit', 'open'],
    pattern: /(?:go\s+to|navigate\s+to|visit|open)\s+["']?([^"',]+)["']?/i,
    type: 'navigate'
  },
  wait: {
    verbs: ['wait', 'pause'],
    pattern: /(?:wait|pause)\s+(?:for\s+)?(?:(\d+)\s*(?:ms|seconds?|s)?\s*(?:for\s+)?)?["']?([^"',]*)["']?/i,
    type: 'wait'
  },
  scroll: {
    verbs: ['scroll'],
    pattern: /scroll\s+(?:to\s+)?(?:the\s+)?["']?([^"',]+)["']?/i,
    type: 'scroll'
  },
  submit: {
    verbs: ['submit'],
    pattern: /submit\s+(?:the\s+)?(?:form|["']?([^"',]*)["']?)?/i,
    type: 'submit'
  },
  hover: {
    verbs: ['hover', 'mouseover'],
    pattern: /(?:hover|mouse\s*over)\s+(?:over\s+)?(?:the\s+)?["']?([^"',]+)["']?/i,
    type: 'hover'
  }
};

const EXPECTATION_PATTERNS = {
  visible: {
    verbs: ['expect', 'see', 'should see', 'verify', 'check', 'confirm'],
    pattern: /(?:expect|see|should\s+see|verify|check|confirm)\s+(?:that\s+)?(?:the\s+)?["']?([^"',]+)["']?(?:\s+(?:is\s+)?(?:visible|displayed|shown|appears?))?/i,
    type: 'visible'
  },
  contains: {
    verbs: ['contains', 'has', 'shows', 'displays'],
    pattern: /(?:contains?|has|shows?|displays?)\s+(?:the\s+)?(?:text\s+)?["']?([^"',]+)["']?/i,
    type: 'contains'
  },
  notVisible: {
    verbs: ['not see', 'should not see', 'hidden', 'gone', 'disappeared'],
    pattern: /(?:not\s+see|should\s+not\s+see|(?:is\s+)?hidden|gone|disappeared?)\s+(?:the\s+)?["']?([^"',]+)["']?/i,
    type: 'not_visible'
  },
  url: {
    verbs: ['url', 'redirected', 'on page'],
    pattern: /(?:url\s+(?:is|should\s+be)|redirected\s+to|on\s+(?:the\s+)?page)\s+["']?([^"',]+)["']?/i,
    type: 'url'
  }
};

// ============================================================
// Target Resolution
// ============================================================

/**
 * Load app-map for component resolution
 * @returns {object|null} - Parsed app-map or null
 */
function loadAppMap() {
  const appMapPath = path.join(PROJECT_ROOT, '.workflow', 'state', 'app-map.md');
  if (!fs.existsSync(appMapPath)) return null;

  try {
    const content = fs.readFileSync(appMapPath, 'utf-8');
    return parseAppMap(content);
  } catch (err) {
    return null;
  }
}

/**
 * Parse app-map markdown to extract components
 * @param {string} content - App-map markdown content
 * @returns {object} - Parsed components by name
 */
function parseAppMap(content) {
  const components = {};
  const lines = content.split('\n');

  let currentSection = null;
  let currentComponent = null;

  for (const line of lines) {
    // Section headers
    if (line.startsWith('## ')) {
      currentSection = line.replace('## ', '').trim().toLowerCase();
      continue;
    }

    // Component entries (typically as list items or table rows)
    const listMatch = line.match(/^-\s+\*\*([^*]+)\*\*\s*[:-]?\s*(.*)/);
    if (listMatch) {
      const [_, name, description] = listMatch;
      components[name.toLowerCase()] = {
        name,
        description,
        section: currentSection,
        selectors: extractSelectorsFromDescription(description)
      };
    }

    // Table row format: | ComponentName | path | description |
    const tableMatch = line.match(/^\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]*)\s*\|/);
    if (tableMatch && !line.includes('---')) {
      const [_, name, filePath, description] = tableMatch;
      if (name.trim() && !name.includes('Component')) { // Skip header row
        components[name.trim().toLowerCase()] = {
          name: name.trim(),
          path: filePath.trim(),
          description: description?.trim(),
          section: currentSection
        };
      }
    }
  }

  return components;
}

/**
 * Extract potential selectors from component description
 * @param {string} description - Component description
 * @returns {Array} - Potential selectors
 */
function extractSelectorsFromDescription(description) {
  const selectors = [];

  // Look for class names (.class-name)
  const classMatches = description.match(/\.[\w-]+/g);
  if (classMatches) selectors.push(...classMatches);

  // Look for IDs (#id)
  const idMatches = description.match(/#[\w-]+/g);
  if (idMatches) selectors.push(...idMatches);

  // Look for data-testid
  const testIdMatches = description.match(/data-testid=["']([^"']+)["']/g);
  if (testIdMatches) selectors.push(...testIdMatches);

  return selectors;
}

/**
 * Resolve a text target to potential selectors
 * @param {string} target - Target text (e.g., "Login button", "email field")
 * @param {object} appMap - Loaded app-map
 * @returns {object} - Resolution result
 */
function resolveTarget(target, appMap = null) {
  const normalized = target.toLowerCase().trim();

  // Check app-map first
  if (appMap) {
    for (const [key, component] of Object.entries(appMap)) {
      if (normalized.includes(key) || key.includes(normalized)) {
        return {
          type: 'component',
          name: component.name,
          confidence: 'high',
          selectors: component.selectors || [],
          suggestedSelector: component.selectors?.[0] || `[data-testid="${component.name}"]`
        };
      }
    }
  }

  // Common UI element patterns
  const elementPatterns = [
    { pattern: /button/i, tag: 'button', role: 'button' },
    { pattern: /link/i, tag: 'a', role: 'link' },
    { pattern: /input|field|textbox/i, tag: 'input', role: 'textbox' },
    { pattern: /checkbox/i, tag: 'input[type="checkbox"]', role: 'checkbox' },
    { pattern: /dropdown|select/i, tag: 'select', role: 'combobox' },
    { pattern: /form/i, tag: 'form', role: 'form' },
    { pattern: /heading|title/i, tag: 'h1,h2,h3,h4,h5,h6', role: 'heading' },
    { pattern: /image|img|picture/i, tag: 'img', role: 'img' },
    { pattern: /table/i, tag: 'table', role: 'table' },
    { pattern: /row/i, tag: 'tr', role: 'row' },
    { pattern: /modal|dialog/i, tag: '[role="dialog"]', role: 'dialog' },
    { pattern: /menu/i, tag: '[role="menu"]', role: 'menu' },
    { pattern: /tab/i, tag: '[role="tab"]', role: 'tab' }
  ];

  // Find matching element pattern
  for (const ep of elementPatterns) {
    if (ep.pattern.test(normalized)) {
      // Extract the descriptive part (e.g., "Login" from "Login button")
      const descriptivePart = normalized.replace(ep.pattern, '').trim();

      return {
        type: 'element',
        elementType: ep.tag.split(',')[0].split('[')[0],
        confidence: 'medium',
        selectors: [
          // Try text content match
          `${ep.tag}:contains("${descriptivePart || target}")`,
          // Try aria-label
          `${ep.tag}[aria-label*="${descriptivePart || target}"]`,
          // Try role with name
          `[role="${ep.role}"][name*="${descriptivePart || target}"]`,
          // Try data-testid
          `[data-testid*="${descriptivePart?.replace(/\s+/g, '-') || target.replace(/\s+/g, '-')}"]`
        ],
        suggestedSelector: `button:contains("${descriptivePart || target}")`
      };
    }
  }

  // Fallback: treat as text to find
  return {
    type: 'text',
    text: target,
    confidence: 'low',
    selectors: [
      `:contains("${target}")`,
      `[aria-label*="${target}"]`,
      `[title*="${target}"]`,
      `[placeholder*="${target}"]`
    ],
    suggestedSelector: `:contains("${target}")`,
    note: 'Target will be found by visible text - use specific selector if available'
  };
}

// ============================================================
// Natural Language Parsing
// ============================================================

/**
 * Parse a natural language description into structured actions
 * @param {string} input - Natural language description
 * @param {object} options - Parsing options
 * @returns {object} - Parsed result with actions and expectations
 */
function parseNaturalLanguage(input, options = {}) {
  const appMap = options.useAppMap !== false ? loadAppMap() : null;

  // Split by common delimiters (commas, "then", "and then", newlines)
  const parts = input
    .split(/[,\n]|\s+then\s+|\s+and\s+then\s+/i)
    .map(p => p.trim())
    .filter(Boolean);

  const result = {
    original: input,
    actions: [],
    expectations: [],
    unrecognized: [],
    appMapUsed: !!appMap
  };

  for (const part of parts) {
    const parsed = parsePart(part, appMap);

    if (parsed.type === 'action') {
      result.actions.push(parsed);
    } else if (parsed.type === 'expectation') {
      result.expectations.push(parsed);
    } else {
      result.unrecognized.push({ text: part, reason: 'Could not identify action or expectation' });
    }
  }

  return result;
}

/**
 * Parse a single part of the input
 * @param {string} part - Single phrase to parse
 * @param {object} appMap - Loaded app-map
 * @returns {object} - Parsed action/expectation
 */
function parsePart(part, appMap) {
  // Try action patterns first
  for (const [actionName, config] of Object.entries(ACTION_PATTERNS)) {
    // Check if any verb matches
    const hasVerb = config.verbs.some(v => part.toLowerCase().includes(v));
    if (!hasVerb) continue;

    const match = part.match(config.pattern);
    if (match) {
      const action = {
        type: 'action',
        actionType: config.type,
        original: part,
        confidence: 'medium'
      };

      if (config.extractValue && match[1] && match[2]) {
        // Type action: value and target
        action.value = match[1];
        action.target = resolveTarget(match[2], appMap);
      } else if (match[1]) {
        // Single target
        action.target = resolveTarget(match[1], appMap);
      }

      return action;
    }
  }

  // Try expectation patterns
  for (const [expName, config] of Object.entries(EXPECTATION_PATTERNS)) {
    const hasVerb = config.verbs.some(v => part.toLowerCase().includes(v));
    if (!hasVerb) continue;

    const match = part.match(config.pattern);
    if (match) {
      return {
        type: 'expectation',
        expectationType: config.type,
        original: part,
        target: match[1] ? resolveTarget(match[1], appMap) : null,
        confidence: 'medium'
      };
    }
  }

  // Unrecognized
  return {
    type: 'unknown',
    original: part
  };
}

/**
 * Convert parsed result to browser flow steps
 * @param {object} parsed - Result from parseNaturalLanguage
 * @returns {Array} - Flow steps for browser executor
 */
function toFlowSteps(parsed) {
  const steps = [];

  // Convert actions
  for (const action of parsed.actions) {
    const step = {
      action: action.actionType,
      description: action.original
    };

    if (action.target?.suggestedSelector) {
      step.selector = action.target.suggestedSelector;
      step.targetText = action.target.text || action.target.name;
    }

    if (action.value) {
      step.value = action.value;
    }

    if (action.actionType === 'navigate' && action.target?.text) {
      step.url = action.target.text;
    }

    steps.push(step);
  }

  // Convert expectations to verify steps
  for (const exp of parsed.expectations) {
    const step = {
      action: 'verify',
      description: exp.original
    };

    if (exp.target?.suggestedSelector) {
      step.selector = exp.target.suggestedSelector;
    }

    switch (exp.expectationType) {
      case 'visible':
        step.exists = true;
        break;
      case 'not_visible':
        step.exists = false;
        break;
      case 'contains':
        step.contains = exp.target?.text;
        break;
      case 'url':
        step.action = 'verify-url';
        step.expectedUrl = exp.target?.text;
        break;
    }

    steps.push(step);
  }

  return steps;
}

/**
 * Format parsed result for display
 * @param {object} parsed - Parsed result
 * @returns {string} - Formatted output
 */
function formatParsedResult(parsed) {
  const lines = [];

  lines.push(color('cyan', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  lines.push(color('cyan', '🗣️ Natural Language Parser'));
  lines.push(color('cyan', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  lines.push('');
  lines.push(`Input: "${parsed.original}"`);
  lines.push(`App-map: ${parsed.appMapUsed ? 'loaded' : 'not found'}`);
  lines.push('');

  if (parsed.actions.length > 0) {
    lines.push(color('yellow', 'Actions:'));
    parsed.actions.forEach((a, i) => {
      lines.push(`  ${i + 1}. [${a.actionType.toUpperCase()}] ${a.original}`);
      if (a.target) {
        lines.push(`     Target: ${a.target.name || a.target.text || a.target.suggestedSelector}`);
        lines.push(`     Confidence: ${a.target.confidence}`);
      }
      if (a.value) {
        lines.push(`     Value: "${a.value}"`);
      }
    });
    lines.push('');
  }

  if (parsed.expectations.length > 0) {
    lines.push(color('green', 'Expectations:'));
    parsed.expectations.forEach((e, i) => {
      lines.push(`  ${i + 1}. [${e.expectationType.toUpperCase()}] ${e.original}`);
      if (e.target) {
        lines.push(`     Target: ${e.target.name || e.target.text || e.target.suggestedSelector}`);
      }
    });
    lines.push('');
  }

  if (parsed.unrecognized.length > 0) {
    lines.push(color('red', 'Unrecognized:'));
    parsed.unrecognized.forEach(u => {
      lines.push(`  ⚠️ "${u.text}"`);
    });
    lines.push('');
  }

  // Show generated flow steps
  const steps = toFlowSteps(parsed);
  if (steps.length > 0) {
    lines.push(color('cyan', 'Generated Flow Steps:'));
    steps.forEach((s, i) => {
      lines.push(`  ${i + 1}. ${s.action}: ${s.selector || s.url || s.description}`);
    });
  }

  return lines.join('\n');
}

// ============================================================
// CLI
// ============================================================

function showHelp() {
  console.log(`
${color('cyan', 'Wogi Flow - Natural Language to Browser Actions Parser')}

Usage:
  flow browser-nl-parse "description"     Parse natural language
  flow browser-nl-parse --json "desc"     Output as JSON
  flow browser-nl-parse --steps "desc"    Output as flow steps only

Examples:
  flow browser-nl-parse "click Login, expect to see dashboard"
  flow browser-nl-parse "type hello into search box, press Enter"
  flow browser-nl-parse "navigate to /settings, verify Settings header is visible"

Supported Actions:
  - click, press, tap, select
  - type, enter, fill, input
  - navigate, go to, visit, open
  - wait, pause
  - scroll to
  - hover over

Supported Expectations:
  - expect, see, should see, verify
  - contains, has, shows
  - not see, hidden, gone
  - url is, redirected to
`);
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp();
    return;
  }

  const jsonOutput = args.includes('--json');
  const stepsOnly = args.includes('--steps');

  // Get the input (everything that's not a flag)
  const input = args.filter(a => !a.startsWith('--')).join(' ');

  if (!input) {
    console.error('Please provide a description to parse');
    process.exit(1);
  }

  const parsed = parseNaturalLanguage(input);

  if (jsonOutput) {
    console.log(JSON.stringify(parsed, null, 2));
  } else if (stepsOnly) {
    const steps = toFlowSteps(parsed);
    console.log(JSON.stringify(steps, null, 2));
  } else {
    console.log(formatParsedResult(parsed));
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  parseNaturalLanguage,
  parsePart,
  resolveTarget,
  toFlowSteps,
  formatParsedResult,
  loadAppMap,
  ACTION_PATTERNS,
  EXPECTATION_PATTERNS
};

if (require.main === module) {
  main();
}
