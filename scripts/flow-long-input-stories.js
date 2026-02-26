#!/usr/bin/env node

/**
 * Wogi Flow - Transcript Stories Module
 *
 * Extracted from flow-transcript-digest.js for maintainability.
 * Handles story generation, presentation queue, editing, and workflow export.
 *
 * Part of E3-S2: Story Generation with Source Tracing
 *
 * Dependencies: Requires core functions from flow-transcript-digest.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Import safe utilities
const { safeJsonParse, writeJson, generateTaskId, withLock, PATHS } = require('./flow-utils');

// Utility: ISO timestamp
function now() {
  return new Date().toISOString();
}

// Core functions are injected via init() to avoid circular dependencies
let digestCore = null;

/**
 * Initialize with core digest functions
 * @param {object} core - Core functions from flow-transcript-digest.js
 */
function init(core) {
  digestCore = core;
}

// Helper to ensure init was called
function requireInit() {
  if (!digestCore) {
    throw new Error('flow-transcript-stories not initialized. Call init() first.');
  }
}

// Proxy functions to core module
function loadActiveDigest() { requireInit(); return digestCore.loadActiveDigest(); }
function saveActiveDigest(d) { requireInit(); return digestCore.saveActiveDigest(d); }
function loadTopics() { requireInit(); return digestCore.loadTopics(); }
function _saveTopics(t) { requireInit(); return digestCore.saveTopics(t); } // Available if needed
function loadStatementMap() { requireInit(); return digestCore.loadStatementMap(); }
function loadClarifications() { requireInit(); return digestCore.loadClarifications(); }
function isRequirement(s) { requireInit(); return digestCore.isRequirement(s); }
function _isVagueStatement(s) { requireInit(); return digestCore.isVagueStatement(s); } // Available if needed
function analyzeComplexity() { requireInit(); return digestCore.analyzeComplexity(); }

// Temp directory for processing (cleaned up after completion)
const TMP_DIR = path.join(process.cwd(), '.workflow', 'tmp', 'long-input');
const _STATE_DIR = TMP_DIR; // Alias for backward compatibility (kept for reference)

// ==========================================================================
// E3-S2: Story Generation with Source Tracing
// ==========================================================================

/**
 * User type patterns for story generation
 */
const USER_TYPE_PATTERNS = [
  { pattern: /\b(admin|administrator)\b/i, type: 'admin' },
  { pattern: /\b(user|customer|client)\b/i, type: 'user' },
  { pattern: /\b(manager|supervisor)\b/i, type: 'manager' },
  { pattern: /\b(developer|dev)\b/i, type: 'developer' },
  { pattern: /\b(guest|visitor|anonymous)\b/i, type: 'guest' },
  { pattern: /\b(owner|creator)\b/i, type: 'owner' }
];

/**
 * Scenario name patterns
 */
const SCENARIO_PATTERNS = [
  { pattern: /\b(create|add|new)\b/i, prefix: 'Create' },
  { pattern: /\b(edit|update|modify|change)\b/i, prefix: 'Update' },
  { pattern: /\b(delete|remove|archive)\b/i, prefix: 'Delete' },
  { pattern: /\b(view|show|display|see|list)\b/i, prefix: 'View' },
  { pattern: /\b(search|find|filter)\b/i, prefix: 'Search' },
  { pattern: /\b(login|authenticate|sign in)\b/i, prefix: 'Login' },
  { pattern: /\b(logout|sign out)\b/i, prefix: 'Logout' },
  { pattern: /\b(validate|check|verify)\b/i, prefix: 'Validate' },
  { pattern: /\b(submit|save|confirm)\b/i, prefix: 'Submit' },
  { pattern: /\b(cancel|dismiss|close)\b/i, prefix: 'Cancel' },
  { pattern: /\b(select|choose|pick)\b/i, prefix: 'Select' },
  { pattern: /\b(upload|import)\b/i, prefix: 'Upload' },
  { pattern: /\b(download|export)\b/i, prefix: 'Download' }
];

/**
 * Generate unique story ID
 */
function generateStoryId() {
  return 'story-' + crypto.randomBytes(4).toString('hex');
}

/**
 * Detect user type from statements
 */
function detectUserType(statements) {
  for (const statement of statements) {
    if (!statement.text) continue;
    for (const { pattern, type } of USER_TYPE_PATTERNS) {
      if (pattern.test(statement.text)) {
        return { value: type, source: statement.id };
      }
    }
  }
  return { value: 'user', source: 'default' };
}

/**
 * Extract main object/entity from text
 */
function extractObject(text) {
  // Look for nouns after action verbs
  const patterns = [
    /(?:create|add|new|edit|update|delete|remove|view|show)\s+(?:a\s+|the\s+)?(\w+)/i,
    /(\w+)\s+(?:table|form|list|page|modal|button)/i,
    /\b(user|product|order|item|account|profile|setting|message)\b/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].toLowerCase();
    }
  }

  // Default to first noun-like word
  const words = text.split(/\s+/);
  for (const word of words) {
    if (word.length > 3 && /^[a-z]+$/i.test(word)) {
      return word.toLowerCase();
    }
  }

  return 'item';
}

/**
 * Generate scenario name from requirement
 */
function generateScenarioName(requirement) {
  const text = requirement.text || '';

  for (const { pattern, prefix } of SCENARIO_PATTERNS) {
    if (pattern.test(text)) {
      const object = extractObject(text);
      return `${prefix} ${object}`;
    }
  }

  return `Handle ${extractObject(text)}`;
}

/**
 * Extract action from requirement text
 */
function extractActionFromText(text) {
  // Look for verb phrases
  const patterns = [
    /(?:should|can|will|must)\s+(be able to\s+)?(\w+(?:\s+\w+)?)/i,
    /(?:want to|need to)\s+(\w+(?:\s+\w+)?)/i,
    /(?:add|create|edit|delete|view|manage)\s+(\w+(?:\s+\w+)?)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[match.length - 1];
    }
  }

  return 'perform the action';
}

/**
 * Extract outcome from requirement text
 */
function extractOutcomeFromText(text) {
  // Look for outcome indicators
  if (/\b(table|list|grid)\b/i.test(text)) {
    return 'I should see the data displayed';
  }
  if (/\b(form|input)\b/i.test(text)) {
    return 'I should see the form';
  }
  if (/\b(button)\b/i.test(text)) {
    return 'the action should be performed';
  }
  if (/\b(modal|dialog|popup)\b/i.test(text)) {
    return 'I should see the modal';
  }
  if (/\b(create|add|new)\b/i.test(text)) {
    return 'a new item should be created';
  }
  if (/\b(delete|remove)\b/i.test(text)) {
    return 'the item should be removed';
  }
  if (/\b(update|edit|modify)\b/i.test(text)) {
    return 'the changes should be saved';
  }

  return 'the expected result should occur';
}

/**
 * Convert statement to Given clause
 */
function convertToGiven(text) {
  // Remove leading "when", "if", etc.
  let given = text.replace(/^(when|if|after|once|assuming)\s+/i, '');

  // Convert to first person if needed
  given = given.replace(/\b(the user|users)\b/i, 'I');

  return given;
}

/**
 * Extract Given clause from context
 */
function extractGiven(requirement, contextStatements, topic) {
  // Look for precondition statements
  const preconditions = contextStatements.filter(s =>
    /\b(when|if|after|once|assuming|logged in|on the)\b/i.test(s.text || '') &&
    s.id !== requirement.id
  );

  if (preconditions.length > 0) {
    return {
      text: convertToGiven(preconditions[0].text),
      source: preconditions[0].id
    };
  }

  // Default context based on topic
  const topicLower = (topic.title || '').toLowerCase();
  if (topicLower.includes('dashboard') || topicLower.includes('management')) {
    return { text: `I am on the ${topicLower} page`, source: 'context' };
  }
  if (topicLower.includes('form')) {
    return { text: 'I am filling out the form', source: 'context' };
  }
  if (topicLower.includes('settings') || topicLower.includes('profile')) {
    return { text: 'I am in the settings section', source: 'context' };
  }

  return { text: 'I am logged into the system', source: 'context' };
}

/**
 * Extract When clause from requirement
 */
function extractWhen(requirement) {
  const text = requirement.text || '';
  const action = extractActionFromText(text);

  return {
    text: `I ${action}`,
    source: requirement.id
  };
}

/**
 * Extract Then clause from requirement
 */
function extractThen(requirement) {
  const text = requirement.text || '';
  const outcome = extractOutcomeFromText(text);

  return {
    text: outcome,
    source: requirement.id
  };
}

/**
 * Generate criteria from clarification answers
 */
function generateCriteriaFromClarification(clarification, _topic) {
  const criteria = [];
  const question = (clarification.question || '').toLowerCase();
  const answer = clarification.answer || '';

  // Column-related questions
  if (question.includes('column') || question.includes('display') || question.includes('show')) {
    criteria.push({
      scenario: 'Display correct columns',
      given: { text: 'I am viewing the table', source: 'context' },
      when: { text: 'the data loads', source: 'context' },
      then: { text: `I should see columns: ${answer}`, source: clarification.id },
      sources: [clarification.id],
      originalText: `Q: ${clarification.question}\nA: ${answer}`,
      type: 'clarification'
    });
  }

  // Validation-related questions
  if (question.includes('validation') || question.includes('required') || question.includes('rules')) {
    criteria.push({
      scenario: 'Validate form input',
      given: { text: 'I am filling out the form', source: 'context' },
      when: { text: 'I submit with invalid data', source: 'context' },
      then: { text: `validation should enforce: ${answer}`, source: clarification.id },
      sources: [clarification.id],
      originalText: `Q: ${clarification.question}\nA: ${answer}`,
      type: 'clarification'
    });
  }

  // Action-related questions
  if (question.includes('action') || question.includes('button') || question.includes('click')) {
    criteria.push({
      scenario: 'Handle user actions',
      given: { text: 'I am on the page', source: 'context' },
      when: { text: 'I perform an action', source: 'context' },
      then: { text: `the available actions are: ${answer}`, source: clarification.id },
      sources: [clarification.id],
      originalText: `Q: ${clarification.question}\nA: ${answer}`,
      type: 'clarification'
    });
  }

  // Sort/filter questions
  if (question.includes('sort') || question.includes('filter') || question.includes('order')) {
    criteria.push({
      scenario: 'Sort and filter data',
      given: { text: 'I am viewing the data', source: 'context' },
      when: { text: 'I apply sorting or filtering', source: 'context' },
      then: { text: `sorting/filtering should support: ${answer}`, source: clarification.id },
      sources: [clarification.id],
      originalText: `Q: ${clarification.question}\nA: ${answer}`,
      type: 'clarification'
    });
  }

  // Generic fallback
  if (criteria.length === 0) {
    const keyword = question.split(' ').find(w => w.length > 4) || 'detail';
    criteria.push({
      scenario: `Handle ${keyword}`,
      given: { text: 'the feature is active', source: 'context' },
      when: { text: 'the user interacts', source: 'context' },
      then: { text: answer, source: clarification.id },
      sources: [clarification.id],
      originalText: `Q: ${clarification.question}\nA: ${answer}`,
      type: 'clarification'
    });
  }

  return criteria;
}

/**
 * Build traceability matrix for a story
 */
function buildTraceabilityMatrix(criteria) {
  const matrix = [];

  for (let i = 0; i < criteria.length; i++) {
    const criterion = criteria[i];
    const criterionId = `AC-${i + 1}`;

    for (const sourceId of criterion.sources || []) {
      matrix.push({
        criterion_id: criterionId,
        criterion_name: criterion.scenario,
        source_id: sourceId,
        source_text: (criterion.originalText || '').slice(0, 60) + '...',
        source_type: sourceId.startsWith('s-') ? 'statement' :
                     sourceId.startsWith('q-') ? 'clarification' : 'context'
      });
    }
  }

  return matrix;
}

/**
 * Validate story coverage
 */
function validateStoryCoverage(story, topicStatements) {
  const warnings = [];
  const coveredSources = new Set(
    story.acceptance_criteria.flatMap(c => c.sources || [])
  );

  // Check all requirements are covered
  const requirements = topicStatements.filter(s =>
    isRequirement({ text: s.text })
  );

  for (const req of requirements) {
    if (!coveredSources.has(req.id)) {
      warnings.push({
        type: 'uncovered_requirement',
        statement_id: req.id,
        text: req.text,
        message: 'Requirement not covered by any acceptance criterion'
      });
    }
  }

  // Check for assumptions
  for (const criterion of story.acceptance_criteria) {
    if (!criterion.sources || criterion.sources.length === 0 ||
        criterion.sources.every(s => s === 'context' || s === 'default')) {
      warnings.push({
        type: 'assumption',
        criterion: criterion.scenario,
        message: 'Criterion has no direct source - may be an assumption'
      });
    }
  }

  return {
    valid: warnings.filter(w => w.type === 'uncovered_requirement').length === 0,
    coverage_percent: requirements.length > 0 ?
      Math.round((coveredSources.size / requirements.length) * 100) : 100,
    warnings
  };
}

/**
 * Generate a story from a topic
 */
function generateStoryFromTopic(topicId) {
  const topics = loadTopics();
  const statementMap = loadStatementMap();
  const clarifications = loadClarifications();
  const complexityResult = analyzeComplexity();

  if (!topics || !topics.topics) {
    return { error: 'No topics found' };
  }

  const topic = topics.topics.find(t => t.id === topicId);
  if (!topic) {
    return { error: `Topic ${topicId} not found` };
  }

  const statements = statementMap?.statements || [];
  const topicStatements = statements.filter(s => s.topic_id === topicId);
  const requirements = topicStatements.filter(s =>
    isRequirement({ text: s.text })
  );

  // Get answered clarifications for this topic
  const topicClarifications = (clarifications?.questions || [])
    .filter(q => q.topic_id === topicId && q.status === 'answered');

  // Detect user type
  const userType = detectUserType(topicStatements);

  // Generate acceptance criteria from requirements
  const criteria = [];

  for (const req of requirements) {
    criteria.push({
      scenario: generateScenarioName(req),
      given: extractGiven(req, topicStatements, topic),
      when: extractWhen(req),
      then: extractThen(req),
      sources: [req.id],
      originalText: req.text,
      type: 'requirement'
    });
  }

  // Add criteria from clarification answers
  for (const clarification of topicClarifications) {
    const derived = generateCriteriaFromClarification(clarification, topic);
    criteria.push(...derived);
  }

  // Build traceability matrix
  const traceability = buildTraceabilityMatrix(criteria);

  // Get topic complexity
  const topicComplexity = complexityResult.topic_analysis?.find(t => t.topic_id === topicId);

  // Build story object
  const story = {
    id: generateStoryId(),
    topic_id: topicId,
    title: topic.title,
    generated_at: now(),
    user_story: {
      user_type: userType.value,
      user_type_source: userType.source,
      action: requirements.length > 0 ? extractActionFromText(requirements[0].text) : 'use this feature',
      action_source: requirements.length > 0 ? requirements[0].id : 'inferred',
      benefit: 'accomplish their goals efficiently',
      benefit_source: 'inferred'
    },
    description: {
      text: `Feature for ${topic.title.toLowerCase()}. ` +
            (topicStatements.length > 0 ? topicStatements[0].text : ''),
      source_statements: topicStatements.slice(0, 3).map(s => s.id)
    },
    acceptance_criteria: criteria.map((c, i) => ({
      id: `AC-${i + 1}`,
      ...c
    })),
    traceability,
    coverage: {
      statements_total: topicStatements.length,
      statements_covered: new Set(criteria.flatMap(c => c.sources || [])).size,
      requirements_total: requirements.length,
      clarifications_used: topicClarifications.length,
      coverage_percent: requirements.length > 0 ?
        Math.round((new Set(criteria.filter(c => c.type === 'requirement').flatMap(c => c.sources)).size / requirements.length) * 100) : 100
    },
    complexity: topicComplexity || { score: 0, level: 'unknown' },
    validation: validateStoryCoverage({ acceptance_criteria: criteria }, topicStatements)
  };

  return story;
}

/**
 * Generate stories for all active topics
 */
function generateAllStories() {
  const topics = loadTopics();
  if (!topics || !topics.topics) {
    return { error: 'No topics found' };
  }

  const activeTopics = topics.topics.filter(t => t.status === 'active');
  const stories = [];
  const errors = [];

  for (const topic of activeTopics) {
    const story = generateStoryFromTopic(topic.id);
    if (story.error) {
      errors.push({ topic_id: topic.id, error: story.error });
    } else {
      stories.push(story);
    }
  }

  return {
    stories,
    summary: {
      total_topics: activeTopics.length,
      stories_generated: stories.length,
      errors: errors.length,
      total_criteria: stories.reduce((sum, s) => sum + s.acceptance_criteria.length, 0),
      average_coverage: stories.length > 0 ?
        Math.round(stories.reduce((sum, s) => sum + s.coverage.coverage_percent, 0) / stories.length) : 0
    },
    errors
  };
}

/**
 * Save story to digest
 */
function saveStory(story) {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    return { error: 'No active digest session' };
  }

  const storiesPath = path.join(activeDigest.session.digest_path, 'stories');
  fs.mkdirSync(storiesPath, { recursive: true });

  const storyPath = path.join(storiesPath, `${story.id}.json`);
  fs.writeFileSync(storyPath, JSON.stringify(story, null, 2));

  return { saved: true, path: storyPath };
}

/**
 * Load story from digest
 */
function loadStory(storyId) {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    return null;
  }

  const storyPath = path.join(activeDigest.session.digest_path, 'stories', `${storyId}.json`);
  return safeJsonParse(storyPath, null);
}

/**
 * Load all stories from digest
 */
function loadAllStories() {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    return [];
  }

  const storiesPath = path.join(activeDigest.session.digest_path, 'stories');
  try {
    const files = fs.readdirSync(storiesPath).filter(f => f.endsWith('.json'));
    return files.map(f => safeJsonParse(path.join(storiesPath, f), null)).filter(Boolean);
  } catch (_err) {
    return [];
  }
}

/**
 * Format story as markdown with source tracing
 */
function formatStoryAsMarkdown(story) {
  let md = '';

  md += `# [${story.id}] ${story.title}\n\n`;

  // Source topic
  md += `## Source Topic\n`;
  md += `**Topic ID**: ${story.topic_id}\n`;
  md += `**Statements**: ${story.coverage.statements_total} statements, ${story.coverage.requirements_total} requirements\n\n`;

  // User story
  md += `## User Story\n`;
  md += `**As a** ${story.user_story.user_type} \`[${story.user_story.user_type_source}]\`\n`;
  md += `**I want** to ${story.user_story.action} \`[${story.user_story.action_source}]\`\n`;
  md += `**So that** I can ${story.user_story.benefit} \`[${story.user_story.benefit_source}]\`\n\n`;

  // Description
  md += `## Description\n`;
  md += `${story.description.text}\n\n`;
  if (story.description.source_statements.length > 0) {
    md += `**Source statements:** ${story.description.source_statements.join(', ')}\n\n`;
  }

  // Acceptance criteria
  md += `## Acceptance Criteria\n\n`;
  for (const ac of story.acceptance_criteria) {
    md += `### Scenario ${ac.id.replace('AC-', '')}: ${ac.scenario}\n`;
    md += `**Given** ${ac.given.text} \`[${ac.given.source}]\`\n`;
    md += `**When** ${ac.when.text} \`[${ac.when.source}]\`\n`;
    md += `**Then** ${ac.then.text} \`[${ac.then.source}]\`\n\n`;

    if (ac.originalText) {
      md += `**Derived from:**\n`;
      md += `> "${ac.originalText.slice(0, 100)}${ac.originalText.length > 100 ? '...' : ''}" — ${ac.sources.join(', ')}\n\n`;
    }
  }

  // Coverage
  md += `## Coverage\n`;
  md += `- **Statements covered**: ${story.coverage.statements_covered}/${story.coverage.statements_total}\n`;
  md += `- **Requirements coverage**: ${story.coverage.coverage_percent}%\n`;
  md += `- **Clarifications used**: ${story.coverage.clarifications_used}\n`;
  if (story.validation.warnings.length === 0) {
    md += `- **Assumptions**: NONE\n`;
  } else {
    const assumptions = story.validation.warnings.filter(w => w.type === 'assumption');
    if (assumptions.length > 0) {
      md += `- **Potential assumptions**: ${assumptions.length}\n`;
    }
  }
  md += '\n';

  // Traceability matrix
  md += `## Traceability Matrix\n`;
  md += `| Criterion | Source | Type |\n`;
  md += `|-----------|--------|------|\n`;
  for (const row of story.traceability) {
    md += `| ${row.criterion_id} | ${row.source_id} | ${row.source_type} |\n`;
  }
  md += '\n';

  // Complexity
  md += `## Complexity\n`;
  md += `**Score**: ${story.complexity.score || 'N/A'} (${story.complexity.level || 'unknown'})\n`;
  if (story.complexity.estimated_stories) {
    md += `**Estimated stories**: ${story.complexity.estimated_stories}\n`;
  }

  return md;
}

// ==========================================================================
// E3-S3: One-by-One Presentation Flow
// ==========================================================================

/**
 * Load presentation queue
 */
function loadQueue() {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    return null;
  }

  const queuePath = path.join(activeDigest.session.digest_path, 'presentation-queue.json');
  return safeJsonParse(queuePath, null);
}

/**
 * Save presentation queue
 */
function saveQueue(queue) {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    return { error: 'No active digest session' };
  }

  const queuePath = path.join(activeDigest.session.digest_path, 'presentation-queue.json');
  fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
  return { saved: true };
}

/**
 * Initialize presentation queue from generated stories
 */
function initializePresentation() {
  const stories = loadAllStories();
  if (stories.length === 0) {
    return { error: 'No stories to present. Run generate-stories first.' };
  }

  const activeDigest = loadActiveDigest();

  const queue = {
    session_id: activeDigest.session.id,
    presentation: {
      status: 'in_progress',
      started_at: now(),
      current_index: 0,
      current_story_id: null
    },
    stories: stories.map(s => ({
      id: s.id,
      topic_id: s.topic_id,
      title: s.title,
      criteria_count: s.acceptance_criteria.length,
      coverage: s.coverage.coverage_percent,
      status: 'pending'
    })),
    summary: {
      total: stories.length,
      approved: 0,
      rejected: 0,
      skipped: 0,
      pending: stories.length,
      presenting: 0
    }
  };

  saveQueue(queue);
  return queue;
}

/**
 * Get presentation status
 */
function getPresentationStatus() {
  const queue = loadQueue();
  if (!queue) {
    return { active: false };
  }

  return {
    active: true,
    status: queue.presentation.status,
    progress: {
      reviewed: queue.summary.approved + queue.summary.rejected,
      remaining: queue.summary.pending + queue.summary.skipped,
      total: queue.summary.total
    },
    current: queue.presentation.current_story_id,
    summary: queue.summary
  };
}

/**
 * Get the next story to present
 */
function getNextStory() {
  let queue = loadQueue();

  // Initialize if no queue exists
  if (!queue) {
    queue = initializePresentation();
    if (queue.error) return queue;
  }

  // Mark any currently presenting story as skipped (interrupted)
  const currentlyPresenting = queue.stories.find(s => s.status === 'presenting');
  if (currentlyPresenting) {
    currentlyPresenting.status = 'skipped';
    currentlyPresenting.skipped_at = now();
    queue.summary.presenting--;
    queue.summary.skipped++;
  }

  // Find first pending story (prefer pending over skipped)
  let nextIndex = queue.stories.findIndex(s => s.status === 'pending');

  // If no pending, try skipped
  if (nextIndex === -1) {
    nextIndex = queue.stories.findIndex(s => s.status === 'skipped');
  }

  // All done
  if (nextIndex === -1) {
    queue.presentation.status = 'completed';
    queue.presentation.completed_at = now();
    saveQueue(queue);
    return { complete: true, summary: queue.summary };
  }

  // Mark as presenting
  const entry = queue.stories[nextIndex];
  const wasSkipped = entry.status === 'skipped';
  entry.status = 'presenting';
  entry.presented_at = now();
  if (wasSkipped) {
    queue.summary.skipped--;
  } else {
    queue.summary.pending--;
  }
  queue.summary.presenting++;

  queue.presentation.current_index = nextIndex;
  queue.presentation.current_story_id = entry.id;

  saveQueue(queue);

  // Load full story
  const story = loadStory(entry.id);

  return {
    index: nextIndex + 1,
    total: queue.stories.length,
    story,
    queue_entry: entry,
    summary: queue.summary
  };
}

/**
 * Get current story being presented
 */
function getCurrentStory() {
  const queue = loadQueue();
  if (!queue) {
    return { error: 'No presentation in progress' };
  }

  const currentEntry = queue.stories.find(s => s.status === 'presenting');
  if (!currentEntry) {
    return { error: 'No story currently being presented' };
  }

  const story = loadStory(currentEntry.id);
  const index = queue.stories.indexOf(currentEntry);

  return {
    index: index + 1,
    total: queue.stories.length,
    story,
    queue_entry: currentEntry,
    summary: queue.summary
  };
}

/**
 * Approve current story
 */
function approveCurrentStory() {
  const queue = loadQueue();
  if (!queue) {
    return { error: 'No presentation in progress' };
  }

  const entry = queue.stories.find(s => s.status === 'presenting');
  if (!entry) {
    return { error: 'No story currently being presented' };
  }

  entry.status = 'approved';
  entry.decided_at = now();

  queue.summary.approved++;
  queue.summary.presenting--;

  saveQueue(queue);

  return { success: true, story_id: entry.id, title: entry.title };
}

/**
 * Reject current story with reason
 */
function rejectCurrentStory(reason) {
  const queue = loadQueue();
  if (!queue) {
    return { error: 'No presentation in progress' };
  }

  const entry = queue.stories.find(s => s.status === 'presenting');
  if (!entry) {
    return { error: 'No story currently being presented' };
  }

  entry.status = 'rejected';
  entry.decided_at = now();
  entry.rejection_reason = reason || 'No reason provided';

  queue.summary.rejected++;
  queue.summary.presenting--;

  saveQueue(queue);

  return { success: true, story_id: entry.id, title: entry.title, reason: entry.rejection_reason };
}

/**
 * Skip current story for later
 */
function skipCurrentStory() {
  const queue = loadQueue();
  if (!queue) {
    return { error: 'No presentation in progress' };
  }

  const entry = queue.stories.find(s => s.status === 'presenting');
  if (!entry) {
    return { error: 'No story currently being presented' };
  }

  entry.status = 'skipped';
  entry.skipped_at = now();

  queue.summary.skipped++;
  queue.summary.presenting--;

  saveQueue(queue);

  return { success: true, story_id: entry.id, title: entry.title };
}

/**
 * Format story summary for presentation (compact view)
 */
function formatStorySummary(storyData) {
  const { index, total, story, summary } = storyData;

  let output = '';

  // Header box
  output += `${'═'.repeat(64)}\n`;
  output += `  Story ${index} of ${total}: ${story.title}\n`;
  output += `${'═'.repeat(64)}\n\n`;

  // User story
  output += `  As a ${story.user_story.user_type.toUpperCase()},\n`;
  output += `  I want to ${story.user_story.action.toUpperCase()}\n`;
  output += `  So that I can ${story.user_story.benefit}\n\n`;

  // Stats
  output += `  Acceptance Criteria: ${story.acceptance_criteria.length}\n`;
  output += `  Coverage: ${story.coverage.coverage_percent}%`;
  if (story.validation.warnings.length === 0) {
    output += ' (no assumptions)';
  }
  output += '\n';

  if (story.complexity && story.complexity.score) {
    output += `  Complexity: ${story.complexity.level} (${story.complexity.score})\n`;
  }

  output += `\n${'─'.repeat(64)}\n`;

  // Progress
  output += `  Progress: ${summary.approved} approved, ${summary.rejected} rejected, ${summary.pending + summary.skipped} remaining\n`;

  output += `${'─'.repeat(64)}\n`;

  return output;
}

/**
 * Format presentation actions prompt
 */
function formatActionsPrompt() {
  return `\nActions: [a]pprove  [r]eject  [s]kip  [v]iew full  [n]ext  [q]uit\n`;
}

/**
 * Get completion summary
 */
function getCompletionSummary() {
  const queue = loadQueue();
  if (!queue) {
    return { error: 'No presentation data' };
  }

  const approved = queue.stories.filter(s => s.status === 'approved');
  const rejected = queue.stories.filter(s => s.status === 'rejected');
  const skipped = queue.stories.filter(s => s.status === 'skipped');
  const pending = queue.stories.filter(s => s.status === 'pending');

  return {
    complete: queue.presentation.status === 'completed',
    summary: queue.summary,
    approved: approved.map(s => ({ id: s.id, title: s.title })),
    rejected: rejected.map(s => ({ id: s.id, title: s.title, reason: s.rejection_reason })),
    skipped: skipped.map(s => ({ id: s.id, title: s.title })),
    pending: pending.map(s => ({ id: s.id, title: s.title }))
  };
}

/**
 * Reset presentation (start over)
 */
function resetPresentation() {
  const queue = loadQueue();
  if (!queue) {
    return { error: 'No presentation to reset' };
  }

  // Reset all stories to pending
  for (const entry of queue.stories) {
    entry.status = 'pending';
    delete entry.presented_at;
    delete entry.decided_at;
    delete entry.skipped_at;
    delete entry.rejection_reason;
  }

  queue.presentation = {
    status: 'in_progress',
    started_at: now(),
    current_index: 0,
    current_story_id: null
  };

  queue.summary = {
    total: queue.stories.length,
    approved: 0,
    rejected: 0,
    skipped: 0,
    pending: queue.stories.length,
    presenting: 0
  };

  saveQueue(queue);

  return { success: true, total: queue.stories.length };
}

// ============================================================================
// E3-S4: Edit and Change Handling
// ============================================================================

/**
 * Generate unique edit session ID
 */
function generateEditSessionId() {
  return 'edit-' + crypto.randomBytes(4).toString('hex');
}

/**
 * Generate unique change ID
 */
function generateChangeId() {
  return 'change-' + crypto.randomBytes(3).toString('hex');
}

/**
 * Load edit sessions data
 */
function loadEditSessions() {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    return null;
  }

  const sessionsPath = path.join(activeDigest.session.digest_path, 'edit-sessions.json');
  return safeJsonParse(sessionsPath, { active_session: null, sessions: [] });
}

/**
 * Save edit sessions data
 */
function saveEditSessions(data) {
  const activeDigest = loadActiveDigest();
  if (!activeDigest.session.digest_path) {
    return { error: 'No active digest session' };
  }

  const sessionsPath = path.join(activeDigest.session.digest_path, 'edit-sessions.json');
  writeJson(sessionsPath, data);
  return { saved: true };
}

/**
 * Start an edit session for a story
 */
function startEditSession(storyId, reason) {
  const story = loadStory(storyId);
  if (!story) {
    return { error: `Story ${storyId} not found` };
  }

  const sessionsData = loadEditSessions() || { active_session: null, sessions: [] };

  // Check if there's already an active session
  if (sessionsData.active_session && sessionsData.active_session.active) {
    return {
      error: 'An edit session is already active',
      active_session: sessionsData.active_session
    };
  }

  // Get rejection reason if story was rejected
  const queue = loadQueue();
  const queueEntry = queue?.stories.find(s => s.id === storyId);
  const rejectionReason = queueEntry?.rejection_reason;

  const session = {
    id: generateEditSessionId(),
    story_id: storyId,
    started_at: now(),
    trigger: reason || (queueEntry?.status === 'rejected' ? 'rejection' : 'manual'),
    rejection_reason: rejectionReason,
    original_status: queueEntry?.status || 'unknown',
    changes: [],
    active: true
  };

  sessionsData.active_session = session;
  saveEditSessions(sessionsData);

  return {
    session,
    story,
    rejection_reason: rejectionReason,
    editable_sections: [
      'user_story',
      'acceptance_criteria',
      'technical_notes',
      'description'
    ]
  };
}

/**
 * Get active edit session
 */
function getActiveEditSession() {
  const sessionsData = loadEditSessions();
  if (!sessionsData || !sessionsData.active_session || !sessionsData.active_session.active) {
    return null;
  }
  return sessionsData.active_session;
}

/**
 * Record a change in the active edit session
 */
function recordChange(change) {
  const sessionsData = loadEditSessions();
  if (!sessionsData || !sessionsData.active_session || !sessionsData.active_session.active) {
    return { error: 'No active edit session' };
  }

  change.id = generateChangeId();
  change.timestamp = now();

  sessionsData.active_session.changes.push(change);
  saveEditSessions(sessionsData);

  return { recorded: true, change };
}

/**
 * Edit user story fields
 */
function editUserStory(storyId, updates) {
  const session = getActiveEditSession();
  if (!session || session.story_id !== storyId) {
    return { error: 'No active edit session for this story. Run edit-story first.' };
  }

  const story = loadStory(storyId);
  if (!story) {
    return { error: `Story ${storyId} not found` };
  }

  const changes = [];

  if (updates.user_type && updates.user_type !== story.user_story.user_type) {
    changes.push({
      type: 'user_story_modified',
      section: 'user_story',
      field: 'user_type',
      before: story.user_story.user_type,
      after: updates.user_type
    });
    story.user_story.user_type = updates.user_type;
    story.user_story.user_type_source = 'manual';
  }

  if (updates.action && updates.action !== story.user_story.action) {
    changes.push({
      type: 'user_story_modified',
      section: 'user_story',
      field: 'action',
      before: story.user_story.action,
      after: updates.action
    });
    story.user_story.action = updates.action;
    story.user_story.action_source = 'manual';
  }

  if (updates.benefit && updates.benefit !== story.user_story.benefit) {
    changes.push({
      type: 'user_story_modified',
      section: 'user_story',
      field: 'benefit',
      before: story.user_story.benefit,
      after: updates.benefit
    });
    story.user_story.benefit = updates.benefit;
    story.user_story.benefit_source = 'manual';
  }

  // Record all changes
  for (const change of changes) {
    recordChange(change);
  }

  // Save the story (uncommitted until commit-edit)
  saveStory(story);

  return { success: true, story, changes };
}

/**
 * Edit a specific acceptance criterion
 */
function editCriterion(storyId, criterionId, updates) {
  const session = getActiveEditSession();
  if (!session || session.story_id !== storyId) {
    return { error: 'No active edit session for this story. Run edit-story first.' };
  }

  const story = loadStory(storyId);
  if (!story) {
    return { error: `Story ${storyId} not found` };
  }

  const criterion = story.acceptance_criteria.find(ac => ac.id === criterionId);
  if (!criterion) {
    return { error: `Criterion ${criterionId} not found in story ${storyId}` };
  }

  const changes = [];

  if (updates.scenario && updates.scenario !== criterion.scenario) {
    changes.push({
      type: 'criteria_modified',
      target: criterionId,
      field: 'scenario',
      before: criterion.scenario,
      after: updates.scenario
    });
    criterion.scenario = updates.scenario;
  }

  if (updates.given) {
    const beforeText = criterion.given?.text || '';
    if (updates.given !== beforeText) {
      changes.push({
        type: 'criteria_modified',
        target: criterionId,
        field: 'given',
        before: beforeText,
        after: updates.given
      });
      criterion.given = { text: updates.given, source: 'manual' };
    }
  }

  if (updates.when) {
    const beforeText = criterion.when?.text || '';
    if (updates.when !== beforeText) {
      changes.push({
        type: 'criteria_modified',
        target: criterionId,
        field: 'when',
        before: beforeText,
        after: updates.when
      });
      criterion.when = { text: updates.when, source: 'manual' };
    }
  }

  if (updates.then) {
    const beforeText = criterion.then?.text || '';
    if (updates.then !== beforeText) {
      changes.push({
        type: 'criteria_modified',
        target: criterionId,
        field: 'then',
        before: beforeText,
        after: updates.then
      });
      criterion.then = { text: updates.then, source: 'manual' };
    }
  }

  // Record all changes
  for (const change of changes) {
    recordChange(change);
  }

  // Save the story
  saveStory(story);

  return { success: true, story, criterion, changes };
}

/**
 * Add a new acceptance criterion
 */
function addCriterion(storyId, criterion) {
  const session = getActiveEditSession();
  if (!session || session.story_id !== storyId) {
    return { error: 'No active edit session for this story. Run edit-story first.' };
  }

  const story = loadStory(storyId);
  if (!story) {
    return { error: `Story ${storyId} not found` };
  }

  // Generate new AC ID
  const existingIds = story.acceptance_criteria.map(ac =>
    parseInt(ac.id.replace('AC-', ''), 10) || 0
  );
  const maxId = existingIds.length > 0 ? Math.max(...existingIds) : 0;
  const newId = `AC-${maxId + 1}`;

  const newCriterion = {
    id: newId,
    scenario: criterion.scenario || `Scenario ${maxId + 1}`,
    given: { text: criterion.given || 'the system is ready', source: 'manual' },
    when: { text: criterion.when || 'the user performs the action', source: 'manual' },
    then: { text: criterion.then || 'the expected result occurs', source: 'manual' },
    and: criterion.and?.map(a => ({ text: a, source: 'manual' })) || [],
    derived_from: [{ id: 'manual', text: 'Manually added criterion' }]
  };

  story.acceptance_criteria.push(newCriterion);

  // Record the change
  recordChange({
    type: 'criteria_added',
    target: newId,
    before: null,
    after: newCriterion
  });

  // Save the story
  saveStory(story);

  return { success: true, story, criterion: newCriterion };
}

/**
 * Remove an acceptance criterion
 */
function removeCriterion(storyId, criterionId, reason) {
  const session = getActiveEditSession();
  if (!session || session.story_id !== storyId) {
    return { error: 'No active edit session for this story. Run edit-story first.' };
  }

  const story = loadStory(storyId);
  if (!story) {
    return { error: `Story ${storyId} not found` };
  }

  const index = story.acceptance_criteria.findIndex(ac => ac.id === criterionId);
  if (index === -1) {
    return { error: `Criterion ${criterionId} not found in story ${storyId}` };
  }

  // Don't allow removing last criterion
  if (story.acceptance_criteria.length === 1) {
    return { error: 'Cannot remove the last acceptance criterion' };
  }

  const removed = story.acceptance_criteria.splice(index, 1)[0];

  // Record the change
  recordChange({
    type: 'criteria_removed',
    target: criterionId,
    before: removed,
    after: null,
    reason: reason || 'Removed by user'
  });

  // Save the story
  saveStory(story);

  return { success: true, story, removed };
}

/**
 * Validate an edited story
 */
function validateEditedStory(story) {
  const warnings = [];
  const errors = [];

  // Check user story completeness
  if (!story.user_story.user_type || story.user_story.user_type === '') {
    errors.push({ field: 'user_story.user_type', message: 'User type is required' });
  }
  if (!story.user_story.action || story.user_story.action === '') {
    errors.push({ field: 'user_story.action', message: 'Action is required' });
  }

  // Check acceptance criteria
  if (!story.acceptance_criteria || story.acceptance_criteria.length === 0) {
    errors.push({ field: 'acceptance_criteria', message: 'At least one acceptance criterion required' });
  }

  for (const ac of story.acceptance_criteria || []) {
    if (!ac.given?.text) {
      warnings.push({ field: `${ac.id}.given`, message: 'Given clause is empty' });
    }
    if (!ac.when?.text) {
      warnings.push({ field: `${ac.id}.when`, message: 'When clause is empty' });
    }
    if (!ac.then?.text) {
      warnings.push({ field: `${ac.id}.then`, message: 'Then clause is empty' });
    }
  }

  // Check for manual-only coverage (all criteria manually added)
  const manualOnlyCriteria = (story.acceptance_criteria || []).filter(ac =>
    ac.given?.source === 'manual' &&
    ac.when?.source === 'manual' &&
    ac.then?.source === 'manual'
  );

  if (manualOnlyCriteria.length === story.acceptance_criteria?.length) {
    warnings.push({
      field: 'coverage',
      message: 'All criteria are manually added - no traceability to original transcript'
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Recalculate coverage after edits
 */
function recalculateCoverage(story) {
  const totalCriteria = story.acceptance_criteria.length;
  let tracedCriteria = 0;

  for (const ac of story.acceptance_criteria) {
    // Count criteria with at least one non-manual source
    const sources = [ac.given?.source, ac.when?.source, ac.then?.source];
    if (sources.some(s => s && s !== 'manual' && s !== 'context' && s !== 'inferred')) {
      tracedCriteria++;
    }
  }

  return {
    statements_total: story.coverage?.statements_total || 0,
    statements_covered: story.coverage?.statements_covered || 0,
    coverage_percent: totalCriteria > 0 ? Math.round((tracedCriteria / totalCriteria) * 100) : 0,
    clarifications_used: story.coverage?.clarifications_used || 0,
    manual_criteria: totalCriteria - tracedCriteria,
    assumptions: story.coverage?.assumptions || []
  };
}

/**
 * Update queue after edit is committed
 */
function updateQueueAfterEdit(storyId) {
  const queue = loadQueue();
  if (!queue) return { error: 'No queue found' };

  const entry = queue.stories.find(s => s.id === storyId);
  if (!entry) return { error: 'Story not found in queue' };

  // Track previous status
  const previousStatus = entry.status;

  // Update summary counts
  if (previousStatus === 'rejected') {
    queue.summary.rejected--;
    queue.summary.pending++;
  } else if (previousStatus === 'approved') {
    queue.summary.approved--;
    queue.summary.pending++;
  } else if (previousStatus === 'skipped') {
    queue.summary.skipped--;
    queue.summary.pending++;
  }

  // Reset entry to pending
  entry.status = 'pending';
  entry.edited_at = now();
  delete entry.rejection_reason;
  delete entry.decided_at;

  // Reset presentation status if complete
  if (queue.presentation.status === 'completed') {
    queue.presentation.status = 'in_progress';
  }

  saveQueue(queue);

  return { previous_status: previousStatus, new_status: 'pending' };
}

/**
 * Commit edit session and return story to review queue
 */
function commitEditSession() {
  const sessionsData = loadEditSessions();
  if (!sessionsData || !sessionsData.active_session || !sessionsData.active_session.active) {
    return { error: 'No active edit session to commit' };
  }

  const session = sessionsData.active_session;
  const story = loadStory(session.story_id);

  if (!story) {
    return { error: 'Story not found' };
  }

  // Validate the edited story
  const validation = validateEditedStory(story);
  if (!validation.valid) {
    return {
      error: 'Story validation failed',
      errors: validation.errors,
      warnings: validation.warnings
    };
  }

  // Mark session complete
  session.completed_at = now();
  session.active = false;
  session.changes_count = session.changes.length;

  // Update story with edit history
  if (!story.edit_history) {
    story.edit_history = [];
  }
  story.edit_history.push({
    session_id: session.id,
    timestamp: session.completed_at,
    changes_count: session.changes_count,
    trigger: session.trigger
  });

  // Recalculate coverage
  story.coverage = recalculateCoverage(story);
  story.last_edited = now();

  // Save story
  saveStory(story);

  // Move session to history
  sessionsData.sessions.push(session);
  sessionsData.active_session = null;
  saveEditSessions(sessionsData);

  // Update presentation queue
  const queueUpdate = updateQueueAfterEdit(story.id);

  return {
    success: true,
    story_id: story.id,
    changes_made: session.changes_count,
    previous_status: queueUpdate.previous_status,
    new_status: 'pending',
    validation_warnings: validation.warnings
  };
}

/**
 * Cancel edit session and discard changes
 */
function cancelEditSession() {
  const sessionsData = loadEditSessions();
  if (!sessionsData || !sessionsData.active_session || !sessionsData.active_session.active) {
    return { error: 'No active edit session to cancel' };
  }

  const session = sessionsData.active_session;
  const changesCount = session.changes.length;

  // Mark session as cancelled
  session.cancelled_at = now();
  session.active = false;
  session.cancelled = true;

  // Move to history
  sessionsData.sessions.push(session);
  sessionsData.active_session = null;
  saveEditSessions(sessionsData);

  // Note: We don't revert the story file here. The changes were saved as they were made.
  // A proper implementation would need to store the original story state and restore it.
  // For simplicity, we just mark the session as cancelled.

  return { success: true, discarded_changes: changesCount };
}

/**
 * Get changes in current edit session
 */
function getEditChanges() {
  const session = getActiveEditSession();
  if (!session) {
    return { error: 'No active edit session' };
  }

  return {
    session_id: session.id,
    story_id: session.story_id,
    started_at: session.started_at,
    trigger: session.trigger,
    rejection_reason: session.rejection_reason,
    changes: session.changes,
    changes_count: session.changes.length
  };
}

/**
 * Get edit history for a story
 */
function getEditHistory(storyId) {
  const story = loadStory(storyId);
  if (!story) {
    return { error: `Story ${storyId} not found` };
  }

  const sessionsData = loadEditSessions() || { sessions: [] };

  // Filter sessions for this story
  const storySessions = sessionsData.sessions.filter(s => s.story_id === storyId);

  return {
    story_id: storyId,
    title: story.title,
    edit_count: storySessions.length,
    sessions: storySessions.map(s => ({
      session_id: s.id,
      timestamp: s.completed_at || s.cancelled_at,
      trigger: s.trigger,
      changes_count: s.changes_count || s.changes.length,
      cancelled: s.cancelled || false
    })),
    story_edit_history: story.edit_history || []
  };
}

/**
 * List stories that can be edited (rejected or approved)
 */
function listEditableStories() {
  const queue = loadQueue();
  if (!queue) {
    return { error: 'No presentation queue found' };
  }

  const editable = queue.stories.filter(s =>
    s.status === 'rejected' || s.status === 'approved' || s.status === 'skipped'
  );

  return {
    total: editable.length,
    rejected: editable.filter(s => s.status === 'rejected').map(s => ({
      id: s.id,
      title: s.title,
      status: s.status,
      rejection_reason: s.rejection_reason
    })),
    approved: editable.filter(s => s.status === 'approved').map(s => ({
      id: s.id,
      title: s.title,
      status: s.status
    })),
    skipped: editable.filter(s => s.status === 'skipped').map(s => ({
      id: s.id,
      title: s.title,
      status: s.status
    }))
  };
}

// ============================================================================
// E3-S5: ready.json Integration
// ============================================================================

/**
 * Generate a workflow ID for task tracking.
 * Delegates to the canonical generateTaskId() from flow-utils.js.
 */
function generateWorkflowId() {
  return generateTaskId('long-input-story');
}

/**
 * Generate sub-task ID from parent
 */
function generateSubTaskId(parentId, index) {
  return `${parentId}-${String(index).padStart(2, '0')}`;
}

/**
 * Map story complexity to task priority
 */
const COMPLEXITY_TO_PRIORITY = {
  'simple': 'P3',
  'low': 'P3',
  'medium': 'P2',
  'high': 'P1',
  'very_high': 'P0'
};

function mapPriority(story) {
  const level = story.complexity?.level || 'medium';
  return COMPLEXITY_TO_PRIORITY[level] || 'P2';
}

/**
 * Format user story description
 */
function formatUserStoryDescription(userStory) {
  if (!userStory) return '';
  const who = userStory.user_type || 'user';
  const what = userStory.action || 'perform an action';
  const why = userStory.benefit || 'achieve my goal';
  return `As a ${who}, I want to ${what}, so that ${why}.`;
}

/**
 * Convert a story to a workflow task
 */
function convertStoryToTask(story, options = {}) {
  const taskId = options.taskId || generateWorkflowId();
  const activeDigest = loadActiveDigest();

  return {
    id: taskId,
    title: story.title,
    type: options.type || 'story',
    parent: options.parent || null,
    epic: options.epic || null,
    status: 'ready',
    priority: mapPriority(story),
    dependencies: options.dependencies || [],
    createdAt: now(),
    source: {
      type: 'transcript-digestion',
      digest_id: activeDigest.session?.id || 'unknown',
      story_id: story.id,
      topic_id: story.topic_id
    },
    description: formatUserStoryDescription(story.user_story),
    acceptanceCriteria: (story.acceptance_criteria || []).map(ac => ({
      id: ac.id,
      scenario: ac.scenario,
      given: ac.given?.text || '',
      when: ac.when?.text || '',
      then: ac.then?.text || ''
    })),
    metadata: {
      coverage: story.coverage?.coverage_percent || 0,
      criteria_count: (story.acceptance_criteria || []).length,
      generated_at: story.generated_at
    }
  };
}

/**
 * Validate stories before export
 */
function validateForExport(stories) {
  const warnings = [];
  const errors = [];

  for (const story of stories) {
    // Check coverage threshold
    if (story.coverage && story.coverage.coverage_percent < 50) {
      warnings.push({
        story_id: story.id,
        message: `Low coverage: ${story.coverage.coverage_percent}%`
      });
    }

    // Check for empty criteria
    if (!story.acceptance_criteria || story.acceptance_criteria.length === 0) {
      errors.push({
        story_id: story.id,
        message: 'No acceptance criteria'
      });
    }

    // Check for manual-only criteria
    if (story.acceptance_criteria && story.acceptance_criteria.length > 0) {
      const manualOnly = story.acceptance_criteria.every(ac =>
        ac.given?.source === 'manual' &&
        ac.when?.source === 'manual' &&
        ac.then?.source === 'manual'
      );
      if (manualOnly) {
        warnings.push({
          story_id: story.id,
          message: 'All criteria manually added - no transcript traceability'
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Export approved stories from the presentation queue
 */
function exportApprovedStories(options = {}) {
  const queue = loadQueue();
  if (!queue) {
    return { error: 'No presentation queue found' };
  }

  const approved = queue.stories.filter(s => s.status === 'approved');
  if (approved.length === 0) {
    return { error: 'No approved stories to export' };
  }

  // Load and convert each story
  const tasks = [];
  const loadErrors = [];

  for (const entry of approved) {
    const story = loadStory(entry.id);
    if (!story) {
      loadErrors.push({ id: entry.id, error: 'Story file not found' });
      continue;
    }

    const task = convertStoryToTask(story, options);
    tasks.push(task);
  }

  // Validate before export
  const stories = approved.map(e => loadStory(e.id)).filter(Boolean);
  const validation = validateForExport(stories);

  return {
    tasks,
    loadErrors,
    validation,
    summary: {
      total_approved: approved.length,
      exported: tasks.length,
      failed: loadErrors.length
    }
  };
}

/**
 * Create a feature task grouping multiple stories
 */
function createFeatureTask(stories, featureName) {
  const featureId = generateWorkflowId();

  return {
    id: featureId,
    title: featureName || `Feature: ${stories[0]?.title || 'Untitled'}`,
    type: 'parent',
    subTasks: stories.map((s, i) => generateSubTaskId(featureId, i + 1)),
    status: 'ready',
    priority: 'P2',
    dependencies: [],
    createdAt: now(),
    source: {
      type: 'transcript-digestion',
      digest_id: loadActiveDigest().session?.id,
      story_count: stories.length
    }
  };
}

/**
 * Add tasks to ready.json
 */
async function addTasksToReadyJson(tasks, _options = {}) {
  const readyPath = path.join(PATHS.state, 'ready.json');

  const defaultReady = {
    lastUpdated: now(),
    ready: [],
    inProgress: [],
    blocked: [],
    recentlyCompleted: []
  };

  return await withLock(readyPath, async () => {
    const readyData = safeJsonParse(readyPath, defaultReady);

    // Check for duplicates by source story_id
    const existingStoryIds = new Set(
      readyData.ready
        .filter(t => t.source?.type === 'transcript-digestion')
        .map(t => t.source?.story_id)
    );

    const newTasks = tasks.filter(t => !existingStoryIds.has(t.source?.story_id));

    if (newTasks.length === 0) {
      return { error: 'All tasks already exist in ready.json', skipped: tasks.length };
    }

    // Add new tasks
    readyData.ready.push(...newTasks);
    readyData.lastUpdated = now();

    writeJson(readyPath, readyData);

    return {
      success: true,
      added: newTasks.length,
      skipped: tasks.length - newTasks.length,
      total_ready: readyData.ready.length
    };
  });
}

/**
 * Format a task as markdown file
 */
function formatTaskAsMarkdown(task) {
  let md = `# ${task.id} ${task.title}\n\n`;

  md += `## User Story\n`;
  md += `${task.description}\n\n`;

  md += `## Acceptance Criteria\n\n`;
  for (const ac of task.acceptanceCriteria || []) {
    md += `### ${ac.id}: ${ac.scenario}\n`;
    md += `**Given** ${ac.given}\n`;
    md += `**When** ${ac.when}\n`;
    md += `**Then** ${ac.then}\n\n`;
  }

  md += `## Metadata\n`;
  md += `- **Priority**: ${task.priority}\n`;
  md += `- **Coverage**: ${task.metadata?.coverage || 0}%\n`;
  md += `- **Criteria Count**: ${task.metadata?.criteria_count || 0}\n`;
  md += `- **Source**: Transcript Digestion (${task.source?.digest_id || 'unknown'})\n`;

  return md;
}

/**
 * Export story files to .workflow/changes/
 */
function exportStoryFiles(tasks, featureName = 'general') {
  const changesDir = path.join(process.cwd(), '.workflow', 'changes', featureName);
  fs.mkdirSync(changesDir, { recursive: true });

  const exported = [];

  for (const task of tasks) {
    const filename = `${task.id}.md`;
    const filepath = path.join(changesDir, filename);

    const content = formatTaskAsMarkdown(task);
    fs.writeFileSync(filepath, content);

    exported.push({ id: task.id, path: filepath });
  }

  return { exported, directory: changesDir };
}

/**
 * Preview what would be exported
 */
function previewExport() {
  const queue = loadQueue();
  if (!queue) {
    return { error: 'No presentation queue found' };
  }

  const approved = queue.stories.filter(s => s.status === 'approved');
  const pending = queue.stories.filter(s => s.status === 'pending' || s.status === 'skipped');

  const stories = approved.map(e => loadStory(e.id)).filter(Boolean);
  const validation = validateForExport(stories);

  return {
    approved_count: approved.length,
    pending_count: pending.length,
    stories: approved.map(e => {
      const story = loadStory(e.id);
      return {
        id: e.id,
        title: e.title,
        priority: story ? mapPriority(story) : 'P2',
        criteria_count: story?.acceptance_criteria?.length || 0,
        coverage: story?.coverage?.coverage_percent || 0
      };
    }),
    validation,
    ready_to_export: validation.valid && approved.length > 0
  };
}

/**
 * Finalize the digestion process and export to ready.json
 */
async function finalizeDigestion(options = {}) {
  // 1. Check presentation status
  const queue = loadQueue();
  if (!queue) {
    return { error: 'No presentation queue found' };
  }

  const pendingCount = queue.stories.filter(s =>
    s.status === 'pending' || s.status === 'skipped'
  ).length;

  if (pendingCount > 0 && !options.force) {
    return {
      error: `${pendingCount} stories not yet reviewed. Use --force to proceed anyway.`,
      pending: pendingCount
    };
  }

  // 2. Export approved stories
  const exportResult = exportApprovedStories(options);
  if (exportResult.error) {
    return exportResult;
  }

  // 3. Add to ready.json
  let addResult;
  try {
    addResult = await addTasksToReadyJson(exportResult.tasks, options);
  } catch (err) {
    return { error: `Failed to add tasks to ready.json: ${err.message}` };
  }
  if (addResult.error && addResult.skipped !== exportResult.tasks.length) {
    return addResult;
  }

  // 4. Optionally export story files
  let fileExport = null;
  if (options.exportFiles) {
    fileExport = exportStoryFiles(exportResult.tasks, options.featureName || 'digest-export');
  }

  // 5. Mark digest as complete
  const activeDigest = loadActiveDigest();
  activeDigest.session.status = 'completed';
  activeDigest.session.completed_at = now();
  activeDigest.session.exported = {
    task_count: addResult.added || 0,
    skipped_count: addResult.skipped || 0,
    timestamp: now()
  };
  saveActiveDigest(activeDigest);

  // 6. Cleanup temp files (processing artifacts no longer needed)
  let cleanupResult = { cleaned: false };
  if (!options.keepTempFiles) {
    cleanupResult = cleanupTempFiles(activeDigest.session.digest_id);
  }

  return {
    success: true,
    approved_count: exportResult.summary.total_approved,
    tasks_added: addResult.added || 0,
    tasks_skipped: addResult.skipped || 0,
    files_exported: fileExport?.exported.length || 0,
    validation: exportResult.validation,
    digest_status: 'completed',
    temp_cleanup: cleanupResult.cleaned ? 'cleaned' : 'kept'
  };
}

/**
 * Cleanup temp processing files after successful completion
 * Removes the digest-specific directory from .workflow/tmp/long-input/
 */
function cleanupTempFiles(digestId) {
  if (!digestId) {
    return { cleaned: false, error: 'No digest ID provided' };
  }

  // Path traversal validation - digestId must be a valid digest format
  // Format: digest-[8 hex chars]
  if (!/^digest-[a-f0-9]{8}$/.test(digestId)) {
    return { cleaned: false, error: 'Invalid digest ID format' };
  }

  const digestPath = path.join(TMP_DIR, digestId);

  // Additional safety: ensure resolved path is within TMP_DIR
  const resolvedPath = path.resolve(digestPath);
  const resolvedTmpDir = path.resolve(TMP_DIR);
  if (!resolvedPath.startsWith(resolvedTmpDir + path.sep)) {
    return { cleaned: false, error: 'Path traversal attempt detected' };
  }

  if (!fs.existsSync(digestPath)) {
    return { cleaned: false, error: 'Digest directory not found' };
  }

  try {
    // Remove the digest directory and all its contents
    fs.rmSync(digestPath, { recursive: true, force: true });

    // Also remove active-digest.json if it points to this digest
    const activeFile = path.join(TMP_DIR, 'active-digest.json');
    if (fs.existsSync(activeFile)) {
      const active = safeJsonParse(activeFile, null);
      if (active && active.session?.digest_id === digestId) {
        try {
          fs.unlinkSync(activeFile);
        } catch (_unlinkErr) {
          // Ignore errors unlinking active file - main cleanup succeeded
        }
      }
    }

    return { cleaned: true, path: digestPath };
  } catch (err) {
    return { cleaned: false, error: err.message };
  }
}

// ============================================================================
// UNIFIED PIPELINE: Generate Stories and Add to ready.json
// ============================================================================

/**
 * Generate all stories from topics and add them to ready.json in one call.
 * Used by the unified extract-review pipeline.
 *
 * Chains: generateAllStories → save stories → initializePresentation →
 *         auto-approve all → exportApprovedStories → addTasksToReadyJson →
 *         exportStoryFiles
 *
 * @param {Object} options
 * @param {string} options.featureName - Feature name for file export (default: 'extract-review')
 * @param {boolean} options.keepTempFiles - Keep temp files after completion
 * @returns {Object} Result with story count, tasks added, and file paths
 */
async function generateAndExportStories(options = {}) {
  const featureName = options.featureName || 'extract-review';

  // Step 1: Generate stories from all active topics
  const genResult = generateAllStories();
  if (genResult.error) {
    return { error: `Story generation failed: ${genResult.error}` };
  }

  if (genResult.stories.length === 0) {
    return { error: 'No stories generated from topics', summary: genResult.summary };
  }

  // Step 2: Save each story
  for (const story of genResult.stories) {
    saveStory(story);
  }

  // Step 3: Initialize presentation queue and auto-approve all stories
  const queue = initializePresentation();
  if (queue.error) {
    return { error: `Presentation init failed: ${queue.error}` };
  }

  // Auto-approve all stories (unified pipeline skips manual review)
  for (const entry of queue.stories) {
    entry.status = 'approved';
    entry.approved_at = now();
  }
  queue.summary.approved = queue.stories.length;
  queue.summary.pending = 0;
  queue.presentation.status = 'completed';
  saveQueue(queue);

  // Step 4: Export approved stories as workflow tasks
  const exportResult = exportApprovedStories({ featureName });
  if (exportResult.error) {
    return { error: `Export failed: ${exportResult.error}` };
  }

  // Step 5: Add tasks to ready.json
  let addResult;
  try {
    addResult = await addTasksToReadyJson(exportResult.tasks);
  } catch (err) {
    return { error: `Failed to add tasks to ready.json: ${err.message}` };
  }
  if (addResult.error && addResult.skipped !== exportResult.tasks.length) {
    return addResult;
  }

  // Step 6: Export story markdown files
  const fileExport = exportStoryFiles(exportResult.tasks, featureName);

  // Step 7: Mark digest as complete
  const activeDigest = loadActiveDigest();
  if (activeDigest.session) {
    activeDigest.session.status = 'completed';
    activeDigest.session.completed_at = now();
    activeDigest.session.exported = {
      task_count: addResult.added || 0,
      skipped_count: addResult.skipped || 0,
      timestamp: now()
    };
    saveActiveDigest(activeDigest);
  }

  return {
    success: true,
    summary: {
      topics_processed: genResult.summary.total_topics,
      stories_generated: genResult.summary.stories_generated,
      total_criteria: genResult.summary.total_criteria,
      average_coverage: genResult.summary.average_coverage,
      tasks_added_to_ready: addResult.added || 0,
      tasks_skipped: addResult.skipped || 0,
      files_exported: fileExport.exported.length,
      export_directory: fileExport.directory
    },
    stories: genResult.stories.map(s => ({
      id: s.id,
      title: s.title,
      criteria_count: s.acceptance_criteria.length,
      coverage: s.coverage.coverage_percent
    })),
    errors: genResult.errors
  };
}

// ============================================================================
// Module Exports
// ============================================================================

module.exports = {
  // Initialization
  init,
  
  // Story Generation (E3-S2)
  USER_TYPE_PATTERNS,
  SCENARIO_PATTERNS,
  generateStoryId,
  detectUserType,
  extractObject,
  generateScenarioName,
  extractActionFromText,
  extractOutcomeFromText,
  convertToGiven,
  extractGiven,
  extractWhen,
  extractThen,
  generateCriteriaFromClarification,
  buildTraceabilityMatrix,
  validateStoryCoverage,
  generateStoryFromTopic,
  generateAllStories,
  saveStory,
  loadStory,
  loadAllStories,
  formatStoryAsMarkdown,
  
  // Story Presentation Queue
  loadQueue,
  saveQueue,
  initializePresentation,
  getPresentationStatus,
  getNextStory,
  getCurrentStory,
  approveCurrentStory,
  rejectCurrentStory,
  skipCurrentStory,
  formatStorySummary,
  formatActionsPrompt,
  getCompletionSummary,
  resetPresentation,
  
  // Story Editing
  generateEditSessionId,
  generateChangeId,
  loadEditSessions,
  saveEditSessions,
  startEditSession,
  getActiveEditSession,
  recordChange,
  editUserStory,
  editCriterion,
  addCriterion,
  removeCriterion,
  validateEditedStory,
  recalculateCoverage,
  updateQueueAfterEdit,
  commitEditSession,
  cancelEditSession,
  getEditChanges,
  getEditHistory,
  listEditableStories,
  
  // Workflow Export
  generateWorkflowId,
  generateSubTaskId,
  mapPriority,
  formatUserStoryDescription,
  convertStoryToTask,
  validateForExport,
  exportApprovedStories,
  createFeatureTask,
  addTasksToReadyJson,
  formatTaskAsMarkdown,
  exportStoryFiles,
  previewExport,
  finalizeDigestion,

  // Unified Pipeline
  generateAndExportStories,

  // Temp File Cleanup
  cleanupTempFiles
};
