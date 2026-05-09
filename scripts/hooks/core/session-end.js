#!/usr/bin/env node

/**
 * Wogi Flow - Session End (Core Module)
 *
 * CLI-agnostic session end logic.
 * Called when a session ends.
 *
 * Handles:
 * - Checking for uncommitted work
 * - Auto-logging status
 *
 * Returns a standardized result that adapters transform for specific CLIs.
 */

const { execFileSync } = require('node:child_process');
const { getConfig, PATHS } = require('../../flow-utils');
const { cleanStaleFiles } = require('./session-context');

/**
 * Check if auto-logging is enabled
 * @returns {boolean}
 */
function isAutoLoggingEnabled() {
  const config = getConfig();
  return config.hooks?.rules?.autoLogging?.enabled !== false;
}

/**
 * Get uncommitted file count
 * @returns {number}
 */
function getUncommittedCount() {
  try {
    const output = execFileSync('git', ['status', '--porcelain'], {
      cwd: PATHS.root,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return output.trim().split('\n').filter(line => line.trim()).length;
  } catch (_err) {
    return 0;
  }
}

/**
 * Handle session end event
 * @param {Object} input - Parsed hook input
 * @returns {Object} Core result
 */
function handleSessionEnd(input) {
  const result = {
    logged: false,
    warning: null
  };

  try {
    // Check for uncommitted work
    const uncommitted = getUncommittedCount();
    if (uncommitted > 0) {
      result.warning = `${uncommitted} uncommitted file${uncommitted !== 1 ? 's' : ''}. Consider committing before ending session.`;
    }

    // Auto-logging would go here but requires more session context
    // For now, just warn about uncommitted work
    if (isAutoLoggingEnabled()) {
      // Could integrate with flow-session-end.js in the future
      result.logged = false;
    }

    // wf-2eafdab0 (AC8): GC stale architect-run markers for completed tasks.
    // Markers in `.workflow/state/architect-runs/` accumulate forever otherwise;
    // task-id collision (re-used fixtures, manual ID re-use) bypasses the gate.
    // Fail-open everywhere — never block session end.
    try {
      const { gcStaleMarkers } = require('../../flow-architect-runs');
      const gc = gcStaleMarkers(); // default 7-day retention for completed tasks
      if (gc && gc.removed && gc.removed.length > 0) {
        result.architectMarkerGc = { removed: gc.removed.length };
      }
    } catch (_err) { /* non-critical */ }

    // Surface pending skill proposals staged by `flow skill propose|patch|remove`.
    // These await user approval (`flow skill promote|reject`) at session end.
    try {
      const { summarizePendingProposals } = require('./session-end-skill-proposals');
      const summary = summarizePendingProposals();
      if (summary) {
        result.pendingSkillProposals = summary;
      }
    } catch (_err) {
      // Non-critical — never block session end
    }

    // Surface pending IGR-artifact memory proposals staged by `flow memory
    // propose`. These await user approval (`flow memory approve|reject`) at
    // session end. Story: wf-4434851f.
    try {
      const { summarizePendingMemoryProposals } = require('./session-end-memory-proposals');
      const summary = summarizePendingMemoryProposals();
      if (summary) {
        result.pendingMemoryProposals = summary;
      }
    } catch (_err) {
      // Non-critical — never block session end
    }

    // Scratch directory cleanup — remove temp files created during session
    try {
      const fs = require('node:fs');
      const path = require('node:path');
      const scratchDir = path.join(PATHS.workflow, 'scratch');
      if (fs.existsSync(scratchDir)) {
        const files = fs.readdirSync(scratchDir);
        let scratchCleaned = 0;
        for (const file of files) {
          if (file === '.gitkeep') continue; // Keep the directory marker
          try {
            const filePath = path.join(scratchDir, file);
            const stat = fs.statSync(filePath);
            if (stat.isFile()) {
              fs.unlinkSync(filePath);
              scratchCleaned++;
            } else if (stat.isDirectory()) {
              fs.rmSync(filePath, { recursive: true, force: true });
              scratchCleaned++;
            }
          } catch (_err) {
            // Skip files that can't be deleted
          }
        }
        if (scratchCleaned > 0) {
          result.scratchCleaned = scratchCleaned;
        }
      }
    } catch (_err) {
      // Non-critical — never block session end
    }

    // Clear phase-reads state — prevents cross-session bleed where stale
    // "already read" records from a previous session silently bypass the
    // phase-read gate when a new session starts in the same phase.
    try {
      const { clearPhaseReads } = require('./phase-read-gate');
      clearPhaseReads();
    } catch (_err) {
      // Non-critical — phase-read gate may not be installed
    }

    try {
      const { clearResearchEvidence } = require('./research-evidence-gate');
      clearResearchEvidence();
    } catch (_err) {
      // Non-critical — research-evidence gate may not be installed
    }

    // State folder hygiene — clean stale/orphan files (fire-and-forget)
    try {
      const hygiene = cleanStaleFiles();
      if (hygiene.cleaned > 0) {
        result.cleaned = hygiene.files;
      }
      if (hygiene.warnings && hygiene.warnings.length > 0) {
        result.hygieneWarnings = hygiene.warnings;
      }
    } catch (_err) {
      // Non-critical — never block session end
    }

    // Community sync: upload anonymized stats (fire-and-forget)
    try {
      const { syncUp } = require('../../flow-community-sync');
      syncUp().catch((err) => {
        if (process.env.DEBUG) {
          console.error(`[Session End] Community sync-up failed: ${err.message}`);
        }
      });
    } catch (_err) {
      // Non-critical — community sync module may not be available
    }

    // Memory pipeline: remember session learnings (fire-and-forget)
    try {
      const memoryDb = require('../../flow-memory-db');
      const summary = input.sessionSummary || input.summary || '';
      if (summary) {
        memoryDb.rememberSessionLearnings(summary).catch(() => {
          // Non-critical - memory pipeline may not be available
        });
      }
    } catch (_err) {
      // Non-critical — memory DB may not be available
    }

    // Promotion pipeline (wf-6a352aae) — scan adversary-runs + correction-patterns
    // for content that should be promoted to feedback-patterns.md. Writes to
    // pending-promotions.json; user reviews via `flow promote apply`.
    // Fire-and-forget, gated by config.promotion.autoAtSessionEnd.
    try {
      const cfg = getConfig();
      if (cfg.promotion?.autoAtSessionEnd !== false) {
        const promote = require('../../flow-promote');
        promote.promoteAll(promote.getPromotionConfig()).then((r) => {
          if (r.proposed > 0) {
            result.pendingPromotions = {
              count: r.proposed,
              message: `${r.proposed} promotion(s) ready. Run \`flow promote apply\` to write to feedback-patterns.md.`,
            };
          }
        }).catch((err) => {
          if (process.env.DEBUG) {
            console.error(`[Session End] Promotion pipeline failed: ${err.message}`);
          }
        });
      }
    } catch (err) {
      // Non-critical — promotion module may not be available
      if (process.env.DEBUG) {
        console.error(`[Session End] Promotion module unavailable: ${err.message}`);
      }
    }
  } catch (err) {
    result.warning = `Session end handler error: ${err.message}`;
  }

  return result;
}

module.exports = { handleSessionEnd, isAutoLoggingEnabled, getUncommittedCount };
