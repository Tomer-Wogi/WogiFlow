#!/usr/bin/env node

/**
 * Wogi Flow - Update Knowledge Base Step
 *
 * Prompts to document learnings in the knowledge base.
 * Helps capture institutional knowledge automatically.
 */

const fs = require('node:fs');
const path = require('node:path');
const { getProjectRoot, colors, getConfig, PATHS } = require('./flow-utils');

const KNOWLEDGE_DIR = path.join(PATHS.root, '.claude', 'docs', 'knowledge-base');

/**
 * Run update knowledge base step
 *
 * @param {object} options
 * @param {string} options.taskId - Current task ID
 * @param {string} options.taskTitle - Task title/description
 * @param {string[]} options.files - Files modified
 * @param {object} options.stepConfig - Step configuration
 * @param {string} options.mode - Step mode (block/warn/prompt/auto)
 * @param {object} options.learnings - Any learnings discovered during task
 * @returns {object} - { passed: boolean, message: string, suggestion?: string }
 */
async function run(options = {}) {
  const { taskId, taskTitle, files = [], mode, stepConfig = {}, learnings } = options;

  // Ensure knowledge base directory exists
  if (!fs.existsSync(KNOWLEDGE_DIR)) {
    fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
  }

  // Detect potential learnings based on task
  const detectedLearnings = detectLearnings(files, taskTitle);

  if (detectedLearnings.length === 0 && !learnings) {
    return { passed: true, message: 'No learnings detected to document' };
  }

  // In prompt mode, suggest documentation
  if (mode === 'prompt') {
    console.log(colors.yellow + '\n  Potential learnings to document:' + colors.reset);

    if (learnings) {
      console.log(`    - ${learnings}`);
    }

    detectedLearnings.forEach(l => {
      console.log(`    - ${l.type}: ${l.description}`);
    });

    console.log(colors.cyan + '\n  Knowledge base location: .claude/docs/knowledge-base/' + colors.reset);

    // Suggest where to document
    const suggestion = suggestKnowledgeFile(detectedLearnings, taskTitle);
    if (suggestion) {
      console.log(colors.cyan + `  Suggested file: ${suggestion}` + colors.reset);
    }

    return {
      passed: true,
      message: 'Documentation prompt shown',
      suggestion: `Document learnings in ${suggestion || 'knowledge-base'}`,
      detectedLearnings,
    };
  }

  // In auto mode, we could auto-create entries (future enhancement)
  return {
    passed: true,
    message: `${detectedLearnings.length} potential learning(s) detected`,
    suggestion: 'Consider documenting these patterns',
    detectedLearnings,
  };
}

/**
 * Detect potential learnings based on files and task
 */
function detectLearnings(files, taskTitle) {
  const learnings = [];

  // Check for new patterns
  const hasNewComponent = files.some(f =>
    f.includes('/components/') && !f.includes('.test.') && !f.includes('.spec.')
  );
  if (hasNewComponent) {
    learnings.push({
      type: 'component',
      description: 'New component created - document usage patterns',
      category: 'components',
    });
  }

  // Check for new hooks
  const hasNewHook = files.some(f =>
    f.includes('/hooks/') || (f.includes('use') && f.endsWith('.ts'))
  );
  if (hasNewHook) {
    learnings.push({
      type: 'hook',
      description: 'Custom hook created - document API and usage',
      category: 'hooks',
    });
  }

  // Check for API endpoints
  const hasApiChange = files.some(f =>
    f.includes('/api/') || f.includes('.controller.') || f.includes('.routes.')
  );
  if (hasApiChange) {
    learnings.push({
      type: 'api',
      description: 'API endpoint modified - document request/response format',
      category: 'api',
    });
  }

  // Check for configuration changes
  const hasConfigChange = files.some(f =>
    f.includes('config') || f.endsWith('.env.example') || f.includes('settings')
  );
  if (hasConfigChange) {
    learnings.push({
      type: 'configuration',
      description: 'Configuration changed - document options',
      category: 'configuration',
    });
  }

  // Check for database/model changes
  const hasModelChange = files.some(f =>
    f.includes('/models/') || f.includes('/entities/') || f.includes('.schema.')
  );
  if (hasModelChange) {
    learnings.push({
      type: 'data-model',
      description: 'Data model changed - document schema',
      category: 'data-models',
    });
  }

  // Check task title for patterns
  const titleLower = (taskTitle || '').toLowerCase();
  if (titleLower.includes('fix') || titleLower.includes('bug')) {
    learnings.push({
      type: 'bugfix',
      description: 'Bug fixed - document root cause and solution',
      category: 'troubleshooting',
    });
  }

  if (titleLower.includes('performance') || titleLower.includes('optim')) {
    learnings.push({
      type: 'performance',
      description: 'Performance improvement - document technique',
      category: 'performance',
    });
  }

  return learnings;
}

/**
 * Suggest knowledge base file based on learnings
 */
function suggestKnowledgeFile(learnings, taskTitle) {
  if (learnings.length === 0) return null;

  const primary = learnings[0];
  const category = primary.category || 'general';

  // Check if category file exists
  const categoryFile = path.join(KNOWLEDGE_DIR, `${category}.md`);
  if (fs.existsSync(categoryFile)) {
    return `knowledge-base/${category}.md`;
  }

  // Check subdirectories
  const categoryDir = path.join(KNOWLEDGE_DIR, category);
  if (fs.existsSync(categoryDir)) {
    return `knowledge-base/${category}/`;
  }

  // Suggest new file
  return `knowledge-base/${category}.md (new)`;
}

module.exports = { run, detectLearnings };
