#!/usr/bin/env node

/**
 * Wogi Flow - Response Parser
 *
 * Cleans LLM responses to extract usable content.
 * Handles common artifacts that cause "failures" which are actually fixable:
 * - Thinking tags (<thinking>...</thinking>)
 * - Markdown fences around code
 * - Preambles before code ("Here's the code:", "Sure, I'll...", etc.)
 * - Claude artifacts like <reflection> tags
 *
 * Usage:
 *   const { parseResponse, cleanCodeBlock } = require('./flow-response-parser');
 *   const cleaned = parseResponse(llmResponse);
 *
 * Part of v1.8.0 - Council Review Fixes
 */

// ============================================================
// Core Parser Functions
// ============================================================

/**
 * Parse and clean an LLM response
 * @param {string} response - Raw LLM response
 * @param {Object} options - Parsing options
 * @returns {Object} - { content, artifacts, metadata }
 */
function parseResponse(response, options = {}) {
  if (!response || typeof response !== 'string') {
    return { content: '', artifacts: [], metadata: {} };
  }

  const {
    stripThinking = true,
    stripReflection = true,
    extractCode = false,
    removePreamble = true,
    preserveMarkdown = false
  } = options;

  let content = response;
  const artifacts = [];
  const metadata = {};

  // 1. Strip thinking tags
  if (stripThinking) {
    const thinkingMatch = content.match(/<thinking>([\s\S]*?)<\/thinking>/gi);
    if (thinkingMatch) {
      artifacts.push({ type: 'thinking', count: thinkingMatch.length });
      content = content.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
    }
  }

  // 2. Strip reflection tags
  if (stripReflection) {
    const reflectionMatch = content.match(/<reflection>([\s\S]*?)<\/reflection>/gi);
    if (reflectionMatch) {
      artifacts.push({ type: 'reflection', count: reflectionMatch.length });
      content = content.replace(/<reflection>[\s\S]*?<\/reflection>/gi, '');
    }
  }

  // 3. Strip artifact tags
  const artifactMatch = content.match(/<artifact[^>]*>([\s\S]*?)<\/artifact>/gi);
  if (artifactMatch) {
    artifacts.push({ type: 'artifact', count: artifactMatch.length });
    // Extract content from within artifacts
    const artifactContent = artifactMatch.map(a => {
      const inner = a.match(/<artifact[^>]*>([\s\S]*?)<\/artifact>/i);
      return inner ? inner[1].trim() : '';
    }).join('\n\n');
    content = artifactContent || content.replace(/<artifact[^>]*>[\s\S]*?<\/artifact>/gi, '');
  }

  // 4. Extract code from markdown fences if requested
  if (extractCode) {
    const codeBlocks = extractCodeBlocks(content);
    if (codeBlocks.length > 0) {
      metadata.codeBlocks = codeBlocks.length;
      metadata.languages = [...new Set(codeBlocks.map(b => b.language).filter(Boolean))];
      // Return just the code if only one block
      if (codeBlocks.length === 1) {
        content = codeBlocks[0].code;
      } else {
        // Multiple blocks - join with separators
        content = codeBlocks.map(b => b.code).join('\n\n');
      }
    }
  } else if (!preserveMarkdown) {
    // Just clean up the fences but keep structure
    content = cleanMarkdownFences(content);
  }

  // 5. Remove preambles
  if (removePreamble) {
    content = removePreambles(content);
  }

  // 6. Clean up whitespace
  content = content.trim();
  content = content.replace(/\n{3,}/g, '\n\n'); // Max 2 consecutive newlines

  return {
    content,
    artifacts,
    metadata,
    wasModified: content !== response.trim()
  };
}

/**
 * Extract code blocks from markdown
 * @param {string} content - Content with potential code blocks
 * @returns {Array} - Array of { language, code, raw }
 */
function extractCodeBlocks(content) {
  const blocks = [];
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    blocks.push({
      language: match[1] || null,
      code: match[2].trim(),
      raw: match[0]
    });
  }

  return blocks;
}

/**
 * Clean markdown fences while preserving code
 * @param {string} content - Content with code fences
 * @returns {string} - Content with cleaned fences
 */
function cleanMarkdownFences(content) {
  // Keep the fence structure but clean up
  return content
    // Remove empty code blocks
    .replace(/```\w*\n\s*```/g, '')
    // Normalize code block spacing
    .replace(/```(\w*)\n\n+/g, '```$1\n')
    .replace(/\n\n+```/g, '\n```');
}

/**
 * Remove common LLM preambles
 * @param {string} content - Content with potential preambles
 * @returns {string} - Content without preambles
 */
function removePreambles(content) {
  // Common preamble patterns
  const preamblePatterns = [
    // Opening statements
    /^(?:Here(?:'s| is) (?:the |your |a )?(?:code|implementation|solution|function|class|file)[^:]*?:?\s*\n+)/i,
    /^(?:Sure[,!]?\s*(?:I(?:'ll| will| can)|let me)[^.]*?\.\s*\n+)/i,
    /^(?:I(?:'ll| will| can)[^.]*?\.\s*\n+)/i,
    /^(?:Let me[^.]*?\.\s*\n+)/i,
    /^(?:Certainly[,!]?\s*(?:Here|I)[^.]*?\.\s*\n+)/i,
    /^(?:Of course[,!]?\s*[^.]*?\.\s*\n+)/i,
    /^(?:Absolutely[,!]?\s*[^.]*?\.\s*\n+)/i,

    // Acknowledgments
    /^(?:I understand[^.]*?\.\s*\n+)/i,
    /^(?:Got it[,!]?\s*[^.]*?\.\s*\n+)/i,
    /^(?:Understood[,!]?\s*[^.]*?\.\s*\n+)/i,

    // Technical context
    /^(?:Based on[^,]*?,\s*(?:here|I)[^.]*?\.\s*\n+)/i,
    /^(?:Looking at[^,]*?,\s*[^.]*?\.\s*\n+)/i,
    /^(?:After (?:reviewing|analyzing)[^,]*?,\s*[^.]*?\.\s*\n+)/i
  ];

  let result = content;

  for (const pattern of preamblePatterns) {
    result = result.replace(pattern, '');
  }

  return result;
}

/**
 * Clean a single code block response
 * Specialized for when you expect just code
 * @param {string} response - LLM response that should be code
 * @param {string} expectedLanguage - Expected language (optional)
 * @returns {string} - Clean code
 */
function cleanCodeBlock(response, expectedLanguage = null) {
  if (!response) return '';

  let content = response;

  // Strip thinking/reflection first
  content = content.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  content = content.replace(/<reflection>[\s\S]*?<\/reflection>/gi, '');

  // Extract from markdown fence
  const fenceMatch = content.match(/```(?:\w*)\n([\s\S]*?)```/);
  if (fenceMatch) {
    content = fenceMatch[1];
  }

  // Remove preambles
  content = removePreambles(content);

  // Clean trailing explanations (after code)
  const explanationPatterns = [
    /\n+(?:This (?:code|function|implementation)[^.]*?\.|Note that[^.]*?\.|The above[^.]*?\.)[\s\S]*$/i,
    /\n+(?:Key (?:changes|features|points)[^:]*?:[\s\S]*?)$/i,
    /\n+(?:Explanation[^:]*?:[\s\S]*?)$/i
  ];

  for (const pattern of explanationPatterns) {
    content = content.replace(pattern, '');
  }

  return content.trim();
}

/**
 * Detect if response needs parsing
 * Quick check to avoid unnecessary processing
 * @param {string} response - Raw response
 * @returns {boolean} - True if parsing would modify the response
 */
function needsParsing(response) {
  if (!response) return false;

  // Check for artifacts that would be stripped
  if (/<thinking>|<reflection>|<artifact/i.test(response)) {
    return true;
  }

  // Check for code fences
  if (/```\w*\n/.test(response)) {
    return true;
  }

  // Check for common preambles
  if (/^(?:Here's|Sure|I'll|Let me|Certainly)/i.test(response)) {
    return true;
  }

  return false;
}

/**
 * Parse response on error retry (conservative mode)
 * Only parses if there was an error and parsing might help
 * @param {string} response - Raw response
 * @param {Error} error - The error that occurred
 * @returns {Object} - { content, shouldRetry }
 */
function parseOnRetry(response, error) {
  // Check if this is a parse-fixable error
  const parseFixableErrors = [
    'SyntaxError',
    'Unexpected token',
    'Invalid JSON',
    'Parse error'
  ];

  const isParseFixable = parseFixableErrors.some(e =>
    error?.message?.includes(e) || error?.name === e
  );

  if (!isParseFixable && !needsParsing(response)) {
    return { content: response, shouldRetry: false };
  }

  const parsed = parseResponse(response, { extractCode: true });

  return {
    content: parsed.content,
    shouldRetry: parsed.wasModified,
    artifacts: parsed.artifacts
  };
}

// ============================================================
// Specialized Parsers
// ============================================================

/**
 * Parse JSON from LLM response
 * @param {string} response - Response that should contain JSON
 * @returns {Object|null} - Parsed JSON or null
 */
function parseJsonResponse(response) {
  const cleaned = parseResponse(response, {
    extractCode: true,
    stripThinking: true,
    stripReflection: true,
    removePreamble: true
  });

  let content = cleaned.content;

  // Try direct parse first
  try {
    return JSON.parse(content);
  } catch (_err) {}

  // Extract JSON from markdown fence
  const jsonMatch = content.match(/```(?:json)?\n([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1].trim());
    } catch (_err) {}
  }

  // Look for JSON object pattern - find balanced braces
  const objectStart = content.indexOf('{');
  if (objectStart !== -1) {
    const jsonStr = extractBalancedJson(content, objectStart, '{', '}');
    if (jsonStr) {
      try {
        return JSON.parse(jsonStr);
      } catch (_err) {}
    }
  }

  // Look for JSON array pattern - find balanced brackets
  const arrayStart = content.indexOf('[');
  if (arrayStart !== -1) {
    const jsonStr = extractBalancedJson(content, arrayStart, '[', ']');
    if (jsonStr) {
      try {
        return JSON.parse(jsonStr);
      } catch (_err) {}
    }
  }

  return null;
}

/**
 * Extract a balanced JSON structure starting at the given index
 * Handles nested structures correctly (won't match across unrelated objects)
 */
function extractBalancedJson(content, startIdx, openChar, closeChar) {
  if (content[startIdx] !== openChar) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIdx; i < content.length; i++) {
    const char = content[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\' && inString) {
      escape = true;
      continue;
    }

    if (char === '"' && !escape) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === openChar) {
        depth++;
      } else if (char === closeChar) {
        depth--;
        if (depth === 0) {
          return content.substring(startIdx, i + 1);
        }
      }
    }
  }

  return null; // Unbalanced
}

/**
 * Parse file content from LLM response
 * For when LLM generates file content
 * @param {string} response - Response containing file content
 * @param {string} filename - Expected filename (for language detection)
 * @returns {string} - Clean file content
 */
function parseFileContent(response, filename = '') {
  // Detect language from filename
  const extMatch = filename.match(/\.(\w+)$/);
  const ext = extMatch ? extMatch[1] : '';

  const cleaned = parseResponse(response, {
    extractCode: true,
    stripThinking: true,
    stripReflection: true,
    removePreamble: true
  });

  let content = cleaned.content;

  // If we got code blocks, use the one matching the expected language
  if (cleaned.metadata.codeBlocks > 1) {
    const blocks = extractCodeBlocks(response);
    const languageMap = {
      js: ['javascript', 'js'],
      ts: ['typescript', 'ts'],
      tsx: ['tsx', 'typescript'],
      jsx: ['jsx', 'javascript'],
      py: ['python', 'py'],
      rs: ['rust', 'rs'],
      go: ['go', 'golang']
    };

    const expectedLangs = languageMap[ext] || [ext];
    const matchingBlock = blocks.find(b =>
      b.language && expectedLangs.includes(b.language.toLowerCase())
    );

    if (matchingBlock) {
      content = matchingBlock.code;
    }
  }

  return content;
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Core functions
  parseResponse,
  extractCodeBlocks,
  cleanMarkdownFences,
  removePreambles,
  cleanCodeBlock,
  needsParsing,
  parseOnRetry,

  // Specialized parsers
  parseJsonResponse,
  parseFileContent
};
