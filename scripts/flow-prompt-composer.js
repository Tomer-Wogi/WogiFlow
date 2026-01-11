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
  printSection
} = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

const FRAGMENTS_DIR = path.join(PROJECT_ROOT, '.workflow', 'prompts', 'fragments');
const COMPOSED_DIR = path.join(PROJECT_ROOT, '.workflow', 'prompts', 'composed');

// Model to CLI mapping
const MODEL_CLI_MAP = {
  'claude-opus-4-5': 'claude-code',
  'claude-sonnet-4': 'claude-code',
  'claude-haiku-3-5': 'claude-code',
  'gpt-4o': null,
  'gemini-2-flash': 'gemini-cli'
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
      content: content.trim()
    };
  }

  const frontMatter = frontMatterMatch[1];
  const body = frontMatterMatch[2].trim();

  // Parse YAML-like front matter
  const metadata = {};
  for (const line of frontMatter.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();

    // Parse arrays
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map(v => v.trim());
    }
    // Parse numbers
    else if (/^\d+$/.test(value)) {
      value = parseInt(value, 10);
    }

    metadata[key] = value;
  }

  return { metadata, content: body };
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
  const files = fs.readdirSync(FRAGMENTS_DIR).filter(f => f.endsWith('.md'));

  for (const file of files) {
    const filePath = path.join(FRAGMENTS_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseFragment(content);

    fragments.push({
      file,
      path: filePath,
      ...parsed
    });
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

  // Separate by purpose
  const coreFragments = filtered.filter(f => f.metadata.purpose === 'core');
  const qualityFragments = filtered.filter(f => f.metadata.purpose === 'quality');
  const domainFragments = filtered.filter(f => f.metadata.purpose === 'domain');
  const formatFragments = filtered.filter(f => f.metadata.purpose === 'formatting');

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
  // Simple substitution: {{key}} or {{object.key}}
  return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const keys = path.trim().split('.');
    let value = data;

    for (const key of keys) {
      if (value === undefined || value === null) return match;
      value = value[key];
    }

    if (Array.isArray(value)) {
      return value.join('\n');
    }

    return value !== undefined ? String(value) : match;
  });
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
    fs.writeFileSync(outputPath, composed.prompt);
    info(`Saved to: ${outputPath}`);
  }
}

// Export for use by other scripts
module.exports = {
  composePrompt,
  loadFragments,
  filterFragments,
  parseFragment,
  applyTemplate,
  MODEL_CLI_MAP
};

if (require.main === module) {
  main().catch(err => {
    error(err.message);
    process.exit(1);
  });
}
