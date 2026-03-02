#!/usr/bin/env node

/**
 * Wogi Flow - Sync Anonymizer
 *
 * Strips PII and project-specific data from stats before uploading
 * to the community knowledge sync service.
 *
 * Part of S6: Community Knowledge Sync
 *
 * Privacy rules:
 * - STRIP: file paths, task descriptions, code content, project names
 * - KEEP: model ID, task type, iteration count, first-attempt rate,
 *         token count, wall clock time, revision rate, WogiFlow version
 */

const path = require('path');
const { getConfig, PATHS } = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

// Fields that are safe to include in uploads
const SAFE_FIELDS = new Set([
  'model',
  'taskType',
  'iterations',
  'firstAttemptPass',
  'tokenEstimate',
  'wallClockMs',
  'revisionCount',
  'scenarioCount',
  'timestamp'
]);

// Fields that must be stripped (PII/project-specific)
const STRIP_FIELDS = new Set([
  'taskId',
  'changedFiles',
  'qualityGateResults',
  'specPath',
  'description',
  'title',
  'feature',
  'parentEpic'
]);

// ============================================================
// Anonymization Functions
// ============================================================

/**
 * Anonymize a single task record for upload.
 *
 * @param {Object} record - Raw task record from stats
 * @returns {Object} Anonymized record safe for upload
 */
function anonymizeRecord(record) {
  if (!record || typeof record !== 'object') return null;

  const anonymized = {};

  for (const [key, value] of Object.entries(record)) {
    // Explicitly safe fields
    if (SAFE_FIELDS.has(key)) {
      anonymized[key] = value;
      continue;
    }

    // Explicitly stripped fields
    if (STRIP_FIELDS.has(key)) {
      continue;
    }

    // Unknown fields: strip by default (deny-by-default for privacy safety)
    // Do NOT pass through unknown fields, even if numeric/boolean —
    // new fields must be explicitly added to SAFE_FIELDS
  }

  return anonymized;
}

/**
 * Anonymize a batch of task records.
 *
 * @param {Object[]} records - Array of raw task records
 * @returns {Object[]} Anonymized records
 */
function anonymizeBatch(records) {
  if (!Array.isArray(records)) return [];
  return records.map(anonymizeRecord).filter(Boolean);
}

/**
 * Create a privacy-safe upload payload.
 *
 * @param {Object} params - Payload parameters
 * @param {Object[]} params.records - Task records to include
 * @param {Object} [params.capabilityScores] - Local capability scores
 * @param {Object} [params.routingEffectiveness] - Routing effectiveness data
 * @returns {Object} Upload payload
 */
function createUploadPayload(params) {
  const { records, capabilityScores, routingEffectiveness } = params;
  const config = getConfig();

  // Get WogiFlow version from package.json
  let version = 'unknown';
  try {
    const pkg = require(path.join(PATHS.root, 'package.json'));
    version = pkg.version || 'unknown';
  } catch (err) {
    // Non-critical
  }

  const payload = {
    version,
    uploadedAt: new Date().toISOString(),
    records: anonymizeBatch(records)
  };

  // Include anonymized capability scores (no file paths)
  if (capabilityScores && typeof capabilityScores === 'object') {
    payload.capabilityScores = {};
    for (const [model, scores] of Object.entries(capabilityScores)) {
      if (typeof scores === 'object' && scores !== null) {
        // Only include taskScores (numeric values)
        payload.capabilityScores[model] = {};
        for (const [key, value] of Object.entries(scores)) {
          if (typeof value === 'number') {
            payload.capabilityScores[model][key] = value;
          }
        }
      }
    }
  }

  // Include routing effectiveness (already numeric)
  if (routingEffectiveness && typeof routingEffectiveness === 'object') {
    payload.routingEffectiveness = {};
    for (const [key, value] of Object.entries(routingEffectiveness)) {
      if (typeof value === 'number') {
        payload.routingEffectiveness[key] = value;
      }
    }
  }

  return payload;
}

/**
 * Preview what would be uploaded (for user transparency).
 *
 * @param {Object[]} records - Task records
 * @returns {string} Formatted preview
 */
function previewUpload(records) {
  const anonymized = anonymizeBatch(records);
  const lines = [];

  lines.push('Community Sync Upload Preview');
  lines.push('═'.repeat(50));
  lines.push(`Records: ${anonymized.length}`);
  lines.push('');
  lines.push('Fields included per record:');
  if (anonymized.length > 0) {
    const sampleKeys = Object.keys(anonymized[0]);
    for (const key of sampleKeys) {
      lines.push(`  - ${key}`);
    }
  }
  lines.push('');
  lines.push('Fields EXCLUDED (privacy):');
  for (const field of STRIP_FIELDS) {
    lines.push(`  - ${field}`);
  }
  lines.push('');
  lines.push('Sample record:');
  if (anonymized.length > 0) {
    lines.push(JSON.stringify(anonymized[0], null, 2));
  }

  return lines.join('\n');
}

// ============================================================
// CLI
// ============================================================

function main() {
  const [command] = process.argv.slice(2);

  switch (command) {
    case 'preview': {
      // Load real stats and preview
      try {
        const { loadStats } = require('./flow-stats-collector');
        const stats = loadStats();
        console.log(previewUpload(stats.recentTasks || []));
      } catch (err) {
        console.error(`Cannot load stats: ${err.message}`);
      }
      break;
    }

    case 'test': {
      // Test with sample data
      const sample = [
        {
          taskId: 'wf-abc123',
          model: 'claude-opus-4-6',
          taskType: 'feature',
          iterations: 2,
          firstAttemptPass: true,
          tokenEstimate: 5000,
          wallClockMs: 30000,
          changedFiles: ['src/secret.ts'],
          description: 'Add user auth'
        }
      ];
      console.log(previewUpload(sample));
      break;
    }

    default:
      console.log(`
Sync Anonymizer

Usage: flow-sync-anonymizer.js <command>

Commands:
  preview   Preview what would be uploaded from current stats
  test      Test with sample data
`);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  anonymizeRecord,
  anonymizeBatch,
  createUploadPayload,
  previewUpload,
  SAFE_FIELDS,
  STRIP_FIELDS
};

if (require.main === module) {
  main();
}
