#!/usr/bin/env node

/**
 * Wogi Flow - Health Check
 *
 * Verifies workflow files are in sync and properly configured.
 */

const path = require('path');
const {
  PATHS,
  PROJECT_ROOT,
  fileExists,
  dirExists,
  validateJson,
  countAppMapComponents,
  countRequestLogEntries,
  getLastRequestLogEntry,
  getGitStatus,
  countFiles,
  color,
  printSection,
  success,
  warn,
  error
} = require('./flow-utils');

function main() {
  console.log(color('cyan', 'Wogi Flow Health Check'));
  console.log('========================');
  console.log('');

  let issues = 0;
  let warnings = 0;

  // Check required files
  printSection('Checking required files...');

  const requiredFiles = [
    { path: PATHS.config, name: '.workflow/config.json' },
    { path: PATHS.ready, name: '.workflow/state/ready.json' },
    { path: PATHS.requestLog, name: '.workflow/state/request-log.md' },
    { path: PATHS.appMap, name: '.workflow/state/app-map.md' },
    { path: PATHS.decisions, name: '.workflow/state/decisions.md' },
    { path: PATHS.progress, name: '.workflow/state/progress.md' },
  ];

  for (const file of requiredFiles) {
    if (fileExists(file.path)) {
      console.log(`  ${color('green', '✓')} ${file.name}`);
    } else {
      console.log(`  ${color('red', '✗')} ${file.name} - MISSING`);
      issues++;
    }
  }

  // Check CLI-specific rules file
  let cliType = 'claude-code'; // default
  if (fileExists(PATHS.config)) {
    try {
      const config = require(PATHS.config);
      cliType = config.cli?.type || 'claude-code';
    } catch {}
  }

  const rulesFiles = {
    'claude-code': { path: path.join(PROJECT_ROOT, 'CLAUDE.md'), name: 'CLAUDE.md' },
    'gemini-cli': { path: path.join(PROJECT_ROOT, 'GEMINI.md'), name: 'GEMINI.md' },
    'opencode': { path: path.join(PROJECT_ROOT, '.opencode', 'config.json'), name: '.opencode/config.json' }
  };

  const rulesFile = rulesFiles[cliType] || rulesFiles['claude-code'];
  if (fileExists(rulesFile.path)) {
    console.log(`  ${color('green', '✓')} ${rulesFile.name} (${cliType})`);
  } else {
    console.log(`  ${color('red', '✗')} ${rulesFile.name} - MISSING (${cliType})`);
    issues++;
  }

  // Check required directories
  console.log('');
  printSection('Checking directories...');

  const requiredDirs = [
    { path: PATHS.components, name: '.workflow/state/components' },
    { path: PATHS.specs, name: '.workflow/specs' },
    { path: PATHS.changes, name: '.workflow/changes' },
    { path: PATHS.bugs, name: '.workflow/bugs' },
    { path: PATHS.archive, name: '.workflow/archive' },
    { path: path.join(PROJECT_ROOT, 'agents'), name: 'agents' },
    { path: path.join(PROJECT_ROOT, 'scripts'), name: 'scripts' },
  ];

  for (const dir of requiredDirs) {
    if (dirExists(dir.path)) {
      console.log(`  ${color('green', '✓')} ${dir.name}/`);
    } else {
      console.log(`  ${color('red', '✗')} ${dir.name}/ - MISSING`);
      issues++;
    }
  }

  // Check universal structure directories (optional but recommended)
  console.log('');
  printSection('Checking universal structure...');

  const universalDirs = [
    { path: path.join(PROJECT_ROOT, '.workflow', 'models'), name: '.workflow/models' },
    { path: path.join(PROJECT_ROOT, '.workflow', 'bridges'), name: '.workflow/bridges' },
    { path: path.join(PROJECT_ROOT, '.workflow', 'templates'), name: '.workflow/templates' },
  ];

  for (const dir of universalDirs) {
    if (dirExists(dir.path)) {
      console.log(`  ${color('green', '✓')} ${dir.name}/`);
    } else {
      console.log(`  ${color('yellow', '○')} ${dir.name}/ - not found (run 'flow migrate' to add)`);
      warnings++;
    }
  }

  // Check model registry
  const registryPath = path.join(PROJECT_ROOT, '.workflow', 'models', 'registry.json');
  if (fileExists(registryPath)) {
    const result = validateJson(registryPath);
    if (result.valid) {
      console.log(`  ${color('green', '✓')} Model registry valid`);
    } else {
      console.log(`  ${color('red', '✗')} Model registry invalid JSON`);
      issues++;
    }
  }

  // Validate config.json
  console.log('');
  printSection('Validating config.json...');

  if (fileExists(PATHS.config)) {
    const result = validateJson(PATHS.config);
    if (result.valid) {
      console.log(`  ${color('green', '✓')} Valid JSON`);
    } else {
      console.log(`  ${color('red', '✗')} Invalid JSON syntax`);
      issues++;
    }
  }

  // Validate ready.json
  console.log('');
  printSection('Validating ready.json...');

  if (fileExists(PATHS.ready)) {
    const result = validateJson(PATHS.ready);
    if (result.valid) {
      console.log(`  ${color('green', '✓')} Valid JSON`);
    } else {
      console.log(`  ${color('red', '✗')} Invalid JSON syntax`);
      issues++;
    }
  }

  // Check enforcement settings
  console.log('');
  printSection('Checking enforcement...');

  const claudeMdPath = path.join(PROJECT_ROOT, 'CLAUDE.md');
  if (fileExists(claudeMdPath)) {
    const fs = require('fs');
    const claudeMdContent = fs.readFileSync(claudeMdPath, 'utf-8');
    const claudeMdSize = fs.statSync(claudeMdPath).size;
    const sizeKb = Math.round(claudeMdSize / 1024);

    // Check CLAUDE.md size (should be under 20KB for reliable loading)
    if (sizeKb <= 20) {
      console.log(`  ${color('green', '✓')} CLAUDE.md size: ${sizeKb}KB (under 20KB limit)`);
    } else {
      console.log(`  ${color('yellow', '⚠')} CLAUDE.md size: ${sizeKb}KB (over 20KB - may get truncated)`);
      warnings++;
    }

    // Check if enforcement section is at top (within first 100 lines)
    const lines = claudeMdContent.split('\n').slice(0, 100);
    const hasEnforcementAtTop = lines.some(line =>
      line.includes('MANDATORY') && line.includes('Task Gating')
    );

    if (hasEnforcementAtTop) {
      console.log(`  ${color('green', '✓')} Enforcement section: FOUND at top of CLAUDE.md`);
    } else {
      console.log(`  ${color('yellow', '⚠')} Enforcement section not found at top of CLAUDE.md`);
      warnings++;
    }
  }

  // Check strict mode in config
  if (fileExists(PATHS.config)) {
    const configResult = validateJson(PATHS.config);
    if (configResult.valid) {
      const config = JSON.parse(require('fs').readFileSync(PATHS.config, 'utf-8'));
      if (config.enforcement?.strictMode === true) {
        console.log(`  ${color('green', '✓')} Strict mode: ENABLED`);
      } else if (config.enforcement?.strictMode === false) {
        console.log(`  ${color('yellow', '⚠')} Strict mode: DISABLED (Claude may skip task creation)`);
        warnings++;
      } else {
        console.log(`  ${color('yellow', '⚠')} Strict mode: NOT CONFIGURED (add enforcement section to config.json)`);
        warnings++;
      }
    }
  }

  // Check app-map sync
  console.log('');
  printSection('Checking app-map sync...');

  const srcComponents = path.join(PROJECT_ROOT, 'src', 'components');
  if (dirExists(srcComponents)) {
    const componentCount = countFiles(srcComponents, ['.tsx', '.jsx']);
    const mappedCount = countAppMapComponents();

    console.log(`  Components in src/: ${componentCount}`);
    console.log(`  Components in app-map: ${mappedCount}`);

    if (componentCount > mappedCount + 5) {
      console.log(`  ${color('yellow', '⚠')} App-map may be out of sync`);
      console.log('    Run: ./scripts/flow update-map scan src/components');
      warnings++;
    } else {
      console.log(`  ${color('green', '✓')} App-map appears in sync`);
    }
  } else {
    console.log(`  ${color('yellow', '⚠')} src/components/ not found (may be OK for new projects)`);
  }

  // Check git status
  console.log('');
  printSection('Checking git status...');

  const git = getGitStatus();
  if (git.isRepo) {
    if (git.clean) {
      console.log(`  ${color('green', '✓')} Working directory clean`);
    } else {
      console.log(`  ${color('yellow', '⚠')} ${git.uncommitted} uncommitted changes`);
      warnings++;
    }
  } else {
    console.log(`  ${color('yellow', '⚠')} Not a git repository`);
    warnings++;
  }

  // Check request-log
  console.log('');
  printSection('Checking request-log...');

  if (fileExists(PATHS.requestLog)) {
    const entryCount = countRequestLogEntries();
    console.log(`  Total entries: ${entryCount}`);

    if (entryCount > 0) {
      const lastEntry = getLastRequestLogEntry();
      if (lastEntry) {
        console.log(`  Last entry: ${lastEntry}`);
      }
    }
  }

  // Check agents
  console.log('');
  printSection('Checking agents...');

  const agentsDir = path.join(PROJECT_ROOT, 'agents');
  const coreAgents = ['orchestrator', 'developer', 'reviewer', 'tester'];
  const optionalAgents = ['accessibility', 'security', 'performance', 'docs', 'design-system', 'onboarding'];

  for (const agent of coreAgents) {
    const agentPath = path.join(agentsDir, `${agent}.md`);
    if (fileExists(agentPath)) {
      console.log(`  ${color('green', '✓')} ${agent}.md`);
    } else {
      console.log(`  ${color('red', '✗')} ${agent}.md - MISSING (core agent)`);
      issues++;
    }
  }

  for (const agent of optionalAgents) {
    const agentPath = path.join(agentsDir, `${agent}.md`);
    if (fileExists(agentPath)) {
      console.log(`  ${color('green', '✓')} ${agent}.md (optional)`);
    }
  }

  // Summary
  console.log('');
  console.log('========================');

  if (issues === 0 && warnings === 0) {
    console.log(color('green', '✓ Workflow is healthy!'));
  } else if (issues === 0) {
    console.log(color('yellow', `⚠ ${warnings} warning(s), but no critical issues`));
  } else {
    console.log(color('red', `✗ ${issues} issue(s), ${warnings} warning(s)`));
    console.log('');
    console.log("Run './scripts/flow init' to fix missing files");
  }

  process.exit(issues > 0 ? 1 : 0);
}

main();
