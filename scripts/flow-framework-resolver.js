'use strict';

/**
 * flow-framework-resolver.js
 *
 * Maps detectStack() output to additional file patterns for scanning.
 * These patterns are ADDITIVE — they extend the base FILE_PATTERNS
 * in flow-pattern-extractor.js, never replace them.
 *
 * Usage:
 *   const { resolvePatterns } = require('./flow-framework-resolver');
 *   const stack = detectStack(projectRoot);
 *   const additional = resolvePatterns(stack);
 *   // additional.patterns = ['prisma files', 'sql files', ...]
 *   // additional.categories = { database: [...], architecture: [...] }
 */

// Framework-to-pattern mapping
// Each framework declares file patterns that are NOT covered by the base
// language extensions (.js, .ts, .py, .go, .rs, .java).
const FRAMEWORK_PATTERNS = {
  // ORM/Database
  'Prisma': {
    patterns: ['**/*.prisma', 'prisma/migrations/**/*.sql'],
    category: 'database'
  },
  'TypeORM': {
    patterns: ['**/*.entity.ts', '**/*.migration.ts'],
    category: 'database'
  },
  'Sequelize': {
    patterns: ['**/*.model.js', '**/models/**/*.js', '**/migrations/**/*.js'],
    category: 'database'
  },
  'Drizzle': {
    patterns: ['**/*.schema.ts', '**/drizzle/**/*.ts'],
    category: 'database'
  },
  'Mongoose': {
    patterns: ['**/*.model.js', '**/*.model.ts'],
    category: 'database'
  },

  // Backend frameworks
  'NestJS': {
    patterns: [
      '**/*.controller.ts', '**/*.service.ts', '**/*.module.ts',
      '**/*.guard.ts', '**/*.middleware.ts', '**/*.dto.ts',
      '**/*.interceptor.ts', '**/*.pipe.ts', '**/*.decorator.ts'
    ],
    category: 'architecture'
  },
  'Django': {
    patterns: [
      '**/models.py', '**/views.py', '**/serializers.py',
      '**/admin.py', '**/urls.py', '**/forms.py', '**/middleware.py'
    ],
    category: 'architecture'
  },
  'FastAPI': {
    patterns: [
      '**/routers/**/*.py', '**/schemas/**/*.py',
      '**/models/**/*.py', '**/dependencies/**/*.py'
    ],
    category: 'architecture'
  },
  'Flask': {
    patterns: [
      '**/routes/**/*.py', '**/models/**/*.py', '**/blueprints/**/*.py'
    ],
    category: 'architecture'
  },

  // Go
  'Go': {
    patterns: [
      '**/*_handler.go', '**/*_service.go',
      '**/*_repository.go', '**/*_middleware.go'
    ],
    category: 'architecture'
  },

  // Rust
  'Rust': {
    patterns: ['**/mod.rs', '**/lib.rs'],
    category: 'architecture'
  }
};

/**
 * Resolve additional file patterns based on detected stack.
 *
 * @param {Object} stack - Output from detectStack() in flow-context-init.js
 * @param {string} stack.orm - ORM name (e.g., 'Prisma', 'TypeORM')
 * @param {Object} stack.frameworks - { frontend, backend, fullStack }
 * @param {string} stack.language - Primary language
 * @param {Object} stack.dependencies - Dependency map
 * @returns {Object} { patterns: string[], categories: { [category]: string[] }, matched: string[] }
 */
function resolvePatterns(stack) {
  if (!stack || typeof stack !== 'object') {
    return { patterns: [], categories: {}, matched: [] };
  }

  const allPatterns = [];
  const categories = {};
  const matched = [];

  // Check ORM
  if (stack.orm && FRAMEWORK_PATTERNS[stack.orm]) {
    const fw = FRAMEWORK_PATTERNS[stack.orm];
    allPatterns.push(...fw.patterns);
    categories[fw.category] = (categories[fw.category] || []).concat(fw.patterns);
    matched.push(stack.orm);
  }

  // Check backend framework
  if (stack.frameworks) {
    const backendName = extractFrameworkName(stack.frameworks.backend);
    if (backendName && FRAMEWORK_PATTERNS[backendName]) {
      const fw = FRAMEWORK_PATTERNS[backendName];
      allPatterns.push(...fw.patterns);
      categories[fw.category] = (categories[fw.category] || []).concat(fw.patterns);
      matched.push(backendName);
    }

    // Check fullStack framework backend patterns
    const fullStackName = extractFrameworkName(stack.frameworks.fullStack);
    if (fullStackName && FRAMEWORK_PATTERNS[fullStackName]) {
      const fw = FRAMEWORK_PATTERNS[fullStackName];
      allPatterns.push(...fw.patterns);
      categories[fw.category] = (categories[fw.category] || []).concat(fw.patterns);
      matched.push(fullStackName);
    }
  }

  // Check language-specific patterns (Go, Rust)
  if (stack.language === 'Go' && FRAMEWORK_PATTERNS['Go']) {
    const fw = FRAMEWORK_PATTERNS['Go'];
    if (!matched.includes('Go')) {
      allPatterns.push(...fw.patterns);
      categories[fw.category] = (categories[fw.category] || []).concat(fw.patterns);
      matched.push('Go');
    }
  }

  if (stack.language === 'Rust' && FRAMEWORK_PATTERNS['Rust']) {
    const fw = FRAMEWORK_PATTERNS['Rust'];
    if (!matched.includes('Rust')) {
      allPatterns.push(...fw.patterns);
      categories[fw.category] = (categories[fw.category] || []).concat(fw.patterns);
      matched.push('Rust');
    }
  }

  // Check dependencies for additional ORM/framework patterns not caught above
  if (stack.dependencies) {
    const depPatterns = resolveDependencyPatterns(stack.dependencies, matched);
    allPatterns.push(...depPatterns.patterns);
    matched.push(...depPatterns.matched);
    for (const [cat, pats] of Object.entries(depPatterns.categories)) {
      categories[cat] = (categories[cat] || []).concat(pats);
    }
  }

  // Deduplicate patterns
  const uniquePatterns = [...new Set(allPatterns)];

  return {
    patterns: uniquePatterns,
    categories,
    matched
  };
}

/**
 * Extract framework name from version string.
 * detectStack() returns strings like "NestJS 10.2.0" or "Express 4.18.2"
 *
 * @param {string|null} frameworkString - e.g., "NestJS 10.2.0"
 * @returns {string|null} Framework name without version, e.g., "NestJS"
 */
function extractFrameworkName(frameworkString) {
  if (!frameworkString) return null;
  // Split by space to remove version number
  const name = frameworkString.split(' ')[0];
  return name || null;
}

/**
 * Check dependencies for patterns not caught by stack.orm or stack.frameworks.
 * This handles edge cases where detectStack doesn't fully categorize a dependency.
 *
 * @param {Object} dependencies - Dependency map from detectStack
 * @param {string[]} alreadyMatched - Frameworks already matched
 * @returns {Object} { patterns, categories, matched }
 */
function resolveDependencyPatterns(dependencies, alreadyMatched) {
  const patterns = [];
  const categories = {};
  const matched = [];

  // Map of dependency names to framework keys
  const DEP_TO_FRAMEWORK = {
    'prisma': 'Prisma',
    '@prisma/client': 'Prisma',
    'typeorm': 'TypeORM',
    'sequelize': 'Sequelize',
    'drizzle-orm': 'Drizzle',
    'mongoose': 'Mongoose',
    '@nestjs/core': 'NestJS',
    'django': 'Django',
    'fastapi': 'FastAPI',
    'flask': 'Flask'
  };

  for (const [dep, fwName] of Object.entries(DEP_TO_FRAMEWORK)) {
    if (dependencies[dep] && !alreadyMatched.includes(fwName) && FRAMEWORK_PATTERNS[fwName]) {
      const fw = FRAMEWORK_PATTERNS[fwName];
      patterns.push(...fw.patterns);
      categories[fw.category] = (categories[fw.category] || []).concat(fw.patterns);
      matched.push(fwName);
    }
  }

  return { patterns, categories, matched };
}

/**
 * Get the FRAMEWORK_PATTERNS mapping (for external consumption by registry plugins).
 *
 * @returns {Object} The full FRAMEWORK_PATTERNS mapping
 */
function getFrameworkPatterns() {
  return { ...FRAMEWORK_PATTERNS };
}

/**
 * Get patterns for a specific framework by name.
 *
 * @param {string} frameworkName - Framework name (e.g., 'Prisma', 'NestJS')
 * @returns {Object|null} { patterns, category } or null if not found
 */
function getPatternsForFramework(frameworkName) {
  return FRAMEWORK_PATTERNS[frameworkName] || null;
}

module.exports = {
  resolvePatterns,
  getFrameworkPatterns,
  getPatternsForFramework,
  extractFrameworkName,
  FRAMEWORK_PATTERNS
};
