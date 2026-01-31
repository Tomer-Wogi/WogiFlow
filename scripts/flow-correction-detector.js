#!/usr/bin/env node

/**
 * Wogi Flow - Correction Detector
 *
 * Detects when users correct or redirect the AI during conversation.
 * Uses semantic detection (Haiku) with regex fallback.
 *
 * Features:
 * - Semantic correction detection using Claude Haiku
 * - Regex fallback when API is not available
 * - Queues corrections for user review at session end
 * - Non-blocking - graceful degradation on errors
 */

const fs = require('fs');
const path = require('path');
const {
  PATHS,
  safeJsonParse,
  writeJson,
  ensureDir,
  fileExists
} = require('./flow-utils');

// ============================================================================
// Constants
// ============================================================================

const PENDING_CORRECTIONS_FILE = 'pending-corrections.json';
const MAX_PENDING_CORRECTIONS = 20;
const MIN_CONFIDENCE_THRESHOLD = 70;

// Regex patterns for fallback correction detection
const CORRECTION_PATTERNS = [
  /^no[,.]?\s/i,                        // "no, I meant..."
  /^not\s(that|what|quite|exactly)/i,   // "not that", "not what I meant"
  /^i meant/i,                          // "I meant..."
  /^actually[,.]?\s/i,                  // "actually, ..."
  /^that'?s not (what|right|correct)/i, // "that's not what I wanted"
  /^you misunderstood/i,                // "you misunderstood"
  /^i (didn'?t|don'?t) (mean|want)/i,   // "I didn't mean", "I don't want"
  /^wrong[,.]?\s/i,                     // "wrong, I need..."
  /^that'?s wrong/i,                    // "that's wrong"
  /^let me clarify/i,                   // "let me clarify"
  /^to be (more\s)?clear/i,             // "to be clear"
  /^what i (really\s)?(want|mean)/i,    // "what I really want"
  /^stop[,.]?\s/i,                      // "stop, that's not..."
  /^wait[,.]?\s/i,                      // "wait, ..."
  /^hold on/i,                          // "hold on"
  /^correction:/i,                      // "correction: ..."
  /^instead[,.]?\s/i,                   // "instead, ..."
  /^don'?t\s(do|use|add|create)/i,      // "don't do that", "don't use..."
  /^please\s(don'?t|stop)/i,            // "please don't", "please stop"
  /^i\s(told|asked|said)\s.*\s(not|different)/i, // "I told you not to..."
  /^that was(?:n'?t)?\s(not\s)?what/i   // "that wasn't what I asked"
];

// Correction type classification patterns
const CORRECTION_TYPE_PATTERNS = {
  behavior: [
    /don'?t\s(do|keep|continue)/i,
    /stop\s(doing|adding)/i,
    /please\s(don'?t|stop)/i
  ],
  output: [
    /that'?s not (the|what|right)/i,
    /wrong\s(output|result|code)/i,
    /doesn'?t (work|compile|run)/i
  ],
  understanding: [
    /you misunderstood/i,
    /i meant/i,
    /what i (want|mean)/i,
    /let me clarify/i
  ],
  approach: [
    /different\s(way|approach)/i,
    /instead[,.]?\s/i,
    /don'?t\s(use|create)/i,
    /use\s.*\sinstead/i
  ]
};

// ============================================================================
// Path Helpers
// ============================================================================

function getPendingCorrectionsPath() {
  return path.join(PATHS.state, PENDING_CORRECTIONS_FILE);
}

// ============================================================================
// Semantic Detection (Haiku)
// ============================================================================

/**
 * Detect if a message is a correction using Claude Haiku
 * @param {string} userMessage - The user's message
 * @param {string} previousContext - Summary of what the AI was doing
 * @returns {Promise<Object>} Detection result
 */
async function detectCorrectionSemantic(userMessage, previousContext = '') {
  // Check if API key is available
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { available: false, reason: 'no-api-key' };
  }

  try {
    const { callModel } = require('./flow-model-caller');

    const prompt = `You are analyzing a user message in a conversation with an AI coding assistant.

Previous context (what the AI was doing):
${previousContext || 'Working on implementation tasks'}

User message:
"${userMessage}"

Is this message correcting, redirecting, or expressing dissatisfaction with the AI's behavior, output, or understanding?

Respond with JSON only (no markdown, no explanation):
{
  "isCorrection": true or false,
  "confidence": 0 to 100,
  "correctionType": "behavior" | "output" | "understanding" | "approach" | null,
  "whatWasWrong": "brief description of what the AI did wrong" | null,
  "whatUserWants": "brief description of what the user actually wants" | null
}`;

    const response = await callModel('anthropic:claude-3-5-haiku-latest', prompt, {
      temperature: 0.1,
      maxTokens: 256
    });

    if (!response || !response.content) {
      return { available: false, reason: 'empty-response' };
    }

    // Parse JSON from response
    const content = response.content.trim();
    // Handle potential markdown code blocks - use non-greedy match for first complete JSON object
    const jsonMatch = content.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/);
    if (!jsonMatch) {
      return { available: false, reason: 'invalid-json' };
    }

    let result;
    try {
      result = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      return { available: false, reason: 'json-parse-error' };
    }

    // Validate expected schema fields
    if (typeof result.isCorrection !== 'boolean') {
      return { available: false, reason: 'invalid-schema-isCorrection' };
    }
    if (typeof result.confidence !== 'number' || result.confidence < 0 || result.confidence > 100) {
      return { available: false, reason: 'invalid-schema-confidence' };
    }

    return {
      available: true,
      method: 'semantic',
      isCorrection: result.isCorrection,
      confidence: result.confidence,
      correctionType: result.correctionType || null,
      whatWasWrong: result.whatWasWrong || null,
      whatUserWants: result.whatUserWants || null
    };
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[DEBUG] Semantic detection failed: ${err.message}`);
    }
    return { available: false, reason: err.message };
  }
}

// ============================================================================
// Regex Fallback Detection
// ============================================================================

/**
 * Detect if a message is a correction using regex patterns (fallback)
 * @param {string} userMessage - The user's message
 * @returns {Object} Detection result
 */
function detectCorrectionRegex(userMessage) {
  if (!userMessage || typeof userMessage !== 'string') {
    return { isCorrection: false, confidence: 0, method: 'regex' };
  }

  const trimmed = userMessage.trim();
  const isCorrection = CORRECTION_PATTERNS.some(pattern => pattern.test(trimmed));

  if (!isCorrection) {
    return { isCorrection: false, confidence: 0, method: 'regex' };
  }

  // Determine correction type
  let correctionType = null;
  for (const [type, patterns] of Object.entries(CORRECTION_TYPE_PATTERNS)) {
    if (patterns.some(p => p.test(trimmed))) {
      correctionType = type;
      break;
    }
  }

  return {
    isCorrection: true,
    confidence: 60, // Regex detection has lower confidence
    correctionType: correctionType || 'understanding',
    method: 'regex',
    whatWasWrong: null, // Regex can't determine this
    whatUserWants: null
  };
}

// ============================================================================
// Combined Detection
// ============================================================================

/**
 * Detect if a message is a correction (semantic with regex fallback)
 * @param {string} userMessage - The user's message
 * @param {string} previousContext - Summary of what the AI was doing
 * @returns {Promise<Object>} Detection result
 */
async function detectCorrection(userMessage, previousContext = '') {
  // First try semantic detection
  const semanticResult = await detectCorrectionSemantic(userMessage, previousContext);

  if (semanticResult.available) {
    return semanticResult;
  }

  // Fall back to regex detection
  const regexResult = detectCorrectionRegex(userMessage);
  return {
    ...regexResult,
    fallbackReason: semanticResult.reason
  };
}

// ============================================================================
// Pending Corrections Queue
// ============================================================================

/**
 * Load pending corrections from file
 * @returns {Array} Array of pending corrections
 */
function loadPendingCorrections() {
  const correctionsPath = getPendingCorrectionsPath();
  return safeJsonParse(correctionsPath, []);
}

/**
 * Save pending corrections to file
 * @param {Array} corrections - Array of corrections to save
 */
function savePendingCorrections(corrections) {
  const correctionsPath = getPendingCorrectionsPath();
  ensureDir(path.dirname(correctionsPath));
  writeJson(correctionsPath, corrections);
}

/**
 * Queue a correction for user review
 * @param {Object} correction - Correction data
 * @returns {boolean} Success
 */
function queuePendingCorrection(correction) {
  try {
    const corrections = loadPendingCorrections();

    // Add new correction
    corrections.push({
      id: `CORR-${Date.now().toString(36)}`,
      timestamp: new Date().toISOString(),
      ...correction
    });

    // Limit queue size
    while (corrections.length > MAX_PENDING_CORRECTIONS) {
      corrections.shift();
    }

    savePendingCorrections(corrections);
    return true;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[DEBUG] queuePendingCorrection: ${err.message}`);
    }
    return false;
  }
}

/**
 * Get all pending corrections
 * @returns {Array} Array of pending corrections
 */
function getPendingCorrections() {
  return loadPendingCorrections();
}

/**
 * Clear all pending corrections
 * @returns {boolean} Success
 */
function clearPendingCorrections() {
  try {
    savePendingCorrections([]);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Cleanup stale corrections older than specified age
 * @param {number} maxAgeMs - Maximum age in milliseconds (default: 7 days)
 * @returns {Object} Cleanup result with count removed
 */
function cleanupStaleCorrections(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  try {
    const corrections = loadPendingCorrections();
    const now = Date.now();

    const fresh = corrections.filter(c => {
      if (!c.timestamp) return false; // Remove entries without timestamp
      const age = now - new Date(c.timestamp).getTime();
      return age < maxAgeMs;
    });

    const removed = corrections.length - fresh.length;

    if (removed > 0) {
      savePendingCorrections(fresh);
    }

    return { removed, remaining: fresh.length };
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[DEBUG] cleanupStaleCorrections: ${err.message}`);
    }
    return { removed: 0, remaining: 0, error: err.message };
  }
}

/**
 * Remove a specific correction from pending
 * @param {string} correctionId - ID of correction to remove
 * @returns {boolean} Success
 */
function removePendingCorrection(correctionId) {
  try {
    const corrections = loadPendingCorrections();
    const filtered = corrections.filter(c => c.id !== correctionId);
    savePendingCorrections(filtered);
    return true;
  } catch (err) {
    return false;
  }
}

// ============================================================================
// High-Level API
// ============================================================================

/**
 * Process a user message for potential corrections
 * @param {string} userMessage - The user's message
 * @param {Object} options - Options
 * @param {string} options.taskId - Current task ID
 * @param {string} options.context - What the AI was doing
 * @returns {Promise<Object>} Processing result
 */
async function processMessageForCorrection(userMessage, options = {}) {
  const result = await detectCorrection(userMessage, options.context);

  // Only queue if correction detected with sufficient confidence
  if (result.isCorrection && result.confidence >= MIN_CONFIDENCE_THRESHOLD) {
    const queued = queuePendingCorrection({
      taskId: options.taskId || null,
      userMessage,
      correctionType: result.correctionType,
      whatWasWrong: result.whatWasWrong,
      whatUserWants: result.whatUserWants,
      confidence: result.confidence,
      method: result.method
    });

    return {
      detected: true,
      queued,
      ...result
    };
  }

  return {
    detected: result.isCorrection,
    queued: false,
    ...result
  };
}

// ============================================================================
// CLI Interface
// ============================================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  async function main() {
    switch (command) {
      case 'detect': {
        const message = args.slice(1).join(' ');
        if (!message) {
          console.log('Usage: node flow-correction-detector.js detect <message>');
          process.exit(1);
        }

        const result = await detectCorrection(message);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'queue': {
        const message = args.slice(1).join(' ');
        if (!message) {
          console.log('Usage: node flow-correction-detector.js queue <message>');
          process.exit(1);
        }

        const result = await processMessageForCorrection(message);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'pending': {
        const corrections = getPendingCorrections();
        console.log(JSON.stringify(corrections, null, 2));
        break;
      }

      case 'clear': {
        clearPendingCorrections();
        console.log('Cleared pending corrections');
        break;
      }

      default:
        console.log(`
Usage: node flow-correction-detector.js <command> [args]

Commands:
  detect <message>  - Detect if message is a correction
  queue <message>   - Detect and queue correction if found
  pending           - Show pending corrections
  clear             - Clear pending corrections
`);
    }
  }

  main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  // Detection
  detectCorrection,
  detectCorrectionSemantic,
  detectCorrectionRegex,
  CORRECTION_PATTERNS,

  // Queue management
  loadPendingCorrections,
  queuePendingCorrection,
  getPendingCorrections,
  clearPendingCorrections,
  removePendingCorrection,
  cleanupStaleCorrections,

  // High-level API
  processMessageForCorrection,

  // Paths
  getPendingCorrectionsPath,

  // Constants
  MIN_CONFIDENCE_THRESHOLD
};
