#!/usr/bin/env node

/**
 * Wogi Flow - Run Trace Manager
 *
 * Creates and manages execution traces for each run.
 * Provides both JSON (queryable) and Markdown (readable) outputs.
 *
 * Usage:
 *   flow run-trace start <run-name>    # Start a new run
 *   flow run-trace event <type> <data> # Log an event
 *   flow run-trace end [status]        # End current run
 *   flow run-trace list [--limit N]    # List recent runs
 *   flow run-trace inspect <run-id>    # Show run details
 *   flow run-trace diff <run-id>       # Show changes from run
 *   flow run-trace cleanup             # Remove old runs
 */

const fs = require('node:fs');
const path = require('node:path');
const { readJson, safeJsonParse, safeJsonParseString } = require('./flow-io');
const crypto = require('node:crypto');
const { colors: c, PATHS } = require('./flow-utils');
const { success: printSuccess } = require('./flow-output');

const RUNS_DIR = PATHS.runs;

// Event types
const EVENT_TYPES = {
  RUN_START: 'run_start',
  STEP_START: 'step_start',
  STEP_END: 'step_end',
  FILE_READ: 'file_read',
  FILE_WRITE: 'file_write',
  FILE_DELETE: 'file_delete',
  COMMAND_RUN: 'command_run',
  COMMAND_SUCCESS: 'command_success',
  COMMAND_FAIL: 'command_fail',
  LLM_CALL: 'llm_call',
  LLM_RESPONSE: 'llm_response',
  VALIDATION_START: 'validation_start',
  VALIDATION_PASS: 'validation_pass',
  VALIDATION_FAIL: 'validation_fail',
  CHECKPOINT: 'checkpoint',
  ERROR: 'error',
  WARNING: 'warning',
  RUN_END: 'run_end'
};

/**
 * Generate a unique run ID
 */
function generateRunId() {
  const now = new Date();
  const timestamp = now.toISOString()
    .slice(0, 19)
    .replace(/[-:T]/g, '')
    .slice(0, 14);
  const shortId = crypto.randomBytes(3).toString('hex');
  return `${timestamp}-${shortId}`;
}

/**
 * Ensure runs directory exists
 */
function ensureRunsDir() {
  if (!fs.existsSync(RUNS_DIR)) {
    fs.mkdirSync(RUNS_DIR, { recursive: true });
  }
}

/**
 * Get current active run ID
 */
function getCurrentRunId() {
  const currentFile = path.join(RUNS_DIR, '.current');
  if (fs.existsSync(currentFile)) {
    return fs.readFileSync(currentFile, 'utf-8').trim();
  }
  return null;
}

/**
 * Set current active run
 */
function setCurrentRun(runId) {
  ensureRunsDir();
  fs.writeFileSync(path.join(RUNS_DIR, '.current'), runId);
}

/**
 * Clear current run
 */
function clearCurrentRun() {
  const currentFile = path.join(RUNS_DIR, '.current');
  if (fs.existsSync(currentFile)) {
    fs.unlinkSync(currentFile);
  }
}

/**
 * Start a new run
 */
function startRun(name, metadata = {}) {
  ensureRunsDir();

  const runId = generateRunId();
  const runDir = path.join(RUNS_DIR, runId);
  fs.mkdirSync(runDir);
  fs.mkdirSync(path.join(runDir, 'artifacts'));
  fs.mkdirSync(path.join(runDir, 'checkpoints'));

  const manifest = {
    id: runId,
    name: name || 'unnamed',
    startedAt: new Date().toISOString(),
    endedAt: null,
    status: 'running',
    steps: 0,
    filesModified: [],
    filesCreated: [],
    filesDeleted: [],
    commandsRun: [],
    validationResults: [],
    llmCalls: 0,
    totalTokens: { input: 0, output: 0 },
    errors: [],
    warnings: [],
    checkpoints: [],
    ...metadata
  };

  fs.writeFileSync(
    path.join(runDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  // Initialize trace log
  logEvent(runId, EVENT_TYPES.RUN_START, { name, metadata });

  // Update index
  updateIndex(runId, manifest);

  setCurrentRun(runId);

  return runId;
}

/**
 * Log an event to the trace
 */
function logEvent(runId, eventType, data = {}) {
  const runDir = path.join(RUNS_DIR, runId);
  if (!fs.existsSync(runDir)) {
    console.error(`Run not found: ${runId}`);
    return;
  }

  const tracePath = path.join(runDir, 'trace.jsonl');

  const event = {
    timestamp: new Date().toISOString(),
    type: eventType,
    data: data
  };

  fs.appendFileSync(tracePath, JSON.stringify(event) + '\n');

  // Update manifest counters
  updateManifestFromEvent(runId, eventType, data);
}

/**
 * Update manifest based on event
 */
function updateManifestFromEvent(runId, eventType, data) {
  const manifestPath = path.join(RUNS_DIR, runId, 'manifest.json');
  const manifest = readJson(manifestPath, null);
  if (!manifest) return;

  switch (eventType) {
    case EVENT_TYPES.STEP_START:
      manifest.steps++;
      break;
    case EVENT_TYPES.FILE_WRITE:
      if (data.created) {
        if (!manifest.filesCreated.includes(data.path)) {
          manifest.filesCreated.push(data.path);
        }
      } else {
        if (!manifest.filesModified.includes(data.path)) {
          manifest.filesModified.push(data.path);
        }
      }
      break;
    case EVENT_TYPES.FILE_DELETE:
      if (!manifest.filesDeleted.includes(data.path)) {
        manifest.filesDeleted.push(data.path);
      }
      break;
    case EVENT_TYPES.COMMAND_RUN:
      manifest.commandsRun.push({
        command: data.command,
        timestamp: new Date().toISOString()
      });
      break;
    case EVENT_TYPES.LLM_CALL:
      manifest.llmCalls++;
      break;
    case EVENT_TYPES.LLM_RESPONSE:
      if (data.tokens) {
        manifest.totalTokens.input += data.tokens.input || 0;
        manifest.totalTokens.output += data.tokens.output || 0;
      }
      break;
    case EVENT_TYPES.VALIDATION_PASS:
    case EVENT_TYPES.VALIDATION_FAIL:
      manifest.validationResults.push({
        command: data.command,
        passed: eventType === EVENT_TYPES.VALIDATION_PASS,
        timestamp: new Date().toISOString()
      });
      break;
    case EVENT_TYPES.CHECKPOINT:
      manifest.checkpoints.push(data.checkpointId);
      break;
    case EVENT_TYPES.ERROR:
      manifest.errors.push({
        message: data.message,
        timestamp: new Date().toISOString()
      });
      break;
    case EVENT_TYPES.WARNING:
      manifest.warnings.push({
        message: data.message,
        timestamp: new Date().toISOString()
      });
      break;
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

/**
 * End the current run
 */
function endRun(runId, status = 'completed') {
  const runDir = path.join(RUNS_DIR, runId);
  if (!fs.existsSync(runDir)) {
    throw new Error(`Run not found: ${runId}`);
  }

  const manifestPath = path.join(runDir, 'manifest.json');
  const manifest = readJson(manifestPath, null);
  if (!manifest) {
    throw new Error(`Manifest not found for run: ${runId}`);
  }

  manifest.endedAt = new Date().toISOString();
  manifest.status = status;
  manifest.durationMs = new Date(manifest.endedAt) - new Date(manifest.startedAt);

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  logEvent(runId, EVENT_TYPES.RUN_END, { status });

  // Generate human-readable summary
  generateSummary(runId);

  // Update index
  updateIndex(runId, manifest);

  clearCurrentRun();

  return manifest;
}

/**
 * Generate human-readable summary
 */
function generateSummary(runId) {
  const runDir = path.join(RUNS_DIR, runId);
  const manifest = safeJsonParse(path.join(runDir, 'manifest.json'), null);
  if (!manifest) return;

  const tracePath = path.join(runDir, 'trace.jsonl');

  const events = fs.existsSync(tracePath)
    ? fs.readFileSync(tracePath, 'utf-8')
        .split('\n')
        .filter(line => line.trim())
        .map(line => safeJsonParseString(line, null))
        .filter(Boolean)
    : [];

  const durationSec = manifest.durationMs
    ? Math.round(manifest.durationMs / 1000)
    : 'N/A';

  let summary = `# Run: ${manifest.name}\n\n`;
  summary += `| Property | Value |\n`;
  summary += `|----------|-------|\n`;
  summary += `| **ID** | ${manifest.id} |\n`;
  summary += `| **Status** | ${manifest.status} |\n`;
  summary += `| **Started** | ${manifest.startedAt} |\n`;
  summary += `| **Duration** | ${durationSec}s |\n`;
  summary += `| **Steps** | ${manifest.steps} |\n`;
  summary += `| **LLM Calls** | ${manifest.llmCalls} |\n`;
  summary += `| **Tokens** | ${manifest.totalTokens.input} in / ${manifest.totalTokens.output} out |\n`;
  summary += `\n`;

  // Files section
  const totalFiles = manifest.filesCreated.length +
    manifest.filesModified.length +
    manifest.filesDeleted.length;

  if (totalFiles > 0) {
    summary += `## Files Changed (${totalFiles})\n\n`;

    if (manifest.filesCreated.length > 0) {
      summary += `### Created\n`;
      for (const file of manifest.filesCreated) {
        summary += `- \`${file}\`\n`;
      }
      summary += '\n';
    }

    if (manifest.filesModified.length > 0) {
      summary += `### Modified\n`;
      for (const file of manifest.filesModified) {
        summary += `- \`${file}\`\n`;
      }
      summary += '\n';
    }

    if (manifest.filesDeleted.length > 0) {
      summary += `### Deleted\n`;
      for (const file of manifest.filesDeleted) {
        summary += `- \`${file}\`\n`;
      }
      summary += '\n';
    }
  }

  // Validation section
  if (manifest.validationResults.length > 0) {
    summary += `## Validation Results\n\n`;
    for (const v of manifest.validationResults) {
      const icon = v.passed ? '✅' : '❌';
      summary += `- ${icon} \`${v.command}\`\n`;
    }
    summary += '\n';
  }

  // Errors section
  if (manifest.errors.length > 0) {
    summary += `## Errors\n\n`;
    for (const err of manifest.errors) {
      summary += `- ❌ ${err.message}\n`;
    }
    summary += '\n';
  }

  // Warnings section
  if (manifest.warnings.length > 0) {
    summary += `## Warnings\n\n`;
    for (const warn of manifest.warnings) {
      summary += `- ⚠️ ${warn.message}\n`;
    }
    summary += '\n';
  }

  // Steps timeline
  summary += `## Timeline\n\n`;
  let stepNum = 0;
  for (const event of events) {
    if (event.type === EVENT_TYPES.STEP_START) {
      stepNum++;
      const time = event.timestamp.slice(11, 19);
      summary += `### ${time} - Step ${stepNum}: ${event.data.name || 'Unnamed'}\n`;
    } else if (event.type === EVENT_TYPES.FILE_WRITE) {
      summary += `  - 📝 ${event.data.created ? 'Created' : 'Modified'}: \`${event.data.path}\`\n`;
    } else if (event.type === EVENT_TYPES.COMMAND_RUN) {
      summary += `  - 🖥️ Command: \`${event.data.command}\`\n`;
    } else if (event.type === EVENT_TYPES.ERROR) {
      summary += `  - ❌ Error: ${event.data.message}\n`;
    }
  }

  fs.writeFileSync(path.join(runDir, 'summary.md'), summary);
}

/**
 * Update the runs index
 */
function updateIndex(runId, manifest) {
  const indexPath = path.join(RUNS_DIR, 'index.json');
  let index = { runs: [], lastUpdated: new Date().toISOString() };

  if (fs.existsSync(indexPath)) {
    index = readJson(indexPath, index);
  }

  // Remove existing entry if updating
  index.runs = index.runs.filter(r => r.id !== runId);

  // Add new entry at the start
  index.runs.unshift({
    id: runId,
    name: manifest.name,
    status: manifest.status,
    startedAt: manifest.startedAt,
    endedAt: manifest.endedAt,
    durationMs: manifest.durationMs,
    steps: manifest.steps,
    filesChanged: manifest.filesCreated.length +
      manifest.filesModified.length +
      manifest.filesDeleted.length,
    errors: manifest.errors.length
  });

  // Load config for retention settings
  const configPath = path.join(PATHS.workflow, 'config.json');
  const config = readJson(configPath, {});
  const maxRuns = config.traces?.runs?.maxRuns || 100;

  // Keep only configured number of runs in index
  index.runs = index.runs.slice(0, maxRuns);
  index.lastUpdated = new Date().toISOString();

  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

/**
 * List recent runs
 */
function listRuns(limit = 10) {
  const indexPath = path.join(RUNS_DIR, 'index.json');
  const index = readJson(indexPath, null);
  if (!index) {
    return [];
  }
  return index.runs.slice(0, limit);
}

/**
 * Inspect a run
 */
function inspectRun(runId) {
  const runDir = path.join(RUNS_DIR, runId);
  if (!fs.existsSync(runDir)) {
    throw new Error(`Run not found: ${runId}`);
  }

  const manifest = safeJsonParse(path.join(runDir, 'manifest.json'), null);
  if (!manifest) {
    throw new Error(`Could not read manifest for run: ${runId}`);
  }

  const tracePath = path.join(runDir, 'trace.jsonl');
  const events = fs.existsSync(tracePath)
    ? fs.readFileSync(tracePath, 'utf-8')
        .split('\n')
        .filter(line => line.trim())
        .map(line => safeJsonParseString(line, null))
        .filter(Boolean)
    : [];

  const summaryPath = path.join(runDir, 'summary.md');
  const summary = fs.existsSync(summaryPath)
    ? fs.readFileSync(summaryPath, 'utf-8')
    : null;

  return { manifest, events, summary };
}

/**
 * Cleanup old runs based on retention policy
 */
function cleanupRuns() {
  const configPath = path.join(PATHS.workflow, 'config.json');
  const cleanupConfig = readJson(configPath, {});
  const retentionDays = cleanupConfig.traces?.runs?.retentionDays || 30;
  const maxRuns = cleanupConfig.traces?.runs?.maxRuns || 100;

  if (!fs.existsSync(RUNS_DIR)) return { deleted: 0 };

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const indexPath = path.join(RUNS_DIR, 'index.json');
  const index = readJson(indexPath, null);
  if (!index) return { deleted: 0 };
  let deleted = 0;

  // Delete runs older than retention period or exceeding max
  const runsToKeep = [];
  for (let i = 0; i < index.runs.length; i++) {
    const run = index.runs[i];
    const runDate = new Date(run.startedAt);

    if (runDate < cutoffDate || i >= maxRuns) {
      // Delete run directory
      const runDir = path.join(RUNS_DIR, run.id);
      if (fs.existsSync(runDir)) {
        fs.rmSync(runDir, { recursive: true });
        deleted++;
      }
    } else {
      runsToKeep.push(run);
    }
  }

  // Update index
  index.runs = runsToKeep;
  index.lastUpdated = new Date().toISOString();
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

  return { deleted };
}

/**
 * Format runs for display
 */
function formatRunsForDisplay(runs) {
  if (runs.length === 0) {
    return `${c.dim}No runs recorded yet.${c.reset}`;
  }

  let output = `${c.cyan}${c.bold}Recent Runs${c.reset}\n`;
  output += `${'─'.repeat(80)}\n`;

  for (const run of runs) {
    const statusColor = run.status === 'completed' ? c.green :
                       run.status === 'failed' ? c.red :
                       run.status === 'running' ? c.yellow : c.dim;

    const statusIcon = run.status === 'completed' ? '✅' :
                      run.status === 'failed' ? '❌' :
                      run.status === 'running' ? '🔄' : '⏸️';

    const duration = run.durationMs
      ? `${Math.round(run.durationMs / 1000)}s`
      : 'running';

    output += `${statusIcon} ${c.bold}${run.name}${c.reset}`;
    output += ` ${c.dim}(${run.id})${c.reset}\n`;
    output += `   ${statusColor}${run.status}${c.reset}`;
    output += ` | ${duration}`;
    output += ` | ${run.steps} steps`;
    output += ` | ${run.filesChanged} files`;
    if (run.errors > 0) {
      output += ` | ${c.red}${run.errors} errors${c.reset}`;
    }
    output += '\n';
  }

  return output;
}

// ============================================================
// Module exports
// ============================================================

module.exports = {
  EVENT_TYPES,
  generateRunId,
  startRun,
  logEvent,
  endRun,
  getCurrentRunId,
  setCurrentRun,
  clearCurrentRun,
  listRuns,
  inspectRun,
  generateSummary,
  cleanupRuns
};

// ============================================================
// CLI Handler
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  const jsonOutput = args.includes('--json');

  try {
    switch (command) {
      case 'start': {
        const name = args[1] || 'unnamed';
        const runId = startRun(name);
        if (jsonOutput) {
          console.log(JSON.stringify({ success: true, runId }));
        } else {
          printSuccess(`Started run: ${runId}`);
        }
        break;
      }

      case 'event': {
        const currentId = getCurrentRunId();
        if (!currentId) {
          throw new Error('No active run');
        }
        const eventType = args[1];
        const eventData = args[2] ? JSON.parse(args[2]) : {};
        logEvent(currentId, eventType, eventData);
        if (!jsonOutput) {
          console.log(`${c.dim}Event logged: ${eventType}${c.reset}`);
        }
        break;
      }

      case 'end': {
        const currentId = getCurrentRunId();
        if (!currentId) {
          throw new Error('No active run');
        }
        const status = args[1] || 'completed';
        const manifest = endRun(currentId, status);
        if (jsonOutput) {
          console.log(JSON.stringify({ success: true, manifest }));
        } else {
          printSuccess(`Ended run: ${currentId} (${status})`);
        }
        break;
      }

      case 'list': {
        const limitIdx = args.indexOf('--limit');
        const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 10;
        const runs = listRuns(limit);
        if (jsonOutput) {
          console.log(JSON.stringify(runs, null, 2));
        } else {
          console.log(formatRunsForDisplay(runs));
        }
        break;
      }

      case 'inspect': {
        const runId = args[1];
        if (!runId) {
          throw new Error('Run ID required');
        }
        const data = inspectRun(runId);
        if (jsonOutput) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log(data.summary || JSON.stringify(data.manifest, null, 2));
        }
        break;
      }

      case 'current': {
        const currentId = getCurrentRunId();
        if (jsonOutput) {
          console.log(JSON.stringify({ currentRunId: currentId }));
        } else {
          console.log(currentId || 'No active run');
        }
        break;
      }

      case 'cleanup': {
        const result = cleanupRuns();
        if (jsonOutput) {
          console.log(JSON.stringify(result));
        } else {
          printSuccess(`Cleaned up ${result.deleted} old runs`);
        }
        break;
      }

      default:
        console.log(`
${c.cyan}Wogi Flow - Run Trace Manager${c.reset}

${c.bold}Usage:${c.reset}
  flow run-trace start <name>       Start a new run
  flow run-trace event <type> <json> Log an event to current run
  flow run-trace end [status]       End current run (completed|failed|aborted)
  flow run-trace list [--limit N]   List recent runs
  flow run-trace inspect <run-id>   Show run details
  flow run-trace current            Show current run ID
  flow run-trace cleanup            Remove old runs per retention policy

${c.bold}Options:${c.reset}
  --json                            Output in JSON format

${c.bold}Event Types:${c.reset}
  ${Object.keys(EVENT_TYPES).map(k => `  ${k}`).join('\n')}
        `);
    }
  } catch (err) {
    if (jsonOutput) {
      console.error(JSON.stringify({ success: false, error: err.message }));
    } else {
      console.error(`${c.red}Error: ${err.message}${c.reset}`);
    }
    process.exit(1);
  }
}
