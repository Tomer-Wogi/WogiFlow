#!/usr/bin/env node

/**
 * Wogi Flow - Knowledge Router
 *
 * See MEMORY-ARCHITECTURE.md for how this fits with other memory/knowledge modules.
 *
 * Auto-detects where learnings/corrections should be stored:
 * - model-specific: Applies only to a specific LLM
 * - skill: Related to a specific skill (nestjs, react, etc.)
 * - project: Project-specific decisions
 * - team: General patterns worthy of team sharing
 *
 * Implements "auto-detect + confirm" pattern:
 * 1. Analyzes correction text and context
 * 2. Suggests best route with confidence score
 * 3. Asks user to confirm or choose alternative
 *
 * Part of v1.8.0 Team Collaboration
 */

const fs = require('fs');
const path = require('path');
const {
  getConfig,
  PATHS,
  STATE_DIR,
  colors,
  color,
  success,
  warn,
  error,
  readFile,
  writeFile,
  fileExists,
  printHeader
} = require('./flow-utils');

// Import from skill-learn and model-adapter to avoid duplication
const { appendLearning: appendSkillLearning } = require('./flow-skill-learn');
const { storeSingleLearning: storeModelLearning, getCurrentModel } = require('./flow-model-adapter');

// Use shared memory database for proposals
const memoryDb = require('./flow-memory-db');

// Rules sync for Claude Code integration
const { syncDecisionsToRules } = require('./flow-rules-sync');

// ============================================================
// Route Detection
// ============================================================

/**
 * Detect possible routes for a learning/correction
 * @param {string} correction - The correction or learning text
 * @param {object} context - Context about where this came from
 * @returns {Array} Sorted array of route suggestions with confidence
 */
function detectKnowledgeRoute(correction, context = {}) {
  const routes = [];
  const correctionLower = correction.toLowerCase();

  // 1. Check if model-specific
  const modelPatterns = [
    { pattern: /claude|anthropic/i, model: 'claude' },
    { pattern: /gemini|google/i, model: 'gemini' },
    { pattern: /gpt|openai|chatgpt/i, model: 'openai' },
    { pattern: /ollama|local|llama|qwen|deepseek|mistral|nemotron/i, model: 'local' }
  ];

  const modelMatch = modelPatterns.find(p =>
    p.pattern.test(correction) || (context.currentModel && p.pattern.test(context.currentModel))
  );

  // Check for model-specific error patterns
  const modelErrorIndicators = [
    'this model',
    'claude tends to',
    'gemini often',
    'when using',
    'with this llm',
    'model-specific'
  ];

  const hasModelIndicator = modelErrorIndicators.some(ind =>
    correctionLower.includes(ind)
  ) || context.errorWasModelSpecific;

  if (modelMatch || hasModelIndicator) {
    routes.push({
      type: 'model-specific',
      model: modelMatch?.model || context.currentModel || 'unknown',
      confidence: hasModelIndicator ? 0.85 : 0.7,
      description: `Store as ${modelMatch?.model || 'model'}-specific learning`
    });
  }

  // 2. Check if skill-specific
  const skillMatch = matchSkillFromContext(correction, context);
  if (skillMatch) {
    routes.push({
      type: 'skill',
      skill: skillMatch.name,
      file: `.claude/skills/${skillMatch.name}/knowledge/learnings.md`,
      confidence: skillMatch.confidence,
      description: `Add to ${skillMatch.name} skill knowledge`
    });
  }

  // 3. Check if project-specific
  const projectPatterns = [
    /this project|our codebase|in this repo/i,
    /\bour api\b|\bour database\b|\bour schema\b/i,
    /project.?specific|local rule/i
  ];

  // Also check for project name reference
  const projectName = context.projectName || getConfig().projectName;
  if (projectName) {
    projectPatterns.push(new RegExp(projectName.replace(/[-_]/g, '[-_]?'), 'i'));
  }

  if (projectPatterns.some(p => p.test(correction))) {
    routes.push({
      type: 'project',
      file: 'decisions.md',
      confidence: 0.75,
      description: 'Add to project decisions.md'
    });
  }

  // 4. Check if general/team-worthy
  const generalPatterns = [
    /always|never|best practice/i,
    /convention|standard|pattern/i,
    /\bdo not\b|\bdon't\b.*\buse\b/i,
    /prefer|avoid|instead of/i,
    /rule of thumb|general rule/i
  ];

  if (generalPatterns.some(p => p.test(correction))) {
    routes.push({
      type: 'team',
      scope: 'proposal',
      confidence: 0.65,
      description: 'Propose as team rule (requires approval)'
    });
  }

  // 5. Default: local project decision
  if (routes.length === 0) {
    routes.push({
      type: 'project',
      file: 'decisions.md',
      confidence: 0.5,
      description: 'Add to project decisions.md (default)'
    });
  }

  // Sort by confidence
  return routes.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Match correction to installed skills based on file types and keywords
 */
function matchSkillFromContext(correction, context) {
  const config = getConfig();
  const installedSkills = config.skills?.installed || [];

  if (installedSkills.length === 0) return null;

  // Skill detection patterns
  const skillPatterns = {
    nestjs: {
      keywords: ['nestjs', 'nest.js', '@nestjs', 'module', 'controller', 'service', 'dto', 'typeorm', 'prisma'],
      fileExtensions: ['.module.ts', '.controller.ts', '.service.ts', '.dto.ts', '.entity.ts']
    },
    react: {
      keywords: ['react', 'component', 'hook', 'usestate', 'useeffect', 'jsx', 'tsx', 'props'],
      fileExtensions: ['.tsx', '.jsx']
    },
    python: {
      keywords: ['python', 'fastapi', 'django', 'flask', 'pydantic', 'pytest'],
      fileExtensions: ['.py']
    },
    typescript: {
      keywords: ['typescript', 'type', 'interface', 'generic', 'tsconfig'],
      fileExtensions: ['.ts', '.tsx']
    }
  };

  const correctionLower = correction.toLowerCase();
  const filesModified = context.filesModified || [];

  for (const skillName of installedSkills) {
    const patterns = skillPatterns[skillName];
    if (!patterns) continue;

    // Check keywords
    const keywordMatch = patterns.keywords.some(kw =>
      correctionLower.includes(kw.toLowerCase())
    );

    // Check file extensions
    const fileMatch = patterns.fileExtensions.some(ext =>
      filesModified.some(f => f.endsWith(ext))
    );

    if (keywordMatch || fileMatch) {
      return {
        name: skillName,
        confidence: keywordMatch && fileMatch ? 0.9 : keywordMatch ? 0.75 : 0.65
      };
    }
  }

  return null;
}

// ============================================================
// Route Handlers
// ============================================================

/**
 * Store learning based on selected route
 */
async function storeByRoute(correction, route, context = {}) {
  switch (route.type) {
    case 'model-specific':
      return await storeModelSpecific(correction, route, context);

    case 'skill':
      return await storeSkillLearning(correction, route, context);

    case 'project':
      return await storeProjectDecision(correction, route, context);

    case 'team':
      return await createTeamProposal(correction, route, context);

    default:
      return { success: false, error: `Unknown route type: ${route.type}` };
  }
}

async function storeModelSpecific(correction, route, context) {
  // Use the centralized model-adapter module
  const modelName = route.model || getCurrentModel();
  return storeModelLearning(modelName, correction, context);
}

async function storeSkillLearning(correction, route, context) {
  // Use the centralized skill-learn module
  const skillPath = path.join(PATHS.skills, route.skill);

  // Adapt context format for skill-learn's appendLearning
  const skillContext = {
    trigger: context.trigger || 'knowledge-router',
    timestamp: new Date().toISOString(),
    files: context.filesModified || [],
    summary: correction.slice(0, 100) + (correction.length > 100 ? '...' : ''),
    type: 'correction'
  };

  const success = appendSkillLearning(skillPath, skillContext);

  if (success) {
    return {
      success: true,
      file: path.join(PATHS.skills, route.skill, 'knowledge', 'learnings.md'),
      message: `Added to ${route.skill} skill learnings`
    };
  }

  return {
    success: false,
    error: `Failed to append learning to ${route.skill} skill`
  };
}

async function storeProjectDecision(correction, route, context) {
  const decisionsPath = PATHS.decisions;

  let content = '';
  if (fs.existsSync(decisionsPath)) {
    content = fs.readFileSync(decisionsPath, 'utf-8');
  } else {
    content = `# Project Decisions

Coding conventions and project-specific rules.

---

`;
  }

  const date = new Date().toISOString().split('T')[0];
  const entry = `\n### ${date}

${correction}

`;

  content += entry;
  fs.writeFileSync(decisionsPath, content);

  // Sync to .claude/rules/ for Claude Code integration
  syncDecisionsToRules();

  return {
    success: true,
    file: decisionsPath,
    message: 'Added to project decisions.md'
  };
}

async function createTeamProposal(correction, route, context) {
  const config = getConfig();

  // Check if team features are enabled
  if (!config.team?.enabled) {
    return {
      success: false,
      error: 'Team features not enabled. Use `./scripts/flow team login` to enable.',
      fallback: 'project'
    };
  }

  // Store in shared database (will sync when team sync runs)
  const result = await memoryDb.createProposal({
    rule: correction,
    category: route.category || 'pattern',
    rationale: context.originalError || 'Learned from correction',
    sourceContext: context.taskId || null
  });

  return {
    success: true,
    proposalId: result.id,
    message: 'Team proposal created. Will sync on next `./scripts/flow team sync`.'
  };
}

// ============================================================
// Interactive Confirmation
// ============================================================

/**
 * Format route for display
 */
function formatRouteChoice(route, index) {
  const confidence = Math.round(route.confidence * 100);
  const prefix = index === 0 ? '(Recommended) ' : '';
  const confStr = color('dim', `[${confidence}%]`);

  switch (route.type) {
    case 'model-specific':
      return `${prefix}Model-specific (${route.model}) ${confStr}`;
    case 'skill':
      return `${prefix}Skill: ${route.skill} ${confStr}`;
    case 'project':
      return `${prefix}Project decisions.md ${confStr}`;
    case 'team':
      return `${prefix}Team proposal (requires approval) ${confStr}`;
    default:
      return `${prefix}${route.type} ${confStr}`;
  }
}

/**
 * Print routes for user selection (non-interactive output)
 */
function printRouteOptions(correction, routes) {
  printHeader('Knowledge Router');

  console.log(color('dim', 'Learning:'));
  console.log(`  "${correction.slice(0, 100)}${correction.length > 100 ? '...' : ''}"`);
  console.log('');

  console.log('Suggested destinations:');
  routes.forEach((route, i) => {
    console.log(`  ${i + 1}. ${formatRouteChoice(route, i)}`);
    console.log(color('dim', `     ${route.description}`));
  });
  console.log(`  ${routes.length + 1}. Skip - don't save`);
  console.log('');
}

// ============================================================
// CLI Interface
// ============================================================

function printUsage() {
  console.log(`
Usage: flow-knowledge-router.js [command] [args]

Commands:
  detect <text>           Detect route for a learning (returns JSON)
  store <text> <route>    Store learning with specified route type
  routes                  List all possible route types
  --help                  Show this help

Route types:
  model-specific    Store as model-specific learning
  skill:<name>      Store in skill knowledge
  project           Store in project decisions.md
  team              Create team proposal

Examples:
  node scripts/flow-knowledge-router.js detect "Always use explicit types"
  node scripts/flow-knowledge-router.js store "Use kebab-case" project
  node scripts/flow-knowledge-router.js store "Claude needs explicit types" model-specific
`);
}

// Main CLI handler
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'detect': {
      const text = args.slice(1).join(' ');
      if (!text) {
        error('Please provide text to analyze');
        process.exit(1);
      }

      const routes = detectKnowledgeRoute(text, {});
      console.log(JSON.stringify(routes, null, 2));
      break;
    }

    case 'store': {
      const routeType = args[args.length - 1];
      const text = args.slice(1, -1).join(' ');

      if (!text || !routeType) {
        error('Usage: store <text> <route-type>');
        process.exit(1);
      }

      let route;
      if (routeType.startsWith('skill:')) {
        route = { type: 'skill', skill: routeType.split(':')[1] };
      } else if (routeType === 'model-specific') {
        route = { type: 'model-specific', model: 'unknown' };
      } else {
        route = { type: routeType };
      }

      storeByRoute(text, route, {}).then(result => {
        if (result.success) {
          success(result.message);
        } else {
          error(result.error);
          process.exit(1);
        }
      });
      break;
    }

    case 'routes': {
      console.log(`
Available route types:

  model-specific    Learnings specific to a particular LLM
                    Stored in: .workflow/model-adapters/<model>.md

  skill:<name>      Learnings related to a specific skill
                    Stored in: .claude/skills/<name>/knowledge/learnings.md

  project           Project-specific decisions and conventions
                    Stored in: .workflow/state/decisions.md

  team              General patterns worthy of team sharing
                    Stored as: proposal for team approval (requires subscription)
`);
      break;
    }

    case 'show': {
      // Show routes for text without storing
      const text = args.slice(1).join(' ');
      if (!text) {
        error('Please provide text to analyze');
        process.exit(1);
      }

      const routes = detectKnowledgeRoute(text, {});
      printRouteOptions(text, routes);
      break;
    }

    case '--help':
    case '-h':
      printUsage();
      break;

    default:
      if (command) {
        error(`Unknown command: ${command}`);
      }
      printUsage();
      process.exit(command ? 1 : 0);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  detectKnowledgeRoute,
  matchSkillFromContext,
  storeByRoute,
  storeModelSpecific,
  storeSkillLearning,
  storeProjectDecision,
  createTeamProposal,
  formatRouteChoice,
  printRouteOptions
};
