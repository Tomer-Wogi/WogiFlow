#!/usr/bin/env node

/**
 * WogiFlow postinstall script
 *
 * Runs after npm install to set up project structure.
 * Creates necessary directories and copies template files for fresh installs.
 * Preserves existing user data (never overwrites).
 */

const fs = require('fs');
const path = require('path');

// Directory structure
const WORKFLOW_DIR = '.workflow';
const STATE_DIR = path.join(WORKFLOW_DIR, 'state');
const CHANGES_DIR = path.join(WORKFLOW_DIR, 'changes');
const MEMORY_DIR = path.join(WORKFLOW_DIR, 'memory');
const VERIFICATIONS_DIR = path.join(WORKFLOW_DIR, 'verifications');
const SPECS_DIR = path.join(WORKFLOW_DIR, 'specs');

// Find template directory (relative to this script's location in node_modules)
function findTemplateDir() {
  // When installed via npm, templates are in the package
  const npmPath = path.join(__dirname, '..', '.workflow', 'state');
  if (fs.existsSync(npmPath)) {
    return npmPath;
  }

  // Fallback for local development
  const localPath = path.join(process.cwd(), '.workflow', 'state');
  if (fs.existsSync(localPath)) {
    return localPath;
  }

  return null;
}

// Template files to copy (without .template extension in target)
const TEMPLATES = [
  'ready.json',
  'request-log.md',
  'progress.md',
  'app-map.md',
  'decisions.md',
  'component-index.json',
  'feedback-patterns.md',
  'architecture.md',
  'stack.md',
  'testing.md',
  'session-state.json',
  'knowledge-sync.json'
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return true;
  }
  return false;
}

function createGitkeep(dir) {
  const gitkeepPath = path.join(dir, '.gitkeep');
  if (!fs.existsSync(gitkeepPath)) {
    fs.writeFileSync(gitkeepPath, '');
  }
}

function copyTemplates(templateDir) {
  let copied = 0;

  for (const file of TEMPLATES) {
    const templatePath = path.join(templateDir, `${file}.template`);
    const targetPath = path.join(STATE_DIR, file);

    // Only copy if target doesn't exist (preserve user data)
    if (!fs.existsSync(targetPath) && fs.existsSync(templatePath)) {
      try {
        fs.copyFileSync(templatePath, targetPath);
        console.log(`  \x1b[32m✓\x1b[0m Created ${file}`);
        copied++;
      } catch (err) {
        console.log(`  \x1b[33m!\x1b[0m Could not create ${file}: ${err.message}`);
      }
    }
  }

  return copied;
}

function main() {
  // Skip if running in CI or non-interactive environment
  if (process.env.CI || process.env.WOGIFLOW_SKIP_POSTINSTALL) {
    return;
  }

  console.log('\n\x1b[36mWogiFlow\x1b[0m: Setting up project structure...\n');

  // Create directory structure
  const dirsCreated = [];

  if (ensureDir(WORKFLOW_DIR)) dirsCreated.push(WORKFLOW_DIR);
  if (ensureDir(STATE_DIR)) dirsCreated.push(STATE_DIR);
  if (ensureDir(CHANGES_DIR)) dirsCreated.push(CHANGES_DIR);
  if (ensureDir(MEMORY_DIR)) dirsCreated.push(MEMORY_DIR);
  if (ensureDir(VERIFICATIONS_DIR)) dirsCreated.push(VERIFICATIONS_DIR);
  if (ensureDir(SPECS_DIR)) dirsCreated.push(SPECS_DIR);

  // Create .gitkeep files to preserve empty directories
  createGitkeep(CHANGES_DIR);
  createGitkeep(VERIFICATIONS_DIR);
  createGitkeep(SPECS_DIR);

  if (dirsCreated.length > 0) {
    console.log(`  \x1b[32m✓\x1b[0m Created directories: ${dirsCreated.join(', ')}`);
  }

  // Find and copy templates
  const templateDir = findTemplateDir();

  if (templateDir) {
    const copied = copyTemplates(templateDir);
    if (copied > 0) {
      console.log(`\n  \x1b[32m✓\x1b[0m Initialized ${copied} state files from templates`);
    }
  }

  console.log('\n\x1b[36mWogiFlow\x1b[0m: Setup complete!');
  console.log('  Run \x1b[33mflow onboard\x1b[0m to analyze your project.\n');
}

// Run
try {
  main();
} catch (err) {
  // Don't fail install on postinstall errors
  console.log(`\x1b[33mWogiFlow postinstall warning:\x1b[0m ${err.message}`);
}
