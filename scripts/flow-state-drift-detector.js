#!/usr/bin/env node

/**
 * Wogi Flow - State Drift Detector
 *
 * Detects when .workflow/state/ files have been modified externally
 * (by another developer, git pull, another Claude session, or manual edits).
 *
 * Tracks file modification timestamps and content hashes in a snapshot file.
 * On each check, compares current state against the snapshot to find drift.
 *
 * Usage:
 *   - As a module: const { detectDrift, takeSnapshot } = require('./flow-state-drift-detector');
 *   - As CLI: node flow-state-drift-detector.js [snapshot|check|watch]
 *   - As monitor (stdout streaming): node flow-state-drift-detector.js watch [--interval=30]
 *
 * Wired into: session-start hook (check on session start)
 *             pre-compact hook (snapshot before compaction)
 *
 * Claude Code 2.1.105+: Can be used as a plugin monitor via monitors manifest.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PATHS, safeJsonParse } = require('./flow-utils');

// ============================================================
// Configuration
// ============================================================

const SNAPSHOT_PATH = path.join(PATHS.state, '.state-snapshot.json');

/**
 * State files to monitor for drift.
 * Only track files that affect workflow behavior — not ephemeral state.
 */
const MONITORED_FILES = [
  'ready.json',
  'decisions.md',
  'feedback-patterns.md',
  'app-map.md',
  'function-map.md',
  'api-map.md',
  'schema-map.md',
  'service-map.md',
  'durable-session.json',
  'task-checkpoint.json',
  'session-state.json',
];

// ============================================================
// Core Functions
// ============================================================

/**
 * Compute a fast content hash for a file.
 * Uses first 4KB + file size for speed (not cryptographic — just change detection).
 *
 * @param {string} filePath - Absolute path to file
 * @returns {string|null} Hash string or null if file doesn't exist
 */
function quickHash(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(Math.min(4096, stat.size));
    fs.readSync(fd, buffer, 0, buffer.length, 0);
    fs.closeSync(fd);

    const hash = crypto.createHash('md5');
    hash.update(buffer);
    hash.update(String(stat.size));
    return hash.digest('hex');
  } catch (_err) {
    return null;
  }
}

/**
 * Take a snapshot of current state file timestamps and hashes.
 *
 * @returns {Object} Snapshot with per-file metadata
 */
function takeSnapshot() {
  const snapshot = {
    takenAt: new Date().toISOString(),
    files: {}
  };

  for (const fileName of MONITORED_FILES) {
    const filePath = path.join(PATHS.state, fileName);
    try {
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        snapshot.files[fileName] = {
          mtime: stat.mtimeMs,
          size: stat.size,
          hash: quickHash(filePath)
        };
      }
    } catch (_err) {
      // Skip files we can't read
    }
  }

  return snapshot;
}

/**
 * Save snapshot to disk.
 *
 * @param {Object} [snapshot] - Snapshot to save (defaults to current)
 */
function saveSnapshot(snapshot) {
  const snap = snapshot || takeSnapshot();
  try {
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2));
  } catch (_err) {
    // Non-fatal — snapshot save failure doesn't break workflow
  }
}

/**
 * Detect drift between saved snapshot and current file state.
 *
 * @returns {{ hasDrift: boolean, drifted: Array<{ file: string, type: string, detail: string }> }}
 */
function detectDrift() {
  const saved = safeJsonParse(SNAPSHOT_PATH, null);
  if (!saved || !saved.files) {
    // No previous snapshot — take one and report no drift
    saveSnapshot();
    return { hasDrift: false, drifted: [], firstRun: true };
  }

  const drifted = [];

  for (const fileName of MONITORED_FILES) {
    const filePath = path.join(PATHS.state, fileName);
    const savedEntry = saved.files[fileName];

    const exists = fs.existsSync(filePath);

    if (savedEntry && !exists) {
      drifted.push({ file: fileName, type: 'deleted', detail: 'File was deleted externally' });
      continue;
    }

    if (!savedEntry && exists) {
      drifted.push({ file: fileName, type: 'created', detail: 'File was created externally' });
      continue;
    }

    if (!savedEntry && !exists) continue;

    // File exists in both — compare
    try {
      const stat = fs.statSync(filePath);
      const currentHash = quickHash(filePath);

      // Check mtime first (cheap), then hash (definitive)
      if (stat.mtimeMs !== savedEntry.mtime && currentHash !== savedEntry.hash) {
        drifted.push({
          file: fileName,
          type: 'modified',
          detail: `Modified externally (size: ${savedEntry.size} → ${stat.size})`
        });
      }
    } catch (_err) {
      // Can't stat — skip
    }
  }

  return { hasDrift: drifted.length > 0, drifted };
}

/**
 * Format drift results for display.
 *
 * @param {{ hasDrift: boolean, drifted: Array }} result - From detectDrift()
 * @returns {string|null} Formatted message or null if no drift
 */
function formatDriftReport(result) {
  if (!result.hasDrift) return null;

  const lines = ['**State Drift Detected** — the following state files changed outside this session:'];
  for (const d of result.drifted) {
    const icon = d.type === 'deleted' ? '✗' : d.type === 'created' ? '+' : '~';
    lines.push(`  ${icon} \`${d.file}\` — ${d.detail}`);
  }
  lines.push('');
  lines.push('Consider running `/wogi-rescan` to sync WogiFlow state, or review the changes manually.');

  return lines.join('\n');
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  takeSnapshot,
  saveSnapshot,
  detectDrift,
  formatDriftReport,
  quickHash,
  MONITORED_FILES,
  SNAPSHOT_PATH
};

// ============================================================
// CLI
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0] || 'check';

  switch (command) {
    case 'snapshot': {
      saveSnapshot();
      console.log('State snapshot saved.');
      break;
    }

    case 'check': {
      const result = detectDrift();
      if (result.firstRun) {
        console.log('First run — snapshot taken. No drift to report.');
      } else if (!result.hasDrift) {
        console.log('No state drift detected.');
      } else {
        console.log(formatDriftReport(result));
      }
      break;
    }

    case 'watch': {
      // Streaming monitor mode — outputs one line per detected change.
      // Designed for use with Claude Code's Monitor tool or plugin monitors.
      const intervalArg = args.find(a => a.startsWith('--interval='));
      const intervalSec = intervalArg ? parseInt(intervalArg.split('=')[1], 10) : 30;
      const intervalMs = (intervalSec || 30) * 1000;

      // Take initial snapshot
      saveSnapshot();
      console.log(`[state-drift] Monitoring ${MONITORED_FILES.length} state files (interval: ${intervalSec}s)`);

      setInterval(() => {
        const result = detectDrift();
        if (result.hasDrift) {
          for (const d of result.drifted) {
            console.log(`[state-drift] ${d.type}: ${d.file} — ${d.detail}`);
          }
          // Update snapshot after reporting
          saveSnapshot();
        }
      }, intervalMs);
      break;
    }

    default:
      console.log(`
Wogi Flow - State Drift Detector

Usage:
  node flow-state-drift-detector.js <command>

Commands:
  snapshot    Take a new state snapshot
  check       Check for drift against last snapshot
  watch       Watch mode (stdout streaming for Monitor tool)

Options (watch mode):
  --interval=N    Check interval in seconds (default: 30)
`);
  }
}
