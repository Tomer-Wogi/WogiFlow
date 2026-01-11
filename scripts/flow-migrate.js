#!/usr/bin/env node

/**
 * flow-migrate.js - Migrate existing projects to universal structure
 *
 * Migrates Claude Code-only projects to the new CLI-agnostic structure:
 * - Backs up original files
 * - Moves skills from .claude/skills/ to .workflow/skills/
 * - Creates model registry from existing config
 * - Sets up CLI bridge configuration
 * - Optionally runs bridge sync
 *
 * Usage:
 *   flow migrate              - Interactive migration
 *   flow migrate --dry-run    - Show what would be done
 *   flow migrate --force      - Skip confirmation
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Colors
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  reset: '\x1b[0m'
};

const PROJECT_ROOT = process.cwd();
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const CLAUDE_DIR = path.join(PROJECT_ROOT, '.claude');
const CONFIG_PATH = path.join(WORKFLOW_DIR, 'config.json');
const BACKUP_DIR = path.join(WORKFLOW_DIR, 'backup');

// Parse args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');

/**
 * Check if migration is needed
 */
function checkMigrationNeeded() {
  const checks = {
    hasWorkflow: fs.existsSync(WORKFLOW_DIR),
    hasClaudeDir: fs.existsSync(CLAUDE_DIR),
    hasConfig: fs.existsSync(CONFIG_PATH),
    hasModels: fs.existsSync(path.join(WORKFLOW_DIR, 'models')),
    hasBridges: fs.existsSync(path.join(WORKFLOW_DIR, 'bridges')),
    hasCliConfig: false,
    hasOldSkills: fs.existsSync(path.join(CLAUDE_DIR, 'skills'))
  };

  // Check if config has CLI section
  if (checks.hasConfig) {
    try {
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      checks.hasCliConfig = !!config.cli;
    } catch {}
  }

  return checks;
}

/**
 * Print migration plan
 */
function printMigrationPlan(checks) {
  console.log(`${colors.bold}Migration Plan:${colors.reset}`);
  console.log('');

  const steps = [];

  // Step 1: Create backup
  steps.push({
    action: 'Create backup',
    description: 'Backup existing config and skills before migration',
    needed: true
  });

  // Step 2: Create models directory
  if (!checks.hasModels) {
    steps.push({
      action: 'Create models directory',
      description: 'Create .workflow/models/ with registry.json and stats.json',
      needed: true
    });
  }

  // Step 3: Create bridges directory
  if (!checks.hasBridges) {
    steps.push({
      action: 'Create bridges directory',
      description: 'Copy bridge scripts to .workflow/bridges/',
      needed: true
    });
  }

  // Step 4: Add CLI config
  if (!checks.hasCliConfig) {
    steps.push({
      action: 'Add CLI configuration',
      description: 'Add cli section to config.json with claude-code settings',
      needed: true
    });
  }

  // Step 5: Migrate skills
  if (checks.hasOldSkills) {
    steps.push({
      action: 'Migrate skills',
      description: 'Move skills from .claude/skills/ to .workflow/skills/',
      needed: true
    });
  }

  // Step 6: Create templates
  if (!fs.existsSync(path.join(WORKFLOW_DIR, 'templates'))) {
    steps.push({
      action: 'Create templates directory',
      description: 'Create .workflow/templates/ for CLI-specific templates',
      needed: true
    });
  }

  // Step 7: Run bridge sync
  steps.push({
    action: 'Run bridge sync',
    description: 'Generate .claude/ files from .workflow/ configuration',
    needed: true
  });

  // Print steps
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const status = step.needed ? `${colors.cyan}•${colors.reset}` : `${colors.green}✓${colors.reset}`;
    console.log(`  ${i + 1}. ${status} ${step.action}`);
    console.log(`     ${colors.dim}${step.description}${colors.reset}`);
  }

  console.log('');
  return steps.filter(s => s.needed);
}

/**
 * Create backup of existing files
 */
function createBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = path.join(BACKUP_DIR, timestamp);

  if (dryRun) {
    console.log(`  ${colors.dim}Would create backup at: ${backupPath}${colors.reset}`);
    return backupPath;
  }

  fs.mkdirSync(backupPath, { recursive: true });

  // Backup config.json
  if (fs.existsSync(CONFIG_PATH)) {
    fs.copyFileSync(CONFIG_PATH, path.join(backupPath, 'config.json'));
  }

  // Backup .claude/skills/ if exists
  const oldSkillsDir = path.join(CLAUDE_DIR, 'skills');
  if (fs.existsSync(oldSkillsDir)) {
    const skillsBackup = path.join(backupPath, 'claude-skills');
    copyDirRecursive(oldSkillsDir, skillsBackup);
  }

  console.log(`  ${colors.green}✓${colors.reset} Backup created at: ${backupPath}`);
  return backupPath;
}

/**
 * Create models directory with registry and stats
 */
function createModelsDirectory() {
  const modelsDir = path.join(WORKFLOW_DIR, 'models');

  if (dryRun) {
    console.log(`  ${colors.dim}Would create: ${modelsDir}${colors.reset}`);
    return;
  }

  fs.mkdirSync(modelsDir, { recursive: true });

  // Create registry.json if it doesn't exist
  const registryPath = path.join(modelsDir, 'registry.json');
  if (!fs.existsSync(registryPath)) {
    // Try to copy from template location
    const templateRegistry = path.join(PROJECT_ROOT, 'scripts', '..', '.workflow', 'models', 'registry.json');
    if (fs.existsSync(templateRegistry)) {
      fs.copyFileSync(templateRegistry, registryPath);
    } else {
      // Create minimal registry
      const registry = {
        "$schema": "./registry-schema.json",
        "version": "1.0.0",
        "lastUpdated": new Date().toISOString(),
        "providers": {},
        "models": {},
        "capabilities": {},
        "costTiers": {},
        "routing": {}
      };
      fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
    }
  }

  // Create stats.json if it doesn't exist
  const statsPath = path.join(modelsDir, 'stats.json');
  if (!fs.existsSync(statsPath)) {
    const stats = {
      "$schema": "./stats-schema.json",
      "version": "1.0.0",
      "lastUpdated": new Date().toISOString(),
      "trackingSince": new Date().toISOString(),
      "summary": { "totalTasks": 0, "totalTokensUsed": 0, "totalCost": 0 },
      "byModel": {},
      "byTaskType": {},
      "byCapability": {},
      "failureStats": { "totalFailures": 0, "byCategory": {}, "recoveryRate": 0 },
      "routingStats": { "escalations": 0, "fallbacks": 0, "primarySuccessRate": 0 },
      "recentTasks": []
    };
    fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
  }

  console.log(`  ${colors.green}✓${colors.reset} Models directory created`);
}

/**
 * Create bridges directory
 */
function createBridgesDirectory() {
  const bridgesDir = path.join(WORKFLOW_DIR, 'bridges');

  if (dryRun) {
    console.log(`  ${colors.dim}Would create: ${bridgesDir}${colors.reset}`);
    return;
  }

  fs.mkdirSync(bridgesDir, { recursive: true });

  // Copy bridge files from wogi-flow installation if available
  const sourceBridges = path.join(__dirname, '..', '.workflow', 'bridges');
  if (fs.existsSync(sourceBridges)) {
    copyDirRecursive(sourceBridges, bridgesDir);
    console.log(`  ${colors.green}✓${colors.reset} Bridges directory created with implementations`);
  } else {
    console.log(`  ${colors.yellow}○${colors.reset} Bridges directory created (no source bridges found)`);
  }
}

/**
 * Add CLI configuration to config.json
 */
function addCliConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.log(`  ${colors.yellow}○${colors.reset} No config.json found, skipping CLI config`);
    return;
  }

  if (dryRun) {
    console.log(`  ${colors.dim}Would add cli section to config.json${colors.reset}`);
    return;
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

  if (!config.cli) {
    config.cli = {
      type: 'claude-code',
      bridge: {
        autoSync: true,
        syncOnConfigChange: true
      }
    };

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log(`  ${colors.green}✓${colors.reset} CLI configuration added to config.json`);
  } else {
    console.log(`  ${colors.dim}○${colors.reset} CLI configuration already exists`);
  }
}

/**
 * Migrate skills from .claude/skills/ to .workflow/skills/
 */
function migrateSkills() {
  const oldSkillsDir = path.join(CLAUDE_DIR, 'skills');
  const newSkillsDir = path.join(WORKFLOW_DIR, 'skills');

  if (!fs.existsSync(oldSkillsDir)) {
    console.log(`  ${colors.dim}○${colors.reset} No skills to migrate`);
    return;
  }

  if (dryRun) {
    console.log(`  ${colors.dim}Would move: ${oldSkillsDir} → ${newSkillsDir}${colors.reset}`);
    return;
  }

  // Create new skills directory
  fs.mkdirSync(newSkillsDir, { recursive: true });

  // Get all skill directories
  const items = fs.readdirSync(oldSkillsDir);

  for (const item of items) {
    const oldPath = path.join(oldSkillsDir, item);
    const newPath = path.join(newSkillsDir, item);

    if (fs.statSync(oldPath).isDirectory()) {
      // Move skill directory
      if (!fs.existsSync(newPath)) {
        copyDirRecursive(oldPath, newPath);
        fs.rmSync(oldPath, { recursive: true });
        console.log(`  ${colors.green}✓${colors.reset} Migrated skill: ${item}`);
      } else {
        console.log(`  ${colors.yellow}○${colors.reset} Skill already exists: ${item}`);
      }
    } else if (item === 'skills-index.json') {
      // Move skills index
      if (!fs.existsSync(path.join(newSkillsDir, item))) {
        fs.copyFileSync(oldPath, path.join(newSkillsDir, item));
        fs.unlinkSync(oldPath);
        console.log(`  ${colors.green}✓${colors.reset} Migrated skills-index.json`);
      }
    }
  }

  // Remove empty .claude/skills directory
  const remaining = fs.readdirSync(oldSkillsDir);
  if (remaining.length === 0) {
    fs.rmdirSync(oldSkillsDir);
    console.log(`  ${colors.dim}○${colors.reset} Removed empty .claude/skills/`);
  }
}

/**
 * Create templates directory
 */
function createTemplatesDirectory() {
  const templatesDir = path.join(WORKFLOW_DIR, 'templates');

  if (dryRun) {
    console.log(`  ${colors.dim}Would create: ${templatesDir}${colors.reset}`);
    return;
  }

  if (!fs.existsSync(templatesDir)) {
    fs.mkdirSync(templatesDir, { recursive: true });

    // Copy templates from wogi-flow installation if available
    const sourceTemplates = path.join(__dirname, '..', '.workflow', 'templates');
    if (fs.existsSync(sourceTemplates)) {
      copyDirRecursive(sourceTemplates, templatesDir);
      console.log(`  ${colors.green}✓${colors.reset} Templates directory created with defaults`);
    } else {
      console.log(`  ${colors.green}✓${colors.reset} Templates directory created (empty)`);
    }
  } else {
    console.log(`  ${colors.dim}○${colors.reset} Templates directory already exists`);
  }
}

/**
 * Run bridge sync
 */
async function runBridgeSync() {
  if (dryRun) {
    console.log(`  ${colors.dim}Would run: flow bridge sync${colors.reset}`);
    return;
  }

  try {
    const bridgesIndex = path.join(WORKFLOW_DIR, 'bridges', 'index.js');
    if (fs.existsSync(bridgesIndex)) {
      const bridges = require(bridgesIndex);
      const result = await bridges.syncBridge({ projectDir: PROJECT_ROOT, verbose: true });

      if (result.success) {
        console.log(`  ${colors.green}✓${colors.reset} Bridge sync completed`);
      } else {
        console.log(`  ${colors.yellow}○${colors.reset} Bridge sync completed with issues: ${result.error || 'unknown'}`);
      }
    } else {
      console.log(`  ${colors.yellow}○${colors.reset} Bridge sync skipped (no bridges installed)`);
    }
  } catch (error) {
    console.log(`  ${colors.yellow}○${colors.reset} Bridge sync skipped: ${error.message}`);
  }
}

/**
 * Copy directory recursively
 */
function copyDirRecursive(source, target) {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }

  const items = fs.readdirSync(source);
  for (const item of items) {
    const sourcePath = path.join(source, item);
    const targetPath = path.join(target, item);

    if (fs.statSync(sourcePath).isDirectory()) {
      copyDirRecursive(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

/**
 * Ask user for confirmation
 */
async function confirm(message) {
  if (force) return true;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(`${message} (y/n): `, answer => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Main migration function
 */
async function migrate() {
  console.log(`${colors.bold}Wogi Flow Migration Tool${colors.reset}`);
  console.log(`${colors.dim}Migrate to CLI-agnostic universal structure${colors.reset}`);
  console.log('');

  // Check current state
  const checks = checkMigrationNeeded();

  if (!checks.hasWorkflow) {
    console.log(`${colors.red}Error:${colors.reset} No .workflow/ directory found.`);
    console.log('Run "flow install" first to set up Wogi Flow.');
    process.exit(1);
  }

  if (checks.hasCliConfig && checks.hasModels && checks.hasBridges && !checks.hasOldSkills) {
    console.log(`${colors.green}✓ Project is already migrated to universal structure.${colors.reset}`);
    console.log('');
    console.log('Run "flow bridge sync" to regenerate CLI-specific files.');
    process.exit(0);
  }

  // Show plan
  const steps = printMigrationPlan(checks);

  if (steps.length === 0) {
    console.log(`${colors.green}Nothing to migrate.${colors.reset}`);
    process.exit(0);
  }

  if (dryRun) {
    console.log(`${colors.yellow}Dry run mode - no changes will be made.${colors.reset}`);
    console.log('');
  }

  // Confirm
  if (!dryRun) {
    const proceed = await confirm('Proceed with migration?');
    if (!proceed) {
      console.log('Migration cancelled.');
      process.exit(0);
    }
    console.log('');
  }

  // Execute migration steps
  console.log(`${colors.cyan}Running migration...${colors.reset}`);
  console.log('');

  createBackup();
  createModelsDirectory();
  createBridgesDirectory();
  addCliConfig();
  migrateSkills();
  createTemplatesDirectory();
  await runBridgeSync();

  console.log('');

  if (dryRun) {
    console.log(`${colors.yellow}Dry run complete.${colors.reset}`);
    console.log('Run without --dry-run to apply changes.');
  } else {
    console.log(`${colors.green}✓ Migration complete!${colors.reset}`);
    console.log('');
    console.log('Next steps:');
    console.log(`  1. Review changes in .workflow/`);
    console.log(`  2. Run "flow bridge status" to verify configuration`);
    console.log(`  3. Commit the changes`);
  }
}

// Run migration
migrate().catch(error => {
  console.error(`${colors.red}Migration failed:${colors.reset}`, error.message);
  process.exit(1);
});
