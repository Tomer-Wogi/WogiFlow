#!/usr/bin/env node

/**
 * Wogi Flow - Roadmap Management
 *
 * Manages project roadmap for deferred work and future phases.
 * Supports dependency tracking and validation before implementation.
 *
 * Usage:
 *   flow roadmap                    Show roadmap summary
 *   flow roadmap add "item"         Add item to roadmap
 *   flow roadmap promote "item"     Promote to story (validates deps)
 *   flow roadmap validate "item"    Check if dependencies still valid
 *   flow roadmap list [--phase]     List items by phase
 */

const fs = require('fs');
const path = require('path');
const {
  PROJECT_ROOT,
  PATHS,
  colors,
  fileExists,
  safeJsonParse,
  parseFlags,
  getConfig,
  isPathWithinProject
} = require('./flow-utils');

// Phase headers constant (used by add and move)
const PHASE_HEADERS = {
  now: '## Now',
  next: '## Next',
  later: '## Later',
  ideas: '## Ideas',
  completed: '## Completed'
};

// Display constants
const DISPLAY_WIDTH = 50;           // Width of separator lines
const MAX_ITEMS_IN_SUMMARY = 5;     // Max items per phase in summary view
const MIN_ITEM_TITLE_LENGTH = 2;    // Minimum length for a valid item title

// Paths
// Note: .workflow/roadmap.md is for USER project roadmaps managed by this module.
// WogiFlow's own internal roadmap is at .workflow/roadmap/roadmap.md (separate file).
const ROADMAP_PATH = path.join(PROJECT_ROOT, '.workflow', 'roadmap.md');
const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'roadmap.md');

// ============================================================
// Utility Functions
// ============================================================

/**
 * Escape special regex characters
 */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validate phase name from CLI input
 * @param {string} phase - Phase name to validate
 * @param {boolean} allowCompleted - Whether to allow 'completed' phase
 * @returns {Object} Validation result with valid flag and normalized phase
 */
function validatePhase(phase, allowCompleted = true) {
  if (!phase || typeof phase !== 'string') {
    return { valid: false, error: 'Phase is required' };
  }

  const normalized = phase.toLowerCase().trim();
  const validPhases = allowCompleted
    ? Object.keys(PHASE_HEADERS)
    : Object.keys(PHASE_HEADERS).filter(p => p !== 'completed');

  if (!validPhases.includes(normalized)) {
    return {
      valid: false,
      error: `Invalid phase: "${phase}". Valid phases: ${validPhases.join(', ')}`
    };
  }

  return { valid: true, phase: normalized };
}

/**
 * Sanitize title input from CLI
 * @param {string} title - Title to sanitize
 * @returns {string} Sanitized title
 */
function sanitizeTitle(title) {
  if (!title || typeof title !== 'string') return '';
  // Remove control characters and excessive whitespace
  return title.replace(/[\x00-\x1f\x7f]/g, '').trim();
}

// ============================================================
// Roadmap Parsing
// ============================================================

/**
 * Parse roadmap.md into structured data
 * @returns {Object} Parsed roadmap with phases and items
 */
function parseRoadmap() {
  if (!fileExists(ROADMAP_PATH)) {
    return {
      exists: false,
      phases: {
        now: [],
        next: [],
        later: [],
        ideas: [],
        completed: []
      }
    };
  }

  let content;
  try {
    content = fs.readFileSync(ROADMAP_PATH, 'utf-8');
  } catch (err) {
    console.error(`${colors.red}Error reading roadmap:${colors.reset} ${err.message}`);
    return { exists: false, phases: { now: [], next: [], later: [], ideas: [], completed: [] } };
  }

  const roadmap = {
    exists: true,
    raw: content,
    phases: {
      now: [],
      next: [],
      later: [],
      ideas: [],
      completed: []
    },
    parseError: null
  };

  try {
    // Split by phase headers
    const sections = content.split(/^## /m);
    if (!sections || sections.length === 0) {
      roadmap.parseError = 'No sections found in roadmap';
      return roadmap;
    }

    for (const section of sections) {
      if (!section || typeof section !== 'string') continue;

      const lines = section.split('\n');
      const header = lines[0]?.toLowerCase().trim() || '';
      const body = lines.slice(1).join('\n');

      let phase = null;
      if (header.includes('now')) phase = 'now';
      else if (header.includes('next')) phase = 'next';
      else if (header.includes('later')) phase = 'later';
      else if (header.includes('ideas') || header.includes('exploration')) phase = 'ideas';
      else if (header.includes('completed') || header.includes('archive')) phase = 'completed';

      if (phase) {
        roadmap.phases[phase] = parsePhaseItems(body);
      }
    }
  } catch (err) {
    roadmap.parseError = `Parse error: ${err.message}`;
    console.error(`${colors.yellow}Warning: Error parsing roadmap:${colors.reset} ${err.message}`);
  }

  return roadmap;
}

/**
 * Parse items from a phase section
 * @param {string} body - Section content
 * @returns {Array} Parsed items
 */
function parsePhaseItems(body) {
  const items = [];
  const itemBlocks = body.split(/^### /m);

  for (const block of itemBlocks) {
    if (!block.trim() || block.startsWith('Example:')) continue;

    const lines = block.split('\n');
    const title = lines[0]?.trim();
    if (!title) continue;

    const item = {
      title,
      status: extractField(block, 'Status') || 'pending',
      created: extractField(block, 'Created'),
      dependsOn: extractField(block, 'Depends On'),
      assumes: extractListField(block, 'Assumes'),
      keyFiles: extractListField(block, 'Key Files'),
      context: extractSection(block, 'Context When Deferred'),
      plan: extractListField(block, 'Implementation Plan'),
      raw: block
    };

    // Only add if it has a real title (not just whitespace)
    if (item.title && !item.title.startsWith('[') && item.title.length > MIN_ITEM_TITLE_LENGTH) {
      items.push(item);
    }
  }

  return items;
}

/**
 * Extract a single field value from item block
 */
function extractField(block, fieldName) {
  const escapedFieldName = escapeRegex(fieldName);
  const regex = new RegExp(`\\*\\*${escapedFieldName}:\\*\\*\\s*(.+)`, 'i');
  const match = block.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Extract a list field (items starting with -)
 */
function extractListField(block, fieldName) {
  const escapedFieldName = escapeRegex(fieldName);
  const regex = new RegExp(`\\*\\*${escapedFieldName}:\\*\\*([\\s\\S]*?)(?=\\*\\*|$)`, 'i');
  const match = block.match(regex);
  if (!match) return [];

  const items = [];
  const lines = match[1].split('\n');
  for (const line of lines) {
    const itemMatch = line.match(/^[-*]\s+(.+)/);
    if (itemMatch) {
      items.push(itemMatch[1].trim());
    }
  }
  return items;
}

/**
 * Extract a section of text
 */
function extractSection(block, sectionName) {
  const escapedSectionName = escapeRegex(sectionName);
  const regex = new RegExp(`\\*\\*${escapedSectionName}:\\*\\*\\s*([\\s\\S]*?)(?=\\*\\*|$)`, 'i');
  const match = block.match(regex);
  return match ? match[1].trim() : null;
}

// ============================================================
// Roadmap Operations
// ============================================================

/**
 * Initialize roadmap file if it doesn't exist
 */
function initRoadmap() {
  if (fileExists(ROADMAP_PATH)) {
    return { success: true, message: 'Roadmap already exists' };
  }

  // Ensure directory exists
  const dir = path.dirname(ROADMAP_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Copy template
  if (fileExists(TEMPLATE_PATH)) {
    try {
      fs.copyFileSync(TEMPLATE_PATH, ROADMAP_PATH);
    } catch (err) {
      return { success: false, error: `Failed to copy template: ${err.message}` };
    }
  } else {
    // Create minimal roadmap
    const minimal = `# Project Roadmap

Future work and deferred phases.

---

## Now (Current Focus)

---

## Next (Ready to Plan)

---

## Later (Future Phases)

---

## Ideas (Exploration)

---

## Completed

---
`;
    try {
      fs.writeFileSync(ROADMAP_PATH, minimal);
    } catch (err) {
      return { success: false, error: `Failed to create roadmap: ${err.message}` };
    }
  }

  return { success: true, message: 'Roadmap created', path: ROADMAP_PATH };
}

/**
 * Add an item to the roadmap
 * @param {Object} item - Item to add
 * @param {string} phase - Phase to add to (now, next, later, ideas)
 */
function addItem(item, phase = 'later') {
  // Ensure roadmap exists
  const initResult = initRoadmap();
  if (!initResult.success) {
    return initResult;
  }

  let content;
  try {
    content = fs.readFileSync(ROADMAP_PATH, 'utf-8');
  } catch (err) {
    return { success: false, error: `Failed to read roadmap: ${err.message}` };
  }

  // Build item block
  const date = new Date().toISOString().split('T')[0];
  const itemBlock = buildItemBlock(item, date);

  // Find the phase section and insert (completed phase not valid for addItem)
  const validPhases = ['now', 'next', 'later', 'ideas'];
  if (!validPhases.includes(phase)) {
    return { success: false, error: `Invalid phase: ${phase}. Valid phases: ${validPhases.join(', ')}` };
  }

  const header = PHASE_HEADERS[phase];
  if (!header) {
    return { success: false, error: `Invalid phase: ${phase}` };
  }

  // Find insertion point (after header line and any existing content)
  const headerIndex = content.indexOf(header);
  if (headerIndex === -1) {
    return { success: false, error: `Phase section "${header}" not found in roadmap` };
  }

  // Find the next section (## or ---)
  const afterHeader = content.substring(headerIndex);
  const nextSectionMatch = afterHeader.match(/\n(?=## |---)/);
  const insertIndex = nextSectionMatch
    ? headerIndex + nextSectionMatch.index
    : content.length;

  // Insert the item
  const before = content.substring(0, insertIndex);
  const after = content.substring(insertIndex);
  const newContent = before + '\n' + itemBlock + after;

  try {
    fs.writeFileSync(ROADMAP_PATH, newContent);
  } catch (err) {
    return { success: false, error: `Failed to write roadmap: ${err.message}` };
  }

  return {
    success: true,
    message: `Added "${item.title}" to ${phase} phase`,
    item: item
  };
}

/**
 * Build markdown block for an item
 */
function buildItemBlock(item, date) {
  let block = `### ${item.title}\n\n`;
  block += `**Status:** ${item.status || 'Deferred'}\n`;
  block += `**Created:** ${date}\n`;

  if (item.dependsOn) {
    block += `**Depends On:** ${item.dependsOn}\n`;
  }

  if (item.assumes && item.assumes.length > 0) {
    block += `\n**Assumes:**\n`;
    for (const assumption of item.assumes) {
      block += `- ${assumption}\n`;
    }
  }

  if (item.keyFiles && item.keyFiles.length > 0) {
    block += `\n**Key Files:**\n`;
    for (const file of item.keyFiles) {
      block += `- ${file}\n`;
    }
  }

  if (item.context) {
    block += `\n**Context When Deferred:**\n${item.context}\n`;
  }

  if (item.plan && item.plan.length > 0) {
    block += `\n**Implementation Plan:**\n`;
    for (let i = 0; i < item.plan.length; i++) {
      block += `${i + 1}. ${item.plan[i]}\n`;
    }
  }

  block += '\n---\n';
  return block;
}

/**
 * Find an item by title (fuzzy match)
 * @param {string} title - Item title to find
 * @returns {Object|null} Found item with phase info
 */
function findItem(title) {
  const roadmap = parseRoadmap();
  if (!roadmap.exists) return null;

  const searchTitle = title.toLowerCase();

  for (const [phase, items] of Object.entries(roadmap.phases)) {
    for (const item of items) {
      if (item.title.toLowerCase().includes(searchTitle) ||
          searchTitle.includes(item.title.toLowerCase())) {
        return { ...item, phase };
      }
    }
  }

  return null;
}

/**
 * Validate an item's dependencies
 * @param {Object} item - Item to validate
 * @returns {Object} Validation result
 */
function validateItem(item) {
  const issues = [];
  const warnings = [];

  // Check key files exist
  if (item.keyFiles && item.keyFiles.length > 0) {
    for (const fileEntry of item.keyFiles) {
      // Extract file path (may have description after " - ")
      const filePath = fileEntry.split(' - ')[0].trim().replace(/`/g, '');
      const fullPath = path.join(PROJECT_ROOT, filePath);

      // Security: validate path is within project
      if (!isPathWithinProject(fullPath)) {
        issues.push({
          type: 'invalid_path',
          message: `Key file path outside project: ${filePath}`,
          file: filePath
        });
        continue;
      }

      if (!fileExists(fullPath)) {
        issues.push({
          type: 'missing_file',
          message: `Key file not found: ${filePath}`,
          file: filePath
        });
      }
    }
  }

  // Check if depends-on item is completed
  if (item.dependsOn) {
    const roadmap = parseRoadmap();
    const dependency = item.dependsOn.toLowerCase();

    // Check if dependency is in completed phase
    const inCompleted = roadmap.phases.completed.some(
      i => i.title.toLowerCase().includes(dependency) ||
           dependency.includes(i.title.toLowerCase())
    );

    // Check if dependency is in ready.json as completed
    let inReadyCompleted = false;
    const readyPath = path.join(PROJECT_ROOT, '.workflow', 'state', 'ready.json');
    if (fileExists(readyPath)) {
      const ready = safeJsonParse(readyPath, {});
      const completed = ready.recentlyCompleted || [];
      inReadyCompleted = completed.some(
        t => t.title?.toLowerCase().includes(dependency)
      );
    }

    if (!inCompleted && !inReadyCompleted) {
      warnings.push({
        type: 'dependency_not_complete',
        message: `Dependency not marked complete: ${item.dependsOn}`,
        dependency: item.dependsOn
      });
    }
  }

  // Check assumptions (basic check - look for contradicting patterns)
  if (item.assumes && item.assumes.length > 0) {
    // This is a simplified check - AI should do deeper analysis
    for (const assumption of item.assumes) {
      // Flag assumptions that mention specific patterns for AI review
      if (assumption.toLowerCase().includes('jwt') ||
          assumption.toLowerCase().includes('session') ||
          assumption.toLowerCase().includes('cookie')) {
        warnings.push({
          type: 'assumption_needs_review',
          message: `Assumption needs verification: ${assumption}`,
          assumption
        });
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
    item
  };
}

/**
 * Move an item to a different phase
 * @param {string} title - Item title
 * @param {string} toPhase - Target phase
 */
function moveItem(title, toPhase) {
  const item = findItem(title);
  if (!item) {
    return { success: false, error: `Item not found: ${title}` };
  }

  let content;
  try {
    content = fs.readFileSync(ROADMAP_PATH, 'utf-8');
  } catch (err) {
    return { success: false, error: `Failed to read roadmap: ${err.message}` };
  }

  // Remove from current location (regex handles section end, ---\n, or EOF)
  const itemBlockRegex = new RegExp(`### ${escapeRegex(item.title)}[\\s\\S]*?(?=### |## |---\\n|$)`, 'i');
  const match = content.match(itemBlockRegex);

  if (!match) {
    return { success: false, error: `Could not locate item block in roadmap` };
  }

  const itemBlock = match[0].trim();
  content = content.replace(itemBlockRegex, '');

  // Insert into new phase - use module constant
  const header = PHASE_HEADERS[toPhase];
  if (!header) {
    return { success: false, error: `Invalid phase: ${toPhase}` };
  }

  const headerIndex = content.indexOf(header);
  if (headerIndex === -1) {
    return { success: false, error: `Phase section "${header}" not found` };
  }

  // Find insertion point
  const afterHeader = content.substring(headerIndex);
  const nextSectionMatch = afterHeader.match(/\n(?=## |---)/);
  const insertIndex = nextSectionMatch
    ? headerIndex + nextSectionMatch.index
    : content.length;

  // Insert
  const before = content.substring(0, insertIndex);
  const after = content.substring(insertIndex);
  const newContent = before + '\n' + itemBlock + '\n' + after;

  try {
    fs.writeFileSync(ROADMAP_PATH, newContent);
  } catch (err) {
    return { success: false, error: `Failed to write roadmap: ${err.message}` };
  }

  return {
    success: true,
    message: `Moved "${item.title}" from ${item.phase} to ${toPhase}`,
    item
  };
}

// ============================================================
// CLI Output
// ============================================================

/**
 * Format roadmap summary for display
 */
function formatSummary() {
  const roadmap = parseRoadmap();

  if (!roadmap.exists) {
    return `${colors.yellow}No roadmap found.${colors.reset}

Create one with: ${colors.cyan}flow roadmap init${colors.reset}
Or add an item: ${colors.cyan}flow roadmap add "Feature name"${colors.reset}
`;
  }

  let output = '';
  output += `${colors.cyan}${'='.repeat(DISPLAY_WIDTH)}${colors.reset}\n`;
  output += `${colors.cyan}        Project Roadmap${colors.reset}\n`;
  output += `${colors.cyan}${'='.repeat(DISPLAY_WIDTH)}${colors.reset}\n\n`;

  const phaseLabels = {
    now: { label: 'Now (Current Focus)', icon: '>' },
    next: { label: 'Next (Ready to Plan)', icon: '-' },
    later: { label: 'Later (Future Phases)', icon: 'o' },
    ideas: { label: 'Ideas (Exploration)', icon: '?' },
    completed: { label: 'Completed', icon: '+' }
  };

  for (const [phase, info] of Object.entries(phaseLabels)) {
    const items = roadmap.phases[phase];
    const count = items.length;

    if (phase === 'completed' && count === 0) continue; // Skip empty completed

    const color = phase === 'now' ? colors.green :
                  phase === 'next' ? colors.yellow :
                  phase === 'later' ? colors.cyan :
                  phase === 'completed' ? colors.dim :
                  colors.reset;

    output += `${color}${info.icon} ${info.label}${colors.reset} (${count})\n`;

    for (const item of items.slice(0, MAX_ITEMS_IN_SUMMARY)) {
      const deps = item.dependsOn ? ` ${colors.dim}← ${item.dependsOn}${colors.reset}` : '';
      output += `    ${item.title}${deps}\n`;
    }

    if (count > MAX_ITEMS_IN_SUMMARY) {
      output += `    ${colors.dim}... and ${count - MAX_ITEMS_IN_SUMMARY} more${colors.reset}\n`;
    }

    output += '\n';
  }

  output += `${colors.dim}File: ${ROADMAP_PATH}${colors.reset}\n`;
  output += `${colors.dim}Commands: add, promote, validate, move${colors.reset}\n`;

  return output;
}

/**
 * Format validation result for display
 */
function formatValidation(result) {
  let output = '';

  output += `${colors.cyan}Validating: ${result.item.title}${colors.reset}\n\n`;

  if (result.valid && result.warnings.length === 0) {
    output += `${colors.green}+ All dependencies valid${colors.reset}\n`;
    output += `${colors.green}+ Ready to implement${colors.reset}\n`;
    return output;
  }

  if (result.issues.length > 0) {
    output += `${colors.red}Issues (blocking):${colors.reset}\n`;
    for (const issue of result.issues) {
      output += `  - ${issue.message}\n`;
    }
    output += '\n';
  }

  if (result.warnings.length > 0) {
    output += `${colors.yellow}Warnings (review recommended):${colors.reset}\n`;
    for (const warning of result.warnings) {
      output += `  - ${warning.message}\n`;
    }
    output += '\n';
  }

  if (!result.valid) {
    output += `\n${colors.red}Cannot proceed until issues are resolved.${colors.reset}\n`;
  }

  return output;
}

// ============================================================
// CLI Entry Point
// ============================================================

function showHelp() {
  console.log(`
${colors.cyan}Wogi Flow - Roadmap Management${colors.reset}

Manage project roadmap for deferred work and future phases.

${colors.bold}Usage:${colors.reset}
  flow roadmap                         Show roadmap summary
  flow roadmap init                    Create roadmap file
  flow roadmap add "title" [options]   Add item to roadmap
  flow roadmap promote "title"         Validate and promote to story
  flow roadmap validate "title"        Validate item dependencies
  flow roadmap move "title" --to=phase Move item to different phase
  flow roadmap list [--phase=name]     List items

${colors.bold}Options:${colors.reset}
  --phase=<name>     Phase: now, next, later, ideas (default: later)
  --depends="..."    What this depends on
  --assumes="..."    Key assumptions (comma-separated)
  --files="..."      Key files (comma-separated)
  --json             Output as JSON

${colors.bold}Examples:${colors.reset}
  flow roadmap add "OAuth integration" --phase=later
  flow roadmap add "Dark mode" --depends="Phase 1: UI Framework"
  flow roadmap validate "OAuth integration"
  flow roadmap move "OAuth" --to=next
`);
}

function main() {
  const args = process.argv.slice(2);
  const { flags, positional } = parseFlags(args);
  const command = positional[0] || '';

  if (flags.help || flags.h) {
    showHelp();
    process.exit(0);
  }

  switch (command) {
    case '':
    case 'show':
    case 'summary':
      if (flags.json) {
        console.log(JSON.stringify(parseRoadmap(), null, 2));
      } else {
        console.log(formatSummary());
      }
      break;

    case 'init':
      const initResult = initRoadmap();
      if (initResult.success) {
        console.log(`${colors.green}+${colors.reset} ${initResult.message}`);
        if (initResult.path) {
          console.log(`  ${colors.dim}${initResult.path}${colors.reset}`);
        }
      } else {
        console.error(`${colors.red}Error:${colors.reset} ${initResult.error}`);
        process.exit(1);
      }
      break;

    case 'add':
      const rawTitle = positional.slice(1).join(' ') || flags.title;
      const title = sanitizeTitle(rawTitle);
      if (!title) {
        console.error(`${colors.red}Error:${colors.reset} Please provide an item title`);
        console.log('Usage: flow roadmap add "Feature name"');
        process.exit(1);
      }

      // Validate phase if provided
      const addPhase = flags.phase || 'later';
      const phaseValidation = validatePhase(addPhase, false); // completed not allowed for add
      if (!phaseValidation.valid) {
        console.error(`${colors.red}Error:${colors.reset} ${phaseValidation.error}`);
        process.exit(1);
      }

      const item = {
        title,
        status: flags.status || 'Deferred',
        dependsOn: flags.depends || flags.dependsOn,
        assumes: flags.assumes ? flags.assumes.split(',').map(s => s.trim()) : [],
        keyFiles: flags.files ? flags.files.split(',').map(s => s.trim()) : [],
        context: flags.context,
        plan: flags.plan ? flags.plan.split(',').map(s => s.trim()) : []
      };

      const addResult = addItem(item, phaseValidation.phase);
      if (addResult.success) {
        console.log(`${colors.green}+${colors.reset} ${addResult.message}`);
      } else {
        console.error(`${colors.red}Error:${colors.reset} ${addResult.error}`);
        process.exit(1);
      }
      break;

    case 'validate':
    case 'check':
      const rawValidateTitle = positional.slice(1).join(' ');
      const validateTitle = sanitizeTitle(rawValidateTitle);
      if (!validateTitle) {
        console.error(`${colors.red}Error:${colors.reset} Please provide an item title`);
        process.exit(1);
      }

      const itemToValidate = findItem(validateTitle);
      if (!itemToValidate) {
        console.error(`${colors.red}Error:${colors.reset} Item not found: ${validateTitle}`);
        process.exit(1);
      }

      const validation = validateItem(itemToValidate);
      if (flags.json) {
        console.log(JSON.stringify(validation, null, 2));
      } else {
        console.log(formatValidation(validation));
      }

      if (!validation.valid) {
        process.exit(1);
      }
      break;

    case 'move':
      const rawMoveTitle = positional.slice(1).join(' ');
      const moveTitle = sanitizeTitle(rawMoveTitle);
      const toPhaseRaw = flags.to || flags.phase;

      if (!moveTitle) {
        console.error(`${colors.red}Error:${colors.reset} Please provide an item title`);
        console.log('Usage: flow roadmap move "Feature name" --to=next');
        process.exit(1);
      }

      if (!toPhaseRaw) {
        console.error(`${colors.red}Error:${colors.reset} Please provide a target phase with --to=<phase>`);
        console.log('Usage: flow roadmap move "Feature name" --to=next');
        process.exit(1);
      }

      // Validate target phase (allow completed for moves)
      const movePhaseValidation = validatePhase(toPhaseRaw, true);
      if (!movePhaseValidation.valid) {
        console.error(`${colors.red}Error:${colors.reset} ${movePhaseValidation.error}`);
        process.exit(1);
      }

      const moveResult = moveItem(moveTitle, movePhaseValidation.phase);
      if (moveResult.success) {
        console.log(`${colors.green}+${colors.reset} ${moveResult.message}`);
      } else {
        console.error(`${colors.red}Error:${colors.reset} ${moveResult.error}`);
        process.exit(1);
      }
      break;

    case 'promote':
      const rawPromoteTitle = positional.slice(1).join(' ');
      const promoteTitle = sanitizeTitle(rawPromoteTitle);
      if (!promoteTitle) {
        console.error(`${colors.red}Error:${colors.reset} Please provide an item title`);
        console.log('Usage: flow roadmap promote "Feature name"');
        process.exit(1);
      }

      const itemToPromote = findItem(promoteTitle);
      if (!itemToPromote) {
        console.error(`${colors.red}Error:${colors.reset} Item not found: ${promoteTitle}`);
        process.exit(1);
      }

      // Validate first
      const promoteValidation = validateItem(itemToPromote);
      if (!promoteValidation.valid) {
        console.log(formatValidation(promoteValidation));
        if (!flags.force) {
          console.error(`\n${colors.yellow}Use --force to promote anyway${colors.reset}`);
          process.exit(1);
        }
        console.log(`${colors.yellow}Proceeding with --force${colors.reset}\n`);
      }

      // Move to completed with "Promoted" status
      const promoteResult = moveItem(itemToPromote.title, 'completed');
      if (!promoteResult.success) {
        console.error(`${colors.red}Error:${colors.reset} ${promoteResult.error}`);
        process.exit(1);
      }

      // Output result
      if (flags.json) {
        console.log(JSON.stringify({
          success: true,
          item: itemToPromote,
          message: `Promoted "${itemToPromote.title}" to completed`,
          nextStep: `Create story: /wogi-story "${itemToPromote.title}"`
        }, null, 2));
      } else {
        console.log(`${colors.green}+${colors.reset} Promoted "${itemToPromote.title}" to completed`);
        console.log(`${colors.dim}  From: ${itemToPromote.phase}${colors.reset}`);
        if (itemToPromote.plan && itemToPromote.plan.length > 0) {
          console.log(`\n${colors.cyan}Implementation Plan:${colors.reset}`);
          for (let i = 0; i < itemToPromote.plan.length; i++) {
            console.log(`  ${i + 1}. ${itemToPromote.plan[i]}`);
          }
        }
        console.log(`\n${colors.yellow}Next step:${colors.reset} Create story with /wogi-story "${itemToPromote.title}"`);
      }
      break;

    case 'list':
      const roadmap = parseRoadmap();
      const listPhase = flags.phase;

      if (flags.json) {
        if (listPhase) {
          console.log(JSON.stringify(roadmap.phases[listPhase] || [], null, 2));
        } else {
          console.log(JSON.stringify(roadmap.phases, null, 2));
        }
      } else {
        if (listPhase) {
          const items = roadmap.phases[listPhase] || [];
          console.log(`${colors.cyan}${listPhase.toUpperCase()} (${items.length} items)${colors.reset}\n`);
          for (const i of items) {
            console.log(`  - ${i.title}`);
            if (i.dependsOn) console.log(`    ${colors.dim}Depends: ${i.dependsOn}${colors.reset}`);
          }
        } else {
          console.log(formatSummary());
        }
      }
      break;

    default:
      console.error(`${colors.red}Unknown command:${colors.reset} ${command}`);
      showHelp();
      process.exit(1);
  }
}

/**
 * Promote an item from roadmap to story (validate and move to completed)
 * @param {string} title - Item title to promote
 * @param {Object} options - Options (force: skip validation)
 * @returns {Object} Result with success, item, validation
 */
function promoteItem(title, options = {}) {
  const item = findItem(title);
  if (!item) {
    return { success: false, error: `Item not found: ${title}` };
  }

  // Validate dependencies
  const validation = validateItem(item);
  if (!validation.valid && !options.force) {
    return {
      success: false,
      error: 'Validation failed',
      validation,
      item
    };
  }

  // Move to completed
  const moveResult = moveItem(item.title, 'completed');
  if (!moveResult.success) {
    return { success: false, error: moveResult.error, item };
  }

  return {
    success: true,
    message: `Promoted "${item.title}" to completed`,
    item,
    validation,
    nextStep: `Create story: /wogi-story "${item.title}"`
  };
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  parseRoadmap,
  initRoadmap,
  addItem,
  findItem,
  validateItem,
  moveItem,
  promoteItem,
  formatSummary,
  formatValidation,
  ROADMAP_PATH,
  PHASE_HEADERS
};

if (require.main === module) {
  main();
}
