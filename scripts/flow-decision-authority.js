#!/usr/bin/env node

/**
 * Wogi Flow - Decision Authority Framework
 *
 * Config-driven classification of decisions into authority levels.
 * Prevents question flooding by classifying engineering vs product decisions
 * and routing them to either agent-decides or owner-decides.
 *
 * Source: Retrospective — manager mistake #4 (12-question flooding),
 * process gap #4 (no framework for engineering vs product authority).
 *
 * Usage:
 *   node flow-decision-authority.js classify <decision-text>
 *   node flow-decision-authority.js batch <json-array-of-decisions>
 *   node flow-decision-authority.js update-category <category> <authority>
 *
 * Programmatic:
 *   const { classifyDecision, batchClassify, getAuthorityConfig } = require('./flow-decision-authority');
 */

const fs = require('node:fs');
const path = require('node:path');
const { PATHS, getConfig, safeJsonParse } = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

const AUTHORITY_LEVELS = {
  'agent-decides': 'Agent decides autonomously, reports in completion summary',
  'agent-decides-report-after': 'Agent decides, explicitly reports the decision after',
  'owner-decides': 'Present to user, wait for answer before proceeding',
  'auto-fix-report-after': 'Agent fixes automatically, reports what was fixed'
};

const DEFAULT_AUTHORITY_CONFIG = {
  engineering: 'agent-decides',
  infrastructure: 'agent-decides-report-after',
  productBehavior: 'owner-decides',
  security: 'auto-fix-report-after',
  ux: 'owner-decides',
  naming: 'agent-decides',
  performance: 'agent-decides-report-after',
  maxOwnerQuestionsPerBatch: 5
};

/**
 * Keywords and patterns for classifying decisions into categories.
 * Each category has patterns that match against the decision text.
 * IMPORTANT: Do NOT add the /g flag — these are used with .test() in a loop.
 * Patterns use compound terms to avoid false positives from common single words.
 */
const CATEGORY_PATTERNS = {
  engineering: [
    /\b(refactor|extract|inline|rename|move file|split|merge|consolidat)\w*/i,
    /\b(import|export|module structure|dependency|circular)\b/i,
    /\b(error handling|try.catch|fallback|retry|timeout)\b/i,
    /\b(lint|format|code style|indentation|semicolons?)\b/i,
    /\b(type system|type annotation|type hierarchy|interface|generic|abstract|class hierarchy)\b/i,
    /\b(cache strategy|memoiz|lazy load|bundle|tree.shak)\w*/i
  ],
  infrastructure: [
    /\b(docker|kubernetes|ci\/cd|pipeline|deploy|build)\b/i,
    /\b(database|migration|schema|index|query optimiz)\w*/i,
    /\b(aws|gcp|azure|cloud|server|hosting)\b/i,
    /\b(environment|env var|config file|secret|credential)\b/i,
    /\b(monitoring|logging|alerting|metrics|observability)\b/i
  ],
  productBehavior: [
    /\b(user.facing|user experience|product behavior|workflow)\b/i,
    /\b(default value|default behavior|fallback behavior)\b/i,
    /\b(business logic|business rule|domain)\b/i,
    /\b(permission|role|access control|authorization)\b/i,
    /\b(notification|email|alert to user)\b/i,
    /\b(pricing|billing|subscription|plan|tier)\b/i,
    /\b(feature flag|feature toggle|product feature)\b/i
  ],
  security: [
    /\b(security|vulnerabilit|exploit|injection|xss|csrf)\w*/i,
    /\b(authentication|auth|token|session|password|hash)\b/i,
    /\b(sanitiz|escap|validat|whitelist|blocklist)\w*/i,
    /\b(cors|csp|header|ssl|tls|certificate)\b/i,
    /\b(rate.limit|brute.force|ddos|firewall)\b/i
  ],
  ux: [
    /\b(layout|design|color|font|spacing|margin|padding)\b/i,
    /\b(animation|transition|hover|focus|accessibility)\b/i,
    /\b(copy text|label|placeholder|tooltip|user message)\b/i,
    /\b(navigation|menu|sidebar|header|footer)\b/i,
    /\b(responsive|mobile|breakpoint|viewport)\b/i
  ],
  naming: [
    /\b(naming convention|naming pattern|rename)\b/i,
    /\b(variable name|function name|file name|class name)\b/i,
    /\b(camelCase|snake_case|PascalCase|kebab-case)\b/i,
    /\b(prefix|suffix|abbreviat)\w*/i
  ],
  performance: [
    /\b(performance|speed|latency|throughput|benchmark)\b/i,
    /\b(memory leak|garbage|allocation|buffer)\b/i,
    /\b(batch|chunk|stream|pagina)\w*/i,
    /\b(optimize|optimis|efficient|bottleneck)\w*/i
  ]
};

// ============================================================
// Core Functions
// ============================================================

/**
 * Get the decision authority config, merging defaults with user overrides
 * @returns {Object} Authority config
 */
function getAuthorityConfig() {
  const config = getConfig();
  const userConfig = config.decisionAuthority ?? {};
  return {
    ...DEFAULT_AUTHORITY_CONFIG,
    ...userConfig
  };
}

/**
 * Classify a decision text into a category
 * @param {string} decisionText - The decision to classify
 * @returns {{ category: string, authority: string, confidence: string }}
 */
function classifyDecision(decisionText) {
  const authorityConfig = getAuthorityConfig();
  // Patterns already use /i flag, no need for toLowerCase()
  const text = decisionText;

  // Score each category
  const scores = {};
  for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    scores[category] = 0;
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        scores[category]++;
      }
    }
  }

  // Find highest scoring category
  let bestCategory = 'productBehavior'; // Default to owner-decides (safest)
  let bestScore = 0;

  for (const [category, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  // Determine confidence
  const totalMatches = Object.values(scores).reduce((a, b) => a + b, 0);
  let confidence = 'low';
  if (bestScore >= 3) confidence = 'high';
  else if (bestScore >= 2) confidence = 'medium';
  else if (bestScore === 1 && totalMatches <= 2) confidence = 'medium';

  // Low-confidence decisions default to owner-decides for safety
  const authority = confidence === 'low'
    ? 'owner-decides'
    : (authorityConfig[bestCategory] ?? 'owner-decides');

  return {
    category: bestCategory,
    authority,
    confidence,
    score: bestScore,
    description: AUTHORITY_LEVELS[authority] ?? 'Unknown authority level'
  };
}

/**
 * Classify a batch of decisions and enforce maxOwnerQuestionsPerBatch
 * @param {string[]} decisions - Array of decision texts
 * @returns {{ classified: Object[], ownerQuestions: Object[], agentDecisions: Object[], truncated: boolean }}
 */
function batchClassify(decisions) {
  const authorityConfig = getAuthorityConfig();
  const maxOwner = authorityConfig.maxOwnerQuestionsPerBatch ?? 5;

  const classified = decisions.map((text, idx) => ({
    index: idx,
    text,
    ...classifyDecision(text)
  }));

  // Separate owner-decides from agent-decides
  const ownerQuestions = classified.filter(d => d.authority === 'owner-decides');
  const agentDecisions = classified.filter(d => d.authority !== 'owner-decides');

  // Enforce max owner questions — overflow becomes agent-decides-report-after
  let truncated = false;
  if (ownerQuestions.length > maxOwner) {
    truncated = true;
    // Keep the first maxOwner, downgrade the rest
    const overflow = ownerQuestions.splice(maxOwner);
    for (const decision of overflow) {
      decision.authority = 'agent-decides-report-after';
      decision.description = AUTHORITY_LEVELS['agent-decides-report-after'];
      decision.downgraded = true;
      decision.downgradeReason = `Exceeded maxOwnerQuestionsPerBatch (${maxOwner})`;
      agentDecisions.push(decision);
    }
  }

  return {
    classified,
    ownerQuestions,
    agentDecisions,
    truncated,
    maxOwner,
    stats: {
      total: decisions.length,
      ownerDecides: ownerQuestions.length,
      agentDecides: agentDecisions.length,
      downgraded: truncated ? agentDecisions.filter(d => d.downgraded).length : 0
    }
  };
}

/**
 * Update a category's authority level in config.json
 * @param {string} category - Category name
 * @param {string} authority - New authority level
 * @returns {{ success: boolean, message: string }}
 */
function updateCategoryAuthority(category, authority) {
  if (!CATEGORY_PATTERNS[category] && category !== 'maxOwnerQuestionsPerBatch') {
    return { success: false, message: `Unknown category: ${category}. Valid: ${Object.keys(CATEGORY_PATTERNS).join(', ')}` };
  }
  if (category !== 'maxOwnerQuestionsPerBatch' && !AUTHORITY_LEVELS[authority]) {
    return { success: false, message: `Unknown authority: ${authority}. Valid: ${Object.keys(AUTHORITY_LEVELS).join(', ')}` };
  }

  try {
    const configPath = path.join(PATHS.workflow, 'config.json');
    const config = safeJsonParse(configPath, {});

    if (!config.decisionAuthority) {
      config.decisionAuthority = {};
    }

    if (category === 'maxOwnerQuestionsPerBatch') {
      const num = parseInt(authority, 10);
      if (isNaN(num) || num < 1 || num > 20) {
        return { success: false, message: 'maxOwnerQuestionsPerBatch must be a number between 1 and 20' };
      }
      config.decisionAuthority.maxOwnerQuestionsPerBatch = num;
    } else {
      config.decisionAuthority[category] = authority;
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return { success: true, message: `Updated ${category} → ${authority}` };
  } catch (err) {
    return { success: false, message: `Failed to update config: ${err.message}` };
  }
}

// ============================================================
// CLI Interface
// ============================================================

function main() {
  const [,, command, ...args] = process.argv;

  switch (command) {
    case 'classify': {
      const text = args.join(' ');
      if (!text) {
        console.error('Usage: flow-decision-authority.js classify <decision-text>');
        process.exit(1);
      }
      const result = classifyDecision(text);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'batch': {
      const jsonInput = args[0];
      if (!jsonInput) {
        console.error('Usage: flow-decision-authority.js batch <json-array>');
        process.exit(1);
      }
      try {
        const decisions = JSON.parse(jsonInput);
        if (!Array.isArray(decisions)) {
          console.error('Input must be a JSON array of decision strings');
          process.exit(1);
        }
        const result = batchClassify(decisions);
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        console.error(`Invalid JSON: ${err.message}`);
        process.exit(1);
      }
      break;
    }

    case 'update-category': {
      const [category, authority] = args;
      if (!category || !authority) {
        console.error('Usage: flow-decision-authority.js update-category <category> <authority>');
        process.exit(1);
      }
      const result = updateCategoryAuthority(category, authority);
      if (result.success) {
        console.log(result.message);
      } else {
        console.error(result.message);
        process.exit(1);
      }
      break;
    }

    case 'config': {
      const config = getAuthorityConfig();
      console.log(JSON.stringify(config, null, 2));
      break;
    }

    default:
      console.log('Wogi Flow - Decision Authority Framework');
      console.log('');
      console.log('Commands:');
      console.log('  classify <text>                  Classify a decision');
      console.log('  batch <json-array>               Classify multiple decisions');
      console.log('  update-category <cat> <authority> Update a category authority');
      console.log('  config                           Show current config');
      console.log('');
      console.log('Authority levels:');
      for (const [level, desc] of Object.entries(AUTHORITY_LEVELS)) {
        console.log(`  ${level}: ${desc}`);
      }
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  classifyDecision,
  batchClassify,
  getAuthorityConfig,
  updateCategoryAuthority,
  AUTHORITY_LEVELS,
  DEFAULT_AUTHORITY_CONFIG,
  CATEGORY_PATTERNS
};

if (require.main === module) {
  main();
}
