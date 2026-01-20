#!/usr/bin/env node

/**
 * Extraction Review Module
 *
 * MANDATORY human review step for zero-loss extraction.
 * Ensures 100% task capture by requiring explicit user confirmation.
 *
 * Flow:
 * 1. Load extracted items from zero-loss extraction
 * 2. Present items grouped by confidence for review
 * 3. User confirms, removes, or merges items
 * 4. Track explicitly removed vs confirmed items
 * 5. Only proceed when user confirms the list is complete
 */

const fs = require('fs');
const path = require('path');

// Paths
const TMP_DIR = path.join(process.cwd(), '.workflow', 'tmp', 'long-input');
const REVIEW_FILE = path.join(TMP_DIR, 'review-session.json');

// Colors
const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  bold: '\x1b[1m'
};

// =============================================================================
// REVIEW SESSION MANAGEMENT
// =============================================================================

/**
 * Initialize a review session from extraction results
 */
function initializeReview(extractionResult) {
  const session = {
    id: `review-${Date.now().toString(36)}`,
    status: 'in_progress',
    started_at: new Date().toISOString(),
    last_updated: new Date().toISOString(),

    // Source stats
    source: {
      total_extracted: extractionResult.review.total,
      high_confidence: extractionResult.review.summary.high_confidence,
      medium_confidence: extractionResult.review.summary.medium_confidence,
      low_confidence: extractionResult.review.summary.low_confidence,
      potential_filler: extractionResult.review.summary.potential_filler
    },

    // All items with review status
    items: extractionResult.review.all.map((item, index) => ({
      ...item,
      review_order: index + 1,
      review_status: 'pending',  // pending, confirmed, removed, merged
      removed_reason: null,
      merged_into_id: null,
      reviewed_at: null
    })),

    // Review progress
    progress: {
      reviewed: 0,
      confirmed: 0,
      removed: 0,
      merged: 0,
      pending: extractionResult.review.total
    },

    // User must explicitly confirm completeness
    completeness_confirmed: false,
    completeness_confirmed_at: null,

    // Audit trail
    actions: []
  };

  // Ensure directory exists (recursive is safe even if exists)
  try {
    fs.mkdirSync(TMP_DIR, { recursive: true });
    fs.writeFileSync(REVIEW_FILE, JSON.stringify(session, null, 2));
  } catch (err) {
    throw new Error(`Failed to initialize review session: ${err.message}`);
  }

  return session;
}

/**
 * Load current review session with safe JSON parsing
 */
function loadReviewSession() {
  if (!fs.existsSync(REVIEW_FILE)) {
    return null;
  }

  try {
    const content = fs.readFileSync(REVIEW_FILE, 'utf8');
    const parsed = JSON.parse(content);

    // Basic structure validation to prevent prototype pollution
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      console.error('Review session file has invalid structure');
      return null;
    }

    // Check for prototype pollution keys
    if ('__proto__' in parsed || 'constructor' in parsed || 'prototype' in parsed) {
      console.error('Review session file contains unsafe keys');
      return null;
    }

    return parsed;
  } catch (err) {
    console.error(`Failed to load review session: ${err.message}`);
    return null;
  }
}

/**
 * Save review session
 */
function saveReviewSession(session) {
  session.last_updated = new Date().toISOString();

  try {
    fs.writeFileSync(REVIEW_FILE, JSON.stringify(session, null, 2));
  } catch (err) {
    throw new Error(`Failed to save review session: ${err.message}`);
  }

  return session;
}

// =============================================================================
// REVIEW ACTIONS
// =============================================================================

/**
 * Confirm an item as a valid task
 */
function confirmItem(itemId, notes = null) {
  const session = loadReviewSession();
  if (!session) throw new Error('No review session active');

  const item = session.items.find(i => i.id === itemId);
  if (!item) throw new Error(`Item not found: ${itemId}`);

  item.review_status = 'confirmed';
  item.reviewed_at = new Date().toISOString();
  if (notes) item.user_notes = notes;

  updateProgress(session);
  logAction(session, 'confirm', itemId, notes);

  return saveReviewSession(session);
}

/**
 * Remove an item (with mandatory reason)
 */
function removeItem(itemId, reason) {
  if (!reason) throw new Error('Must provide reason for removal');

  const session = loadReviewSession();
  if (!session) throw new Error('No review session active');

  const item = session.items.find(i => i.id === itemId);
  if (!item) throw new Error(`Item not found: ${itemId}`);

  item.review_status = 'removed';
  item.removed_reason = reason;
  item.reviewed_at = new Date().toISOString();

  updateProgress(session);
  logAction(session, 'remove', itemId, reason);

  return saveReviewSession(session);
}

/**
 * Merge item into another item
 * Validates against circular merges and invalid target states
 */
function mergeItems(sourceId, targetId) {
  const session = loadReviewSession();
  if (!session) throw new Error('No review session active');

  // Prevent self-merge
  if (sourceId === targetId) {
    throw new Error('Cannot merge item into itself');
  }

  const source = session.items.find(i => i.id === sourceId);
  const target = session.items.find(i => i.id === targetId);

  if (!source) throw new Error(`Source item not found: ${sourceId}`);
  if (!target) throw new Error(`Target item not found: ${targetId}`);

  // Prevent merging already-merged items
  if (source.review_status === 'merged') {
    throw new Error(`Source item ${sourceId} is already merged into ${source.merged_into_id}`);
  }

  // Prevent merging into a removed or merged target
  if (target.review_status === 'removed') {
    throw new Error(`Cannot merge into removed item ${targetId}`);
  }
  if (target.review_status === 'merged') {
    throw new Error(`Cannot merge into ${targetId} - it is already merged into ${target.merged_into_id}. Merge into the final target instead.`);
  }

  source.review_status = 'merged';
  source.merged_into_id = targetId;
  source.reviewed_at = new Date().toISOString();

  // Add merged text to target's notes
  target.merged_texts = target.merged_texts || [];
  target.merged_texts.push(source.text);

  updateProgress(session);
  logAction(session, 'merge', sourceId, `merged into ${targetId}`);

  return saveReviewSession(session);
}

/**
 * Bulk confirm all high-confidence items
 */
function confirmAllHighConfidence() {
  const session = loadReviewSession();
  if (!session) throw new Error('No review session active');

  const highConfidenceItems = session.items.filter(
    i => i.confidence === 'high' && i.review_status === 'pending'
  );

  for (const item of highConfidenceItems) {
    item.review_status = 'confirmed';
    item.reviewed_at = new Date().toISOString();
  }

  updateProgress(session);
  logAction(session, 'bulk_confirm', 'high_confidence', `${highConfidenceItems.length} items`);

  return saveReviewSession(session);
}

/**
 * Mark low-priority items as reviewed (filler removed with standard reason)
 */
function dismissFiller() {
  const session = loadReviewSession();
  if (!session) throw new Error('No review session active');

  const fillerItems = session.items.filter(
    i => i.is_filler && i.review_status === 'pending'
  );

  for (const item of fillerItems) {
    item.review_status = 'removed';
    item.removed_reason = 'conversational_filler';
    item.reviewed_at = new Date().toISOString();
  }

  updateProgress(session);
  logAction(session, 'bulk_dismiss', 'filler', `${fillerItems.length} items`);

  return saveReviewSession(session);
}

/**
 * Update progress counters
 */
function updateProgress(session) {
  const items = session.items;
  session.progress = {
    reviewed: items.filter(i => i.review_status !== 'pending').length,
    confirmed: items.filter(i => i.review_status === 'confirmed').length,
    removed: items.filter(i => i.review_status === 'removed').length,
    merged: items.filter(i => i.review_status === 'merged').length,
    pending: items.filter(i => i.review_status === 'pending').length
  };
}

/**
 * Log action for audit trail
 */
function logAction(session, action, itemId, details) {
  session.actions.push({
    timestamp: new Date().toISOString(),
    action,
    item_id: itemId,
    details
  });
}

// =============================================================================
// COMPLETENESS CONFIRMATION
// =============================================================================

/**
 * User explicitly confirms the list is complete
 * THIS IS MANDATORY before proceeding
 */
function confirmCompleteness() {
  const session = loadReviewSession();
  if (!session) throw new Error('No review session active');

  // Check if all items have been reviewed
  const pending = session.items.filter(i => i.review_status === 'pending');
  if (pending.length > 0) {
    return {
      success: false,
      error: `Cannot confirm completeness: ${pending.length} items still pending review`,
      pending_items: pending.slice(0, 5).map(i => ({ id: i.id, text: i.text.substring(0, 50) }))
    };
  }

  session.completeness_confirmed = true;
  session.completeness_confirmed_at = new Date().toISOString();
  session.status = 'completed';

  logAction(session, 'confirm_completeness', null,
    `${session.progress.confirmed} tasks confirmed, ${session.progress.removed} removed`);

  return {
    success: true,
    session: saveReviewSession(session),
    summary: {
      confirmed_tasks: session.progress.confirmed,
      removed_items: session.progress.removed,
      merged_items: session.progress.merged
    }
  };
}

/**
 * Check if review is complete and ready to proceed
 */
function isReviewComplete() {
  const session = loadReviewSession();
  if (!session) return { complete: false, reason: 'no_session' };

  if (session.progress.pending > 0) {
    return {
      complete: false,
      reason: 'items_pending',
      pending_count: session.progress.pending
    };
  }

  if (!session.completeness_confirmed) {
    return {
      complete: false,
      reason: 'completeness_not_confirmed',
      message: 'User must explicitly confirm the task list is complete'
    };
  }

  return { complete: true };
}

// =============================================================================
// GET CONFIRMED TASKS
// =============================================================================

/**
 * Get all confirmed tasks (only after review is complete)
 */
function getConfirmedTasks() {
  const session = loadReviewSession();
  if (!session) throw new Error('No review session active');

  if (!session.completeness_confirmed) {
    throw new Error('Cannot get tasks: review not yet confirmed as complete');
  }

  return session.items
    .filter(i => i.review_status === 'confirmed')
    .map(i => ({
      id: i.id,
      text: i.text,
      confidence: i.confidence,
      score: i.score,
      speaker: i.speaker,
      timestamp: i.timestamp,
      user_notes: i.user_notes,
      merged_texts: i.merged_texts
    }));
}

// =============================================================================
// DISPLAY HELPERS
// =============================================================================

/**
 * Format review status for display
 */
function formatReviewStatus() {
  const session = loadReviewSession();
  if (!session) {
    return `${c.red}No active review session${c.reset}`;
  }

  const p = session.progress;
  const total = session.source.total_extracted;
  const pct = total === 0 ? 0 : Math.round((p.reviewed / total) * 100);

  let output = '';
  output += `\n${c.bold}📋 Task Extraction Review${c.reset}\n`;
  output += `${'─'.repeat(50)}\n`;
  output += `\n${c.cyan}Progress:${c.reset} ${p.reviewed}/${total} reviewed (${pct}%)\n`;
  output += `  ${c.green}✓ Confirmed:${c.reset} ${p.confirmed}\n`;
  output += `  ${c.red}✗ Removed:${c.reset} ${p.removed}\n`;
  output += `  ${c.blue}⊕ Merged:${c.reset} ${p.merged}\n`;
  output += `  ${c.yellow}◌ Pending:${c.reset} ${p.pending}\n`;

  if (session.completeness_confirmed) {
    output += `\n${c.green}✓ COMPLETENESS CONFIRMED${c.reset}\n`;
  } else if (p.pending === 0) {
    output += `\n${c.yellow}⚠ All items reviewed - awaiting completeness confirmation${c.reset}\n`;
  }

  return output;
}

/**
 * Format items for review display
 */
function formatItemsForReview(filter = 'pending', limit = 10) {
  const session = loadReviewSession();
  if (!session) return `${c.red}No active review session${c.reset}`;

  let items;
  switch (filter) {
    case 'pending':
      items = session.items.filter(i => i.review_status === 'pending');
      break;
    case 'confirmed':
      items = session.items.filter(i => i.review_status === 'confirmed');
      break;
    case 'removed':
      items = session.items.filter(i => i.review_status === 'removed');
      break;
    case 'high':
      items = session.items.filter(i => i.confidence === 'high' && i.review_status === 'pending');
      break;
    case 'medium':
      items = session.items.filter(i => i.confidence === 'medium' && i.review_status === 'pending');
      break;
    case 'low':
      items = session.items.filter(i => i.confidence === 'low' && i.review_status === 'pending');
      break;
    case 'filler':
      items = session.items.filter(i => i.is_filler && i.review_status === 'pending');
      break;
    default:
      items = session.items;
  }

  const displayed = items.slice(0, limit);
  const remaining = items.length - displayed.length;

  let output = '';
  output += `\n${c.bold}Items (${filter}): ${items.length} total${c.reset}\n`;
  output += `${'─'.repeat(50)}\n`;

  for (const item of displayed) {
    const confColor = item.confidence === 'high' ? c.green :
                      item.confidence === 'medium' ? c.yellow : c.dim;

    output += `\n${c.cyan}[${item.id}]${c.reset} ${confColor}(${item.confidence})${c.reset}`;
    if (item.speaker) output += ` ${c.dim}${item.speaker}:${c.reset}`;
    output += `\n  "${item.text.substring(0, 80)}${item.text.length > 80 ? '...' : ''}"\n`;

    if (item.signals && item.signals.length > 0) {
      output += `  ${c.dim}Signals: ${item.signals.join(', ')}${c.reset}\n`;
    }
  }

  if (remaining > 0) {
    output += `\n${c.dim}... and ${remaining} more${c.reset}\n`;
  }

  return output;
}

// =============================================================================
// CLEANUP
// =============================================================================

/**
 * Clean up the review session file
 * Call after review is complete or to reset
 */
function cleanupReviewSession() {
  try {
    if (fs.existsSync(REVIEW_FILE)) {
      fs.unlinkSync(REVIEW_FILE);
      return { success: true, message: 'Review session cleaned up' };
    }
    return { success: true, message: 'No session to clean up' };
  } catch (err) {
    return { success: false, error: `Failed to cleanup: ${err.message}` };
  }
}

/**
 * Reset the current session to start fresh
 * Keeps the extracted items but resets all review status
 */
function resetReviewSession() {
  const session = loadReviewSession();
  if (!session) {
    return { success: false, error: 'No review session active' };
  }

  // Reset all items to pending
  for (const item of session.items) {
    item.review_status = 'pending';
    item.removed_reason = null;
    item.merged_into_id = null;
    item.reviewed_at = null;
    item.user_notes = null;
    item.merged_texts = null;
  }

  // Reset progress
  session.progress = {
    reviewed: 0,
    confirmed: 0,
    removed: 0,
    merged: 0,
    pending: session.items.length
  };

  // Reset completeness
  session.completeness_confirmed = false;
  session.completeness_confirmed_at = null;
  session.status = 'in_progress';

  // Log the reset
  session.actions.push({
    timestamp: new Date().toISOString(),
    action: 'reset',
    item_id: null,
    details: 'Session reset to initial state'
  });

  saveReviewSession(session);
  return { success: true, message: 'Review session reset', items_count: session.items.length };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Session management
  initializeReview,
  loadReviewSession,
  saveReviewSession,
  cleanupReviewSession,
  resetReviewSession,

  // Review actions
  confirmItem,
  removeItem,
  mergeItems,
  confirmAllHighConfidence,
  dismissFiller,

  // Completeness
  confirmCompleteness,
  isReviewComplete,

  // Get results
  getConfirmedTasks,

  // Display
  formatReviewStatus,
  formatItemsForReview
};

// =============================================================================
// CLI INTERFACE
// =============================================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'status':
      console.log(formatReviewStatus());
      break;

    case 'show':
      console.log(formatItemsForReview(args[1] || 'pending', parseInt(args[2]) || 10));
      break;

    case 'confirm':
      if (!args[1]) {
        console.error('Usage: confirm <item-id>');
        process.exit(1);
      }
      confirmItem(args[1], args[2]);
      console.log(`${c.green}✓ Confirmed: ${args[1]}${c.reset}`);
      break;

    case 'remove':
      if (!args[1] || !args[2]) {
        console.error('Usage: remove <item-id> <reason>');
        process.exit(1);
      }
      removeItem(args[1], args.slice(2).join(' '));
      console.log(`${c.red}✗ Removed: ${args[1]}${c.reset}`);
      break;

    case 'merge':
      if (!args[1] || !args[2]) {
        console.error('Usage: merge <source-id> <target-id>');
        process.exit(1);
      }
      mergeItems(args[1], args[2]);
      console.log(`${c.blue}⊕ Merged: ${args[1]} → ${args[2]}${c.reset}`);
      break;

    case 'confirm-high':
      confirmAllHighConfidence();
      console.log(`${c.green}✓ All high-confidence items confirmed${c.reset}`);
      break;

    case 'dismiss-filler':
      dismissFiller();
      console.log(`${c.yellow}✓ Filler items dismissed${c.reset}`);
      break;

    case 'complete':
      const result = confirmCompleteness();
      if (result.success) {
        console.log(`${c.green}✓ Review complete!${c.reset}`);
        console.log(`  Confirmed tasks: ${result.summary.confirmed_tasks}`);
      } else {
        console.error(`${c.red}✗ ${result.error}${c.reset}`);
      }
      break;

    case 'tasks':
      try {
        const tasks = getConfirmedTasks();
        console.log(JSON.stringify(tasks, null, 2));
      } catch (err) {
        console.error(`${c.red}✗ ${err.message}${c.reset}`);
      }
      break;

    default:
      console.log('Extraction Review Module');
      console.log('Commands:');
      console.log('  status                      Show review progress');
      console.log('  show [filter] [limit]       Show items (pending|confirmed|removed|high|medium|low|filler)');
      console.log('  confirm <id> [notes]        Confirm an item as a task');
      console.log('  remove <id> <reason>        Remove an item (reason required)');
      console.log('  merge <src-id> <tgt-id>     Merge item into another');
      console.log('  confirm-high                Bulk confirm all high-confidence items');
      console.log('  dismiss-filler              Bulk dismiss filler items');
      console.log('  complete                    Confirm review is complete');
      console.log('  tasks                       Get confirmed tasks as JSON');
  }
}
