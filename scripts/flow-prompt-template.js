#!/usr/bin/env node

/**
 * Wogi Flow - Prompt Template Engine
 *
 * Loads structured YAML prompt templates and fills variables
 * for model-specific prompt composition.
 *
 * Templates are form-filling patterns: the orchestrator populates
 * {variables} with task-specific context. Each model gets instructions
 * tailored to its strengths and limitations.
 *
 * Part of S4: Hybrid Mode + Prompt Templates
 */

const fs = require('fs');
const path = require('path');
const {
  getConfig,
  PATHS,
  fileExists
} = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

const TEMPLATES_DIR = path.join(PATHS.root, '.workflow', 'templates', 'prompts');

// Model family to template file mapping
const MODEL_TEMPLATE_MAP = {
  opus: 'opus.yaml',
  sonnet: 'sonnet.yaml',
  haiku: 'haiku.yaml',
  gpt4o: 'gpt4o.yaml',
  'gpt-4o': 'gpt4o.yaml',
  'gemini-flash': 'gemini-flash.yaml',
  'gemini-2-flash': 'gemini-flash.yaml'
};

// Blocked keys for security (prototype pollution prevention)
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// ============================================================
// YAML Parser (lightweight, no dependency)
// ============================================================

/**
 * Parse a simple YAML template file.
 * Supports: scalars, lists, multi-line strings (|).
 * Does NOT support full YAML spec — just what our templates need.
 *
 * @param {string} content - YAML file content
 * @returns {Object} Parsed object
 */
function parseSimpleYaml(content) {
  const result = {};
  const lines = content.split('\n');
  let currentKey = null;
  let currentSection = null;
  let currentList = null;
  let indentLevel = 0;
  let multilineValue = '';
  let inMultiline = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip comments and empty lines at top level
    if (!inMultiline && (line.trim().startsWith('#') || line.trim() === '')) {
      continue;
    }

    // Multi-line string collection
    if (inMultiline) {
      const lineIndent = line.search(/\S/);
      if (lineIndent > indentLevel || line.trim() === '') {
        multilineValue += (multilineValue ? '\n' : '') + line.trimEnd();
        continue;
      } else {
        // End of multi-line block
        if (currentSection && currentKey) {
          if (!result[currentSection]) result[currentSection] = {};
          result[currentSection][currentKey] = multilineValue.trim();
        } else if (currentKey) {
          result[currentKey] = multilineValue.trim();
        }
        inMultiline = false;
        multilineValue = '';
      }
    }

    // Top-level key: value
    const topMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (topMatch) {
      const key = topMatch[1];
      const value = topMatch[2].trim();

      if (BLOCKED_KEYS.has(key)) continue;

      currentSection = null;
      currentList = null;

      if (value === '' || value === '|') {
        // Start of nested section or multi-line
        if (value === '|') {
          currentKey = key;
          indentLevel = 2;
          inMultiline = true;
          multilineValue = '';
        } else {
          currentSection = key;
          result[key] = result[key] || {};
        }
      } else {
        result[key] = value;
        currentKey = key;
      }
      continue;
    }

    // Nested key: value (2-space indent)
    const nestedMatch = line.match(/^  (\w[\w-]*)\s*:\s*(.*)$/);
    if (nestedMatch && currentSection) {
      const key = nestedMatch[1];
      const value = nestedMatch[2].trim();

      if (BLOCKED_KEYS.has(key)) continue;

      currentList = null;
      currentKey = key;

      if (value === '|') {
        indentLevel = 4;
        inMultiline = true;
        multilineValue = '';
      } else if (value === '') {
        // Could be a list starting next
        if (!result[currentSection]) result[currentSection] = {};
        result[currentSection][key] = '';
      } else {
        if (!result[currentSection]) result[currentSection] = {};
        result[currentSection][key] = value;
      }
      continue;
    }

    // List item (indented with -)
    const listMatch = line.match(/^    - (.+)$/);
    if (listMatch && currentSection && currentKey) {
      if (!result[currentSection]) result[currentSection] = {};
      if (!Array.isArray(result[currentSection][currentKey])) {
        result[currentSection][currentKey] = [];
      }
      result[currentSection][currentKey].push(listMatch[1].trim());
      continue;
    }
  }

  // Flush any remaining multi-line value
  if (inMultiline && multilineValue) {
    if (currentSection && currentKey) {
      if (!result[currentSection]) result[currentSection] = {};
      result[currentSection][currentKey] = multilineValue.trim();
    } else if (currentKey) {
      result[currentKey] = multilineValue.trim();
    }
  }

  return result;
}

// ============================================================
// Template Loading
// ============================================================

/**
 * Load a prompt template for a given model.
 *
 * @param {string} modelFamily - Model family name (opus, sonnet, haiku, gpt4o, gemini-flash)
 * @returns {Object|null} Parsed template or null
 */
function loadTemplate(modelFamily) {
  const templateFile = MODEL_TEMPLATE_MAP[modelFamily];
  if (!templateFile) return null;

  const templatePath = path.join(TEMPLATES_DIR, templateFile);

  try {
    if (!fs.existsSync(templatePath)) return null;
    const content = fs.readFileSync(templatePath, 'utf-8');
    return parseSimpleYaml(content);
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[prompt-template] Failed to load ${templateFile}: ${err.message}`);
    }
    return null;
  }
}

/**
 * List all available prompt templates.
 *
 * @returns {string[]} Available model families
 */
function listTemplates() {
  try {
    if (!fs.existsSync(TEMPLATES_DIR)) return [];
    return fs.readdirSync(TEMPLATES_DIR)
      .filter((f) => f.endsWith('.yaml'))
      .map((f) => f.replace('.yaml', ''));
  } catch (err) {
    return [];
  }
}

// ============================================================
// Variable Substitution
// ============================================================

/**
 * Substitute {variables} in a template string.
 * Blocks access to prototype pollution keys.
 *
 * @param {string} text - Template string with {variable} placeholders
 * @param {Object} variables - Key-value pairs to substitute
 * @returns {string} Substituted string
 */
function substituteVariables(text, variables) {
  if (!text || typeof text !== 'string') return text || '';
  if (!variables || typeof variables !== 'object') return text;

  return text.replace(/\{(\w+)\}/g, (match, key) => {
    if (BLOCKED_KEYS.has(key)) return match;
    if (!Object.prototype.hasOwnProperty.call(variables, key)) return match;
    return String(variables[key] || '');
  });
}

/**
 * Apply variables to all sections of a template.
 *
 * @param {Object} template - Parsed template
 * @param {Object} variables - Variables to substitute
 * @returns {Object} Template with variables applied
 */
function applyVariables(template, variables) {
  if (!template) return null;

  const result = {};

  for (const [key, value] of Object.entries(template)) {
    if (BLOCKED_KEYS.has(key)) continue;

    if (typeof value === 'string') {
      result[key] = substituteVariables(value, variables);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === 'string' ? substituteVariables(item, variables) : item
      );
    } else if (typeof value === 'object' && value !== null) {
      result[key] = applyVariables(value, variables);
    } else {
      result[key] = value;
    }
  }

  return result;
}

// ============================================================
// Prompt Composition
// ============================================================

/**
 * Compose a full prompt from a template and variables.
 *
 * @param {string} modelFamily - Model family (opus, sonnet, haiku, etc.)
 * @param {Object} variables - Variables to fill in the template
 * @returns {string} Composed prompt string
 */
function composePrompt(modelFamily, variables) {
  const template = loadTemplate(modelFamily);
  if (!template) {
    // Fallback: return a simple prompt without template
    return variables.task_description || '';
  }

  const filled = applyVariables(template, variables);
  const sections = filled.sections || {};

  const parts = [];

  // Build prompt from sections in order
  if (sections.role) parts.push(sections.role);
  if (sections.task) parts.push(`## Task\n${sections.task}`);
  if (sections.context) parts.push(`## Context\n${sections.context}`);
  if (sections.constraints) parts.push(`## Constraints\n${sections.constraints}`);
  if (sections.output_format) parts.push(`## Output Format\n${sections.output_format}`);
  if (sections.guidelines) parts.push(`## Guidelines\n${sections.guidelines}`);

  // Do/Don't lists
  if (sections.do && Array.isArray(sections.do)) {
    parts.push(`## Do\n${sections.do.map((d) => `- ${d}`).join('\n')}`);
  }
  if (sections.dont && Array.isArray(sections.dont)) {
    parts.push(`## Don't\n${sections.dont.map((d) => `- ${d}`).join('\n')}`);
  }

  return parts.join('\n\n');
}

/**
 * Get the Agent tool model parameter for a given task type.
 * Maps task types to Claude Code Agent model strings.
 *
 * @param {string} taskType - Task type (explore, review, research, architecture, etc.)
 * @param {Object} [options] - Additional options
 * @param {boolean} [options.checkCapabilities] - Check YAML capability scores
 * @returns {string} Agent model parameter value (opus, sonnet, haiku)
 */
function getAgentModel(taskType, options = {}) {
  const config = getConfig();

  // If hybrid mode is disabled, return null (no routing — Claude Code uses its own model)
  if (!config.hybrid?.enabled) {
    return null;
  }

  // Routing table: task type → Agent model parameter
  const routingTable = {
    // Premium tier — complex reasoning
    architecture: 'opus',
    planning: 'opus',
    'complex-reasoning': 'opus',
    judging: 'opus',

    // Standard tier — implementation and analysis
    explore: 'sonnet',
    research: 'sonnet',
    'code-review': 'sonnet',
    feature: 'sonnet',
    bugfix: 'sonnet',
    refactor: 'sonnet',
    test: 'sonnet',
    implementation: 'sonnet',

    // Economy tier — simple tasks
    search: 'haiku',
    lookup: 'haiku',
    classification: 'haiku',
    summary: 'haiku',
    compaction: 'haiku',
    boilerplate: 'haiku',
    docs: 'haiku',
    metadata: 'haiku'
  };

  // Check config overrides
  const overrides = config.hybrid?.routing?.overrides || {};
  if (overrides[taskType]) {
    return overrides[taskType];
  }

  const model = routingTable[taskType] || 'sonnet';

  // Capability check: if selected model scores below threshold for this task type,
  // escalate to next tier
  if (options.checkCapabilities) {
    const threshold = config.hybrid?.routing?.capabilityThreshold || 5;
    const capScore = getCapabilityScore(model, taskType);
    if (capScore > 0 && capScore < threshold) {
      // Escalate
      if (model === 'haiku') return 'sonnet';
      if (model === 'sonnet') return 'opus';
    }
  }

  return model;
}

/**
 * Get capability score for a model/task-type combination from YAML files.
 *
 * @param {string} modelFamily - Model family (opus, sonnet, haiku)
 * @param {string} taskType - Task type
 * @returns {number} Score 0-10, or 0 if not found
 */
function getCapabilityScore(modelFamily, taskType) {
  const capDir = path.join(PATHS.root, '.workflow', 'models', 'capabilities');

  // Map model family to capability file
  const fileMap = {
    opus: 'claude-opus-4-6.yaml',
    sonnet: 'claude-sonnet-4-6.yaml',
    haiku: 'claude-haiku-3-5.yaml'
  };

  const fileName = fileMap[modelFamily];
  if (!fileName) return 0;

  const filePath = path.join(capDir, fileName);
  try {
    if (!fs.existsSync(filePath)) return 0;
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseSimpleYaml(content);
    const scores = parsed.taskScores || {};

    // Map common task types to YAML capability file keys
    // YAML keys: simple-edit, multi-file-refactor, architecture, code-generation,
    //            documentation, debugging, test-generation, bugfix
    const keyMap = {
      explore: 'simple-edit',
      research: 'debugging',
      'code-review': 'debugging',
      feature: 'code-generation',
      bugfix: 'bugfix',
      refactor: 'multi-file-refactor',
      architecture: 'architecture',
      test: 'test-generation',
      search: 'simple-edit',
      lookup: 'simple-edit',
      classification: 'simple-edit',
      summary: 'documentation',
      docs: 'documentation',
      boilerplate: 'simple-edit',
      implementation: 'code-generation',
      planning: 'architecture',
      'complex-reasoning': 'architecture',
      judging: 'debugging',
      compaction: 'documentation',
      metadata: 'simple-edit'
    };

    const capKey = keyMap[taskType] || taskType;
    const score = parseInt(scores[capKey], 10);
    return isNaN(score) ? 0 : score;
  } catch (err) {
    return 0;
  }
}

// ============================================================
// CLI
// ============================================================

function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'list':
      console.log('Available templates:', listTemplates().join(', '));
      break;

    case 'compose': {
      const model = args[0];
      const taskDesc = args[1] || 'Example task';
      if (!model) {
        console.error('Usage: flow-prompt-template.js compose <model> [task]');
        process.exit(1);
      }
      const prompt = composePrompt(model, {
        task_type: 'feature',
        task_description: taskDesc,
        languages: 'JavaScript',
        frameworks: 'Node.js',
        context: '(context would be inserted here)',
        additional_constraints: '',
        output_format: 'Return the implementation code.'
      });
      console.log(prompt);
      break;
    }

    case 'route': {
      const taskType = args[0] || 'feature';
      const model = getAgentModel(taskType, { checkCapabilities: true });
      console.log(`Task type "${taskType}" → Agent model: "${model}"`);
      break;
    }

    default:
      console.log(`
Prompt Template Engine

Usage: flow-prompt-template.js <command> [args]

Commands:
  list                      List available templates
  compose <model> [task]    Compose a prompt from template
  route <taskType>          Get Agent model for a task type

Templates are in .workflow/templates/prompts/
`);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  TEMPLATES_DIR,
  MODEL_TEMPLATE_MAP,
  parseSimpleYaml,
  loadTemplate,
  listTemplates,
  substituteVariables,
  applyVariables,
  composePrompt,
  getAgentModel,
  getCapabilityScore
};

if (require.main === module) {
  main();
}
