#!/usr/bin/env node

/**
 * Wogi Flow - Hash-Based ID Generation & Validation
 *
 * Generates collision-resistant 8-char hex IDs for work items:
 *   wf-XXXXXXXX  (task), ep-XXXXXXXX (epic), ft-XXXXXXXX (feature), pl-XXXXXXXX (plan)
 *
 * Extracted from flow-utils.js (wf-94cc3b72 epic — flow-utils decomposition).
 * Zero external deps beyond node:crypto — pure helpers.
 */

'use strict';

const crypto = require('node:crypto');

/**
 * Generate a hash-based ID with a given prefix.
 * Uses SHA256 of (seed + title + timestamp + randomBytes) for collision resistance.
 *
 * @param {string} prefix - ID prefix (e.g., 'wf', 'ep', 'ft', 'pl')
 * @param {string} seed - Seed string for the hash (e.g., '', 'epic-', 'feature-')
 * @param {string} title - Title to include in hash input
 * @returns {string} ID in format prefix-XXXXXXXX
 */
function generateHashId(prefix, seed, title) {
  const randomHex = crypto.randomBytes(8).toString('hex');
  const input = `${seed}${title}${Date.now()}${randomHex}`;
  const hash = crypto.createHash('sha256').update(input).digest('hex').slice(0, 8);
  return `${prefix}-${hash}`;
}

/**
 * Generate a hash-based task ID
 * Format: wf-XXXXXXXX (8-char hex hash)
 * @example generateTaskId('Fix login bug') // => 'wf-a1b2c3d4'
 */
function generateTaskId(title) {
  return generateHashId('wf', '', title);
}

/** Generate a hash-based epic ID (ep-XXXXXXXX) */
function generateEpicId(title) {
  return generateHashId('ep', 'epic-', title);
}

/** Generate a hash-based feature ID (ft-XXXXXXXX) */
function generateFeatureId(title) {
  return generateHashId('ft', 'feature-', title);
}

/** Generate a hash-based plan ID (pl-XXXXXXXX) */
function generatePlanId(title) {
  return generateHashId('pl', 'plan-', title);
}

/**
 * Check if a string is a valid task ID.
 * @returns {{ valid: boolean, format: 'hash' | 'slug' | 'legacy' | null }}
 *
 * Accepted formats:
 *   - 'hash'   — wf-XXXXXXXX (8-char hex, produced by generateTaskId)
 *   - 'slug'   — wf-<alphanum>[<alphanum or hyphen>]*<alphanum>, 5-64 chars total.
 *                For manager-dispatched descriptive IDs (e.g. wf-ttp-gate-2a,
 *                wf-auth-me-customer-capabilities). Path-safe: no '.', no '/',
 *                no '\\', no whitespace — safe to interpolate into file paths.
 *   - 'legacy' — TASK-NNN / BUG-NNN (grandfathered)
 */
function validateTaskId(id) {
  if (!id || typeof id !== 'string') {
    return { valid: false, format: null };
  }

  // Hash format: wf-XXXXXXXX
  if (/^wf-[a-f0-9]{8}$/i.test(id)) {
    return { valid: true, format: 'hash' };
  }

  // Slug format: wf-<start-alphanum><0-60 alphanum-or-hyphen><end-alphanum>.
  // Min 5 chars ("wf-ab"), max 64 chars. Start+end must be alphanum so the ID
  // never begins or ends with '-'. No dots or path separators allowed — this
  // keeps `path.join(DIR, `.routing-receipt-${id}`)` safe from traversal.
  if (/^wf-[a-z0-9][a-z0-9-]{0,60}[a-z0-9]$/i.test(id)) {
    return { valid: true, format: 'slug' };
  }

  // Legacy formats: TASK-XXX, BUG-XXX
  if (/^(TASK|BUG)-\d{3,}$/i.test(id)) {
    return { valid: true, format: 'legacy' };
  }

  return { valid: false, format: null };
}

/** Check if ID is in legacy format (for migration warnings) */
function isLegacyTaskId(id) {
  return /^(TASK|BUG)-\d{3,}$/i.test(id);
}

module.exports = {
  generateHashId,
  generateTaskId,
  generateEpicId,
  generateFeatureId,
  generatePlanId,
  validateTaskId,
  isLegacyTaskId,
};
