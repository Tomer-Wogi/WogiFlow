#!/usr/bin/env node

/**
 * Wogi Flow - Agent Teams Integration Module
 *
 * Integrates with Claude Code's Agent Teams feature (experimental).
 * Provides:
 * - Teammate state tracking (who's working on what)
 * - Lead session detection (prevent lead from implementing directly)
 * - File-conflict detection (avoid assigning tasks that touch same files)
 * - Parallelizability scoring (rate tasks by independence level)
 *
 * Usage:
 *   const { isTeamLeadSession, getTeammateState, checkFileConflicts, scoreParallelizability } = require('./flow-agent-teams');
 */

const fs = require('fs');
const path = require('path');
const { getConfig, PATHS, safeJsonParse } = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

const TEAMMATES_FILE = path.join(PATHS.state, 'teammates.json');

const DEFAULT_AGENT_TEAMS_CONFIG = {
  enabled: false,
  teammateDispatch: {
    mode: 'suggest',       // 'suggest' | 'dispatch'
    includeContext: true,
    avoidFileConflicts: true
  },
  leadEnforcement: {
    enabled: false,
    mode: 'warn'           // 'warn' | 'block'
  },
  stateTracking: {
    enabled: true
  }
};

// ============================================================
// Agent Teams Config
// ============================================================

/**
 * Get agent teams configuration, merged with defaults
 * @returns {Object}
 */
function getAgentTeamsConfig() {
  const config = getConfig();
  return {
    ...DEFAULT_AGENT_TEAMS_CONFIG,
    ...(config.agentTeams || {}),
    teammateDispatch: {
      ...DEFAULT_AGENT_TEAMS_CONFIG.teammateDispatch,
      ...(config.agentTeams?.teammateDispatch || {})
    },
    leadEnforcement: {
      ...DEFAULT_AGENT_TEAMS_CONFIG.leadEnforcement,
      ...(config.agentTeams?.leadEnforcement || {})
    },
    stateTracking: {
      ...DEFAULT_AGENT_TEAMS_CONFIG.stateTracking,
      ...(config.agentTeams?.stateTracking || {})
    }
  };
}

// ============================================================
// Team Lead Detection
// ============================================================

/**
 * Detect if the current session is running as a team lead.
 *
 * Heuristics:
 * 1. CLAUDE_CODE_AGENT_TEAMS=1 env var is set
 * 2. Session has spawned teammates (check teammates.json)
 * 3. Lead enforcement is enabled in config
 *
 * @returns {{ isLead: boolean, confidence: string, reason: string }}
 */
function detectTeamLead() {
  const agentTeamsEnv = process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === '1'
    || process.env.CLAUDE_CODE_AGENT_TEAMS === '1';

  if (!agentTeamsEnv) {
    return { isLead: false, confidence: 'high', reason: 'agent_teams_not_enabled' };
  }

  // Check if we have active teammates (indicating we're the lead)
  const state = getTeammateState();
  const hasActiveTeammates = state.teammates.some(t => t.status === 'active' || t.status === 'idle');

  if (hasActiveTeammates) {
    return { isLead: true, confidence: 'high', reason: 'has_active_teammates' };
  }

  // Agent teams env is set but no teammates yet - might be pre-spawn
  // Check if the lead spawner marker exists
  const isSpawner = process.env.CLAUDE_CODE_TEAM_ROLE === 'lead';
  if (isSpawner) {
    return { isLead: true, confidence: 'high', reason: 'team_role_lead' };
  }

  // Agent teams enabled but unclear if we're lead or teammate
  return { isLead: false, confidence: 'low', reason: 'agent_teams_enabled_role_unclear' };
}

/**
 * Check if the current session is a team lead and should enforce delegation
 * @returns {{ enforce: boolean, mode: string, message: string|null }}
 */
function checkLeadEnforcement() {
  const config = getAgentTeamsConfig();

  if (!config.leadEnforcement.enabled) {
    return { enforce: false, mode: 'off', message: null };
  }

  const detection = detectTeamLead();

  if (!detection.isLead) {
    return { enforce: false, mode: 'off', message: null };
  }

  return {
    enforce: true,
    mode: config.leadEnforcement.mode,
    message: `Team Lead detected: You are the team lead (${detection.reason}). ` +
      `Use the Task tool to delegate work to teammates instead of editing files directly. ` +
      `Press Shift+Tab to enable delegate mode for coordination-only tools.`
  };
}

// ============================================================
// Teammate State Tracking
// ============================================================

/**
 * Read current teammate state
 * @returns {{ teammates: Array, lastUpdated: string|null }}
 */
function getTeammateState() {
  return safeJsonParse(TEAMMATES_FILE, {
    teammates: [],
    lastUpdated: null
  });
}

/**
 * Register a new teammate
 * @param {Object} teammate - { id, role, taskId, status }
 */
function registerTeammate(teammate) {
  const state = getTeammateState();

  // Update existing or add new
  const existing = state.teammates.findIndex(t => t.id === teammate.id);
  const entry = {
    id: teammate.id,
    role: teammate.role || 'developer',
    taskId: teammate.taskId || null,
    status: teammate.status || 'active',
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString()
  };

  if (existing >= 0) {
    state.teammates[existing] = { ...state.teammates[existing], ...entry };
  } else {
    state.teammates.push(entry);
  }

  state.lastUpdated = new Date().toISOString();
  saveTeammateState(state);
  return entry;
}

/**
 * Update a teammate's status
 * @param {string} teammateId
 * @param {Object} updates - { status, taskId, etc }
 */
function updateTeammate(teammateId, updates) {
  const state = getTeammateState();
  const idx = state.teammates.findIndex(t => t.id === teammateId);

  if (idx >= 0) {
    state.teammates[idx] = {
      ...state.teammates[idx],
      ...updates,
      lastUpdated: new Date().toISOString()
    };
    state.lastUpdated = new Date().toISOString();
    saveTeammateState(state);
    return state.teammates[idx];
  }

  return null;
}

/**
 * Mark a teammate as idle (task completed)
 * @param {string} teammateId
 */
function markTeammateIdle(teammateId) {
  return updateTeammate(teammateId, { status: 'idle', taskId: null });
}

/**
 * Get active teammates and their current tasks
 * @returns {Array} Active teammate entries
 */
function getActiveTeammates() {
  const state = getTeammateState();
  return state.teammates.filter(t => t.status === 'active');
}

/**
 * Get files currently being worked on by active teammates
 * Cross-references teammate taskIds with ready.json specs
 * @returns {Map<string, string>} Map of filePath → teammateId
 */
function getFilesInProgress() {
  const fileMap = new Map();
  const activeTeammates = getActiveTeammates();

  if (activeTeammates.length === 0) return fileMap;

  // Read ready.json for inProgress tasks
  const readyPath = path.join(PATHS.state, 'ready.json');
  const ready = safeJsonParse(readyPath, { inProgress: [] });

  for (const teammate of activeTeammates) {
    if (!teammate.taskId) continue;

    // Find the task in inProgress
    const task = (ready.inProgress || []).find(t => t.id === teammate.taskId);
    if (!task) continue;

    // Try to get files from task spec
    const files = getTaskFiles(task);
    for (const file of files) {
      fileMap.set(file, teammate.id);
    }
  }

  return fileMap;
}

/**
 * Save teammate state to file
 * @param {Object} state
 */
function saveTeammateState(state) {
  try {
    fs.writeFileSync(TEAMMATES_FILE, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[flow-agent-teams] Failed to save teammate state: ${err.message}`);
    }
  }
}

// ============================================================
// File Conflict Detection
// ============================================================

/**
 * Extract files from a task (from spec or filesToChange)
 * @param {Object} task - Task object from ready.json
 * @returns {Array<string>} File paths
 */
function getTaskFiles(task) {
  const files = [];

  // Direct filesToChange on the task
  if (task.filesToChange && Array.isArray(task.filesToChange)) {
    files.push(...task.filesToChange);
  }

  // From files array
  if (task.files && Array.isArray(task.files)) {
    files.push(...task.files);
  }

  // Try to read the spec file for more detail
  if (task.specPath) {
    try {
      const specContent = fs.readFileSync(task.specPath, 'utf-8');
      // Extract file paths from markdown code blocks and "Files to Change" sections
      const filePattern = /(?:^|\s)((?:scripts|src|\.workflow|\.claude)\/[^\s,)]+\.\w+)/gm;
      let match;
      while ((match = filePattern.exec(specContent)) !== null) {
        if (!files.includes(match[1])) {
          files.push(match[1]);
        }
      }
    } catch {
      // Spec file not readable, use what we have
    }
  }

  return files;
}

/**
 * Check if a candidate task conflicts with currently active work
 * @param {Object} candidateTask - Task to check
 * @returns {{ hasConflict: boolean, conflictingFiles: Array, conflictingTeammate: string|null }}
 */
function checkFileConflicts(candidateTask) {
  const config = getAgentTeamsConfig();

  if (!config.teammateDispatch.avoidFileConflicts) {
    return { hasConflict: false, conflictingFiles: [], conflictingTeammate: null };
  }

  const filesInProgress = getFilesInProgress();
  const candidateFiles = getTaskFiles(candidateTask);
  const conflictingFiles = [];
  let conflictingTeammate = null;

  for (const file of candidateFiles) {
    if (filesInProgress.has(file)) {
      conflictingFiles.push(file);
      conflictingTeammate = filesInProgress.get(file);
    }
  }

  return {
    hasConflict: conflictingFiles.length > 0,
    conflictingFiles,
    conflictingTeammate
  };
}

// ============================================================
// Parallelizability Scoring
// ============================================================

/**
 * Score a set of tasks by how parallelizable they are.
 * Higher score = more independent = better for parallel execution.
 *
 * Factors:
 * - File overlap with other tasks (negative)
 * - Explicit dependencies (negative)
 * - Same feature area (slightly negative)
 * - Different types (slightly positive)
 *
 * @param {Array} tasks - Array of task objects
 * @returns {Array<{ taskId: string, score: number, label: string, details: Object }>}
 */
function scoreParallelizability(tasks) {
  if (!tasks || tasks.length < 2) {
    return tasks ? tasks.map(t => ({
      taskId: t.id,
      score: 100,
      label: 'independent',
      details: { reason: 'single_task' }
    })) : [];
  }

  const { detectDependencies } = require('./flow-parallel');
  const dependencies = detectDependencies(tasks);
  const results = [];

  for (const task of tasks) {
    let score = 100;
    const penalties = {};

    // Penalty: explicit dependencies
    const deps = dependencies[task.id] || [];
    if (deps.length > 0) {
      const depPenalty = Math.min(deps.length * 25, 75);
      score -= depPenalty;
      penalties.dependencies = { count: deps.length, penalty: depPenalty };
    }

    // Penalty: file overlap with other tasks
    const taskFiles = getTaskFiles(task);
    let maxOverlap = 0;
    for (const other of tasks) {
      if (other.id === task.id) continue;
      const otherFiles = getTaskFiles(other);
      const overlap = taskFiles.filter(f => otherFiles.includes(f)).length;
      maxOverlap = Math.max(maxOverlap, overlap);
    }
    if (maxOverlap > 0) {
      const overlapPenalty = Math.min(maxOverlap * 15, 60);
      score -= overlapPenalty;
      penalties.fileOverlap = { count: maxOverlap, penalty: overlapPenalty };
    }

    // Penalty: same feature area as another task
    const sameFeatureCount = tasks.filter(t =>
      t.id !== task.id && t.feature && task.feature && t.feature === task.feature
    ).length;
    if (sameFeatureCount > 0) {
      const featurePenalty = Math.min(sameFeatureCount * 5, 15);
      score -= featurePenalty;
      penalties.sameFeature = { count: sameFeatureCount, penalty: featurePenalty };
    }

    // Clamp score
    score = Math.max(0, Math.min(100, score));

    // Label
    let label;
    if (score >= 80) label = 'parallel-safe';
    else if (score >= 50) label = 'parallelizable';
    else if (score >= 25) label = 'sequential-preferred';
    else label = 'sequential-only';

    results.push({
      taskId: task.id,
      score,
      label,
      details: penalties
    });
  }

  return results;
}

/**
 * Get a summary of parallelizability for display in /wogi-ready
 * @param {Array} tasks
 * @returns {{ parallelCount: number, sequentialCount: number, summary: string, scores: Array }}
 */
function getParallelizabilitySummary(tasks) {
  if (!tasks || tasks.length < 2) {
    return {
      parallelCount: 0,
      sequentialCount: tasks ? tasks.length : 0,
      summary: 'Not enough tasks for parallel analysis',
      scores: []
    };
  }

  const scores = scoreParallelizability(tasks);
  const parallelCount = scores.filter(s => s.score >= 50).length;
  const sequentialCount = scores.filter(s => s.score < 50).length;

  let summary;
  if (parallelCount >= 2) {
    summary = `${parallelCount} tasks parallelizable, ${sequentialCount} must run sequentially`;
  } else {
    summary = `Tasks have high interdependence - sequential execution recommended`;
  }

  return { parallelCount, sequentialCount, summary, scores };
}

// ============================================================
// Task Context for Dispatch
// ============================================================

/**
 * Build rich task context for teammate dispatch.
 * Returns everything a teammate needs to start working.
 *
 * @param {Object} task - Task from ready.json
 * @returns {Object} Rich context object
 */
function buildTaskContext(task) {
  const context = {
    taskId: task.id,
    title: task.title,
    type: task.type || 'task',
    priority: task.priority || 'P2',
    description: task.description || '',
    files: getTaskFiles(task),
    acceptanceCriteria: [],
    patterns: []
  };

  // Try to load spec for acceptance criteria
  if (task.specPath) {
    try {
      const specContent = fs.readFileSync(task.specPath, 'utf-8');
      // Extract Given/When/Then patterns
      const criteriaPattern = /(?:Given|When|Then|And)\s+.+/g;
      const matches = specContent.match(criteriaPattern);
      if (matches) {
        context.acceptanceCriteria = matches.slice(0, 10); // Limit to 10
      }
    } catch {
      // Spec not readable
    }
  }

  // Load relevant patterns from decisions.md
  try {
    const decisionsPath = path.join(PATHS.state, 'decisions.md');
    if (fs.existsSync(decisionsPath)) {
      const decisions = fs.readFileSync(decisionsPath, 'utf-8');
      // Extract the first 3 relevant patterns (keep context small)
      const patternMatches = decisions.match(/^###?\s+.+$/gm);
      if (patternMatches) {
        context.patterns = patternMatches.slice(0, 3);
      }
    }
  } catch {
    // Decisions not readable
  }

  return context;
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Config
  getAgentTeamsConfig,

  // Lead detection
  detectTeamLead,
  checkLeadEnforcement,

  // Teammate state
  getTeammateState,
  registerTeammate,
  updateTeammate,
  markTeammateIdle,
  getActiveTeammates,
  saveTeammateState,
  TEAMMATES_FILE,

  // File conflicts
  getFilesInProgress,
  getTaskFiles,
  checkFileConflicts,

  // Parallelizability
  scoreParallelizability,
  getParallelizabilitySummary,

  // Task context
  buildTaskContext
};

// ============================================================
// CLI
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'status': {
      const state = getTeammateState();
      console.log('\nAgent Teams Status:\n');
      if (state.teammates.length === 0) {
        console.log('  No teammates registered');
      } else {
        for (const t of state.teammates) {
          console.log(`  ${t.id}: ${t.status} (role: ${t.role}, task: ${t.taskId || 'none'})`);
        }
      }
      console.log(`\nLast updated: ${state.lastUpdated || 'never'}`);
      break;
    }

    case 'detect': {
      const detection = detectTeamLead();
      console.log('\nTeam Lead Detection:');
      console.log(`  Is lead: ${detection.isLead}`);
      console.log(`  Confidence: ${detection.confidence}`);
      console.log(`  Reason: ${detection.reason}`);
      break;
    }

    case 'scores': {
      const readyPath = path.join(PATHS.state, 'ready.json');
      const ready = safeJsonParse(readyPath, { ready: [] });
      const tasks = ready.ready || [];

      if (tasks.length < 2) {
        console.log('\nNeed 2+ ready tasks for scoring');
        break;
      }

      const summary = getParallelizabilitySummary(tasks);
      console.log('\nParallelizability Scores:\n');
      for (const s of summary.scores) {
        console.log(`  ${s.taskId}: ${s.score}/100 (${s.label})`);
        if (Object.keys(s.details).length > 0) {
          console.log(`    Penalties: ${JSON.stringify(s.details)}`);
        }
      }
      console.log(`\nSummary: ${summary.summary}`);
      break;
    }

    default:
      console.log(`
Wogi Flow - Agent Teams Integration

Usage:
  node flow-agent-teams.js <command>

Commands:
  status        Show teammate state
  detect        Detect if running as team lead
  scores        Show parallelizability scores for ready tasks
`);
  }
}
