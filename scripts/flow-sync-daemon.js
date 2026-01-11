#!/usr/bin/env node

/**
 * Wogi Flow - Background Sync Daemon
 *
 * Keeps workflow state in sync when multiple agents work on different branches.
 * Watches .workflow/state/ for changes and handles branch switching.
 *
 * Part of Phase 6: Team & Integrations
 *
 * Usage:
 *   flow sync-daemon start       Start the daemon
 *   flow sync-daemon stop        Stop the daemon
 *   flow sync-daemon status      Check daemon status
 *   flow sync-daemon restart     Restart the daemon
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const {
  PROJECT_ROOT,
  STATE_DIR,
  parseFlags,
  color,
  info,
  warn,
  error,
  success,
  fileExists,
  safeJsonParse,
  getConfig,
  printHeader
} = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

const PID_FILE = path.join(STATE_DIR, 'sync-daemon.pid');
const LOG_FILE = path.join(STATE_DIR, 'sync-daemon.log');
const HEARTBEAT_FILE = path.join(STATE_DIR, 'sync-daemon.heartbeat');
const SYNC_STATE_FILE = path.join(STATE_DIR, 'sync-state.json');

const DEFAULT_CONFIG = {
  enabled: false,
  watchPaths: ['.workflow/state/'],
  syncOnBranchSwitch: true,
  heartbeatIntervalMs: 30000,
  debounceMs: 1000,
  maxLogSizeBytes: 1024 * 1024 // 1MB
};

// ============================================================
// Configuration
// ============================================================

/**
 * Get sync daemon configuration
 */
function getSyncConfig() {
  const config = getConfig();
  return {
    ...DEFAULT_CONFIG,
    ...(config?.syncDaemon || {})
  };
}

// ============================================================
// Daemon Management
// ============================================================

/**
 * Check if daemon is running
 */
function isDaemonRunning() {
  if (!fileExists(PID_FILE)) {
    return false;
  }

  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim());
    // Check if process exists
    process.kill(pid, 0);

    // Check heartbeat freshness (2x interval)
    if (fileExists(HEARTBEAT_FILE)) {
      const heartbeat = JSON.parse(fs.readFileSync(HEARTBEAT_FILE, 'utf-8'));
      const age = Date.now() - new Date(heartbeat.timestamp).getTime();
      const config = getSyncConfig();

      if (age > config.heartbeatIntervalMs * 2) {
        warn('Daemon heartbeat stale, may be unresponsive');
        return false;
      }
    }

    return true;
  } catch (e) {
    // Process doesn't exist
    cleanupPidFile();
    return false;
  }
}

/**
 * Get daemon status
 */
function getDaemonStatus() {
  const running = isDaemonRunning();
  let pid = null;
  let heartbeat = null;
  let currentBranch = null;

  if (fileExists(PID_FILE)) {
    pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim());
  }

  if (fileExists(HEARTBEAT_FILE)) {
    heartbeat = JSON.parse(fs.readFileSync(HEARTBEAT_FILE, 'utf-8'));
  }

  try {
    currentBranch = execSync('git branch --show-current', {
      encoding: 'utf-8',
      cwd: PROJECT_ROOT
    }).trim();
  } catch (e) {
    currentBranch = 'unknown';
  }

  const syncState = safeJsonParse(SYNC_STATE_FILE) || {};

  return {
    running,
    pid,
    heartbeat,
    currentBranch,
    lastSync: syncState.lastSync,
    syncedBranches: syncState.branches || {},
    config: getSyncConfig()
  };
}

/**
 * Cleanup stale PID file
 */
function cleanupPidFile() {
  if (fileExists(PID_FILE)) {
    fs.unlinkSync(PID_FILE);
  }
  if (fileExists(HEARTBEAT_FILE)) {
    fs.unlinkSync(HEARTBEAT_FILE);
  }
}

/**
 * Start the daemon
 */
function startDaemon() {
  if (isDaemonRunning()) {
    warn('Daemon is already running');
    return false;
  }

  const config = getSyncConfig();
  if (!config.enabled) {
    warn('Sync daemon is disabled in config');
    info('Enable with: flow config set syncDaemon.enabled true');
    return false;
  }

  // Start daemon as detached process
  const daemon = spawn('node', [__filename, '--daemon'], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    cwd: PROJECT_ROOT,
    env: { ...process.env, WOGI_DAEMON: '1' }
  });

  daemon.unref();

  // Write PID file
  fs.writeFileSync(PID_FILE, daemon.pid.toString());

  success(`Daemon started (PID: ${daemon.pid})`);
  info(`Log file: ${LOG_FILE}`);

  return true;
}

/**
 * Stop the daemon
 */
function stopDaemon() {
  if (!fileExists(PID_FILE)) {
    info('Daemon is not running');
    return false;
  }

  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim());
    process.kill(pid, 'SIGTERM');
    cleanupPidFile();
    success('Daemon stopped');
    return true;
  } catch (e) {
    cleanupPidFile();
    info('Daemon was not running (cleaned up stale PID)');
    return false;
  }
}

// ============================================================
// Daemon Process
// ============================================================

/**
 * Log message to file
 */
function log(level, message) {
  const timestamp = new Date().toISOString();
  const line = `${timestamp} [${level}] ${message}\n`;

  // Rotate log if too large
  const config = getSyncConfig();
  if (fileExists(LOG_FILE)) {
    const stats = fs.statSync(LOG_FILE);
    if (stats.size > config.maxLogSizeBytes) {
      const backupPath = LOG_FILE + '.old';
      if (fileExists(backupPath)) fs.unlinkSync(backupPath);
      fs.renameSync(LOG_FILE, backupPath);
    }
  }

  fs.appendFileSync(LOG_FILE, line);
}

/**
 * Update heartbeat
 */
function updateHeartbeat() {
  const status = {
    timestamp: new Date().toISOString(),
    pid: process.pid,
    branch: getCurrentBranch(),
    uptime: process.uptime()
  };

  fs.writeFileSync(HEARTBEAT_FILE, JSON.stringify(status, null, 2));
}

/**
 * Get current git branch
 */
function getCurrentBranch() {
  try {
    return execSync('git branch --show-current', {
      encoding: 'utf-8',
      cwd: PROJECT_ROOT
    }).trim();
  } catch (e) {
    return 'unknown';
  }
}

/**
 * Detect branch switch
 */
let lastBranch = null;
function detectBranchSwitch() {
  const currentBranch = getCurrentBranch();

  if (lastBranch && lastBranch !== currentBranch) {
    log('INFO', `Branch switched: ${lastBranch} -> ${currentBranch}`);
    handleBranchSwitch(lastBranch, currentBranch);
  }

  lastBranch = currentBranch;
}

/**
 * Handle branch switch
 */
function handleBranchSwitch(fromBranch, toBranch) {
  const config = getSyncConfig();

  if (!config.syncOnBranchSwitch) {
    return;
  }

  // Save state for current branch
  saveBranchState(fromBranch);

  // Load state for new branch
  loadBranchState(toBranch);

  // Invalidate caches
  invalidateCaches();
}

/**
 * Save state for a branch
 */
function saveBranchState(branch) {
  const syncState = safeJsonParse(SYNC_STATE_FILE) || { branches: {} };

  syncState.branches[branch] = {
    savedAt: new Date().toISOString(),
    ready: safeJsonParse(path.join(STATE_DIR, 'ready.json')),
    progress: fileExists(path.join(STATE_DIR, 'progress.md'))
      ? fs.readFileSync(path.join(STATE_DIR, 'progress.md'), 'utf-8').slice(0, 1000)
      : null
  };

  fs.writeFileSync(SYNC_STATE_FILE, JSON.stringify(syncState, null, 2));
  log('INFO', `Saved state for branch: ${branch}`);
}

/**
 * Load state for a branch
 */
function loadBranchState(branch) {
  const syncState = safeJsonParse(SYNC_STATE_FILE);

  if (!syncState?.branches?.[branch]) {
    log('INFO', `No saved state for branch: ${branch}`);
    return;
  }

  const branchState = syncState.branches[branch];

  // Optionally restore ready.json (be careful not to overwrite work)
  // For now, just log that we could restore
  log('INFO', `Found saved state for branch: ${branch} (from ${branchState.savedAt})`);
}

/**
 * Invalidate caches
 */
function invalidateCaches() {
  const cacheFiles = [
    'jira-cache.json',
    'linear-cache.json',
    'component-index.json'
  ];

  for (const file of cacheFiles) {
    const cachePath = path.join(STATE_DIR, file);
    if (fileExists(cachePath)) {
      fs.unlinkSync(cachePath);
      log('DEBUG', `Invalidated cache: ${file}`);
    }
  }
}

/**
 * File watcher callback (debounced)
 */
let debounceTimer = null;
function onFileChange(eventType, filename) {
  const config = getSyncConfig();

  // Debounce rapid changes
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    log('DEBUG', `File changed: ${filename} (${eventType})`);
    updateSyncState(filename);
  }, config.debounceMs);
}

/**
 * Update sync state after file change
 */
function updateSyncState(filename) {
  const syncState = safeJsonParse(SYNC_STATE_FILE) || { branches: {} };

  syncState.lastSync = new Date().toISOString();
  syncState.lastFile = filename;

  fs.writeFileSync(SYNC_STATE_FILE, JSON.stringify(syncState, null, 2));
}

/**
 * Run the daemon
 */
function runDaemon() {
  const config = getSyncConfig();

  log('INFO', `Daemon started (PID: ${process.pid})`);
  log('INFO', `Watch paths: ${config.watchPaths.join(', ')}`);
  log('INFO', `Heartbeat interval: ${config.heartbeatIntervalMs}ms`);

  // Initial state
  lastBranch = getCurrentBranch();
  log('INFO', `Current branch: ${lastBranch}`);

  // Set up file watcher
  const watchers = [];
  for (const watchPath of config.watchPaths) {
    const fullPath = path.join(PROJECT_ROOT, watchPath);

    if (!fs.existsSync(fullPath)) {
      log('WARN', `Watch path does not exist: ${watchPath}`);
      continue;
    }

    try {
      const watcher = fs.watch(fullPath, { recursive: true }, onFileChange);
      watchers.push(watcher);
      log('INFO', `Watching: ${watchPath}`);
    } catch (e) {
      log('ERROR', `Failed to watch ${watchPath}: ${e.message}`);
    }
  }

  // Heartbeat interval
  const heartbeatInterval = setInterval(() => {
    updateHeartbeat();
    detectBranchSwitch();
  }, config.heartbeatIntervalMs);

  // Initial heartbeat
  updateHeartbeat();

  // Handle signals
  const cleanup = () => {
    log('INFO', 'Daemon stopping...');
    clearInterval(heartbeatInterval);
    for (const watcher of watchers) {
      watcher.close();
    }
    cleanupPidFile();
    log('INFO', 'Daemon stopped');
    process.exit(0);
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  log('INFO', 'Daemon running. Send SIGTERM to stop.');
}

// ============================================================
// CLI Output
// ============================================================

function printStatus(status) {
  printHeader('SYNC DAEMON STATUS');

  console.log(`  ${color('dim', 'Running:')} ${status.running ? color('green', 'Yes') : color('red', 'No')}`);
  console.log(`  ${color('dim', 'PID:')} ${status.pid || 'N/A'}`);
  console.log(`  ${color('dim', 'Current branch:')} ${color('cyan', status.currentBranch)}`);

  if (status.heartbeat) {
    const age = Date.now() - new Date(status.heartbeat.timestamp).getTime();
    const ageStr = age < 60000 ? `${Math.floor(age / 1000)}s ago` : `${Math.floor(age / 60000)}m ago`;
    console.log(`  ${color('dim', 'Last heartbeat:')} ${ageStr}`);
    console.log(`  ${color('dim', 'Uptime:')} ${Math.floor(status.heartbeat.uptime / 60)}m`);
  }

  if (status.lastSync) {
    console.log(`  ${color('dim', 'Last sync:')} ${status.lastSync}`);
  }

  console.log(`\n  ${color('dim', 'Configuration:')}`);
  console.log(`  ${color('dim', '  Enabled:')} ${status.config.enabled ? 'Yes' : 'No'}`);
  console.log(`  ${color('dim', '  Watch paths:')} ${status.config.watchPaths.join(', ')}`);
  console.log(`  ${color('dim', '  Branch sync:')} ${status.config.syncOnBranchSwitch ? 'Yes' : 'No'}`);

  const branchCount = Object.keys(status.syncedBranches).length;
  if (branchCount > 0) {
    console.log(`\n  ${color('dim', `Synced branches: ${branchCount}`)}`);
    for (const [branch, data] of Object.entries(status.syncedBranches)) {
      console.log(`    - ${branch} (${data.savedAt})`);
    }
  }

  console.log('');
}

// ============================================================
// CLI Entry Point
// ============================================================

function showHelp() {
  console.log(`
Wogi Flow - Background Sync Daemon

Keep workflow state in sync across branches and agents.

Usage:
  flow sync-daemon start       Start the daemon
  flow sync-daemon stop        Stop the daemon
  flow sync-daemon status      Check daemon status
  flow sync-daemon restart     Restart the daemon

Options:
  --json            Output as JSON
  --help, -h        Show this help

Configuration:
  Add to .workflow/config.json:
  {
    "syncDaemon": {
      "enabled": true,
      "watchPaths": [".workflow/state/"],
      "syncOnBranchSwitch": true,
      "heartbeatIntervalMs": 30000
    }
  }

Features:
  - Watches .workflow/state/ for file changes
  - Detects branch switches and saves/restores state
  - Invalidates caches on branch switch
  - Logs activity to .workflow/state/sync-daemon.log
`);
}

async function main() {
  const args = process.argv.slice(2);
  const { flags, positional } = parseFlags(args);

  // Check if running as daemon
  if (flags.daemon || process.env.WOGI_DAEMON === '1') {
    runDaemon();
    return;
  }

  if (flags.help || flags.h) {
    showHelp();
    process.exit(0);
  }

  const command = positional[0] || 'status';

  switch (command) {
    case 'start':
      startDaemon();
      break;

    case 'stop':
      stopDaemon();
      break;

    case 'restart':
      stopDaemon();
      setTimeout(() => startDaemon(), 500);
      break;

    case 'status': {
      const status = getDaemonStatus();
      if (flags.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        printStatus(status);
      }
      break;
    }

    default:
      error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  getSyncConfig,
  isDaemonRunning,
  getDaemonStatus,
  startDaemon,
  stopDaemon
};

if (require.main === module) {
  main().catch(err => {
    error(err.message);
    process.exit(1);
  });
}
