#!/usr/bin/env node

/**
 * Wogi Flow - Auto-Checkpoint System
 *
 * Creates periodic checkpoints during execution:
 * - Git commits at configurable intervals
 * - State snapshots for rollback
 * - Checkpoint metadata tracking
 *
 * Usage as module:
 *   const { Checkpoint, createCheckpoint, rollback } = require('./flow-checkpoint');
 *   const cp = new Checkpoint(config);
 *   cp.maybeCreate(stepCount);
 *
 * Usage as CLI:
 *   flow checkpoint create [message]     # Create manual checkpoint
 *   flow checkpoint list                 # List checkpoints
 *   flow checkpoint rollback [id]        # Rollback to checkpoint
 *   flow checkpoint cleanup              # Remove old checkpoints
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const { getProjectRoot, getConfig, colors: c } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const CHECKPOINTS_DIR = path.join(WORKFLOW_DIR, 'checkpoints');
const CHECKPOINT_LOG = path.join(CHECKPOINTS_DIR, 'checkpoint-log.json');

// Alias getConfig as loadConfig for minimal code changes
const loadConfig = getConfig;

/**
 * Default checkpoint configuration
 */
const DEFAULT_CHECKPOINT_CONFIG = {
  enabled: true,
  interval: 5,
  maxCheckpoints: 20,
  autoCommit: true,
  commitPrefix: '[checkpoint]',
  includeStateFiles: true,
  excludePatterns: ['node_modules', '.git', 'dist', 'build']
};

/**
 * Checkpoint class for managing automatic checkpoints
 */
class Checkpoint {
  constructor(config = {}) {
    const cpConfig = config.checkpoint || config.safety?.limits || {};
    this.config = { ...DEFAULT_CHECKPOINT_CONFIG, ...cpConfig };
    this.stepCount = 0;
    this.lastCheckpointStep = 0;
    this.checkpoints = [];

    this.ensureDir();
    this.loadCheckpoints();
  }

  /**
   * Ensure checkpoint directory exists
   */
  ensureDir() {
    if (!fs.existsSync(CHECKPOINTS_DIR)) {
      fs.mkdirSync(CHECKPOINTS_DIR, { recursive: true });
    }
  }

  /**
   * Load existing checkpoints
   */
  loadCheckpoints() {
    if (fs.existsSync(CHECKPOINT_LOG)) {
      try {
        const { readJson } = require('./flow-utils');
      this.checkpoints = readJson(CHECKPOINT_LOG, []);
      } catch {
        this.checkpoints = [];
      }
    }
  }

  /**
   * Save checkpoint log
   */
  saveCheckpoints() {
    fs.writeFileSync(CHECKPOINT_LOG, JSON.stringify(this.checkpoints, null, 2));
  }

  /**
   * Check if checkpoint is needed
   */
  needsCheckpoint() {
    if (!this.config.enabled) return false;
    const interval = this.config.interval || 5;
    return this.stepCount > 0 && (this.stepCount - this.lastCheckpointStep) >= interval;
  }

  /**
   * Increment step counter and maybe create checkpoint
   */
  recordStep() {
    this.stepCount++;

    if (this.needsCheckpoint()) {
      return this.create(`Auto checkpoint at step ${this.stepCount}`);
    }

    return null;
  }

  /**
   * Create a checkpoint
   */
  create(message = null) {
    const timestamp = new Date().toISOString();
    const id = `cp-${timestamp.replace(/[:.]/g, '-').slice(0, 19)}`;

    const checkpoint = {
      id,
      timestamp,
      step: this.stepCount,
      message: message || `Checkpoint at step ${this.stepCount}`,
      gitCommit: null,
      stateSnapshot: null,
      filesTracked: []
    };

    // Snapshot state files
    if (this.config.includeStateFiles) {
      checkpoint.stateSnapshot = this.snapshotState(id);
    }

    // Git commit if enabled
    if (this.config.autoCommit && this.hasGitChanges()) {
      checkpoint.gitCommit = this.createGitCommit(checkpoint.message);
    }

    this.checkpoints.push(checkpoint);
    this.lastCheckpointStep = this.stepCount;
    this.saveCheckpoints();

    // Cleanup old checkpoints
    this.cleanup();

    return checkpoint;
  }

  /**
   * Snapshot workflow state files
   */
  snapshotState(id) {
    const snapshotDir = path.join(CHECKPOINTS_DIR, id);
    if (!fs.existsSync(snapshotDir)) {
      fs.mkdirSync(snapshotDir, { recursive: true });
    }

    const stateFiles = [
      'state/ready.json',
      'state/request-log.md',
      'state/decisions.md',
      'state/progress.md',
      'state/durable-session.json',
      'config.json'
    ];

    // Add all active registry map files dynamically
    try {
      const { getRegistryMapFiles } = require('./flow-utils');
      for (const mapFile of getRegistryMapFiles()) {
        stateFiles.push(`state/${mapFile}`);
      }
    } catch {
      stateFiles.push('state/app-map.md');
    }

    const snapshots = {};

    for (const relPath of stateFiles) {
      const srcPath = path.join(WORKFLOW_DIR, relPath);
      try {
        const content = fs.readFileSync(srcPath, 'utf-8');
        const destPath = path.join(snapshotDir, relPath.replace(/\//g, '_'));
        fs.writeFileSync(destPath, content);
        snapshots[relPath] = destPath;
      } catch (err) {
        // File may not exist or be unreadable — skip silently
        if (process.env.DEBUG && err.code !== 'ENOENT') {
          console.error(`[checkpoint] Could not snapshot ${relPath}: ${err.message}`);
        }
      }
    }

    return snapshots;
  }

  /**
   * Check if there are git changes to commit
   */
  hasGitChanges() {
    try {
      const result = spawnSync('git', ['status', '--porcelain'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8'
      });
      return result.stdout && result.stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Create a git commit
   */
  createGitCommit(message) {
    try {
      // Stage all changes
      spawnSync('git', ['add', '-A'], { cwd: PROJECT_ROOT });

      // Create commit
      const commitMessage = `${this.config.commitPrefix} ${message}`;
      const result = spawnSync('git', ['commit', '-m', commitMessage], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8'
      });

      if (result.status === 0) {
        // Get commit hash
        const hashResult = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
          cwd: PROJECT_ROOT,
          encoding: 'utf-8'
        });
        return hashResult.stdout.trim();
      }
    } catch {
      // Git commit failed
    }
    return null;
  }

  /**
   * Rollback to a checkpoint
   */
  rollback(checkpointId) {
    const checkpoint = this.checkpoints.find(cp => cp.id === checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    const results = {
      stateRestored: false,
      gitRestored: false,
      errors: []
    };

    // Restore state files
    if (checkpoint.stateSnapshot) {
      try {
        for (const [relPath, snapshotPath] of Object.entries(checkpoint.stateSnapshot)) {
          try {
            const content = fs.readFileSync(snapshotPath, 'utf-8');
            const destPath = path.join(WORKFLOW_DIR, relPath);
            fs.writeFileSync(destPath, content);
          } catch (err) {
            if (err.code !== 'ENOENT') {
              results.errors.push(`Could not restore ${relPath}: ${err.message}`);
            }
          }
        }
        results.stateRestored = true;
      } catch (err) {
        results.errors.push(`Failed to restore state: ${err.message}`);
      }
    }

    // Rollback git if commit exists
    if (checkpoint.gitCommit) {
      try {
        // Find commits since checkpoint
        const logResult = spawnSync('git', [
          'log', '--oneline', `${checkpoint.gitCommit}..HEAD`
        ], { cwd: PROJECT_ROOT, encoding: 'utf-8' });

        const commitsSince = logResult.stdout.trim().split('\n').filter(l => l).length;

        if (commitsSince > 0) {
          // Soft reset to checkpoint
          spawnSync('git', ['reset', '--soft', checkpoint.gitCommit], {
            cwd: PROJECT_ROOT
          });
          results.gitRestored = true;
        }
      } catch (err) {
        results.errors.push(`Failed to rollback git: ${err.message}`);
      }
    }

    return results;
  }

  /**
   * Cleanup old checkpoints
   */
  cleanup() {
    const max = this.config.maxCheckpoints || 20;

    while (this.checkpoints.length > max) {
      const oldest = this.checkpoints.shift();

      // Remove snapshot directory
      if (oldest.stateSnapshot) {
        const snapshotDir = path.join(CHECKPOINTS_DIR, oldest.id);
        if (fs.existsSync(snapshotDir)) {
          fs.rmSync(snapshotDir, { recursive: true });
        }
      }
    }

    this.saveCheckpoints();
    return this.checkpoints.length;
  }

  /**
   * Get checkpoint list
   */
  list() {
    return this.checkpoints.map(cp => ({
      id: cp.id,
      timestamp: cp.timestamp,
      step: cp.step,
      message: cp.message,
      hasGitCommit: !!cp.gitCommit,
      hasStateSnapshot: !!cp.stateSnapshot
    }));
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      enabled: this.config.enabled,
      interval: this.config.interval,
      stepCount: this.stepCount,
      lastCheckpointStep: this.lastCheckpointStep,
      totalCheckpoints: this.checkpoints.length,
      nextCheckpointAt: this.lastCheckpointStep + this.config.interval
    };
  }
}


/**
 * Format checkpoint list for display
 */
function formatCheckpointList(checkpoints) {
  if (checkpoints.length === 0) {
    return `${c.dim}No checkpoints found${c.reset}`;
  }

  let output = `${c.cyan}${c.bold}Checkpoints${c.reset}\n`;
  output += `${'─'.repeat(60)}\n\n`;

  for (const cp of checkpoints.reverse()) {
    const date = new Date(cp.timestamp);
    const timeStr = date.toLocaleString();

    output += `${c.bold}${cp.id}${c.reset}\n`;
    output += `  ${c.dim}Time:${c.reset} ${timeStr}\n`;
    output += `  ${c.dim}Step:${c.reset} ${cp.step}\n`;
    output += `  ${c.dim}Message:${c.reset} ${cp.message}\n`;

    const features = [];
    if (cp.hasGitCommit) features.push('git');
    if (cp.hasStateSnapshot) features.push('state');
    output += `  ${c.dim}Includes:${c.reset} ${features.join(', ') || 'none'}\n`;
    output += '\n';
  }

  return output;
}

// Module exports
module.exports = {
  Checkpoint,
  DEFAULT_CHECKPOINT_CONFIG,
  loadConfig
};

// CLI Handler
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  const config = loadConfig();
  const cp = new Checkpoint(config);

  switch (command) {
    case 'create': {
      const message = args.slice(1).join(' ') || 'Manual checkpoint';
      console.log(`${c.cyan}Creating checkpoint...${c.reset}`);
      const checkpoint = cp.create(message);
      console.log(`${c.green}✅ Checkpoint created: ${checkpoint.id}${c.reset}`);
      if (checkpoint.gitCommit) {
        console.log(`   Git commit: ${checkpoint.gitCommit}`);
      }
      break;
    }

    case 'list': {
      const checkpoints = cp.list();
      console.log(formatCheckpointList(checkpoints));
      break;
    }

    case 'rollback': {
      const checkpointId = args[1];
      if (!checkpointId) {
        console.error(`${c.red}Error: Checkpoint ID required${c.reset}`);
        console.log(`${c.dim}Usage: flow checkpoint rollback <id>${c.reset}`);
        process.exit(1);
      }

      console.log(`${c.yellow}Rolling back to ${checkpointId}...${c.reset}`);
      try {
        const results = cp.rollback(checkpointId);

        if (results.stateRestored) {
          console.log(`${c.green}✅ State files restored${c.reset}`);
        }
        if (results.gitRestored) {
          console.log(`${c.green}✅ Git rolled back${c.reset}`);
        }
        if (results.errors.length > 0) {
          for (const err of results.errors) {
            console.log(`${c.yellow}⚠ ${err}${c.reset}`);
          }
        }
      } catch (err) {
        console.error(`${c.red}Error: ${err.message}${c.reset}`);
        process.exit(1);
      }
      break;
    }

    case 'cleanup': {
      const remaining = cp.cleanup();
      console.log(`${c.green}✅ Cleanup complete. ${remaining} checkpoints remaining${c.reset}`);
      break;
    }

    case 'status': {
      const status = cp.getStatus();
      console.log(`${c.cyan}Checkpoint Status${c.reset}`);
      console.log(`${'─'.repeat(40)}`);
      console.log(`  Enabled: ${status.enabled ? c.green + 'Yes' : c.yellow + 'No'}${c.reset}`);
      console.log(`  Interval: Every ${status.interval} steps`);
      console.log(`  Current step: ${status.stepCount}`);
      console.log(`  Last checkpoint: Step ${status.lastCheckpointStep}`);
      console.log(`  Total checkpoints: ${status.totalCheckpoints}`);
      break;
    }

    default: {
      console.log(`
${c.cyan}Wogi Flow - Auto-Checkpoint System${c.reset}

${c.bold}Usage:${c.reset}
  flow checkpoint create [message]     Create manual checkpoint
  flow checkpoint list                 List all checkpoints
  flow checkpoint rollback <id>        Rollback to checkpoint
  flow checkpoint cleanup              Remove old checkpoints
  flow checkpoint status               Show checkpoint status

${c.bold}Configuration:${c.reset}
  Add to .workflow/config.json:
  {
    "checkpoint": {
      "enabled": true,
      "interval": 5,
      "maxCheckpoints": 20,
      "autoCommit": true,
      "commitPrefix": "[checkpoint]"
    }
  }

  Or in safety.limits:
  {
    "safety": {
      "limits": {
        "checkpointInterval": 5
      }
    }
  }
      `);
    }
  }
}
