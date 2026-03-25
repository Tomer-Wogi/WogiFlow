#!/usr/bin/env node
/**
 * Rollback Manager - Extracted from flow-orchestrate.js
 *
 * Tracks file creations and modifications during orchestration,
 * enabling full rollback of changes if a plan execution fails.
 */

const fs = require('node:fs');
const path = require('node:path');
const { getProjectRoot, colors, PATHS } = require('./flow-utils');
const { readJson } = require('./flow-io');

function log(color, ...args) {
  console.log(colors[color] + args.join(' ') + colors.reset);
}

class RollbackManager {
  constructor() {
    this.createdFiles = [];
    this.modifiedFiles = [];
    this.checkpointPath = path.join(PATHS.state, 'rollback-checkpoint.json');
  }

  trackCreation(filePath) {
    this.createdFiles.push(filePath);
    this.saveCheckpoint();
  }

  trackModification(filePath) {
    if (fs.existsSync(filePath)) {
      const original = fs.readFileSync(filePath, 'utf-8');
      this.modifiedFiles.push({ path: filePath, original });
      this.saveCheckpoint();
    }
  }

  saveCheckpoint() {
    const checkpoint = {
      createdFiles: this.createdFiles,
      modifiedFiles: this.modifiedFiles,
      timestamp: new Date().toISOString()
    };
    fs.writeFileSync(this.checkpointPath, JSON.stringify(checkpoint, null, 2));
  }

  loadCheckpoint() {
    const checkpoint = readJson(this.checkpointPath, null);
    if (checkpoint) {
      this.createdFiles = checkpoint.createdFiles || [];
      this.modifiedFiles = checkpoint.modifiedFiles || [];
      return true;
    }
    return false;
  }

  rollback() {
    log('yellow', '\n🔙 Rolling back changes...\n');

    for (const filePath of this.createdFiles) {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        log('dim', `  🗑️  Deleted: ${filePath}`);

        let dir = path.dirname(filePath);
        while (dir !== PATHS.root && fs.existsSync(dir)) {
          const files = fs.readdirSync(dir);
          if (files.length === 0) {
            fs.rmdirSync(dir);
            log('dim', `  📁 Removed empty: ${dir}`);
            dir = path.dirname(dir);
          } else {
            break;
          }
        }
      }
    }

    for (const { path: filePath, original } of this.modifiedFiles) {
      fs.writeFileSync(filePath, original);
      log('dim', `  ↩️  Restored: ${filePath}`);
    }

    if (fs.existsSync(this.checkpointPath)) {
      fs.unlinkSync(this.checkpointPath);
    }

    this.createdFiles = [];
    this.modifiedFiles = [];

    log('green', '\n✅ Rollback complete\n');
  }

  clearCheckpoint() {
    if (fs.existsSync(this.checkpointPath)) {
      fs.unlinkSync(this.checkpointPath);
    }
    this.createdFiles = [];
    this.modifiedFiles = [];
  }
}

module.exports = { RollbackManager };
