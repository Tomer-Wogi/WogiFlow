#!/usr/bin/env node

/**
 * WogiFlow Parity Check
 *
 * Verifies that all CLIs have the same features available:
 * - User commands in templates
 * - Auto-features in task execution flow
 * - CLI documentation guides
 * - Partial includes working
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// Configuration
// ============================================================

const SUPPORTED_CLIS = [
  { name: 'claude-code', template: 'claude-md.hbs', rules: 'CLAUDE.md', guide: 'claude-code.md' },
  { name: 'gemini-cli', template: 'gemini-md.hbs', rules: 'GEMINI.md', guide: 'gemini-cli.md' },
  { name: 'cursor', template: 'cursor-rules.mdc.hbs', rules: '.cursor/rules/wogiflow.mdc', guide: 'cursor.md' },
  { name: 'opencode', template: 'opencode-agents-md.hbs', rules: 'AGENTS.md', guide: 'opencode.md' },
  { name: 'codex', template: 'agents-md.hbs', rules: 'AGENTS.md', guide: 'codex.md' },
  { name: 'kimi', template: 'agents-md.hbs', rules: 'AGENTS.md', guide: 'kimi.md' }
];

const REQUIRED_PARTIALS = [
  'user-commands.hbs',
  'auto-features.hbs',
  'enforcement-rules.hbs'
];

const USER_COMMANDS = [
  'wogi-start',
  'wogi-review',
  'wogi-morning',
  'wogi-session-end',
  'wogi-peer-review',
  'wogi-hybrid',
  'wogi-ready',
  'wogi-status'
];

const AUTO_FEATURES = [
  'Component reuse',
  'Scope validation',
  'Post-edit validation',
  'Request logging',
  'App-map updates'
];

// ============================================================
// Helpers
// ============================================================

function checkFile(filePath) {
  return fs.existsSync(filePath);
}

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    return null;
  }
}

function checkPartialInclude(template, partialName) {
  // Check for {{> partial-name}} or {{>partial-name}}
  const pattern = new RegExp(`\\{\\{>\\s*${partialName.replace('.hbs', '')}\\s*\\}\\}`, 'i');
  return pattern.test(template);
}

function checkContentIncludes(content, keywords) {
  const results = {};
  for (const keyword of keywords) {
    results[keyword] = content.toLowerCase().includes(keyword.toLowerCase());
  }
  return results;
}

// ============================================================
// Checks
// ============================================================

function checkPartials(workflowDir) {
  console.log('\n=== Checking Partials ===\n');
  const partialsDir = path.join(workflowDir, 'templates', 'partials');
  let allPassed = true;

  for (const partial of REQUIRED_PARTIALS) {
    const partialPath = path.join(partialsDir, partial);
    const exists = checkFile(partialPath);
    console.log(`  ${exists ? '[PASS]' : '[FAIL]'} ${partial}`);
    if (!exists) allPassed = false;
  }

  return allPassed;
}

function checkTemplates(workflowDir) {
  console.log('\n=== Checking Templates ===\n');
  const templatesDir = path.join(workflowDir, 'templates');
  let allPassed = true;

  for (const cli of SUPPORTED_CLIS) {
    const templatePath = path.join(templatesDir, cli.template);
    const exists = checkFile(templatePath);

    if (exists) {
      const content = readFile(templatePath);
      const hasUserCommands = checkPartialInclude(content, 'user-commands');
      const hasAutoFeatures = checkPartialInclude(content, 'auto-features');
      const hasEnforcement = checkPartialInclude(content, 'enforcement-rules');

      const allIncludes = hasUserCommands && hasAutoFeatures && hasEnforcement;

      console.log(`  ${allIncludes ? '[PASS]' : '[WARN]'} ${cli.name}: ${cli.template}`);
      if (!hasUserCommands) console.log(`         Missing: {{> user-commands}}`);
      if (!hasAutoFeatures) console.log(`         Missing: {{> auto-features}}`);
      if (!hasEnforcement) console.log(`         Missing: {{> enforcement-rules}}`);
    } else {
      console.log(`  [FAIL] ${cli.name}: ${cli.template} - Template not found`);
      allPassed = false;
    }
  }

  return allPassed;
}

function checkDocumentation(workflowDir) {
  console.log('\n=== Checking CLI Documentation ===\n');
  const guidesDir = path.join(workflowDir, 'docs', 'cli-guides');
  let allPassed = true;

  // Check README
  const readmePath = path.join(guidesDir, 'README.md');
  const readmeExists = checkFile(readmePath);
  console.log(`  ${readmeExists ? '[PASS]' : '[FAIL]'} README.md`);
  if (!readmeExists) allPassed = false;

  // Check individual guides
  for (const cli of SUPPORTED_CLIS) {
    const guidePath = path.join(guidesDir, cli.guide);
    const exists = checkFile(guidePath);
    console.log(`  ${exists ? '[PASS]' : '[FAIL]'} ${cli.name}: ${cli.guide}`);
    if (!exists) allPassed = false;
  }

  return allPassed;
}

function checkBridges(projectDir) {
  console.log('\n=== Checking Bridges ===\n');
  const bridgesDir = path.join(projectDir, '.workflow', 'bridges');
  let allPassed = true;

  const bridges = [
    'claude-bridge.js',
    'gemini-bridge.js',
    'cursor-bridge.js',
    'codex-bridge.js',
    'opencode-bridge.js',
    'kimi-bridge.js'
  ];

  for (const bridge of bridges) {
    const bridgePath = path.join(bridgesDir, bridge);
    const exists = checkFile(bridgePath);

    if (exists) {
      const content = readFile(bridgePath);
      const hasPartialSupport = content.includes('registerPartials') || content.includes('processPartials');
      console.log(`  ${hasPartialSupport ? '[PASS]' : '[WARN]'} ${bridge} ${hasPartialSupport ? '(has partial support)' : '(no partial support)'}`);
    } else {
      console.log(`  [FAIL] ${bridge} - Bridge not found`);
      allPassed = false;
    }
  }

  return allPassed;
}

function checkCommandContent(workflowDir) {
  console.log('\n=== Checking User Command Coverage ===\n');
  const userCommandsPath = path.join(workflowDir, 'templates', 'partials', 'user-commands.hbs');
  const content = readFile(userCommandsPath);

  if (!content) {
    console.log('  [FAIL] Could not read user-commands.hbs');
    return false;
  }

  let allPassed = true;
  for (const cmd of USER_COMMANDS) {
    const hasCommand = content.toLowerCase().includes(cmd.toLowerCase());
    console.log(`  ${hasCommand ? '[PASS]' : '[FAIL]'} ${cmd}`);
    if (!hasCommand) allPassed = false;
  }

  return allPassed;
}

function checkAutoFeatureContent(workflowDir) {
  console.log('\n=== Checking Auto-Feature Coverage ===\n');
  const autoFeaturesPath = path.join(workflowDir, 'templates', 'partials', 'auto-features.hbs');
  const content = readFile(autoFeaturesPath);

  if (!content) {
    console.log('  [FAIL] Could not read auto-features.hbs');
    return false;
  }

  let allPassed = true;
  for (const feature of AUTO_FEATURES) {
    const hasFeature = content.toLowerCase().includes(feature.toLowerCase());
    console.log(`  ${hasFeature ? '[PASS]' : '[WARN]'} ${feature}`);
    if (!hasFeature) allPassed = false;
  }

  return allPassed;
}

// ============================================================
// Main
// ============================================================

function main() {
  const projectDir = process.cwd();
  const workflowDir = path.join(projectDir, '.workflow');

  console.log('WogiFlow Feature Parity Check');
  console.log('=============================');
  console.log(`Project: ${projectDir}`);

  // Check if .workflow exists
  if (!checkFile(workflowDir)) {
    console.log('\n[ERROR] .workflow directory not found. Is this a WogiFlow project?');
    process.exit(1);
  }

  const results = {
    partials: checkPartials(workflowDir),
    templates: checkTemplates(workflowDir),
    documentation: checkDocumentation(workflowDir),
    bridges: checkBridges(projectDir),
    userCommands: checkCommandContent(workflowDir),
    autoFeatures: checkAutoFeatureContent(workflowDir)
  };

  // Summary
  console.log('\n=== Summary ===\n');

  const categories = [
    { name: 'Partials', passed: results.partials },
    { name: 'Templates', passed: results.templates },
    { name: 'Documentation', passed: results.documentation },
    { name: 'Bridges', passed: results.bridges },
    { name: 'User Commands', passed: results.userCommands },
    { name: 'Auto-Features', passed: results.autoFeatures }
  ];

  let allPassed = true;
  for (const cat of categories) {
    console.log(`  ${cat.passed ? '[PASS]' : '[WARN]'} ${cat.name}`);
    if (!cat.passed) allPassed = false;
  }

  console.log('');
  if (allPassed) {
    console.log('All checks passed! Feature parity is complete.');
  } else {
    console.log('Some checks failed or have warnings. See details above.');
  }

  process.exit(allPassed ? 0 : 1);
}

main();
