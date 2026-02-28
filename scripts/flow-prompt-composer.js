#!/usr/bin/env node

/**
 * Wogi Flow - Prompt Composer
 *
 * Assembles prompt fragments into complete prompts tailored
 * to specific models and CLIs.
 *
 * Part of Phase 2: Multi-Model Core
 *
 * Usage:
 *   flow prompt-compose --model claude-sonnet-4 --task-type feature
 *   flow prompt-compose --model gemini-2-flash --domain api
 *   flow prompt-compose --list-fragments
 */

const fs = require('fs');
const path = require('path');
const {
  PROJECT_ROOT,
  parseFlags,
  outputJson,
  color,
  info,
  warn,
  error,
  fileExists,
  dirExists,
  printHeader,
  printSection,
  isPathWithinProject,
  estimateTokens
} = require('./flow-utils');

// Smart Context System integration
let sectionResolver = null;
let contextGatherer = null;
let instructionRichness = null;

try {
  sectionResolver = require('./flow-section-resolver');
  contextGatherer = require('./flow-context-gatherer');
  instructionRichness = require('./flow-instruction-richness');
} catch (err) {
  // Smart Context modules not available, will use traditional approach
}

// ============================================================
// Constants
// ============================================================

const FRAGMENTS_DIR = path.join(PROJECT_ROOT, '.workflow', 'prompts', 'fragments');
const COMPOSED_DIR = path.join(PROJECT_ROOT, '.workflow', 'prompts', 'composed');

// Model to CLI mapping (Claude Code only)
const MODEL_CLI_MAP = {
  'claude-opus-4-6': 'claude-code',
  'claude-opus-4-5': 'claude-code',
  'claude-sonnet-4-5': 'claude-code',
  'claude-sonnet-4': 'claude-code',
  'claude-haiku-3-5': 'claude-code'
};

// ============================================================
// Fragment Loading
// ============================================================

/**
 * Parse fragment front matter
 * @param {string} content - Fragment file content
 * @returns {Object} Parsed fragment with metadata and content
 */
function parseFragment(content) {
  const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontMatterMatch) {
    return {
      metadata: {},
      content: content.trim(),
      _parseErrors: []
    };
  }

  const frontMatter = frontMatterMatch[1];
  const body = frontMatterMatch[2].trim();

  // Parse YAML-like front matter with error tracking
  const metadata = {};
  const parseErrors = [];

  try {
    for (const line of frontMatter.split('\n')) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) {
        // Skip empty lines silently, warn about malformed lines
        if (line.trim() && !line.trim().startsWith('#')) {
          parseErrors.push(`Malformed line (no colon): "${line.slice(0, 50)}"`);
        }
        continue;
      }

      const key = line.slice(0, colonIndex).trim();
      if (!key) {
        parseErrors.push(`Empty key in line: "${line.slice(0, 50)}"`);
        continue;
      }

      let value = line.slice(colonIndex + 1).trim();

      // Parse arrays
      if (value.startsWith('[') && value.endsWith(']')) {
        try {
          value = value.slice(1, -1).split(',').map(v => v.trim());
        } catch {
          parseErrors.push(`Failed to parse array for key "${key}"`);
          continue;
        }
      }
      // Parse numbers
      else if (/^\d+$/.test(value)) {
        value = parseInt(value, 10);
      }

      metadata[key] = value;
    }
  } catch (err) {
    parseErrors.push(`Unexpected error: ${err.message}`);
  }

  // Log warnings for parse errors
  if (parseErrors.length > 0) {
    warn(`Fragment parse warnings: ${parseErrors.join('; ')}`);
  }

  return { metadata, content: body, _parseErrors: parseErrors };
}

/**
 * Load all fragments from directory
 * @returns {Object[]} Array of loaded fragments
 */
function loadFragments() {
  if (!dirExists(FRAGMENTS_DIR)) {
    return [];
  }

  const fragments = [];

  let files;
  try {
    files = fs.readdirSync(FRAGMENTS_DIR).filter(f => f.endsWith('.md'));
  } catch (err) {
    warn(`Could not read fragments directory: ${err.message}`);
    return [];
  }

  for (const file of files) {
    const filePath = path.join(FRAGMENTS_DIR, file);

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = parseFragment(content);

      fragments.push({
        file,
        path: filePath,
        ...parsed
      });
    } catch (err) {
      warn(`Could not read fragment ${file}: ${err.message}`);
      // Continue with other fragments
    }
  }

  return fragments;
}

/**
 * Filter fragments for a specific model and context
 * @param {Object[]} fragments - All fragments
 * @param {Object} filter - Filter criteria
 * @returns {Object[]} Filtered and sorted fragments
 */
function filterFragments(fragments, filter) {
  const { model, cli, domain, purpose } = filter;

  return fragments.filter(f => {
    const meta = f.metadata;

    // Check model compatibility
    if (meta.models && meta.models !== 'all') {
      const models = Array.isArray(meta.models) ? meta.models : [meta.models];
      if (!models.includes(model) && !models.includes('all')) {
        return false;
      }
    }

    // Check CLI compatibility
    if (meta.cli && meta.cli !== 'all') {
      const clis = Array.isArray(meta.cli) ? meta.cli : [meta.cli];
      if (!clis.includes(cli) && !clis.includes('all')) {
        return false;
      }
    }

    // Check domain if specified
    if (domain && meta.domain && meta.domain !== domain) {
      return false;
    }

    // Check purpose if specified
    if (purpose && meta.purpose && meta.purpose !== purpose) {
      return false;
    }

    return true;
  }).sort((a, b) => {
    // Sort by order (lower first)
    const orderA = a.metadata.order || 50;
    const orderB = b.metadata.order || 50;
    return orderA - orderB;
  });
}

// ============================================================
// Prompt Composition
// ============================================================

/**
 * Compose prompt from fragments
 * @param {Object} params - Composition parameters
 * @returns {Object} Composed prompt
 */
function composePrompt(params) {
  const {
    model,
    taskType = 'feature',
    domain = null,
    taskData = null,
    includeCore = true
  } = params;

  // Get CLI for model
  const cli = MODEL_CLI_MAP[model] || 'claude-code';

  // Load and filter fragments
  const allFragments = loadFragments();
  const filtered = filterFragments(allFragments, {
    model,
    cli,
    domain
  });

  // Separate by purpose (single pass)
  const byPurpose = filtered.reduce((acc, f) => {
    const key = f.metadata.purpose;
    if (acc[key]) acc[key].push(f);
    return acc;
  }, { core: [], quality: [], domain: [], formatting: [] });
  const { core: coreFragments, quality: qualityFragments, domain: domainFragments, formatting: formatFragments } = byPurpose;

  // Build sections
  const sections = [];

  // Core context
  if (includeCore && coreFragments.length > 0) {
    sections.push({
      name: 'Task Context',
      fragments: coreFragments
    });
  }

  // Quality guidelines
  if (qualityFragments.length > 0) {
    sections.push({
      name: 'Quality Guidelines',
      fragments: qualityFragments
    });
  }

  // Domain-specific
  if (domainFragments.length > 0) {
    sections.push({
      name: 'Domain Guidelines',
      fragments: domainFragments
    });
  }

  // Output format (model-specific)
  if (formatFragments.length > 0) {
    sections.push({
      name: 'Output Format',
      fragments: formatFragments
    });
  }

  // Compose full prompt
  let fullPrompt = '';

  for (const section of sections) {
    for (const fragment of section.fragments) {
      fullPrompt += fragment.content + '\n\n';
    }
  }

  // Apply template substitution if task data provided
  if (taskData) {
    fullPrompt = applyTemplate(fullPrompt, taskData);
  }

  return {
    model,
    cli,
    domain,
    taskType,
    sections: sections.map(s => ({
      name: s.name,
      fragments: s.fragments.map(f => f.metadata.id || f.file)
    })),
    fragmentCount: filtered.length,
    prompt: fullPrompt.trim(),
    tokenEstimate: Math.ceil(fullPrompt.length / 4) // Rough estimate
  };
}

/**
 * Apply handlebars-like template substitution
 * @param {string} template - Template string
 * @param {Object} data - Data to substitute
 * @returns {string} Processed string
 */
function applyTemplate(template, data) {
  // Guard against null/undefined data
  if (!data || typeof data !== 'object') {
    return template;
  }

  // Guard against null/undefined template
  if (!template || typeof template !== 'string') {
    return template || '';
  }

  // Forbidden keys to prevent prototype pollution (case-insensitive)
  const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

  // Simple substitution: {{key}} or {{object.key}}
  return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const keys = path.trim().split('.');
    let value = data;

    for (const key of keys) {
      // Prevent prototype pollution attacks (case-insensitive check)
      const keyLower = key.toLowerCase();
      if (FORBIDDEN_KEYS.has(keyLower)) return match;
      if (value === undefined || value === null) return match;
      // Only access own properties
      if (!Object.prototype.hasOwnProperty.call(value, key)) return match;
      value = value[key];
    }

    if (Array.isArray(value)) {
      return value.join('\n');
    }

    return value !== undefined ? String(value) : match;
  });
}

// ============================================================
// Smart Context Composition (Section-Level)
// ============================================================

/**
 * Compose prompt with section-level context (Smart Context System)
 * Instead of including full files, uses targeted section references.
 *
 * @param {Object} params - Composition parameters
 * @returns {Promise<Object>} Composed prompt with section context
 */
async function composeWithSections(params) {
  const {
    model,
    taskDescription,
    taskType = 'feature',
    domain = null,
    taskData = null,
    includeCore = true,
    maxTokens = null
  } = params;

  // Check if Smart Context is available
  if (!sectionResolver || !contextGatherer) {
    // Fall back to traditional composition
    return composePrompt({
      model,
      taskType,
      domain,
      taskData,
      includeCore
    });
  }

  // Get model preferences for context density
  const modelPrefs = instructionRichness
    ? instructionRichness.getModelContextPreferences(model)
    : { density: 'standard', explicitExamples: true, patternHints: true };

  // Gather relevant sections using Smart Context
  const contextResult = await contextGatherer.gatherContext({
    task: taskDescription,
    model,
    maxTokens,
    format: modelPrefs.density === 'concise' ? 'summary' : 'full'
  });

  // Get CLI for model
  const cli = MODEL_CLI_MAP[model] || 'claude-code';

  // Build sections array for traditional fragment composition
  const allFragments = loadFragments();
  const filtered = filterFragments(allFragments, { model, cli, domain });

  // Compose sections
  const sections = [];

  // 1. Smart Context sections (from decisions.md, app-map.md, etc.)
  if (contextResult.sections && contextResult.sections.length > 0) {
    sections.push({
      name: 'Project Rules (Targeted)',
      content: formatSectionsForPrompt(contextResult.sections, modelPrefs),
      fragments: contextResult.sections.map(s => s.id)
    });
  }

  // 2. Traditional fragments (quality guidelines, domain, formatting) — single pass
  const fragsByPurpose = filtered.reduce((acc, f) => {
    const key = f.metadata.purpose;
    if (acc[key]) acc[key].push(f);
    return acc;
  }, { quality: [], domain: [], formatting: [] });
  const { quality: qualityFragments, domain: domainFragments, formatting: formatFragments } = fragsByPurpose;

  if (qualityFragments.length > 0) {
    sections.push({
      name: 'Quality Guidelines',
      content: qualityFragments.map(f => f.content).join('\n\n'),
      fragments: qualityFragments.map(f => f.metadata.id || f.file)
    });
  }

  if (domainFragments.length > 0) {
    sections.push({
      name: 'Domain Guidelines',
      content: domainFragments.map(f => f.content).join('\n\n'),
      fragments: domainFragments.map(f => f.metadata.id || f.file)
    });
  }

  if (formatFragments.length > 0) {
    sections.push({
      name: 'Output Format',
      content: formatFragments.map(f => f.content).join('\n\n'),
      fragments: formatFragments.map(f => f.metadata.id || f.file)
    });
  }

  // 3. Core task context (if requested)
  if (includeCore && taskData) {
    const coreFragments = filtered.filter(f => f.metadata.purpose === 'core');
    if (coreFragments.length > 0) {
      let coreContent = coreFragments.map(f => f.content).join('\n\n');
      coreContent = applyTemplate(coreContent, taskData);
      sections.push({
        name: 'Task Context',
        content: coreContent,
        fragments: coreFragments.map(f => f.metadata.id || f.file)
      });
    }
  }

  // Compose full prompt
  let fullPrompt = '';
  for (const section of sections) {
    if (section.content) {
      fullPrompt += `## ${section.name}\n\n${section.content}\n\n`;
    }
  }

  // Apply template substitution if task data provided
  if (taskData) {
    fullPrompt = applyTemplate(fullPrompt, taskData);
  }

  return {
    model,
    cli,
    domain,
    taskType,
    usedSmartContext: true,
    modelDensity: modelPrefs.density,
    sections: sections.map(s => ({
      name: s.name,
      fragments: s.fragments
    })),
    smartContextStats: contextResult.stats,
    fragmentCount: filtered.length,
    sectionCount: contextResult.sections?.length || 0,
    prompt: fullPrompt.trim(),
    tokenEstimate: estimateTokens ? estimateTokens(fullPrompt) : Math.ceil(fullPrompt.length / 4)
  };
}

/**
 * Format sections for inclusion in prompt based on model preferences
 * @param {Object[]} sections - Sections from Smart Context
 * @param {Object} modelPrefs - Model context preferences
 * @returns {string} Formatted section content
 */
function formatSectionsForPrompt(sections, modelPrefs) {
  if (!sections || sections.length === 0) return '';

  const lines = [];

  for (const section of sections) {
    const source = section.source || 'decisions.md';
    const category = section.category || 'General';

    if (modelPrefs.patternHints && !modelPrefs.explicitExamples) {
      // Concise format: Just reference the rule
      lines.push(`### ${section.title}`);
      lines.push(`*From: ${source} > ${category}*`);
      // First line or two as a hint
      const firstLines = section.content?.split('\n').slice(0, 2).join(' ').trim() || '';
      if (firstLines) {
        lines.push(firstLines);
      }
      lines.push('');
    } else {
      // Full format: Include complete content
      lines.push(`### ${section.title}`);
      lines.push(`*From: ${source} > ${category}*`);
      lines.push('');
      if (section.content) {
        lines.push(section.content);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Compose prompt with automatic format selection
 * Uses Smart Context when available and task description provided,
 * falls back to traditional fragment-based composition otherwise.
 *
 * @param {Object} params - Composition parameters
 * @returns {Promise<Object>} Composed prompt
 */
async function composePromptAuto(params) {
  const { taskDescription, useSmartContext = true } = params;

  // Use Smart Context if available and task description provided
  if (useSmartContext && taskDescription && sectionResolver && contextGatherer) {
    return composeWithSections(params);
  }

  // Fall back to traditional composition
  return composePrompt(params);
}

// ============================================================
// CLI Output
// ============================================================

/**
 * List all available fragments
 */
function listFragments() {
  const fragments = loadFragments();

  printHeader('PROMPT FRAGMENTS');

  if (fragments.length === 0) {
    info('No fragments found in ' + FRAGMENTS_DIR);
    return;
  }

  // Group by purpose
  const byPurpose = {};
  for (const f of fragments) {
    const purpose = f.metadata.purpose || 'other';
    if (!byPurpose[purpose]) byPurpose[purpose] = [];
    byPurpose[purpose].push(f);
  }

  for (const [purpose, frags] of Object.entries(byPurpose)) {
    printSection(purpose.charAt(0).toUpperCase() + purpose.slice(1));

    for (const f of frags) {
      const models = f.metadata.models === 'all' ? 'all' :
        (Array.isArray(f.metadata.models) ? f.metadata.models.join(', ') : f.metadata.models);
      console.log(`  ${color('cyan', f.metadata.id || f.file)}`);
      console.log(`    Models: ${models}`);
      console.log(`    Order: ${f.metadata.order || 50}`);
      if (f.metadata.description) {
        console.log(`    ${f.metadata.description}`);
      }
      console.log('');
    }
  }
}

/**
 * Print composed prompt summary
 * @param {Object} composed - Composed prompt result
 */
function printComposed(composed) {
  printHeader('COMPOSED PROMPT');

  printSection('Configuration');
  console.log(`  Model: ${color('cyan', composed.model)}`);
  console.log(`  CLI: ${composed.cli}`);
  if (composed.domain) {
    console.log(`  Domain: ${composed.domain}`);
  }
  console.log(`  Task Type: ${composed.taskType}`);

  printSection('Sections');
  for (const section of composed.sections) {
    console.log(`  ${section.name}:`);
    for (const frag of section.fragments) {
      console.log(`    - ${frag}`);
    }
  }

  printSection('Stats');
  console.log(`  Fragments: ${composed.fragmentCount}`);
  console.log(`  Estimated tokens: ~${composed.tokenEstimate.toLocaleString()}`);

  if (composed.prompt) {
    printSection('Preview (first 500 chars)');
    console.log(`  ${composed.prompt.slice(0, 500)}...`);
  }

  console.log('');
}

// ============================================================
// Main
// ============================================================

async function main() {
  const { positional, flags } = parseFlags(process.argv.slice(2));

  // List fragments mode
  if (flags['list-fragments'] || positional[0] === 'list') {
    listFragments();
    return;
  }

  // Compose prompt
  const model = flags.model || 'claude-sonnet-4';
  const taskType = flags['task-type'] || flags.type || 'feature';
  const domain = flags.domain || null;

  const composed = composePrompt({
    model,
    taskType,
    domain,
    includeCore: true
  });

  // Output
  if (flags.json) {
    outputJson({
      success: true,
      ...composed
    });
  } else {
    printComposed(composed);
  }

  // Optionally save to file
  if (flags.output) {
    const outputPath = path.isAbsolute(flags.output)
      ? flags.output
      : path.join(PROJECT_ROOT, flags.output);

    // Validate path is within project to prevent path traversal
    if (!isPathWithinProject(outputPath)) {
      error('Output path must be within project directory');
      process.exit(1);
    }

    fs.writeFileSync(outputPath, composed.prompt);
    info(`Saved to: ${outputPath}`);
  }
}

// Export for use by other scripts
module.exports = {
  // Traditional composition
  composePrompt,
  loadFragments,
  filterFragments,
  parseFragment,
  applyTemplate,
  MODEL_CLI_MAP,
  // Smart Context composition
  composeWithSections,
  composePromptAuto,
  formatSectionsForPrompt
};

if (require.main === module) {
  main().catch(err => {
    error(err.message);
    process.exit(1);
  });
}
