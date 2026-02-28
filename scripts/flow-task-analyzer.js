#!/usr/bin/env node

/**
 * Wogi Flow - Task Analyzer
 *
 * Analyzes task descriptions to determine complexity, domains,
 * languages, and estimated token effort for intelligent model routing.
 *
 * Part of Phase 2: Multi-Model Core
 *
 * Usage:
 *   flow task-analyze "<description>" [--type feature]
 *   flow task-analyze --file .workflow/changes/general/wf-xxx.md
 *   flow task-analyze --json
 */

const fs = require('fs');
const path = require('path');
const {
  PROJECT_ROOT,
  parseFlags,
  outputJson,
  color,
  info,
  error,
  fileExists,
  printHeader,
  printSection,
  isPathWithinProject
} = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

const COMPLEXITY_THRESHOLDS = {
  HIGH: {
    minIndicators: 5,
    keywords: ['architecture', 'refactor', 'migrate', 'redesign', 'overhaul', 'system', 'infrastructure'],
    fileCountEstimate: 10
  },
  MEDIUM: {
    minIndicators: 3,
    keywords: ['feature', 'implement', 'add', 'create', 'integrate', 'update', 'modify'],
    fileCountEstimate: 5
  },
  LOW: {
    minIndicators: 0,
    keywords: ['fix', 'bug', 'typo', 'rename', 'comment', 'format', 'simple', 'quick'],
    fileCountEstimate: 2
  }
};

const DOMAIN_PATTERNS = {
  api: {
    keywords: ['api', 'endpoint', 'rest', 'graphql', 'route', 'controller', 'request', 'response'],
    weight: 1.0
  },
  database: {
    keywords: ['database', 'db', 'query', 'model', 'entity', 'schema', 'migration', 'sql', 'orm'],
    weight: 1.0
  },
  frontend: {
    keywords: ['component', 'ui', 'view', 'page', 'screen', 'button', 'form', 'modal', 'layout'],
    weight: 1.0
  },
  auth: {
    keywords: ['auth', 'login', 'session', 'token', 'permission', 'role', 'security', 'oauth'],
    weight: 1.2
  },
  testing: {
    keywords: ['test', 'spec', 'mock', 'fixture', 'coverage', 'e2e', 'unit', 'integration'],
    weight: 0.8
  },
  config: {
    keywords: ['config', 'setting', 'env', 'environment', 'variable', 'option'],
    weight: 0.6
  },
  cli: {
    keywords: ['cli', 'command', 'script', 'terminal', 'shell', 'bash'],
    weight: 0.8
  },
  infrastructure: {
    keywords: ['deploy', 'ci', 'cd', 'docker', 'kubernetes', 'aws', 'cloud', 'pipeline'],
    weight: 1.2
  }
};

const LANGUAGE_PATTERNS = {
  typescript: {
    keywords: ['typescript', 'ts', 'tsx', '.ts', 'interface', 'type ', 'generic'],
    extensions: ['.ts', '.tsx'],
    weight: 1.0
  },
  javascript: {
    keywords: ['javascript', 'js', 'jsx', '.js', 'node', 'npm'],
    extensions: ['.js', '.jsx', '.mjs'],
    weight: 1.0
  },
  python: {
    keywords: ['python', 'py', '.py', 'pip', 'django', 'flask', 'fastapi'],
    extensions: ['.py'],
    weight: 1.0
  },
  go: {
    keywords: ['golang', 'go ', '.go'],
    extensions: ['.go'],
    weight: 1.0
  },
  rust: {
    keywords: ['rust', 'cargo', '.rs'],
    extensions: ['.rs'],
    weight: 1.0
  },
  java: {
    keywords: ['java', 'spring', 'maven', 'gradle', '.java'],
    extensions: ['.java'],
    weight: 1.0
  },
  sql: {
    keywords: ['sql', 'query', 'select', 'insert', 'update', 'delete', 'join'],
    extensions: ['.sql'],
    weight: 0.5
  },
  shell: {
    keywords: ['bash', 'shell', 'sh', 'script'],
    extensions: ['.sh', '.bash'],
    weight: 0.5
  }
};

/**
 * Capability requirements mapped to task keywords
 *
 * Note: 'vision' and 'extended-thinking' capabilities are future-proofing
 * for when model registry includes multimodal and o1-style models.
 * Currently maps to Claude-4 capabilities.
 */
const CAPABILITY_REQUIREMENTS = {
  'reasoning': ['architecture', 'design', 'system', 'algorithm', 'optimize', 'complex'],
  'code-gen': ['implement', 'create', 'add', 'build', 'feature', 'component'],
  'analysis': ['review', 'analyze', 'audit', 'evaluate', 'assess', 'classify', 'detect', 'categorize', 'metadata'],
  'structured-output': ['schema', 'json', 'config', 'template', 'format'],
  'vision': ['design', 'figma', 'screenshot', 'mockup', 'ui'],           // Future: multimodal models
  'extended-thinking': ['difficult', 'challenging', 'intricate', 'debug'] // Future: o1-style models
};

/**
 * Token estimation factors
 *
 * Values calibrated from observed Claude Code task executions:
 * - BASE_INPUT: Minimum tokens for task context, instructions, and rules
 * - PER_FILE: Average tokens per file change (read + edit operations)
 * - PER_DOMAIN: Additional context tokens per technical domain
 * - COMPLEXITY_MULTIPLIER: Accounts for more iterations/exploration
 * - OUTPUT_RATIO: Model output typically 60% of input for code tasks
 */
const TOKEN_FACTORS = {
  BASE_INPUT: 500,
  PER_FILE: 200,
  PER_DOMAIN: 150,
  COMPLEXITY_MULTIPLIER: {
    low: 1.0,
    medium: 1.5,
    high: 2.5
  },
  OUTPUT_RATIO: 0.6
};

// ============================================================
// Analysis Functions
// ============================================================

/**
 * Analyze task complexity
 * @param {string} text - Combined task text (title + description)
 * @param {string} taskType - Task type (feature, bugfix, refactor, etc.)
 * @returns {Object} Complexity analysis
 */
function analyzeComplexity(text, taskType) {
  const lowerText = text.toLowerCase();
  const indicators = [];

  // Check high complexity indicators
  for (const keyword of COMPLEXITY_THRESHOLDS.HIGH.keywords) {
    if (lowerText.includes(keyword)) {
      indicators.push({ keyword, level: 'high', weight: 2 });
    }
  }

  // Check medium complexity indicators
  for (const keyword of COMPLEXITY_THRESHOLDS.MEDIUM.keywords) {
    if (lowerText.includes(keyword)) {
      indicators.push({ keyword, level: 'medium', weight: 1 });
    }
  }

  // Check low complexity indicators
  for (const keyword of COMPLEXITY_THRESHOLDS.LOW.keywords) {
    if (lowerText.includes(keyword)) {
      indicators.push({ keyword, level: 'low', weight: 0.5 });
    }
  }

  // Task type influences complexity
  const typeComplexity = {
    architecture: 'high',
    refactor: 'medium',
    feature: 'medium',
    bugfix: 'low',
    'quick-edit': 'low',
    documentation: 'low'
  };

  // Calculate weighted score
  const score = indicators.reduce((sum, ind) => sum + ind.weight, 0);
  const typeHint = typeComplexity[taskType] || 'medium';

  // Determine final complexity
  let complexity;
  if (score >= COMPLEXITY_THRESHOLDS.HIGH.minIndicators || typeHint === 'high') {
    complexity = 'high';
  } else if (score >= COMPLEXITY_THRESHOLDS.MEDIUM.minIndicators || typeHint === 'medium') {
    complexity = 'medium';
  } else {
    complexity = 'low';
  }

  // Estimate file count
  const fileEstimate = COMPLEXITY_THRESHOLDS[complexity.toUpperCase()].fileCountEstimate;

  return {
    level: complexity,
    score,
    indicators: indicators.slice(0, 5), // Top 5 indicators
    estimatedFiles: fileEstimate,
    confidence: Math.min(0.9, 0.5 + (score * 0.1))
  };
}

/**
 * Detect domains involved in task
 * @param {string} text - Combined task text
 * @returns {Object} Domain analysis
 */
function detectDomains(text) {
  const lowerText = text.toLowerCase();
  const detected = {};

  for (const [domain, config] of Object.entries(DOMAIN_PATTERNS)) {
    const matches = config.keywords.filter(kw => lowerText.includes(kw));
    if (matches.length > 0) {
      detected[domain] = {
        matches,
        score: matches.length * config.weight,
        weight: config.weight
      };
    }
  }

  // Sort by score and return top domains
  const sorted = Object.entries(detected)
    .sort(([, a], [, b]) => b.score - a.score);

  return {
    primary: sorted[0]?.[0] || 'general',
    all: sorted.map(([name, data]) => ({
      name,
      score: data.score,
      matches: data.matches
    })),
    count: sorted.length
  };
}

/**
 * Detect languages required
 * @param {string} text - Combined task text
 * @returns {Object} Language analysis
 */
function detectLanguages(text) {
  const lowerText = text.toLowerCase();
  const detected = {};

  for (const [lang, config] of Object.entries(LANGUAGE_PATTERNS)) {
    const matches = config.keywords.filter(kw => lowerText.includes(kw));
    if (matches.length > 0) {
      detected[lang] = {
        matches,
        score: matches.length * config.weight
      };
    }
  }

  // If no explicit language detected, infer from project
  if (Object.keys(detected).length === 0) {
    // Default to project's primary language (check package.json existence)
    if (fileExists(path.join(PROJECT_ROOT, 'package.json'))) {
      if (fileExists(path.join(PROJECT_ROOT, 'tsconfig.json'))) {
        detected.typescript = { matches: ['inferred'], score: 0.5 };
      } else {
        detected.javascript = { matches: ['inferred'], score: 0.5 };
      }
    }
  }

  const sorted = Object.entries(detected)
    .sort(([, a], [, b]) => b.score - a.score);

  return {
    primary: sorted[0]?.[0] || 'unknown',
    all: sorted.map(([name, data]) => ({
      name,
      score: data.score
    })),
    count: sorted.length
  };
}

/**
 * Determine required model capabilities
 * @param {string} text - Combined task text
 * @param {Object} complexity - Complexity analysis
 * @returns {string[]} Required capabilities
 */
function determineCapabilities(text, complexity) {
  const lowerText = text.toLowerCase();
  const required = new Set();

  for (const [capability, keywords] of Object.entries(CAPABILITY_REQUIREMENTS)) {
    for (const kw of keywords) {
      if (lowerText.includes(kw)) {
        required.add(capability);
        break;
      }
    }
  }

  // High complexity always needs reasoning
  if (complexity.level === 'high') {
    required.add('reasoning');
  }

  // All tasks need code generation unless pure analysis
  if (!required.has('analysis') || required.size > 1) {
    required.add('code-gen');
  }

  return Array.from(required);
}

/**
 * Estimate token usage
 * @param {Object} analysis - Full analysis object
 * @returns {Object} Token estimates
 */
function estimateTokens(analysis) {
  const { complexity, domains, languages } = analysis;

  const multiplier = TOKEN_FACTORS.COMPLEXITY_MULTIPLIER[complexity.level];
  const baseInput = TOKEN_FACTORS.BASE_INPUT;
  const fileTokens = complexity.estimatedFiles * TOKEN_FACTORS.PER_FILE;
  const domainTokens = domains.count * TOKEN_FACTORS.PER_DOMAIN;

  const inputTokens = Math.round((baseInput + fileTokens + domainTokens) * multiplier);
  const outputTokens = Math.round(inputTokens * TOKEN_FACTORS.OUTPUT_RATIO);

  return {
    estimated: {
      input: inputTokens,
      output: outputTokens,
      total: inputTokens + outputTokens
    },
    confidence: complexity.confidence,
    factors: {
      baseInput,
      fileTokens,
      domainTokens,
      multiplier
    }
  };
}

/**
 * Full task analysis
 * @param {Object} params - Analysis parameters
 * @returns {Object} Complete analysis
 */
function analyzeTask(params) {
  // Handle string input (just title/description)
  const isString = typeof params === 'string';
  const { title, description = '', type: inputType = 'feature', acceptanceCriteria = [] } = isString
    ? { title: params, description: '' }
    : params;

  // Combine all text for analysis
  const text = [
    title,
    description,
    ...acceptanceCriteria
  ].join(' ');

  // Auto-detect metadata task type if not explicitly set
  let type = inputType;
  if (type === 'feature') {
    const lowerText = text.toLowerCase();
    if (
      lowerText.includes('classify') ||
      lowerText.includes('detect') ||
      lowerText.includes('categorize') ||
      lowerText.includes('metadata') ||
      lowerText.includes('file type') ||
      lowerText.includes('syntax detection')
    ) {
      type = 'metadata';
    }
  }

  // Run all analyses
  const complexity = analyzeComplexity(text, type);
  const domains = detectDomains(text);
  const languages = detectLanguages(text);
  const capabilities = determineCapabilities(text, complexity);

  const analysis = {
    complexity,
    domains,
    languages,
    capabilities,
    taskType: type
  };

  // Add token estimates
  analysis.tokens = estimateTokens(analysis);

  // Add timestamp
  analysis.analyzedAt = new Date().toISOString();

  return analysis;
}

// ============================================================
// File Parsing
// ============================================================

/**
 * Parse story file for analysis input
 * @param {string} filePath - Path to story file
 * @returns {Object} Parsed content
 */
function parseStoryFile(filePath) {
  if (!fileExists(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Extract title from header
    const titleMatch = content.match(/^#\s*\[[\w-]+\]\s*(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // Extract description
    const descMatch = content.match(/## Description\s*\n([\s\S]*?)(?=\n## |\n$)/);
    const description = descMatch ? descMatch[1].trim() : '';

    // Extract acceptance criteria
    const criteriaMatches = content.matchAll(/\*\*(Given|When|Then|And)\*\*\s*(.+)/g);
    const criteria = Array.from(criteriaMatches).map(m => m[2].trim());

    // Extract task type from content
    let type = 'feature';
    const lowerContent = content.toLowerCase();
    if (lowerContent.includes('bugfix') || lowerContent.includes('fix bug')) {
      type = 'bugfix';
    } else if (lowerContent.includes('refactor')) {
      type = 'refactor';
    } else if (lowerContent.includes('architecture')) {
      type = 'architecture';
    } else if (
      lowerContent.includes('classify') ||
      lowerContent.includes('detect') ||
      lowerContent.includes('categorize') ||
      lowerContent.includes('metadata') ||
      lowerContent.includes('file type') ||
      lowerContent.includes('syntax detection')
    ) {
      type = 'metadata';
    }

    return {
      title,
      description,
      acceptanceCriteria: criteria,
      type
    };
  } catch (err) {
    // File read error (permission denied, race condition, etc.)
    console.error(`Warning: Could not read story file ${filePath}: ${err.message}`);
    return null;
  }
}

// ============================================================
// CLI Output
// ============================================================

/**
 * Print analysis results
 * @param {Object} analysis - Analysis result
 */
function printAnalysis(analysis) {
  printHeader('TASK ANALYSIS');

  // Complexity
  printSection('Complexity');
  const complexityColor = {
    low: 'green',
    medium: 'yellow',
    high: 'red'
  }[analysis.complexity.level];
  console.log(`  Level: ${color(complexityColor, analysis.complexity.level.toUpperCase())}`);
  console.log(`  Score: ${analysis.complexity.score}`);
  console.log(`  Estimated files: ${analysis.complexity.estimatedFiles}`);
  console.log(`  Confidence: ${(analysis.complexity.confidence * 100).toFixed(0)}%`);
  if (analysis.complexity.indicators.length > 0) {
    console.log(`  Indicators: ${analysis.complexity.indicators.map(i => i.keyword).join(', ')}`);
  }

  // Domains
  printSection('Domains');
  console.log(`  Primary: ${color('cyan', analysis.domains.primary)}`);
  if (analysis.domains.all.length > 1) {
    console.log(`  All: ${analysis.domains.all.map(d => d.name).join(', ')}`);
  }

  // Languages
  printSection('Languages');
  console.log(`  Primary: ${color('cyan', analysis.languages.primary)}`);
  if (analysis.languages.all.length > 1) {
    console.log(`  All: ${analysis.languages.all.map(l => l.name).join(', ')}`);
  }

  // Capabilities
  printSection('Required Capabilities');
  for (const cap of analysis.capabilities) {
    console.log(`  - ${cap}`);
  }

  // Token Estimates
  printSection('Token Estimates');
  const tokens = analysis.tokens.estimated;
  console.log(`  Input:  ~${tokens.input.toLocaleString()} tokens`);
  console.log(`  Output: ~${tokens.output.toLocaleString()} tokens`);
  console.log(`  Total:  ~${tokens.total.toLocaleString()} tokens`);

  console.log('');
}

// ============================================================
// Main
// ============================================================

async function main() {
  const { positional, flags } = parseFlags(process.argv.slice(2));

  let taskData;

  // Parse from file or positional args
  if (flags.file) {
    const filePath = path.isAbsolute(flags.file)
      ? flags.file
      : path.join(PROJECT_ROOT, flags.file);

    // Validate path is within project to prevent path traversal
    if (!isPathWithinProject(filePath)) {
      error('File path must be within project directory');
      process.exit(1);
    }

    taskData = parseStoryFile(filePath);
    if (!taskData) {
      error(`Could not read story file: ${flags.file}`);
      process.exit(1);
    }
  } else if (positional.length > 0) {
    taskData = {
      title: positional.join(' '),
      description: '',
      acceptanceCriteria: [],
      type: flags.type || 'feature'
    };
  } else {
    error('Usage: flow task-analyze "<description>" [--type feature]');
    error('       flow task-analyze --file .workflow/changes/general/wf-xxx.md');
    process.exit(1);
  }

  // Run analysis
  const analysis = analyzeTask(taskData);

  // Output
  if (flags.json) {
    outputJson({
      success: true,
      input: taskData,
      analysis
    });
  } else {
    info(`Analyzing: "${taskData.title}"`);
    console.log('');
    printAnalysis(analysis);
  }
}

// Export for use by other scripts
module.exports = {
  analyzeTask,
  analyzeComplexity,
  detectDomains,
  detectLanguages,
  determineCapabilities,
  estimateTokens,
  parseStoryFile,
  COMPLEXITY_THRESHOLDS,
  DOMAIN_PATTERNS,
  LANGUAGE_PATTERNS,
  CAPABILITY_REQUIREMENTS
};

if (require.main === module) {
  main().catch(err => {
    error(err.message);
    process.exit(1);
  });
}
