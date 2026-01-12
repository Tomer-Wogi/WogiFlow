#!/usr/bin/env node

/**
 * Wogi Flow - Orchestrator Validation Module
 *
 * Extracted from flow-orchestrate.js for modularity.
 * Contains code extraction and validation functions.
 *
 * Functions:
 * - extractCodeFromResponse: Extract code from LLM responses
 * - scoreCodeBlock: Score code blocks for selection
 * - isValidCode: Validate extracted code
 * - validateOutputMatchesTask: Semantic validation
 * - validateImports: Import validation against export map
 */

const path = require('path');
const { getConfig } = require('./flow-utils');
const { loadCachedExportMap } = require('./flow-export-scanner');

// ============================================================
// Code Extraction
// ============================================================

/**
 * Extracts code from an LLM response, handling various model formats.
 * Handles:
 * - Thinking tags (<think>, <thinking>, etc.)
 * - Model-specific artifacts (Qwen, DeepSeek, Llama)
 * - Markdown code blocks (picks best one)
 * - Trailing prose/explanations
 * - JSON wrapper responses
 * - Multiple code blocks (selects largest/most relevant)
 */
function extractCodeFromResponse(response, modelName = '') {
  if (!response || typeof response !== 'string') {
    return response;
  }

  const rawResponse = response;
  let code = response;

  // 0. Handle JSON wrapper responses (some models wrap code in JSON)
  try {
    const jsonMatch = code.match(/^\s*\{[\s\S]*"code"\s*:\s*"([\s\S]*)"[\s\S]*\}\s*$/);
    if (jsonMatch) {
      code = JSON.parse(`"${jsonMatch[1]}"`); // Unescape JSON string
    }
  } catch { /* not JSON wrapped */ }

  // 1. Remove model-specific thinking tags and artifacts
  const thinkingPatterns = [
    // Standard thinking tags
    /<think>[\s\S]*?<\/think>/gi,
    /<thinking>[\s\S]*?<\/thinking>/gi,
    /<reasoning>[\s\S]*?<\/reasoning>/gi,
    /<analysis>[\s\S]*?<\/analysis>/gi,

    // Qwen-specific
    /<\|im_start\|>[\s\S]*?<\|im_end\|>/gi,

    // DeepSeek-specific artifacts
    /^<\|begin_of_sentence\|>/gm,
    /<\|end_of_sentence\|>$/gm,

    // Llama-specific
    /\[INST\][\s\S]*?\[\/INST\]/gi,
    /<<SYS>>[\s\S]*?<<\/SYS>>/gi,

    // Generic assistant markers
    /^Assistant:\s*/gim,
    /^AI:\s*/gim,
    /^Response:\s*/gim,
    /^Output:\s*/gim,
    /^Answer:\s*/gim,
    /^Code:\s*/gim,

    // Model-specific trailing signatures
    /---\s*End of (response|code|file)[\s\S]*$/gi,
    /\n\nPlease let me know[\s\S]*$/gi,
    /\n\nIs there anything[\s\S]*$/gi,
    /\n\nFeel free to[\s\S]*$/gi,
    /\n\nLet me know if[\s\S]*$/gi,
  ];

  for (const pattern of thinkingPatterns) {
    code = code.replace(pattern, '');
  }

  // 2. Handle </think> tag (if partial tag remains)
  const thinkEndMatch = code.match(/<\/think>\s*/i);
  if (thinkEndMatch) {
    code = code.slice(thinkEndMatch.index + thinkEndMatch[0].length);
  }

  // 3. Extract from markdown code blocks
  // Find all code blocks and pick the best one
  const codeBlocks = [...code.matchAll(/```(?:typescript|tsx|ts|javascript|jsx|js|plaintext)?\s*\n([\s\S]*?)```/g)];

  if (codeBlocks.length > 0) {
    // Score each block and pick the best one
    let bestBlock = codeBlocks[0][1];
    let bestScore = scoreCodeBlock(bestBlock);

    for (let i = 1; i < codeBlocks.length; i++) {
      const blockContent = codeBlocks[i][1];
      const score = scoreCodeBlock(blockContent);
      if (score > bestScore) {
        bestScore = score;
        bestBlock = blockContent;
      }
    }
    code = bestBlock;
  } else {
    // Also try to remove any remaining markdown code block markers
    code = code.replace(/^```(?:typescript|tsx|javascript|jsx|ts|js|plaintext)?\n/gm, '');
    code = code.replace(/\n```$/gm, '');
    code = code.replace(/^```$/gm, '');
  }

  // 4. Find first valid TypeScript/JavaScript line
  const validStartPatterns = [
    /^import\s/m,
    /^export\s/m,
    /^const\s/m,
    /^let\s/m,
    /^var\s/m,
    /^function\s/m,
    /^async\s+function\s/m,
    /^class\s/m,
    /^interface\s/m,
    /^type\s/m,
    /^enum\s/m,
    /^declare\s/m,
    /^module\s/m,
    /^namespace\s/m,
    /^\/\*\*/m,  // JSDoc comment
    /^\/\*[^*]/m, // Block comment
    /^\/\//m,    // Single line comment at start
    /^'use /m,   // 'use strict' or 'use client'
    /^"use /m,
    /^@/m,       // Decorators
  ];

  let earliestMatch = -1;
  for (const pattern of validStartPatterns) {
    const match = code.search(pattern);
    if (match !== -1 && (earliestMatch === -1 || match < earliestMatch)) {
      earliestMatch = match;
    }
  }

  if (earliestMatch > 0) {
    code = code.slice(earliestMatch);
  }

  // 5. Remove trailing explanations and prose
  const trailingPatterns = [
    // Standard prose after code
    /(\}|\;)\s*\n\s*\n+[A-Z][a-z]/,
    // Numbered explanations
    /(\}|\;)\s*\n\s*\n+\d+\.\s+/,
    // Bullet points
    /(\}|\;)\s*\n\s*\n+[-*•]\s+/,
    // Notes/explanations
    /(\}|\;)\s*\n\s*\n+(?:Note:|Explanation:|Summary:|Key |Important:)/i,
  ];

  for (const pattern of trailingPatterns) {
    const match = code.match(pattern);
    if (match) {
      code = code.slice(0, match.index + 1);
      break;
    }
  }

  // 6. Clean up common artifacts
  code = code
    // Remove zero-width characters
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // Normalize line endings
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Remove trailing whitespace on each line
    .replace(/[ \t]+$/gm, '')
    // Collapse multiple blank lines to max 2
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Debug logging
  if (process.env.DEBUG_HYBRID) {
    console.log('\n--- RAW LLM RESPONSE (first 500 chars) ---');
    console.log(rawResponse.slice(0, 500));
    console.log('\n--- EXTRACTED CODE (first 500 chars) ---');
    console.log(code.slice(0, 500));
    console.log('---\n');
  }

  return code;
}

/**
 * Score a code block to determine which is most likely the actual code
 * Higher score = more likely to be the real code
 */
function scoreCodeBlock(block) {
  if (!block) return 0;

  let score = 0;

  // Length bonus (longer is usually better, but cap it)
  score += Math.min(block.length / 100, 50);

  // Valid code patterns
  if (/^import\s/m.test(block)) score += 20;
  if (/^export\s/m.test(block)) score += 20;
  if (/^const\s/m.test(block)) score += 10;
  if (/^function\s/m.test(block)) score += 10;
  if (/^class\s/m.test(block)) score += 10;
  if (/^interface\s/m.test(block)) score += 15;
  if (/^type\s/m.test(block)) score += 10;

  // Code structure indicators
  score += (block.match(/\{/g) || []).length * 2;
  score += (block.match(/\}/g) || []).length * 2;
  score += (block.match(/=>/g) || []).length * 3;
  score += (block.match(/return\s/g) || []).length * 3;

  // Penalties for prose/non-code
  if (/^[A-Z][a-z]+\s+[a-z]+/m.test(block)) score -= 10; // Starts with prose
  if (/\.$/.test(block.trim())) score -= 5; // Ends with period (prose)

  return score;
}

// ============================================================
// Code Validation
// ============================================================

/**
 * Validates if the extracted code looks like valid TypeScript/JavaScript.
 * Returns { valid: boolean, reason?: string }
 */
function isValidCode(code) {
  if (!code) {
    return { valid: false, reason: 'Empty output' };
  }

  if (code.length < 10) {
    return { valid: false, reason: 'Output too short' };
  }

  const trimmed = code.trim();

  // Check for common LLM prose patterns that indicate thinking/explanation
  const prosePatterns = [
    /^(We need|Let's|The |I |You |This |Maybe|Probably|Actually|But |So |Thus |Given |Here|Now |First|To |In order)/i,
    /^(Looking at|Based on|According to|As you can|Note that|Remember|Consider|Thinking|Output:)/i,
    /^(```|~~~)/,  // Markdown code fence at start means extraction failed
    /<think>|<\/think>/i,  // Thinking tags leaked through
  ];

  for (const pattern of prosePatterns) {
    if (pattern.test(trimmed)) {
      return { valid: false, reason: `Starts with prose/thinking: "${trimmed.slice(0, 50)}..."` };
    }
  }

  // Must start with valid TS/JS syntax
  const validStartPatterns = /^(import|export|const|let|var|function|async|class|interface|type|enum|declare|module|namespace|\/\*\*|\/\*|\/\/|'use |"use |@)/;

  if (!validStartPatterns.test(trimmed)) {
    return { valid: false, reason: `Invalid start: "${trimmed.slice(0, 50)}..."` };
  }

  // Additional sanity checks
  // Should have some code-like structure (braces, semicolons, etc.)
  const hasCodeStructure = /[{};=()]/.test(code);
  if (!hasCodeStructure && code.length > 100) {
    return { valid: false, reason: 'No code structure detected (missing braces/semicolons)' };
  }

  return { valid: true };
}

// ============================================================
// Semantic Output Validation
// ============================================================

/**
 * Validates that the output semantically matches what was requested.
 * This catches cases where the code is syntactically valid but implements
 * the wrong thing (e.g., creating ApprovalChain instead of Button).
 *
 * @param {string} code - The generated code
 * @param {Object} step - The step definition containing type and params
 * @returns {{ valid: boolean, reason?: string, confidence: number }}
 */
function validateOutputMatchesTask(code, step) {
  if (!code || !step) {
    return { valid: true, confidence: 0 }; // Can't validate without info
  }

  const stepType = step.type;
  const expectedName = step.params?.name || step.params?.componentName || '';
  const targetPath = step.params?.path || '';
  const codeLower = code.toLowerCase();
  const issues = [];
  let confidence = 100;

  // Extract the expected filename/component name from path
  const fileBaseName = targetPath
    ? path.basename(targetPath, path.extname(targetPath))
    : expectedName;

  // 1. For component creation, check component name
  if (stepType === 'create-file' || stepType === 'create-component') {
    const expectedLower = fileBaseName.toLowerCase();

    // Check for component definition
    const componentPatterns = [
      new RegExp(`(function|const|class)\\s+${escapeRegex(fileBaseName)}`, 'i'),
      new RegExp(`export\\s+(default\\s+)?${escapeRegex(fileBaseName)}`, 'i'),
      new RegExp(`export\\s+(default\\s+)?(function|const|class)\\s+${escapeRegex(fileBaseName)}`, 'i'),
    ];

    let foundComponent = false;
    for (const pattern of componentPatterns) {
      if (pattern.test(code)) {
        foundComponent = true;
        break;
      }
    }

    if (!foundComponent && expectedLower && expectedLower !== 'index') {
      // Check if a completely different component was created
      const anyComponentMatch = code.match(/(?:function|const|class)\s+([A-Z][a-zA-Z0-9]+)/);
      if (anyComponentMatch && anyComponentMatch[1].toLowerCase() !== expectedLower) {
        issues.push(`Expected component "${fileBaseName}" but found "${anyComponentMatch[1]}"`);
        confidence -= 30;
      } else {
        // Component name not found at all
        confidence -= 10;
      }
    }
  }

  // 2. For modifications, check target function/component exists
  if (stepType === 'modify-file') {
    const targetFunction = step.params?.function || step.params?.targetFunction;
    if (targetFunction) {
      const funcPattern = new RegExp(`(function|const|async\\s+function)\\s+${escapeRegex(targetFunction)}`, 'i');
      if (!funcPattern.test(code)) {
        confidence -= 15;
      }
    }
  }

  // 3. Check for hallucinated imports from wrong paths
  if (targetPath.includes('/components/')) {
    // UI component file - should not import from chains/approval etc.
    if (/from\s+['"].*\/(chains|approval|workflow)/.test(code)) {
      issues.push('UI component imports from non-UI paths (chains/approval/workflow)');
      confidence -= 20;
    }
  }

  // 4. Check export matches file name
  if (fileBaseName && fileBaseName !== 'index') {
    const hasMatchingExport = new RegExp(`export\\s+(default\\s+)?.*${escapeRegex(fileBaseName)}`, 'i').test(code);
    if (!hasMatchingExport) {
      confidence -= 5;
    }
  }

  const valid = issues.length === 0 && confidence >= 50;

  return {
    valid,
    reason: issues.length > 0 ? issues.join('; ') : undefined,
    confidence,
    issues
  };
}

/**
 * Escapes special regex characters in a string
 */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================
// Import Validation (Config-Driven)
// ============================================================

/**
 * Validates imports in generated code against the export map.
 * Uses the cached export map for accurate import validation.
 *
 * @param {string} code - The generated code
 * @param {Object} exportMap - The export map (or null to load from cache)
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateImports(code, exportMap = null) {
  const errors = [];
  const warnings = [];

  // Load export map if not provided
  if (!exportMap) {
    exportMap = loadCachedExportMap();
    if (!exportMap) {
      // No export map available, can't validate
      return { valid: true, errors: [], warnings: ['No export map available for validation'] };
    }
  }

  // Load doNotImport from config
  let doNotImport = ['React']; // Default
  try {
    const config = getConfig();
    doNotImport = config.hybrid?.projectContext?.doNotImport || ['React'];
  } catch {}

  // Build a lookup map for all exports by import path
  const exportsByPath = new Map();

  // Add all exports from the map
  for (const [category, items] of Object.entries(exportMap)) {
    if (category === '_meta') continue;

    for (const [name, info] of Object.entries(items)) {
      if (!info.importPath) continue;

      const exports = [];
      if (info.exports?.length > 0) exports.push(...info.exports);
      if (info.types?.length > 0) exports.push(...info.types);
      if (info.defaultExport) exports.push(info.defaultExport);

      exportsByPath.set(info.importPath, {
        name,
        exports,
        defaultExport: info.defaultExport,
        category
      });
    }
  }

  // Extract imports from code
  const importMatches = code.match(/import\s+(?:type\s+)?(?:{[^}]*}|[\w*]+)?\s*(?:,\s*{[^}]*})?\s*from\s+['"]([^'"]+)['"]/g) || [];

  for (const importLine of importMatches) {
    // Extract the import path
    const pathMatch = importLine.match(/from\s+['"]([^'"]+)['"]/);
    if (!pathMatch) continue;

    const importPath = pathMatch[1];

    // Skip external packages
    if (!importPath.startsWith('@/') && !importPath.startsWith('./') && !importPath.startsWith('../')) {
      // Check doNotImport for external packages
      for (const forbidden of doNotImport) {
        if (importLine.includes(`import ${forbidden} `) ||
            importLine.includes(`import ${forbidden},`) ||
            importLine.includes(`import * as ${forbidden}`)) {
          errors.push(`Forbidden import detected: "import ${forbidden}" - use named imports instead`);
        }
      }
      continue;
    }

    // Check if import path exists in our export map
    const knownExports = exportsByPath.get(importPath);

    if (!knownExports) {
      // Path not in export map - might be a relative import or unknown path
      if (importPath.startsWith('@/')) {
        warnings.push(`Import path "${importPath}" not found in export map - verify it exists`);
      }
      continue;
    }

    // Extract what's being imported
    const namedImportsMatch = importLine.match(/{([^}]+)}/);
    if (namedImportsMatch) {
      const importedNames = namedImportsMatch[1]
        .split(',')
        .map(n => n.trim().split(/\s+as\s+/)[0].trim()) // Handle "X as Y"
        .filter(n => n && n !== 'type'); // Filter out 'type' keyword

      const availableExports = knownExports.exports || [];

      for (const importedName of importedNames) {
        if (importedName && !availableExports.includes(importedName)) {
          const suggestions = availableExports.slice(0, 5).join(', ');
          errors.push(`"${importedName}" is not exported by "${importPath}" - available: ${suggestions}`);
        }
      }
    }

    // Check default import
    const defaultImportMatch = importLine.match(/import\s+(\w+)\s*(?:,|from)/);
    if (defaultImportMatch) {
      const defaultImportName = defaultImportMatch[1];
      if (defaultImportName !== 'type' && !knownExports.defaultExport) {
        // Check if they might want a named export
        if (knownExports.exports.includes(defaultImportName)) {
          warnings.push(`"${defaultImportName}" is a named export, not default - use: import { ${defaultImportName} } from '${importPath}'`);
        } else {
          errors.push(`"${importPath}" has no default export - use named imports instead`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Code extraction
  extractCodeFromResponse,
  scoreCodeBlock,

  // Code validation
  isValidCode,
  validateOutputMatchesTask,
  validateImports,

  // Utilities
  escapeRegex
};
