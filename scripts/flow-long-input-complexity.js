'use strict';

/**
 * Long Input Processing - Complexity Detection (E3-S1)
 *
 * Analyzes the complexity of extracted topics and statements to recommend
 * output structure (single story, story group, or epic hierarchy).
 *
 * Extracted from flow-long-input.js.
 */

const {
  UI_PATTERNS,
  DATA_PATTERNS,
  INTERACTION_PATTERNS,
  COMPLEXITY_LEVELS
} = require('./flow-long-input-constants');

// ============================================
// Entity Analysis Functions
// ============================================

/**
 * Count unique entity types in statements
 */
function countEntityTypes(statements) {
  const entityTypes = new Set();

  for (const statement of statements) {
    if (!statement.text) continue;

    // Check UI patterns
    for (const { pattern, type } of UI_PATTERNS) {
      if (pattern.test(statement.text)) {
        entityTypes.add(`ui:${type}`);
      }
    }

    // Check data patterns
    for (const { pattern, type } of DATA_PATTERNS) {
      if (pattern.test(statement.text)) {
        entityTypes.add(`data:${type}`);
      }
    }

    // Check interaction patterns
    for (const { pattern, type } of INTERACTION_PATTERNS) {
      if (pattern.test(statement.text)) {
        entityTypes.add(`interaction:${type}`);
      }
    }
  }

  return entityTypes.size;
}

/**
 * Extract all entities from statements for summary
 */
function extractEntities(statements) {
  const entities = {
    ui_components: new Set(),
    data_entities: new Set(),
    interactions: new Set()
  };

  for (const statement of statements) {
    if (!statement.text) continue;

    // Check UI patterns
    for (const { pattern } of UI_PATTERNS) {
      const match = statement.text.match(pattern);
      if (match) {
        entities.ui_components.add(match[1].toLowerCase());
      }
    }

    // Check data patterns
    for (const { pattern } of DATA_PATTERNS) {
      const match = statement.text.match(pattern);
      if (match) {
        entities.data_entities.add(match[1].toLowerCase());
      }
    }

    // Check interaction patterns
    for (const { pattern } of INTERACTION_PATTERNS) {
      const match = statement.text.match(pattern);
      if (match) {
        entities.interactions.add(match[1].toLowerCase());
      }
    }
  }

  return {
    ui_components: Array.from(entities.ui_components),
    data_entities: Array.from(entities.data_entities),
    interactions: Array.from(entities.interactions)
  };
}

// ============================================
// Complexity Scoring Functions
// ============================================

/**
 * Determine complexity level from score
 */
function getComplexityLevel(score) {
  for (const level of COMPLEXITY_LEVELS) {
    if (score <= level.max) {
      return level;
    }
  }
  return COMPLEXITY_LEVELS[COMPLEXITY_LEVELS.length - 1];
}

/**
 * Calculate overall complexity score (0-100)
 */
function calculateComplexityScore(digest) {
  const topics = digest.topics || [];
  const statements = digest.statements || [];
  const clarifications = digest.clarifications || { questions: [], contradictions: [] };

  let score = 0;

  // Topic complexity (0-25)
  const topicCount = topics.filter(t => t.status === 'active').length;
  score += Math.min(topicCount * 5, 25);

  // Statement density (0-25)
  const meaningfulStatements = statements.filter(s => s.meaningful !== false);
  score += Math.min(meaningfulStatements.length * 2, 25);

  // Clarification needs (0-25)
  const questionCount = clarifications.questions?.length || 0;
  const contradictionCount = clarifications.contradictions?.length || 0;
  score += Math.min((questionCount + contradictionCount * 2) * 2, 25);

  // Entity diversity (0-25)
  const entityTypes = countEntityTypes(statements);
  score += Math.min(entityTypes * 5, 25);

  return Math.min(score, 100);
}

// ============================================
// Statement Classification Functions
// ============================================

/**
 * Check if statement is a requirement (vs discussion)
 */
function isRequirement(statement) {
  const requirementIndicators = [
    /\b(must|should|will|need|require|want)\b/i,
    /\b(add|create|build|implement|include)\b/i,
    /\b(feature|functionality|capability)\b/i
  ];
  return requirementIndicators.some(pattern => pattern.test(statement.text));
}

/**
 * Check if statement is vague
 */
function isVagueStatement(statement) {
  const vagueIndicators = [
    /\b(nice|good|better|pretty|clean)\b/i,
    /\b(maybe|might|could|possibly|probably)\b/i,
    /\b(some|various|multiple|many|few)\b/i,
    /\b(etc|and so on|and more)\b/i
  ];
  return vagueIndicators.some(pattern => pattern.test(statement.text));
}

/**
 * Check if topic has UI component
 */
function hasUIComponent(statements) {
  return statements.some(s =>
    UI_PATTERNS.some(({ pattern }) => pattern.test(s.text || ''))
  );
}

/**
 * Check if topic has data model
 */
function hasDataModel(statements) {
  return statements.some(s =>
    DATA_PATTERNS.some(({ pattern }) => pattern.test(s.text || ''))
  );
}

/**
 * Check if topic has user interaction
 */
function hasUserInteraction(statements) {
  return statements.some(s =>
    INTERACTION_PATTERNS.some(({ pattern }) => pattern.test(s.text || ''))
  );
}

// ============================================
// Topic & Structure Analysis
// ============================================

/**
 * Analyze complexity of a single topic
 */
function analyzeTopicComplexity(topic, statements, clarifications) {
  const topicStatements = statements.filter(s => s.topic_id === topic.id);
  const topicQuestions = (clarifications?.questions || []).filter(q => q.topic_id === topic.id);

  const metrics = {
    statement_count: topicStatements.length,
    requirement_statements: topicStatements.filter(s => isRequirement(s)).length,
    vague_statements: topicStatements.filter(s => isVagueStatement(s)).length,
    question_count: topicQuestions.length,
    answered_questions: topicQuestions.filter(q => q.status === 'answered').length,
    entity_mentions: countEntityTypes(topicStatements),
    has_ui_component: hasUIComponent(topicStatements),
    has_data_model: hasDataModel(topicStatements),
    has_user_interaction: hasUserInteraction(topicStatements)
  };

  // Calculate topic complexity score (0-100)
  let topicScore = 0;
  topicScore += Math.min(metrics.statement_count * 3, 30);
  topicScore += Math.min(metrics.requirement_statements * 5, 25);
  topicScore += Math.min(metrics.question_count * 3, 15);
  topicScore += metrics.has_ui_component ? 10 : 0;
  topicScore += metrics.has_data_model ? 10 : 0;
  topicScore += metrics.has_user_interaction ? 10 : 0;
  topicScore = Math.min(topicScore, 100);

  // Determine topic type
  let topicType = 'general';
  if (metrics.has_ui_component) topicType = 'ui_feature';
  else if (metrics.has_data_model) topicType = 'data_feature';
  else if (metrics.has_user_interaction) topicType = 'workflow';

  // Estimate story count for this topic
  let estimatedStories = 1;
  if (topicScore > 60) estimatedStories = 3;
  else if (topicScore > 40) estimatedStories = 2;

  return {
    topic_id: topic.id,
    title: topic.title,
    metrics,
    complexity_score: topicScore,
    type: topicType,
    estimated_stories: estimatedStories
  };
}

/**
 * Group related topics based on shared entities
 */
function groupRelatedTopics(topicAnalysis) {
  const groups = [];
  const assigned = new Set();

  for (const topic of topicAnalysis) {
    if (assigned.has(topic.topic_id)) continue;

    // Start a new group
    const group = {
      topics: [topic],
      primary_type: topic.type,
      combined_score: topic.complexity_score,
      total_stories: topic.estimated_stories
    };

    // Find related topics (same type or low complexity topics that could be grouped)
    for (const other of topicAnalysis) {
      if (assigned.has(other.topic_id) || other.topic_id === topic.topic_id) continue;

      // Group if same type and combined complexity is manageable
      if (other.type === topic.type && group.combined_score + other.complexity_score <= 80) {
        group.topics.push(other);
        group.combined_score += other.complexity_score;
        group.total_stories += other.estimated_stories;
        assigned.add(other.topic_id);
      }
    }

    assigned.add(topic.topic_id);
    groups.push(group);
  }

  return groups;
}

/**
 * Generate epic structure from topic analysis
 */
function generateEpicStructure(topicAnalysis, topicGroups) {
  const epics = [];
  let epicNumber = 1;

  for (const group of topicGroups) {
    // Create an epic if the group has significant complexity
    if (group.combined_score > 40 || group.topics.length > 2) {
      const epic = {
        id: `epic-${epicNumber}`,
        title: `Epic ${epicNumber}: ${group.topics[0].title}${group.topics.length > 1 ? ' and related' : ''}`,
        type: group.primary_type,
        complexity_score: group.combined_score,
        stories: group.topics.map(t => ({
          topic_id: t.topic_id,
          title: t.title,
          estimated_stories: t.estimated_stories
        })),
        total_stories: group.total_stories
      };
      epics.push(epic);
      epicNumber++;
    } else {
      // Add as standalone stories (no epic needed)
      for (const topic of group.topics) {
        epics.push({
          id: `standalone-${topic.topic_id}`,
          title: topic.title,
          type: topic.type,
          complexity_score: topic.complexity_score,
          stories: [{ topic_id: topic.topic_id, title: topic.title, estimated_stories: topic.estimated_stories }],
          total_stories: topic.estimated_stories
        });
      }
    }
  }

  return epics;
}

/**
 * Recommend output structure based on complexity
 */
function recommendOutputStructure(complexityScore, topicAnalysis) {
  // Simple case
  if (complexityScore <= 20) {
    return {
      type: 'single_story',
      confidence: 0.9,
      rationale: 'Low complexity, all requirements fit in one story',
      structure: {
        story_count: 1,
        format: 'detailed',
        include_all_topics: true
      }
    };
  }

  // Check for natural groupings
  const topicGroups = groupRelatedTopics(topicAnalysis);

  // Medium case with clear groupings
  if (complexityScore <= 60 && topicGroups.length <= 5) {
    const totalStories = topicGroups.reduce((sum, g) => sum + g.total_stories, 0);
    return {
      type: 'story_group',
      confidence: 0.85,
      rationale: `${topicGroups.length} distinct feature areas identified`,
      structure: {
        story_count: totalStories,
        grouping: 'by_topic',
        format: 'standard',
        shared_context: true
      },
      groups: topicGroups.map(g => ({
        topics: g.topics.map(t => t.title),
        type: g.primary_type,
        stories: g.total_stories
      }))
    };
  }

  // Complex case - epic structure
  const epics = generateEpicStructure(topicAnalysis, topicGroups);
  const totalStories = epics.reduce((sum, e) => sum + e.total_stories, 0);

  return {
    type: 'epic',
    confidence: 0.8,
    rationale: 'High complexity requires hierarchical organization',
    structure: {
      epic_count: epics.filter(e => e.id.startsWith('epic-')).length,
      total_stories: totalStories,
      format: 'hierarchical',
      include_dependencies: true,
      include_phases: true
    },
    epics: epics.map(e => ({
      id: e.id,
      title: e.title,
      type: e.type,
      stories: e.total_stories
    }))
  };
}

module.exports = {
  // Entity analysis
  countEntityTypes,
  extractEntities,
  // Complexity scoring
  getComplexityLevel,
  calculateComplexityScore,
  // Statement classification
  isRequirement,
  isVagueStatement,
  hasUIComponent,
  hasDataModel,
  hasUserInteraction,
  // Topic & structure analysis
  analyzeTopicComplexity,
  groupRelatedTopics,
  generateEpicStructure,
  recommendOutputStructure
};
