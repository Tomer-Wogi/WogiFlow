#!/usr/bin/env node

/**
 * Wogi Flow - Specification Generator (Priority 2: Mandatory Spec Mode)
 *
 * Generates comprehensive specifications BEFORE implementation starts.
 * Follows "spec-first" approach - planning before coding.
 *
 * Key principle: "Quality code starts with quality planning"
 *
 * Usage:
 *   const { generateSpec, loadSpec, validateSpec } = require('./flow-spec-generator');
 *   const spec = await generateSpec(taskId, taskContext);
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot, getConfig, PATHS, colors } = require('./flow-utils');
const { matchSkills, loadSkillContext } = require('./flow-skill-matcher');

const PROJECT_ROOT = getProjectRoot();

// ============================================================
// Spec Generation
// ============================================================

/**
 * Generate a specification for a task
 *
 * @param {string} taskId - Task ID (e.g., wf-abc123)
 * @param {object} taskContext - Task context
 * @param {string} taskContext.title - Task title
 * @param {string} taskContext.description - Task description
 * @param {string} taskContext.userStory - User story (As a... I want... So that...)
 * @param {Array} taskContext.acceptanceCriteria - Acceptance criteria scenarios
 * @param {string} taskContext.type - Task type (feature, bugfix, refactor)
 * @param {string} taskContext.size - Task size (small, medium, large)
 */
async function generateSpec(taskId, taskContext) {
  const config = getConfig();
  const specConfig = config.specificationMode || {};

  // Check if spec mode is enabled
  if (!specConfig.enabled) {
    return { skipped: true, reason: 'Specification mode disabled' };
  }

  // Check if mandatory for this task size
  const taskSize = taskContext.size || 'medium';
  const taskType = taskContext.type || 'feature';

  if (specConfig.skipFor?.includes(taskSize) || specConfig.skipFor?.includes(taskType)) {
    return { skipped: true, reason: `Skipped for ${taskSize}/${taskType} tasks` };
  }

  // Generate spec content
  const spec = {
    taskId,
    title: taskContext.title,
    generatedAt: new Date().toISOString(),
    status: 'pending_approval',
    sections: {}
  };

  // 1. Acceptance Criteria
  if (specConfig.sections?.acceptanceCriteria !== false) {
    spec.sections.acceptanceCriteria = formatAcceptanceCriteria(taskContext.acceptanceCriteria);
  }

  // 2. Implementation Steps
  if (specConfig.sections?.implementationSteps !== false) {
    spec.sections.implementationSteps = await generateImplementationSteps(taskContext);
  }

  // 3. Files to Change
  if (specConfig.sections?.filesToChange !== false && specConfig.autoDetectFiles) {
    spec.sections.filesToChange = await detectFilesToChange(taskContext);
  }

  // 3.5 Boundary Declarations (DO NOT MODIFY files)
  if (specConfig.sections?.boundaries !== false) {
    spec.sections.boundaries = extractBoundaries(taskContext);
  }

  // 4. Test Strategy
  if (specConfig.sections?.testStrategy !== false) {
    spec.sections.testStrategy = generateTestStrategy(taskContext);
  }

  // 5. Verification Commands
  if (specConfig.sections?.verificationCommands !== false) {
    spec.sections.verificationCommands = generateVerificationCommands(taskContext);
  }

  // 6. Matched Skills
  const matchedSkills = matchSkills(taskContext.description || taskContext.title, {
    taskType: taskContext.type
  });
  spec.sections.matchedSkills = matchedSkills.map(s => ({
    name: s.name,
    score: s.score,
    reasons: s.reasons
  }));

  // 7. Assumptions (Phase 0.5 - Hybrid Assumption Surfacing)
  if (specConfig.sections?.assumptions !== false) {
    try {
      const {
        detectAssumptions,
        getAssumptionsNeedingClarification,
        generateClarificationQuestions
      } = require('../.workflow/lib/assumption-detector');
      const assumptions = detectAssumptions({
        title: taskContext.title,
        description: taskContext.description || taskContext.userStory || '',
        acceptanceCriteria: taskContext.acceptanceCriteria || [],
        context: taskContext
      });
      const needingClarification = getAssumptionsNeedingClarification(assumptions);
      spec.sections.assumptions = {
        detected: assumptions,
        needingClarification,
        clarificationRequired: needingClarification.length > 0,
        // AskUserQuestion-compatible format for Claude to use
        askUserQuestions: needingClarification.length > 0
          ? generateClarificationQuestions(assumptions)
          : []
      };
    } catch (err) {
      // Assumption detector not available
      spec.sections.assumptions = { detected: [], needingClarification: [], error: err.message };
    }
  }

  // 8. Rollback Plan (optional)
  if (specConfig.sections?.rollbackPlan) {
    spec.sections.rollbackPlan = generateRollbackPlan(taskContext);
  }

  // Save spec to file
  const specPath = saveSpec(taskId, spec);
  spec.filePath = specPath;

  return spec;
}

/**
 * Format acceptance criteria into structured scenarios
 */
function formatAcceptanceCriteria(criteria) {
  if (!criteria || criteria.length === 0) {
    return [];
  }

  return criteria.map((criterion, index) => {
    // Parse Given/When/Then if it's a string
    if (typeof criterion === 'string') {
      const givenMatch = criterion.match(/Given\s+(.+?)(?=\s+When|$)/i);
      const whenMatch = criterion.match(/When\s+(.+?)(?=\s+Then|$)/i);
      const thenMatch = criterion.match(/Then\s+(.+?)$/i);

      return {
        id: index + 1,
        scenario: criterion,
        given: givenMatch ? givenMatch[1].trim() : null,
        when: whenMatch ? whenMatch[1].trim() : null,
        then: thenMatch ? thenMatch[1].trim() : null,
        status: 'pending'
      };
    }

    return {
      id: index + 1,
      ...criterion,
      status: 'pending'
    };
  });
}

/**
 * Generate implementation steps based on task context
 */
async function generateImplementationSteps(taskContext) {
  const steps = [];

  // Base steps for all tasks
  steps.push({
    order: 1,
    description: 'Load and review relevant context',
    type: 'preparation',
    status: 'pending'
  });

  // Add steps based on task type
  const type = taskContext.type || 'feature';

  if (type === 'feature') {
    steps.push(
      { order: 2, description: 'Create/update necessary data models', type: 'implementation', status: 'pending' },
      { order: 3, description: 'Implement core business logic', type: 'implementation', status: 'pending' },
      { order: 4, description: 'Add API endpoints or UI components', type: 'implementation', status: 'pending' },
      { order: 5, description: 'Write unit tests', type: 'testing', status: 'pending' },
      { order: 6, description: 'Write integration tests', type: 'testing', status: 'pending' }
    );
  } else if (type === 'bugfix') {
    steps.push(
      { order: 2, description: 'Reproduce the bug', type: 'investigation', status: 'pending' },
      { order: 3, description: 'Identify root cause', type: 'investigation', status: 'pending' },
      { order: 4, description: 'Write failing test that captures the bug', type: 'testing', status: 'pending' },
      { order: 5, description: 'Implement fix', type: 'implementation', status: 'pending' },
      { order: 6, description: 'Verify test passes', type: 'verification', status: 'pending' }
    );
  } else if (type === 'refactor') {
    steps.push(
      { order: 2, description: 'Ensure existing tests pass', type: 'verification', status: 'pending' },
      { order: 3, description: 'Refactor code incrementally', type: 'implementation', status: 'pending' },
      { order: 4, description: 'Verify tests still pass after each change', type: 'verification', status: 'pending' },
      { order: 5, description: 'Update documentation if needed', type: 'documentation', status: 'pending' }
    );
  }

  // Add final verification step
  steps.push({
    order: steps.length + 1,
    description: 'Run all verification commands',
    type: 'verification',
    status: 'pending'
  });

  return steps;
}

/**
 * Detect files that will likely be changed
 * Uses task description keywords and existing file patterns
 */
async function detectFilesToChange(taskContext) {
  const files = {
    create: [],
    modify: [],
    delete: []
  };

  // Extract keywords from description
  const desc = (taskContext.description || taskContext.title || '').toLowerCase();

  // Check component-index for matching files
  const indexPath = path.join(PATHS.state, 'component-index.json');
  if (fs.existsSync(indexPath)) {
    try {
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      const components = index.components || [];

      // Find components that match keywords
      for (const comp of components) {
        const name = (comp.name || '').toLowerCase();
        const filePath = comp.path || '';

        // Simple keyword matching
        const keywords = desc.split(/\s+/).filter(w => w.length > 3);
        for (const keyword of keywords) {
          if (name.includes(keyword) || filePath.toLowerCase().includes(keyword)) {
            files.modify.push({
              path: filePath,
              reason: `matches keyword "${keyword}"`,
              confidence: 'medium'
            });
            break;
          }
        }
      }
    } catch {
      // Ignore errors
    }
  }

  // Deduplicate
  files.modify = [...new Map(files.modify.map(f => [f.path, f])).values()];

  return files;
}

/**
 * Extract boundary declarations from task context
 * Boundaries are files/paths that must NOT be modified during this task.
 * They come from the spec's "## Boundaries" section if present.
 *
 * @param {Object} taskContext - The task context
 * @returns {string[]} Array of file/path patterns that are off-limits
 */
function extractBoundaries(taskContext) {
  const boundaries = [];

  // Extract from spec content if available (## Boundaries section)
  if (taskContext.specContent) {
    const boundaryMatch = taskContext.specContent.match(
      /## Boundaries[^\n]*\n([\s\S]*?)(?=\n## |\n$|$)/i
    );
    if (boundaryMatch) {
      const lines = boundaryMatch[1].split('\n');
      for (const line of lines) {
        // Match bullet points with file paths: "- path/to/file.js — reason"
        const pathMatch = line.match(/^[-*]\s+([^\s—]+)/);
        if (pathMatch && pathMatch[1] && !pathMatch[1].startsWith('[')) {
          boundaries.push(pathMatch[1].trim());
        }
      }
    }
  }

  // Extract from explicit boundaries field if present
  if (Array.isArray(taskContext.boundaries)) {
    for (const b of taskContext.boundaries) {
      if (typeof b === 'string' && b.length > 0) {
        boundaries.push(b);
      }
    }
  }

  return boundaries;
}

/**
 * Generate test strategy based on task context
 */
function generateTestStrategy(taskContext) {
  const strategy = {
    unitTests: [],
    integrationTests: [],
    e2eTests: []
  };

  const type = taskContext.type || 'feature';

  if (type === 'feature') {
    strategy.unitTests.push(
      'Test core business logic functions',
      'Test edge cases and error handling',
      'Test data transformations'
    );
    strategy.integrationTests.push(
      'Test API endpoints with mock data',
      'Test database operations',
      'Test service integrations'
    );
    strategy.e2eTests.push(
      'Test happy path user flow',
      'Test error scenarios'
    );
  } else if (type === 'bugfix') {
    strategy.unitTests.push(
      'Add test case that reproduces the bug',
      'Add tests for related edge cases'
    );
    strategy.integrationTests.push(
      'Verify fix doesn\'t break existing functionality'
    );
  } else if (type === 'refactor') {
    strategy.unitTests.push(
      'Ensure all existing tests still pass',
      'Update tests if API changes'
    );
  }

  return strategy;
}

/**
 * Generate verification commands
 */
function generateVerificationCommands(taskContext) {
  const config = getConfig();
  const commands = [];

  // Add lint command
  commands.push({
    command: 'npm run lint',
    description: 'Run linter',
    required: true,
    expectedExitCode: 0
  });

  // Add typecheck command
  commands.push({
    command: 'npm run typecheck',
    description: 'Run type checker',
    required: true,
    expectedExitCode: 0
  });

  // Add test command
  commands.push({
    command: 'npm test',
    description: 'Run tests',
    required: true,
    expectedExitCode: 0
  });

  // Add build command for features
  if (taskContext.type === 'feature') {
    commands.push({
      command: 'npm run build',
      description: 'Build project',
      required: false,
      expectedExitCode: 0
    });
  }

  return commands;
}

/**
 * Generate rollback plan
 */
function generateRollbackPlan(taskContext) {
  return {
    strategy: 'git-revert',
    steps: [
      'Identify the commit(s) to revert',
      'Run git revert <commit-hash>',
      'Verify tests pass after revert',
      'Push revert commit'
    ],
    automatedRollback: false
  };
}

// ============================================================
// Spec File Management
// ============================================================

/**
 * Save spec to file
 */
function saveSpec(taskId, spec) {
  const config = getConfig();
  const specDir = config.specificationMode?.specDirectory || '.workflow/specs';
  const fullDir = path.join(PROJECT_ROOT, specDir);

  // Ensure directory exists
  if (!fs.existsSync(fullDir)) {
    fs.mkdirSync(fullDir, { recursive: true });
  }

  // Generate markdown content
  const content = formatSpecAsMarkdown(spec);

  // Save file
  const filePath = path.join(fullDir, `${taskId}.md`);
  fs.writeFileSync(filePath, content, 'utf-8');

  // Also save JSON version for programmatic access
  const jsonPath = path.join(fullDir, `${taskId}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(spec, null, 2), 'utf-8');

  return filePath;
}

/**
 * Format spec as markdown
 */
function formatSpecAsMarkdown(spec) {
  let md = `# Specification: ${spec.title}\n\n`;
  md += `**Task ID:** ${spec.taskId}\n`;
  md += `**Generated:** ${spec.generatedAt}\n`;
  md += `**Status:** ${spec.status}\n\n`;
  md += `---\n\n`;

  // Acceptance Criteria
  if (spec.sections.acceptanceCriteria?.length > 0) {
    md += `## Acceptance Criteria\n\n`;
    for (const criterion of spec.sections.acceptanceCriteria) {
      md += `### Scenario ${criterion.id}\n`;
      if (criterion.given) md += `**Given** ${criterion.given}\n`;
      if (criterion.when) md += `**When** ${criterion.when}\n`;
      if (criterion.then) md += `**Then** ${criterion.then}\n`;
      md += `**Status:** ${criterion.status}\n\n`;
    }
  }

  // Implementation Steps
  if (spec.sections.implementationSteps?.length > 0) {
    md += `## Implementation Steps\n\n`;
    for (const step of spec.sections.implementationSteps) {
      const checkbox = step.status === 'completed' ? '[x]' : '[ ]';
      md += `${checkbox} **Step ${step.order}:** ${step.description} _(${step.type})_\n`;
    }
    md += '\n';
  }

  // Files to Change
  if (spec.sections.filesToChange) {
    md += `## Files to Change\n\n`;
    const files = spec.sections.filesToChange;

    if (files.create?.length > 0) {
      md += `### Create\n`;
      for (const f of files.create) {
        md += `- \`${f.path}\` - ${f.reason}\n`;
      }
      md += '\n';
    }

    if (files.modify?.length > 0) {
      md += `### Modify\n`;
      for (const f of files.modify) {
        md += `- \`${f.path}\` - ${f.reason} (${f.confidence})\n`;
      }
      md += '\n';
    }
  }

  // Test Strategy
  if (spec.sections.testStrategy) {
    md += `## Test Strategy\n\n`;
    const ts = spec.sections.testStrategy;

    if (ts.unitTests?.length > 0) {
      md += `### Unit Tests\n`;
      for (const t of ts.unitTests) {
        md += `- ${t}\n`;
      }
      md += '\n';
    }

    if (ts.integrationTests?.length > 0) {
      md += `### Integration Tests\n`;
      for (const t of ts.integrationTests) {
        md += `- ${t}\n`;
      }
      md += '\n';
    }

    if (ts.e2eTests?.length > 0) {
      md += `### E2E Tests\n`;
      for (const t of ts.e2eTests) {
        md += `- ${t}\n`;
      }
      md += '\n';
    }
  }

  // Verification Commands
  if (spec.sections.verificationCommands?.length > 0) {
    md += `## Verification Commands\n\n`;
    md += `| Command | Description | Required | Expected Exit |\n`;
    md += `|---------|-------------|----------|---------------|\n`;
    for (const cmd of spec.sections.verificationCommands) {
      md += `| \`${cmd.command}\` | ${cmd.description} | ${cmd.required ? 'Yes' : 'No'} | ${cmd.expectedExitCode} |\n`;
    }
    md += '\n';
  }

  // Matched Skills
  if (spec.sections.matchedSkills?.length > 0) {
    md += `## Matched Skills\n\n`;
    for (const skill of spec.sections.matchedSkills) {
      md += `- **${skill.name}** (score: ${skill.score})\n`;
      md += `  - ${skill.reasons.slice(0, 3).join(', ')}\n`;
    }
    md += '\n';
  }

  // Assumptions
  if (spec.sections.assumptions?.detected?.length > 0) {
    md += `## Assumptions\n\n`;

    // Show clarification warning if needed
    const needClarification = spec.sections.assumptions.needingClarification || [];
    if (needClarification.length > 0) {
      md += `> ⚠️ **${needClarification.length} assumption(s) need clarification** before proceeding.\n\n`;
      md += `> Use \`AskUserQuestion\` tool to clarify these assumptions before implementation.\n\n`;
    }

    // Format assumptions using assumption-detector if available
    try {
      const { formatAssumptionsForSpec } = require('../.workflow/lib/assumption-detector');
      md += formatAssumptionsForSpec(spec.sections.assumptions.detected);
    } catch {
      // Fallback formatting
      for (const a of spec.sections.assumptions.detected) {
        const confidenceDisplay = Math.round(a.confidence * 100);
        const needsFlag = a.needsClarification ? ' ⚠️' : '';
        md += `- **[${a.id}]** ${a.text} (${confidenceDisplay}% confidence)${needsFlag}\n`;
        if (a.needsClarification && a.clarificationQuestion) {
          md += `  - *Clarify:* ${a.clarificationQuestion}\n`;
        }
      }
    }

    // Add clarification questions JSON for Claude to use with AskUserQuestion
    if (spec.sections.assumptions.askUserQuestions?.length > 0) {
      md += `\n### Clarification Questions\n\n`;
      md += `The following questions are formatted for \`AskUserQuestion\`:\n\n`;
      md += `\`\`\`json\n`;
      // Format without assumption metadata (just the tool-compatible format)
      const toolQuestions = spec.sections.assumptions.askUserQuestions.map(q => ({
        question: q.question,
        header: q.header,
        options: q.options,
        multiSelect: q.multiSelect
      }));
      md += JSON.stringify(toolQuestions, null, 2);
      md += `\n\`\`\`\n`;
    }
    md += '\n';
  }

  return md;
}

/**
 * Load existing spec for a task
 */
function loadSpec(taskId) {
  const config = getConfig();
  const specDir = config.specificationMode?.specDirectory || '.workflow/specs';
  const jsonPath = path.join(PROJECT_ROOT, specDir, `${taskId}.json`);

  if (!fs.existsSync(jsonPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Update spec status
 */
function updateSpecStatus(taskId, status) {
  const spec = loadSpec(taskId);
  if (!spec) return null;

  spec.status = status;
  spec.updatedAt = new Date().toISOString();

  saveSpec(taskId, spec);
  return spec;
}

/**
 * Mark spec step as completed
 */
function markStepCompleted(taskId, stepOrder) {
  const spec = loadSpec(taskId);
  if (!spec) return null;

  const step = spec.sections.implementationSteps?.find(s => s.order === stepOrder);
  if (step) {
    step.status = 'completed';
    step.completedAt = new Date().toISOString();
  }

  spec.updatedAt = new Date().toISOString();
  saveSpec(taskId, spec);
  return spec;
}

/**
 * Validate that spec requirements are met
 */
function validateSpec(taskId) {
  const spec = loadSpec(taskId);
  if (!spec) {
    return { valid: false, errors: ['Spec not found'] };
  }

  const errors = [];
  const warnings = [];

  // Check all acceptance criteria are addressed
  for (const criterion of spec.sections.acceptanceCriteria || []) {
    if (criterion.status !== 'completed') {
      errors.push(`Acceptance criterion ${criterion.id} not completed`);
    }
  }

  // Check all implementation steps are completed
  for (const step of spec.sections.implementationSteps || []) {
    if (step.status !== 'completed') {
      warnings.push(`Implementation step ${step.order} not completed: ${step.description}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

// ============================================================
// CLI
// ============================================================

function showHelp() {
  console.log(`
Wogi Flow - Specification Generator

Generates comprehensive specifications before implementation.

Usage:
  flow spec generate <task-id> [options]
  flow spec view <task-id>
  flow spec validate <task-id>
  flow spec approve <task-id>

Commands:
  generate   Generate a new spec for a task
  view       View existing spec
  validate   Validate spec completion
  approve    Mark spec as approved

Options:
  --title <title>       Task title
  --description <desc>  Task description
  --type <type>         Task type (feature, bugfix, refactor)
  --size <size>         Task size (small, medium, large)
  --json                Output as JSON
  --help, -h            Show this help

Examples:
  flow spec generate wf-abc123 --title "Add user login" --type feature
  flow spec view wf-abc123
  flow spec validate wf-abc123
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    showHelp();
    process.exit(0);
  }

  const command = args[0];
  const taskId = args[1];
  const jsonOutput = args.includes('--json');

  if (!taskId && command !== '--help') {
    console.log(`${colors.red}Error: Task ID required${colors.reset}`);
    process.exit(1);
  }

  switch (command) {
    case 'generate': {
      // Extract options
      const titleIdx = args.indexOf('--title');
      const descIdx = args.indexOf('--description');
      const typeIdx = args.indexOf('--type');
      const sizeIdx = args.indexOf('--size');

      const context = {
        title: titleIdx >= 0 ? args[titleIdx + 1] : taskId,
        description: descIdx >= 0 ? args[descIdx + 1] : '',
        type: typeIdx >= 0 ? args[typeIdx + 1] : 'feature',
        size: sizeIdx >= 0 ? args[sizeIdx + 1] : 'medium',
        acceptanceCriteria: []
      };

      const spec = await generateSpec(taskId, context);

      if (jsonOutput) {
        console.log(JSON.stringify(spec, null, 2));
      } else {
        if (spec.skipped) {
          console.log(`${colors.yellow}Spec generation skipped: ${spec.reason}${colors.reset}`);
        } else {
          console.log(`${colors.green}✓ Spec generated: ${spec.filePath}${colors.reset}`);
          console.log(`\n${colors.cyan}Sections:${colors.reset}`);
          for (const [name, content] of Object.entries(spec.sections)) {
            const count = Array.isArray(content) ? content.length : Object.keys(content).length;
            console.log(`  - ${name}: ${count} items`);
          }
        }
      }
      break;
    }

    case 'view': {
      const spec = loadSpec(taskId);
      if (!spec) {
        console.log(`${colors.red}Spec not found for ${taskId}${colors.reset}`);
        process.exit(1);
      }

      if (jsonOutput) {
        console.log(JSON.stringify(spec, null, 2));
      } else {
        console.log(formatSpecAsMarkdown(spec));
      }
      break;
    }

    case 'validate': {
      const result = validateSpec(taskId);

      if (jsonOutput) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (result.valid) {
          console.log(`${colors.green}✓ Spec validation passed${colors.reset}`);
        } else {
          console.log(`${colors.red}✗ Spec validation failed${colors.reset}`);
          for (const error of result.errors) {
            console.log(`  ${colors.red}• ${error}${colors.reset}`);
          }
        }
        if (result.warnings.length > 0) {
          console.log(`\n${colors.yellow}Warnings:${colors.reset}`);
          for (const warning of result.warnings) {
            console.log(`  ${colors.yellow}• ${warning}${colors.reset}`);
          }
        }
      }
      break;
    }

    case 'approve': {
      const spec = updateSpecStatus(taskId, 'approved');
      if (!spec) {
        console.log(`${colors.red}Spec not found for ${taskId}${colors.reset}`);
        process.exit(1);
      }
      console.log(`${colors.green}✓ Spec approved for ${taskId}${colors.reset}`);
      break;
    }

    default:
      console.log(`${colors.red}Unknown command: ${command}${colors.reset}`);
      showHelp();
      process.exit(1);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  generateSpec,
  loadSpec,
  saveSpec,
  updateSpecStatus,
  markStepCompleted,
  validateSpec,
  formatSpecAsMarkdown,
  formatAcceptanceCriteria,
  generateImplementationSteps,
  detectFilesToChange,
  generateTestStrategy,
  generateVerificationCommands
};

if (require.main === module) {
  main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
