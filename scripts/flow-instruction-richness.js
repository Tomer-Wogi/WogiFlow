#!/usr/bin/env node

/**
 * Wogi Flow - Instruction Richness Module
 *
 * Controls how much detail to include for the local LLM.
 *
 * KEY INSIGHT: Local LLM tokens are FREE. The goal is to give the LLM
 * everything it needs for 90%+ success rate. Failed executions cost more
 * (in Claude retry tokens) than generous upfront context.
 *
 * This module provides GUIDANCE on context richness, not hard limits.
 * When in doubt, include MORE context - it's free for the local LLM!
 *
 * Usage:
 *   const { getInstructionRichness } = require('./flow-instruction-richness');
 *   const richness = getInstructionRichness('large');
 */

const fs = require('fs');
const path = require('path');

// LSP integration for accurate type information
let lspModule = null;
try {
  lspModule = require('./flow-lsp');
} catch (err) {
  // LSP module not available, will use fallback
}

// ============================================================
// Model Context Preferences (from registry.json)
// ============================================================

/**
 * Cache for model registry
 */
let registryCache = null;

/**
 * Load model registry from .workflow/models/registry.json
 * @returns {Object|null} Registry data or null if not found
 */
function loadModelRegistry() {
  if (registryCache) return registryCache;

  const { PATHS } = require('./flow-utils');
  const registryPath = path.join(path.dirname(PATHS.config), 'models', 'registry.json');

  try {
    if (fs.existsSync(registryPath)) {
      const content = fs.readFileSync(registryPath, 'utf-8');
      registryCache = JSON.parse(content);
      return registryCache;
    }
  } catch (err) {
    // Ignore errors, use defaults
  }
  return null;
}

/**
 * Get model context preferences from registry
 * @param {string} modelName - Model name (e.g., "claude-opus-4-5", "opus", "claude-sonnet-4")
 * @returns {Object} Context preferences with defaults
 */
function getModelContextPreferences(modelName) {
  const defaults = {
    density: 'standard',
    explicitExamples: true,
    patternHints: true,
    minContextForQuality: 0.5
  };

  if (!modelName) return defaults;

  const registry = loadModelRegistry();
  if (!registry?.models) return defaults;

  // Normalize model name for lookup
  const normalized = modelName.toLowerCase();

  // Direct lookup first
  if (registry.models[modelName]?.contextPreferences) {
    return { ...defaults, ...registry.models[modelName].contextPreferences };
  }

  // Try partial matching (e.g., "opus" matches "claude-opus-4-5")
  for (const [key, model] of Object.entries(registry.models)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      if (model.contextPreferences) {
        return { ...defaults, ...model.contextPreferences };
      }
    }
    // Also try matching against modelId
    if (model.modelId && (normalized.includes(model.modelId) || model.modelId.includes(normalized))) {
      if (model.contextPreferences) {
        return { ...defaults, ...model.contextPreferences };
      }
    }
  }

  return defaults;
}

// ============================================================
// Instruction Richness Levels (Guidance, NOT Limits)
// ============================================================

/**
 * Richness levels guide what context to include for the local LLM.
 *
 * IMPORTANT: These are MINIMUMS for each complexity level.
 * Always include MORE context if there's any doubt - local LLM tokens are free!
 *
 * The goal is 90%+ success rate, not minimizing tokens.
 */
const INSTRUCTION_RICHNESS = {
  minimal: {
    // Even "minimal" should include enough for success
    includeProjectContext: true,  // Always include
    includeTypeDefinitions: true, // Always include - prevents type errors
    includeRelatedCode: false,
    includeExamples: false,
    includePatterns: true,        // Always include - consistency matters
    includeFullFileContents: false,
    templateVerbosity: 'standard', // Upgraded from 'concise'
    description: 'Simple changes - but still include types and patterns for accuracy'
  },

  standard: {
    includeProjectContext: true,
    includeTypeDefinitions: true,
    includeRelatedCode: true,     // Include related code for context
    includeExamples: true,        // Include examples - they help!
    includePatterns: true,
    includeFullFileContents: false,
    templateVerbosity: 'detailed', // Upgraded from 'standard'
    description: 'Typical tasks - include examples and related code for best results'
  },

  rich: {
    includeProjectContext: true,
    includeTypeDefinitions: true,
    includeRelatedCode: true,
    includeExamples: true,
    includePatterns: true,
    includeFullFileContents: true, // Include full files for complex tasks
    templateVerbosity: 'comprehensive',
    description: 'Complex tasks - full context for highest success rate'
  },

  maximum: {
    includeProjectContext: true,
    includeTypeDefinitions: true,
    includeRelatedCode: true,
    includeExamples: true,
    includePatterns: true,
    includeFullFileContents: true,
    templateVerbosity: 'comprehensive',
    description: 'XL tasks - everything available, maximum context'
  }
};

// ============================================================
// Complexity to Richness Mapping
// ============================================================

/**
 * Maps complexity level (from flow-complexity.js) to instruction richness
 */
const COMPLEXITY_TO_RICHNESS = {
  'small': 'minimal',
  'medium': 'standard',
  'large': 'rich',
  'xl': 'maximum'
};

/**
 * Gets the instruction richness configuration for a complexity level
 *
 * Model-aware: Different models need different amounts of context:
 * - Opus (concise): Can use minimal even for medium tasks
 * - Sonnet (standard): Use default mapping
 * - Haiku/Local (comprehensive): Needs rich even for small tasks
 *
 * @param {string} complexityLevel - 'small', 'medium', 'large', or 'xl'
 * @param {Object} config - Optional config overrides from config.json
 * @param {string} model - Optional model name for model-aware richness
 * @returns {Object} - Richness configuration
 */
function getInstructionRichness(complexityLevel, config = {}, model = null) {
  // Map complexity to base richness level
  let richnessLevel = COMPLEXITY_TO_RICHNESS[complexityLevel] || 'standard';
  const levels = ['minimal', 'standard', 'rich', 'maximum'];

  // Model-aware adjustment
  if (model) {
    const modelPrefs = getModelContextPreferences(model);

    if (modelPrefs.density === 'concise') {
      // Opus: Can use less context - downgrade one level (but not below minimal)
      // small → minimal (already minimal)
      // medium → minimal (was standard)
      // large → standard (was rich)
      // xl → rich (was maximum)
      const currentIndex = levels.indexOf(richnessLevel);
      if (currentIndex > 0) {
        richnessLevel = levels[currentIndex - 1];
      }
    } else if (modelPrefs.density === 'comprehensive') {
      // Local LLM / Haiku: Needs more context - upgrade one level (but not above maximum)
      // small → standard (was minimal)
      // medium → rich (was standard)
      // large → maximum (was rich)
      // xl → maximum (already maximum)
      const currentIndex = levels.indexOf(richnessLevel);
      if (currentIndex < levels.length - 1) {
        richnessLevel = levels[currentIndex + 1];
      }
    }
    // 'standard' density uses default mapping
  }

  // Check for minimum richness override in config
  const minRichness = config.minRichness;
  if (minRichness) {
    const currentIndex = levels.indexOf(richnessLevel);
    const minIndex = levels.indexOf(minRichness);
    if (minIndex > currentIndex) {
      richnessLevel = minRichness;
    }
  }

  const richness = { ...INSTRUCTION_RICHNESS[richnessLevel] };

  // Add level name and model info for reference
  richness.level = richnessLevel;
  if (model) {
    const modelPrefs = getModelContextPreferences(model);
    richness.modelDensity = modelPrefs.density;
    richness.patternHintsOnly = modelPrefs.patternHints && !modelPrefs.explicitExamples;
  }

  return richness;
}

// ============================================================
// Context Loaders
// ============================================================

/**
 * Loads project context from workflow state
 */
function loadProjectContext(projectRoot) {
  const contextPath = path.join(projectRoot, '.workflow', 'state', 'hybrid-context.md');
  const projectPath = path.join(projectRoot, '.workflow', 'specs', 'project.md');

  let context = '';

  // Try hybrid-context first (optimized for hybrid mode)
  // Use try-catch even after existsSync (race conditions, permissions)
  if (fs.existsSync(contextPath)) {
    try {
      context += fs.readFileSync(contextPath, 'utf-8');
    } catch (err) {
      // File may have been deleted/modified between check and read
    }
  }

  // Add project overview
  if (fs.existsSync(projectPath)) {
    try {
      const projectMd = fs.readFileSync(projectPath, 'utf-8');
      // Extract just the summary section
      const summaryMatch = projectMd.match(/## Summary[\s\S]*?(?=##|$)/);
      if (summaryMatch) {
        context += '\n\n### Project Summary\n' + summaryMatch[0];
      }
    } catch (err) {
      // File may have been deleted/modified between check and read
    }
  }

  return context || null;
}

/**
 * Loads ALL coding patterns from decisions.md
 * Extracts all ## sections, not just Coding Standards and Component Architecture
 */
function loadPatterns(projectRoot) {
  const decisionsPath = path.join(projectRoot, '.workflow', 'state', 'decisions.md');

  if (!fs.existsSync(decisionsPath)) {
    return null;
  }

  let content;
  try {
    content = fs.readFileSync(decisionsPath, 'utf-8');
  } catch (err) {
    // File may have been deleted/modified between check and read
    return null;
  }

  // Extract ALL ## sections from decisions.md
  // This includes: Naming Conventions, File Structure, Error Handling, etc.
  const sections = content.match(/## [^\n]+[\s\S]*?(?=\n## |$)/g);

  if (!sections || sections.length === 0) {
    // Fallback: return full content if no sections found
    return content.trim() || null;
  }

  return sections.map(s => s.trim()).join('\n\n');
}

/**
 * Extracts keywords from task description for relevance filtering
 */
function extractTaskKeywords(taskDescription) {
  if (!taskDescription) return [];

  // Extract meaningful words (nouns, component names, etc.)
  const words = taskDescription
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2)
    .map(w => w.toLowerCase());

  // Also extract PascalCase component names
  const pascalCaseNames = taskDescription.match(/[A-Z][a-z]+(?:[A-Z][a-z]+)*/g) || [];

  return [...new Set([...words, ...pascalCaseNames.map(n => n.toLowerCase())])];
}

/**
 * Checks if a type definition is relevant to the task
 */
function isTypeRelevant(typeDefinition, keywords, filename) {
  if (!keywords || keywords.length === 0) return true;

  const typeLower = typeDefinition.toLowerCase();
  const filenameLower = filename.toLowerCase();

  // Always include types that match the filename
  if (typeLower.includes(filenameLower) || filenameLower.includes(typeLower.split(/\s+/)[1]?.toLowerCase() || '')) {
    return true;
  }

  // Check if any keyword appears in the type definition
  return keywords.some(keyword => typeLower.includes(keyword));
}

/**
 * Finds TypeScript types relevant to a file path and task
 * @param {string} projectRoot - Project root directory
 * @param {string} filePath - Target file path
 * @param {Object} options - Options including taskDescription and maxTypes
 */
function loadRelevantTypes(projectRoot, filePath, options = {}) {
  if (!filePath) return null;

  const { taskDescription = '', maxTypes = 5 } = options;
  const keywords = extractTaskKeywords(taskDescription);
  const types = [];
  const dir = path.dirname(filePath);
  const filename = path.basename(filePath, path.extname(filePath));

  // Common type file locations - prioritize closest first
  const typeLocations = [
    path.join(dir, 'types.ts'),
    path.join(dir, 'types.d.ts'),
    path.join(dir, '..', 'types.ts'),
    path.join(dir, '..', 'types', 'index.ts'),
    path.join(dir, '..', 'api', 'types.ts'),
    path.join(projectRoot, 'src', 'types', 'index.ts'),
    path.join(projectRoot, 'src', 'types.ts')
  ];

  for (const typePath of typeLocations) {
    const fullPath = path.isAbsolute(typePath) ? typePath : path.join(projectRoot, typePath);
    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        // Extract interface/type definitions (simplified)
        const typeMatches = content.match(/(?:export\s+)?(?:interface|type)\s+\w+[\s\S]*?(?=\n(?:export\s+)?(?:interface|type|const|function)|$)/g);
        if (typeMatches) {
          // Filter types by relevance
          const relevantTypes = typeMatches.filter(t => isTypeRelevant(t, keywords, filename));

          if (relevantTypes.length > 0) {
            types.push(`// From ${path.relative(projectRoot, fullPath)}`);
            types.push(...relevantTypes.slice(0, maxTypes - types.length));
          }
        }
      } catch {
        // Ignore read errors
      }
    }

    // Stop if we have enough types
    if (types.length >= maxTypes) break;
  }

  return types.length > 0 ? types.join('\n\n') : null;
}

/**
 * LSP-enhanced type loading
 * Uses Language Server Protocol when available for accurate type info,
 * falls back to regex-based loading otherwise.
 *
 * @param {string} projectRoot - Project root directory
 * @param {string} filePath - Target file path
 * @param {object} options - Options (taskDescription, maxTypes)
 * @returns {Promise<string|null>} Formatted type information
 */
async function loadRelevantTypesWithLSP(projectRoot, filePath, options = {}) {
  const { getConfig } = require('./flow-utils');
  const config = getConfig();

  // Check if LSP is enabled
  if (!config.lsp?.enabled || !lspModule) {
    return loadRelevantTypes(projectRoot, filePath, options);
  }

  try {
    const lsp = await lspModule.getLSP(projectRoot);
    if (!lsp) {
      return loadRelevantTypes(projectRoot, filePath, options);
    }

    const types = [];
    const { taskDescription = '', maxTypes = 5 } = options;
    const keywords = extractTaskKeywords(taskDescription);

    // If we have a target file, extract identifiers and get their types
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);
    if (fs.existsSync(absPath)) {
      let content;
      try {
        content = fs.readFileSync(absPath, 'utf-8');
      } catch (err) {
        // File may have been deleted/modified between check and read
        return loadRelevantTypes(projectRoot, filePath, options);
      }
      const identifiers = extractIdentifiersForLSP(content, keywords);

      // Get types for identified positions
      for (const id of identifiers.slice(0, maxTypes)) {
        try {
          const typeInfo = await lsp.getTypeAtPosition(absPath, id.line, id.character);
          if (typeInfo) {
            types.push(`// ${id.name}\n${typeInfo}`);
          }
        } catch (err) {
          // Skip individual errors
        }
      }
    }

    // If LSP didn't find enough types, supplement with regex-based loading
    if (types.length < maxTypes) {
      const regexTypes = loadRelevantTypes(projectRoot, filePath, {
        ...options,
        maxTypes: maxTypes - types.length
      });
      if (regexTypes) {
        types.push(regexTypes);
      }
    }

    return types.length > 0 ? types.join('\n\n') : null;
  } catch (err) {
    // Fallback to regex-based loading on any error
    return loadRelevantTypes(projectRoot, filePath, options);
  }
}

/**
 * Extract identifiers from code that we want to get types for
 * @param {string} content - File content
 * @param {string[]} keywords - Task-related keywords to prioritize
 * @returns {Array<{name: string, line: number, character: number}>}
 */
function extractIdentifiersForLSP(content, keywords = []) {
  const identifiers = [];
  const lines = content.split('\n');

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];

    // Look for function/const/interface declarations
    const patterns = [
      // function name(
      /\bfunction\s+(\w+)\s*\(/g,
      // const name = or const name:
      /\bconst\s+(\w+)\s*[=:]/g,
      // interface Name
      /\binterface\s+(\w+)/g,
      // type Name
      /\btype\s+(\w+)\s*=/g,
      // : TypeName (for type annotations)
      /:\s*(\w+)(?:[<\s,\[\]>|&]|$)/g
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(line)) !== null) {
        const name = match[1];
        const character = match.index + match[0].indexOf(name);

        // Prioritize keywords
        const priority = keywords.some(k =>
          name.toLowerCase().includes(k.toLowerCase())
        ) ? 0 : 1;

        identifiers.push({
          name,
          line: lineNum,
          character,
          priority
        });
      }
    }
  }

  // Sort by priority (keyword matches first)
  identifiers.sort((a, b) => a.priority - b.priority);

  return identifiers;
}

/**
 * Finds related code files (similar components, hooks, etc.)
 */
function loadRelatedCode(projectRoot, filePath, stepType) {
  if (!filePath) return null;

  const related = [];
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);

  // Find siblings or similar files
  const searchDirs = [dir, path.join(dir, '..'), path.join(dir, '..', '..')];

  for (const searchDir of searchDirs) {
    const fullSearchDir = path.isAbsolute(searchDir) ? searchDir : path.join(projectRoot, searchDir);
    if (!fs.existsSync(fullSearchDir)) continue;

    try {
      const files = fs.readdirSync(fullSearchDir);

      for (const file of files) {
        if (!file.endsWith('.tsx') && !file.endsWith('.ts')) continue;
        if (file.includes('.test.') || file.includes('.spec.')) continue;

        const fullFilePath = path.join(fullSearchDir, file);
        if (fullFilePath === filePath) continue;

        // Limit to first 2 related files
        if (related.length >= 2) break;

        try {
          const content = fs.readFileSync(fullFilePath, 'utf-8');
          // Take first 50 lines as example
          const preview = content.split('\n').slice(0, 50).join('\n');
          related.push(`// Example from ${path.relative(projectRoot, fullFilePath)}\n${preview}`);
        } catch {
          // Ignore read errors
        }
      }
    } catch {
      // Ignore dir read errors
    }

    if (related.length >= 2) break;
  }

  return related.length > 0 ? related.join('\n\n---\n\n') : null;
}

/**
 * Simple glob pattern matcher for finding example files
 */
function globSync(basePath, pattern) {
  const results = [];
  const parts = pattern.split('/');

  const searchDir = (currentPath, remainingParts) => {
    if (remainingParts.length === 0) {
      if (fs.existsSync(currentPath) && fs.statSync(currentPath).isFile()) {
        results.push(currentPath);
      }
      return;
    }

    const [current, ...rest] = remainingParts;

    if (current === '**') {
      try {
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry.name);
          if (entry.isDirectory()) {
            // Continue with ** (recurse deeper)
            searchDir(fullPath, remainingParts);
            // Also try without ** (match at this level)
            searchDir(fullPath, rest);
          } else if (rest.length === 0) {
            results.push(fullPath);
          } else if (rest.length === 1 && matchGlobPart(entry.name, rest[0])) {
            results.push(fullPath);
          }
        }
      } catch { /* ignore permission errors */ }
    } else if (current.includes('*')) {
      try {
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });
        for (const entry of entries) {
          if (matchGlobPart(entry.name, current)) {
            const fullPath = path.join(currentPath, entry.name);
            if (entry.isDirectory()) {
              searchDir(fullPath, rest);
            } else if (rest.length === 0) {
              results.push(fullPath);
            }
          }
        }
      } catch { /* ignore permission errors */ }
    } else {
      const nextPath = path.join(currentPath, current);
      if (fs.existsSync(nextPath)) {
        searchDir(nextPath, rest);
      }
    }
  };

  // Handle src/ prefix - check both with and without
  const srcPath = path.join(basePath, 'src');
  if (fs.existsSync(srcPath)) {
    searchDir(srcPath, parts);
  }
  searchDir(basePath, parts);

  return [...new Set(results)]; // Dedupe
}

/**
 * Match a filename against a glob pattern part (e.g., *.tsx)
 */
function matchGlobPart(filename, pattern) {
  const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
  return regex.test(filename);
}

/**
 * Truncate file content to a reasonable size for examples
 */
function truncateForExample(content, maxLines = 60) {
  const lines = content.split('\n');
  if (lines.length <= maxLines) return content;

  // Keep imports and first part of file
  const imports = [];
  let importEnd = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('import ') || lines[i].startsWith('from ') || lines[i].trim() === '') {
      imports.push(lines[i]);
      importEnd = i + 1;
    } else if (imports.length > 0) {
      break;
    }
  }

  const remaining = maxLines - imports.length - 3;
  const body = lines.slice(importEnd, importEnd + remaining);

  return [
    ...imports,
    ...body,
    '',
    `// ... (${lines.length - importEnd - remaining} more lines truncated)`,
    ''
  ].join('\n');
}

/**
 * Finds examples of similar implementations
 */
function loadSimilarExamples(projectRoot, stepType, maxExamples = 2) {
  // Map step types to example search patterns
  const patterns = {
    'create-component': [
      'components/**/*.tsx',
      'features/**/components/*.tsx',
      'app/**/components/*.tsx',
      'ui/**/*.tsx'
    ],
    'create-hook': [
      'hooks/**/*.ts',
      'hooks/**/*.tsx',
      'features/**/hooks/*.ts',
      'lib/hooks/*.ts'
    ],
    'create-service': [
      'services/**/*.ts',
      'api/**/*.ts',
      'lib/api/*.ts',
      'features/**/api/*.ts'
    ],
    'create-util': [
      'utils/**/*.ts',
      'lib/**/*.ts',
      'helpers/**/*.ts'
    ],
    'create-test': [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '__tests__/**/*.ts'
    ],
    'modify-file': [] // No examples needed for modifications
  };

  const searchPatterns = patterns[stepType] || patterns['create-component'];
  if (searchPatterns.length === 0) return null;

  const examples = [];
  const seen = new Set();

  for (const pattern of searchPatterns) {
    if (examples.length >= maxExamples) break;

    const files = globSync(projectRoot, pattern);

    // Sort by file size (prefer smaller, simpler examples)
    const sorted = files
      .map(f => ({ path: f, size: fs.statSync(f).size }))
      .sort((a, b) => a.size - b.size)
      .slice(0, 5); // Consider top 5 smallest

    for (const { path: filePath } of sorted) {
      if (examples.length >= maxExamples) break;
      if (seen.has(filePath)) continue;

      try {
        const content = fs.readFileSync(filePath, 'utf8');
        // Skip files that are too short (likely stubs) or too long
        const lineCount = content.split('\n').length;
        if (lineCount < 10 || lineCount > 500) continue;

        seen.add(filePath);
        const relativePath = path.relative(projectRoot, filePath);
        const truncated = truncateForExample(content);

        examples.push(`### Example: ${relativePath}\n\`\`\`typescript\n${truncated}\`\`\``);
      } catch { /* ignore read errors */ }
    }
  }

  if (examples.length === 0) return null;

  return `## Similar Examples in This Project\n\nUse these as reference for style and patterns:\n\n${examples.join('\n\n')}`;
}

// ============================================================
// Verbosity Guidance
// ============================================================

/**
 * Returns guidance text based on verbosity level
 *
 * NOTE: All levels now emphasize completeness over brevity.
 * Local LLM tokens are free - include everything needed for success!
 */
function getVerbosityGuidance(verbosity) {
  const guidance = {
    standard: `
Include enough context for success. Local LLM tokens are free!
- Clear description of the task
- All imports with exact paths
- Type definitions for all interfaces
- Mention patterns to follow`,

    detailed: `
Be thorough. Include everything the local LLM needs to succeed first try.
- Show exact import paths and type signatures
- Include ALL props for components being used
- Show existing patterns to follow
- Provide examples of similar code
- List all edge cases and error handling requirements`,

    comprehensive: `
Maximum detail. The local LLM should have complete knowledge to implement
this without guessing anything. Local LLM tokens are FREE - don't hold back!
- Include full file contents of related files
- Show complete type definitions with all fields
- Provide multiple usage examples
- Document all integration points
- Include testing requirements
- Show exact prop values (variant="primary" not variant={variants.primary})`
  };

  return guidance[verbosity] || guidance.detailed;
}

// ============================================================
// Exports
// ============================================================

// ============================================================
// Lightweight Type Hints Generator
// ============================================================

/**
 * Generate lightweight type hints for common project types
 * These are condensed summaries to help LLMs understand type shapes
 * without loading entire type files.
 *
 * @param {string} projectRoot - Project root directory
 * @param {Object} options - Options
 * @returns {string|null} Formatted type hints
 */
function generateTypeHints(projectRoot, options = {}) {
  const { maxTypes = 10, taskDescription = '' } = options;
  const typeHints = [];

  // Common type file locations
  const typeFiles = [
    path.join(projectRoot, 'src', 'types', 'index.ts'),
    path.join(projectRoot, 'src', 'types.ts'),
    path.join(projectRoot, 'types', 'index.ts'),
    path.join(projectRoot, 'src', 'lib', 'types.ts')
  ];

  for (const typePath of typeFiles) {
    if (!fs.existsSync(typePath)) continue;

    try {
      const content = fs.readFileSync(typePath, 'utf-8');

      // Extract interface/type definitions
      const interfaceRegex = /(?:export\s+)?interface\s+(\w+)\s*(?:extends\s+[\w,\s]+)?\s*\{([^}]+)\}/g;
      const typeRegex = /(?:export\s+)?type\s+(\w+)\s*=\s*([^;]+);/g;

      let match;

      // Extract interfaces with their key properties
      while ((match = interfaceRegex.exec(content)) !== null && typeHints.length < maxTypes) {
        const name = match[1];
        const body = match[2];

        // Extract key properties (first 5 lines or so)
        const props = body
          .split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('//'))
          .slice(0, 5)
          .map(line => '  ' + line);

        if (props.length > 0) {
          typeHints.push(`${name}: { ${props.join(' ').replace(/\s+/g, ' ').slice(0, 100)}${props.length > 5 ? ' ...' : ''} }`);
        }
      }

      // Extract type aliases (simpler)
      while ((match = typeRegex.exec(content)) !== null && typeHints.length < maxTypes) {
        const name = match[1];
        const value = match[2].trim().slice(0, 80);

        // Only include simple types, not complex unions
        if (!value.includes('\n') && value.length < 80) {
          typeHints.push(`${name}: ${value}`);
        }
      }

    } catch (err) {
      if (process.env.DEBUG) {
        console.warn(`Could not parse types from ${typePath}: ${err.message}`);
      }
    }
  }

  if (typeHints.length === 0) return null;

  return `**Type Hints (condensed):**\n${typeHints.map(h => `- ${h}`).join('\n')}`;
}

module.exports = {
  INSTRUCTION_RICHNESS,
  COMPLEXITY_TO_RICHNESS,
  getInstructionRichness,
  getVerbosityGuidance,
  // Model-aware context
  getModelContextPreferences,
  loadModelRegistry,
  // Context loaders
  loadProjectContext,
  loadPatterns,
  loadRelevantTypes,
  loadRelevantTypesWithLSP,  // LSP-enhanced version
  loadRelatedCode,
  loadSimilarExamples,
  // Type hints
  generateTypeHints,
  // LSP helpers
  extractIdentifiersForLSP
};

// ============================================================
// CLI for testing
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
Usage: node flow-instruction-richness.js <complexity-level> [model]

Complexity levels: small, medium, large, xl
Model (optional): claude-opus-4-5, claude-sonnet-4, claude-haiku-3-5, etc.

Model-Aware Context Density:
  - opus (concise):        Uses less context, can infer from hints
  - sonnet (standard):     Default context levels
  - haiku/local (comprehensive): Uses more context, needs explicit examples

Examples:
  node flow-instruction-richness.js small
  node flow-instruction-richness.js medium claude-opus-4-5
  node flow-instruction-richness.js medium claude-haiku-3-5
`);
    process.exit(0);
  }

  const level = args[0];
  const model = args[1] || null;
  const richness = getInstructionRichness(level, {}, model);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('     INSTRUCTION RICHNESS CONFIG (Model-Aware)');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Complexity Level: ${level.toUpperCase()}`);
  console.log(`Richness Level: ${richness.level.toUpperCase()}`);
  if (model) {
    console.log(`Model: ${model}`);
    console.log(`Model Density: ${richness.modelDensity || 'standard'}`);
    if (richness.patternHintsOnly) {
      console.log(`Pattern Mode: Hints only (no explicit examples needed)`);
    }
  }
  console.log(`\n${richness.description}\n`);

  console.log('───────────────────────────────────────────────────────────');
  console.log('              CONTEXT TO INCLUDE');
  console.log('───────────────────────────────────────────────────────────\n');

  console.log(`Template Verbosity: ${richness.templateVerbosity}`);
  console.log('');
  console.log(`Include Project Context: ${richness.includeProjectContext ? '✅ Yes' : '❌ No'}`);
  console.log(`Include Type Definitions: ${richness.includeTypeDefinitions ? '✅ Yes' : '❌ No'}`);
  console.log(`Include Related Code: ${richness.includeRelatedCode ? '✅ Yes' : '❌ No'}`);
  console.log(`Include Examples: ${richness.includeExamples ? '✅ Yes' : '❌ No'}`);
  console.log(`Include Patterns: ${richness.includePatterns ? '✅ Yes' : '❌ No'}`);
  console.log(`Include Full File Contents: ${richness.includeFullFileContents ? '✅ Yes' : '❌ No'}`);

  console.log('\n───────────────────────────────────────────────────────────');
  console.log('                  GUIDANCE');
  console.log('───────────────────────────────────────────────────────────');
  console.log(getVerbosityGuidance(richness.templateVerbosity));

  if (model) {
    const prefs = getModelContextPreferences(model);
    console.log('\n───────────────────────────────────────────────────────────');
    console.log('              MODEL PREFERENCES');
    console.log('───────────────────────────────────────────────────────────');
    console.log(`  Density: ${prefs.density}`);
    console.log(`  Explicit Examples: ${prefs.explicitExamples ? 'Yes' : 'No'}`);
    console.log(`  Pattern Hints: ${prefs.patternHints ? 'Yes' : 'No'}`);
    console.log(`  Min Context for Quality: ${(prefs.minContextForQuality * 100).toFixed(0)}%`);
  }

  console.log('\n💡 Model-aware context: Each model gets the right amount of');
  console.log('   context for optimal quality without waste.\n');
  console.log('═══════════════════════════════════════════════════════════\n');
}
