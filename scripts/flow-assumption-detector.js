/**
 * Assumption Detector Library
 *
 * Detects and categorizes assumptions made during task analysis.
 * Used by spec generation to surface assumptions for user validation.
 *
 * Features:
 * - Detects implicit assumptions in task descriptions
 * - Assigns confidence levels (0.0 - 1.0)
 * - Categorizes by type (technical, requirements, scope, behavior)
 * - Flags low-confidence assumptions for clarification
 */

// Assumption categories
const ASSUMPTION_CATEGORIES = {
  TECHNICAL: 'technical',      // Tech stack, framework, patterns
  REQUIREMENTS: 'requirements', // User requirements, acceptance criteria
  SCOPE: 'scope',              // Task boundaries, what's included/excluded
  BEHAVIOR: 'behavior',        // Expected behavior, edge cases
  DEPENDENCIES: 'dependencies', // Dependencies on other components/tasks
  DATA: 'data',                // Data format, structure, validation
  UI: 'ui',                    // User interface expectations
  SECURITY: 'security',        // Security requirements
};

// Confidence thresholds
const CONFIDENCE = {
  HIGH: 0.9,    // Very confident, based on explicit info
  MEDIUM: 0.7,  // Reasonably confident, common pattern
  LOW: 0.5,     // Uncertain, needs clarification
  GUESS: 0.3,   // Wild guess, definitely needs clarification
};

// Threshold for flagging assumptions
const CLARIFICATION_THRESHOLD = 0.7;

// Max input size before skipping pattern matching (ReDoS protection)
const MAX_INPUT_SIZE = 100000; // 100KB

// Unicode characters for confidence bar display
const CONFIDENCE_FILLED = '\u25CF'; // ●
const CONFIDENCE_EMPTY = '\u25CB';  // ○

// Detection patterns - defined at module scope for performance
const FRAMEWORK_PATTERNS = [
  { pattern: /component|react|vue|angular|svelte/i, assumption: 'Using existing component framework', confidence: 0.9 },
  { pattern: /api|endpoint|rest|graphql/i, assumption: 'Following existing API patterns', confidence: 0.7 },
  { pattern: /database|db|query|model/i, assumption: 'Using existing database patterns', confidence: 0.7 },
  { pattern: /auth|login|session|token/i, assumption: 'Integrating with existing auth system', confidence: 0.7 },
];

const AMBIGUOUS_TERMS = [
  { term: 'integrate', question: 'What system/service should this integrate with?' },
  { term: 'connect', question: 'What should this connect to?' },
  { term: 'similar to', question: 'Which existing feature should this be similar to?' },
  { term: 'like', question: 'What exactly should this be like?' },
];

const SCOPE_PATTERNS = [
  { pattern: /all|every|each/i, assumption: 'Scope includes all instances', confidence: 0.5 },
  { pattern: /complete|full|entire/i, assumption: 'Full implementation required (not partial)', confidence: 0.7 },
  { pattern: /basic|simple|minimal/i, assumption: 'MVP scope only (no edge cases)', confidence: 0.7 },
  { pattern: /update|modify|change/i, assumption: 'Updating existing feature (not creating new)', confidence: 0.7 },
];

const VAGUE_PATTERNS = [
  { pattern: /should work|should be able/i, text: 'Specific success criteria undefined', confidence: 0.5 },
  { pattern: /nice to have|optional/i, text: 'Optional features may be deferred', confidence: 0.7 },
  { pattern: /as needed|when necessary/i, text: 'Trigger conditions are understood', confidence: 0.5 },
  { pattern: /appropriate|suitable/i, text: '"Appropriate" behavior is understood', confidence: 0.5 },
];

// UI detection patterns
const UI_ELEMENT_PATTERN = /button|form|modal|dialog|page|screen|view/i;
const UI_LAYOUT_PATTERN = /layout|position|place|where/i;
const UI_STYLING_PATTERN = /style|design|color|theme/i;
const RESPONSIVE_PATTERN = /responsive|mobile|desktop/i;

// Data detection patterns
const DATA_PATTERN = /data|input|field|form/i;
const FORMAT_PATTERN = /format|type|valid/i;
const PERSISTENCE_PATTERN = /save|store|persist|database/i;

// Behavior detection patterns
const ASYNC_PATTERN = /fetch|load|api|async/i;
const LOADING_PATTERN = /loading|spinner/i;
const EDGE_CASE_PATTERN = /edge case|empty|null|undefined|invalid/i;

/**
 * Assumption object structure
 * @typedef {Object} Assumption
 * @property {string} id - Unique identifier
 * @property {string} text - The assumption statement
 * @property {string} category - One of ASSUMPTION_CATEGORIES
 * @property {number} confidence - 0.0 to 1.0
 * @property {string} source - What triggered this assumption
 * @property {string} clarificationQuestion - Question to ask user if low confidence
 * @property {boolean} needsClarification - Whether user should validate
 */

/**
 * Detect assumptions from task description and context
 * @param {Object} params - Detection parameters
 * @param {string} params.title - Task title
 * @param {string} params.description - Full task description
 * @param {string[]} params.acceptanceCriteria - List of acceptance criteria
 * @param {Object} params.context - Additional context (app-map, decisions, etc.)
 * @returns {Assumption[]} Array of detected assumptions
 */
function detectAssumptions(params) {
  const { title, description, acceptanceCriteria = [], context = {} } = params;
  const assumptions = [];

  // ReDoS protection: check total input size before pattern matching
  const totalInputSize = (title?.length || 0) +
    (description?.length || 0) +
    acceptanceCriteria.reduce((sum, c) => sum + (c?.length || 0), 0);

  if (totalInputSize > MAX_INPUT_SIZE) {
    console.warn(`[assumption-detector] Input too large (${totalInputSize} chars), skipping pattern matching`);
    return [{
      id: 'A01',
      text: 'Input too large for detailed analysis',
      category: ASSUMPTION_CATEGORIES.SCOPE,
      confidence: CONFIDENCE.LOW,
      source: 'size_limit',
      clarificationQuestion: 'Please provide a more concise description for detailed analysis',
      needsClarification: true
    }];
  }

  // 1. Detect technical assumptions
  assumptions.push(...detectTechnicalAssumptions(title, description, context));

  // 2. Detect scope assumptions
  assumptions.push(...detectScopeAssumptions(title, description, acceptanceCriteria));

  // 3. Detect requirements assumptions
  assumptions.push(...detectRequirementsAssumptions(description, acceptanceCriteria));

  // 4. Detect UI assumptions
  assumptions.push(...detectUIAssumptions(title, description));

  // 5. Detect data assumptions
  assumptions.push(...detectDataAssumptions(description, acceptanceCriteria));

  // 6. Detect behavior assumptions
  assumptions.push(...detectBehaviorAssumptions(description, acceptanceCriteria));

  // Deduplicate and assign IDs
  const uniqueAssumptions = deduplicateAssumptions(assumptions);
  return uniqueAssumptions.map((a, i) => ({
    ...a,
    id: `A${String(i + 1).padStart(2, '0')}`,
    needsClarification: a.confidence < CLARIFICATION_THRESHOLD,
  }));
}

/**
 * Detect technical assumptions (framework, patterns, etc.)
 */
function detectTechnicalAssumptions(title, description, context) {
  const assumptions = [];
  const text = `${title} ${description}`.toLowerCase();

  // Framework assumptions - use module-level patterns
  for (const { pattern, assumption, confidence } of FRAMEWORK_PATTERNS) {
    if (pattern.test(text)) {
      assumptions.push({
        text: assumption,
        category: ASSUMPTION_CATEGORIES.TECHNICAL,
        confidence,
        source: 'keyword_detection',
        clarificationQuestion: `Should this ${assumption.toLowerCase()}?`,
      });
    }
  }

  // Check for ambiguous technical terms - use module-level patterns
  for (const { term, question } of AMBIGUOUS_TERMS) {
    if (text.includes(term)) {
      assumptions.push({
        text: `Integration approach for "${term}" is understood`,
        category: ASSUMPTION_CATEGORIES.TECHNICAL,
        confidence: CONFIDENCE.LOW,
        source: 'ambiguous_term',
        clarificationQuestion: question,
      });
    }
  }

  return assumptions;
}

/**
 * Detect scope assumptions (what's included/excluded)
 */
function detectScopeAssumptions(title, description, acceptanceCriteria) {
  const assumptions = [];
  const text = `${title} ${description}`.toLowerCase();
  const criteriaText = acceptanceCriteria.join(' ').toLowerCase();

  // Scope-expanding keywords - use module-level patterns
  for (const { pattern, assumption, confidence } of SCOPE_PATTERNS) {
    if (pattern.test(text)) {
      assumptions.push({
        text: assumption,
        category: ASSUMPTION_CATEGORIES.SCOPE,
        confidence,
        source: 'scope_keyword',
        clarificationQuestion: `Is this assumption correct: "${assumption}"?`,
      });
    }
  }

  // Check if error handling is mentioned
  if (!criteriaText.includes('error') && !text.includes('error')) {
    assumptions.push({
      text: 'Error handling will follow existing patterns',
      category: ASSUMPTION_CATEGORIES.SCOPE,
      confidence: CONFIDENCE.MEDIUM,
      source: 'missing_error_handling',
      clarificationQuestion: 'Should specific error handling be implemented?',
    });
  }

  return assumptions;
}

/**
 * Detect requirements assumptions
 */
function detectRequirementsAssumptions(description, acceptanceCriteria) {
  const assumptions = [];

  // Check for vague requirements - use module-level patterns
  for (const { pattern, text, confidence } of VAGUE_PATTERNS) {
    if (pattern.test(description)) {
      assumptions.push({
        text,
        category: ASSUMPTION_CATEGORIES.REQUIREMENTS,
        confidence,
        source: 'vague_requirement',
        clarificationQuestion: `Please clarify: ${text.toLowerCase()}`,
      });
    }
  }

  // Check if acceptance criteria are specific enough (require Given AND When AND Then)
  for (const criterion of acceptanceCriteria) {
    const hasGiven = criterion.includes('Given');
    const hasWhen = criterion.includes('When');
    const hasThen = criterion.includes('Then');

    if (!(hasGiven && hasWhen && hasThen)) {
      assumptions.push({
        text: `Acceptance criteria "${criterion.slice(0, 30)}..." is understood`,
        category: ASSUMPTION_CATEGORIES.REQUIREMENTS,
        confidence: CONFIDENCE.MEDIUM,
        source: 'non_gherkin_criteria',
        clarificationQuestion: 'Can you provide Given/When/Then format for this criteria?',
      });
    }
  }

  return assumptions;
}

/**
 * Detect UI assumptions
 */
function detectUIAssumptions(title, description) {
  const assumptions = [];
  const text = `${title} ${description}`.toLowerCase();

  // UI-related keywords - use module-level patterns
  if (UI_ELEMENT_PATTERN.test(text)) {
    // Check for layout assumptions
    if (!UI_LAYOUT_PATTERN.test(text)) {
      assumptions.push({
        text: 'UI placement follows existing patterns',
        category: ASSUMPTION_CATEGORIES.UI,
        confidence: CONFIDENCE.MEDIUM,
        source: 'ui_placement',
        clarificationQuestion: 'Where should this UI element be placed?',
      });
    }

    // Check for styling assumptions
    if (!UI_STYLING_PATTERN.test(text)) {
      assumptions.push({
        text: 'Styling will match existing design system',
        category: ASSUMPTION_CATEGORIES.UI,
        confidence: CONFIDENCE.HIGH,
        source: 'ui_styling',
        clarificationQuestion: 'Should this follow existing design system?',
      });
    }
  }

  // Responsive design - use module-level pattern
  if (RESPONSIVE_PATTERN.test(text)) {
    assumptions.push({
      text: 'Responsive breakpoints follow existing patterns',
      category: ASSUMPTION_CATEGORIES.UI,
      confidence: CONFIDENCE.MEDIUM,
      source: 'responsive_design',
      clarificationQuestion: 'What screen sizes should be supported?',
    });
  }

  return assumptions;
}

/**
 * Detect data-related assumptions
 */
function detectDataAssumptions(description, acceptanceCriteria) {
  const assumptions = [];
  const text = `${description} ${acceptanceCriteria.join(' ')}`.toLowerCase();

  // Data format assumptions - use module-level patterns
  if (DATA_PATTERN.test(text)) {
    if (!FORMAT_PATTERN.test(text)) {
      assumptions.push({
        text: 'Data validation follows existing patterns',
        category: ASSUMPTION_CATEGORIES.DATA,
        confidence: CONFIDENCE.MEDIUM,
        source: 'data_validation',
        clarificationQuestion: 'What validation rules should be applied?',
      });
    }
  }

  // Persistence assumptions - use module-level pattern
  if (PERSISTENCE_PATTERN.test(text)) {
    assumptions.push({
      text: 'Data persistence uses existing storage patterns',
      category: ASSUMPTION_CATEGORIES.DATA,
      confidence: CONFIDENCE.MEDIUM,
      source: 'data_persistence',
      clarificationQuestion: 'Where should this data be stored?',
    });
  }

  return assumptions;
}

/**
 * Detect behavior assumptions
 */
function detectBehaviorAssumptions(description, acceptanceCriteria) {
  const assumptions = [];
  const text = `${description} ${acceptanceCriteria.join(' ')}`.toLowerCase();

  // Loading state - use module-level patterns
  if (ASYNC_PATTERN.test(text) && !LOADING_PATTERN.test(text)) {
    assumptions.push({
      text: 'Loading states will be handled',
      category: ASSUMPTION_CATEGORIES.BEHAVIOR,
      confidence: CONFIDENCE.MEDIUM,
      source: 'loading_state',
      clarificationQuestion: 'How should loading states be displayed?',
    });
  }

  // Edge cases - use module-level pattern
  if (!EDGE_CASE_PATTERN.test(text)) {
    assumptions.push({
      text: 'Edge cases will follow existing patterns',
      category: ASSUMPTION_CATEGORIES.BEHAVIOR,
      confidence: CONFIDENCE.LOW,
      source: 'edge_cases',
      clarificationQuestion: 'What edge cases should be handled explicitly?',
    });
  }

  return assumptions;
}

/**
 * Deduplicate assumptions by text similarity
 */
function deduplicateAssumptions(assumptions) {
  const seen = new Set();
  return assumptions.filter(a => {
    const key = `${a.category}:${a.text.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Format assumptions for display in spec
 * @param {Assumption[]} assumptions
 * @returns {string} Markdown formatted assumptions
 */
function formatAssumptionsForSpec(assumptions) {
  if (assumptions.length === 0) {
    return '> No assumptions detected - requirements are well-defined.';
  }

  const sections = [];

  // Group by category
  const byCategory = {};
  for (const a of assumptions) {
    if (!byCategory[a.category]) byCategory[a.category] = [];
    byCategory[a.category].push(a);
  }

  for (const [category, items] of Object.entries(byCategory)) {
    const categoryTitle = category.charAt(0).toUpperCase() + category.slice(1);
    sections.push(`### ${categoryTitle}`);

    for (const item of items) {
      const confidenceBar = getConfidenceBar(item.confidence);
      const needsFlag = item.needsClarification ? ' ⚠️' : '';
      sections.push(`- **[${item.id}]** ${item.text} ${confidenceBar}${needsFlag}`);
      if (item.needsClarification) {
        sections.push(`  - *Clarify:* ${item.clarificationQuestion}`);
      }
    }
    sections.push('');
  }

  return sections.join('\n');
}

/**
 * Get confidence bar visualization
 */
function getConfidenceBar(confidence) {
  const filled = Math.round(confidence * 5);
  const empty = 5 - filled;
  return `[${CONFIDENCE_FILLED.repeat(filled)}${CONFIDENCE_EMPTY.repeat(empty)}]`;
}

/**
 * Get assumptions that need clarification
 * @param {Assumption[]} assumptions
 * @returns {Assumption[]} Assumptions below threshold
 */
function getAssumptionsNeedingClarification(assumptions) {
  return assumptions.filter(a => a.needsClarification);
}

/**
 * Generate clarification questions for AskUserQuestion tool
 * @param {Assumption[]} assumptions - Assumptions needing clarification
 * @returns {Object[]} Questions formatted for AskUserQuestion
 */
function generateClarificationQuestions(assumptions) {
  const needClarification = getAssumptionsNeedingClarification(assumptions);

  // Limit to 4 questions (AskUserQuestion limit)
  const topQuestions = needClarification.slice(0, 4);

  return topQuestions.map(a => ({
    question: a.clarificationQuestion,
    header: a.category.slice(0, 12),
    options: [
      { label: 'Yes, correct', description: `Confirm: ${a.text}` },
      { label: 'No, clarify', description: 'I\'ll provide more details' },
      { label: 'Skip for now', description: 'Proceed with assumption' },
    ],
    multiSelect: false,
    assumption: a, // Include original assumption for reference
  }));
}

module.exports = {
  detectAssumptions,
  formatAssumptionsForSpec,
  getAssumptionsNeedingClarification,
  generateClarificationQuestions,
  ASSUMPTION_CATEGORIES,
  CONFIDENCE,
  CLARIFICATION_THRESHOLD,
};
