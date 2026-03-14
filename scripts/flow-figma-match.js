#!/usr/bin/env node

/**
 * Wogi Flow - Component Similarity Matcher
 *
 * Compares extracted Figma components against the codebase registry
 * and calculates similarity scores based on CSS, structure, and naming.
 *
 * Usage:
 *   flow figma match <figma-components.json>   # Match against registry
 *   flow figma match --stdin                   # Read from stdin
 *   flow figma match --threshold 80            # Set match threshold
 */

const fs = require('node:fs');
const path = require('node:path');
const { getProjectRoot, safeJsonParse, safeJsonParseString } = require('./flow-utils')
const { error } = require('./flow-output');;

const PROJECT_ROOT = getProjectRoot();
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const REGISTRY_PATH = path.join(WORKFLOW_DIR, 'state', 'component-registry.json');

// ============================================================
// Matching Configuration
// ============================================================

const MATCH_CONFIG = {
  thresholds: {
    EXACT_MATCH: 95,        // Use directly, minimal/no changes
    STRONG_MATCH: 80,       // Use with minor adjustments
    VARIANT_CANDIDATE: 60,  // Could be a new variant of existing
    NEW_COMPONENT: 60       // Below this = definitely new
  },

  weights: {
    css: 0.35,          // CSS properties (colors, spacing, etc.)
    structure: 0.25,    // DOM structure similarity
    naming: 0.20,       // Name similarity
    behavior: 0.20      // Props/variants similarity
  }
};

// ============================================================
// Similarity Calculator
// ============================================================

class SimilarityMatcher {
  constructor(registry) {
    this.registry = registry;
  }

  /**
   * Match a single Figma component against all registry components
   */
  matchComponent(figmaComponent) {
    const matches = [];

    for (const registryComponent of this.registry.components) {
      const score = this.calculateSimilarity(figmaComponent, registryComponent);

      if (score > 0) {
        matches.push({
          registryComponent: registryComponent,
          score: score,
          breakdown: this.getScoreBreakdown(figmaComponent, registryComponent),
          differences: this.getDifferences(figmaComponent, registryComponent),
          suggestion: this.getSuggestion(score)
        });
      }
    }

    // Sort by score descending
    matches.sort((a, b) => b.score - a.score);

    return {
      figmaComponent: {
        id: figmaComponent.id,
        name: figmaComponent.name,
        type: figmaComponent.type,
        figmaType: figmaComponent.figmaType
      },
      matches: matches.slice(0, 5), // Top 5 matches
      bestMatch: matches[0] || null,
      suggestion: this.getOverallSuggestion(figmaComponent, matches[0])
    };
  }

  /**
   * Match all Figma components
   */
  matchAll(figmaComponents) {
    const results = {
      summary: {
        total: figmaComponents.length,
        exactMatches: 0,
        strongMatches: 0,
        variantCandidates: 0,
        newComponents: 0
      },
      matches: []
    };

    for (const component of figmaComponents) {
      const result = this.matchComponent(component);
      results.matches.push(result);

      // Update summary
      if (result.bestMatch) {
        const score = result.bestMatch.score;
        if (score >= MATCH_CONFIG.thresholds.EXACT_MATCH) {
          results.summary.exactMatches++;
        } else if (score >= MATCH_CONFIG.thresholds.STRONG_MATCH) {
          results.summary.strongMatches++;
        } else if (score >= MATCH_CONFIG.thresholds.VARIANT_CANDIDATE) {
          results.summary.variantCandidates++;
        } else {
          results.summary.newComponents++;
        }
      } else {
        results.summary.newComponents++;
      }
    }

    return results;
  }

  /**
   * Calculate overall similarity score (0-100)
   */
  calculateSimilarity(figma, registry) {
    const cssScore = this.calculateCSSScore(figma, registry);
    const structureScore = this.calculateStructureScore(figma, registry);
    const namingScore = this.calculateNamingScore(figma, registry);
    const behaviorScore = this.calculateBehaviorScore(figma, registry);

    const weightedScore =
      cssScore * MATCH_CONFIG.weights.css +
      structureScore * MATCH_CONFIG.weights.structure +
      namingScore * MATCH_CONFIG.weights.naming +
      behaviorScore * MATCH_CONFIG.weights.behavior;

    return Math.round(weightedScore);
  }

  /**
   * CSS similarity based on colors, spacing, typography, etc.
   */
  calculateCSSScore(figma, registry) {
    let totalScore = 0;
    let totalWeight = 0;

    // Compare colors
    const figmaColors = this.extractCSSValues(figma, 'colors');
    const registryColors = this.extractCSSValuesFromRegistry(registry, 'color');
    const colorScore = this.compareArrays(figmaColors, registryColors);
    totalScore += colorScore * 30;
    totalWeight += 30;

    // Compare spacing
    const figmaSpacing = this.extractCSSValues(figma, 'spacing');
    const registrySpacing = this.extractCSSValuesFromRegistry(registry, 'spacing');
    const spacingScore = this.compareArrays(figmaSpacing, registrySpacing);
    totalScore += spacingScore * 25;
    totalWeight += 25;

    // Compare typography
    const figmaTypo = this.extractCSSValues(figma, 'typography');
    const registryTypo = this.extractCSSValuesFromRegistry(registry, 'typography');
    const typoScore = this.compareArrays(figmaTypo, registryTypo);
    totalScore += typoScore * 20;
    totalWeight += 20;

    // Compare radius
    const figmaRadius = this.extractCSSValues(figma, 'radius');
    const registryRadius = this.extractCSSValuesFromRegistry(registry, 'radius');
    const radiusScore = this.compareArrays(figmaRadius, registryRadius);
    totalScore += radiusScore * 15;
    totalWeight += 15;

    // Compare layout
    const figmaLayout = this.extractCSSValues(figma, 'layout');
    const registryLayout = this.extractCSSValuesFromRegistry(registry, 'layout');
    const layoutScore = this.compareArrays(figmaLayout, registryLayout);
    totalScore += layoutScore * 10;
    totalWeight += 10;

    return totalWeight > 0 ? (totalScore / totalWeight) * 100 : 0;
  }

  extractCSSValues(figma, type) {
    if (!figma.css || !figma.css[type]) return [];
    return figma.css[type].map(item => {
      if (typeof item.value === 'object') {
        return item.shorthand || JSON.stringify(item.value);
      }
      return item.value;
    }).filter(Boolean);
  }

  extractCSSValuesFromRegistry(registry, type) {
    if (!registry.cssProperties) return [];
    return registry.cssProperties
      .filter(p => p.type === type)
      .map(p => p.value);
  }

  /**
   * Structure similarity based on depth, child count, etc.
   */
  calculateStructureScore(figma, registry) {
    let score = 0;

    // Component type match
    if (figma.type === registry.type) {
      score += 40;
    } else if (
      (figma.type === 'atom' && registry.type === 'molecule') ||
      (figma.type === 'molecule' && registry.type === 'atom')
    ) {
      score += 20; // Adjacent types get partial credit
    }

    // Child count similarity
    const figmaChildren = figma.structure?.childCount || figma.children?.length || 0;
    const registryChildren = registry.childComponents?.length || 0;
    const childDiff = Math.abs(figmaChildren - registryChildren);

    if (childDiff === 0) score += 30;
    else if (childDiff <= 2) score += 20;
    else if (childDiff <= 4) score += 10;

    // Depth similarity
    const figmaDepth = figma.structure?.depth || 0;
    const registryDepth = registry.structure?.depth || 0;
    const depthDiff = Math.abs(figmaDepth - registryDepth);

    if (depthDiff === 0) score += 30;
    else if (depthDiff <= 1) score += 20;
    else if (depthDiff <= 2) score += 10;

    return score;
  }

  /**
   * Name similarity using fuzzy matching
   */
  calculateNamingScore(figma, registry) {
    const figmaName = this.normalizeName(figma.name);
    const registryName = this.normalizeName(registry.name);

    // Exact match
    if (figmaName === registryName) return 100;

    // Contains match
    if (figmaName.includes(registryName) || registryName.includes(figmaName)) {
      return 80;
    }

    // Word overlap
    const figmaWords = figmaName.split(/[-_\s]/).filter(w => w.length > 2);
    const registryWords = registryName.split(/[-_\s]/).filter(w => w.length > 2);
    const commonWords = figmaWords.filter(w =>
      registryWords.some(rw => rw.includes(w) || w.includes(rw))
    );

    if (commonWords.length > 0) {
      return 60 + (commonWords.length / Math.max(figmaWords.length, registryWords.length)) * 40;
    }

    // Levenshtein distance
    const distance = this.levenshteinDistance(figmaName, registryName);
    const maxLen = Math.max(figmaName.length, registryName.length);
    const similarity = 1 - (distance / maxLen);

    return Math.round(similarity * 100);
  }

  normalizeName(name) {
    return (name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .replace(/component|wrapper|container|item|view/g, '');
  }

  levenshteinDistance(str1, str2) {
    const m = str1.length;
    const n = str2.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
      }
    }

    return dp[m][n];
  }

  /**
   * Behavior similarity based on props and variants
   */
  calculateBehaviorScore(figma, registry) {
    let score = 0;

    // Check for similar variant properties
    if (figma.figma?.variantProperties && registry.variants?.length > 0) {
      const figmaVariants = Object.keys(figma.figma.variantProperties);
      const registryVariants = registry.variants.map(v => v.name);

      const commonVariants = figmaVariants.filter(v =>
        registryVariants.some(rv => rv.toLowerCase() === v.toLowerCase())
      );

      if (commonVariants.length > 0) {
        score += (commonVariants.length / Math.max(figmaVariants.length, registryVariants.length)) * 60;
      }
    }

    // Check for Figma component match (if connected)
    if (figma.figma?.isInstance && figma.figma?.componentId) {
      score += 20;
    }

    // Check if both are same Figma type
    if (figma.figma?.isComponent && registry.exports?.includes('default')) {
      score += 20;
    }

    return Math.min(100, score);
  }

  /**
   * Compare two arrays and return similarity (0-1)
   */
  compareArrays(arr1, arr2) {
    if (arr1.length === 0 && arr2.length === 0) return 1;
    if (arr1.length === 0 || arr2.length === 0) return 0;

    // Normalize arrays for comparison
    const norm1 = arr1.map(v => String(v).toLowerCase());
    const norm2 = arr2.map(v => String(v).toLowerCase());

    // Count matches (allowing partial matches for CSS values)
    let matches = 0;
    for (const val of norm1) {
      if (norm2.some(v2 => {
        // Exact match
        if (v2 === val) return true;
        // Contains match (e.g., "bg-blue-500" contains "blue")
        if (v2.includes(val) || val.includes(v2)) return true;
        // Number proximity (for spacing/sizing)
        const num1 = parseFloat(val.replace(/[^0-9.-]/g, ''));
        const num2 = parseFloat(v2.replace(/[^0-9.-]/g, ''));
        if (!isNaN(num1) && !isNaN(num2)) {
          return Math.abs(num1 - num2) <= Math.max(num1, num2) * 0.2; // Within 20%
        }
        return false;
      })) {
        matches++;
      }
    }

    return matches / Math.max(norm1.length, norm2.length);
  }

  /**
   * Get detailed score breakdown
   */
  getScoreBreakdown(figma, registry) {
    return {
      css: Math.round(this.calculateCSSScore(figma, registry)),
      structure: Math.round(this.calculateStructureScore(figma, registry)),
      naming: Math.round(this.calculateNamingScore(figma, registry)),
      behavior: Math.round(this.calculateBehaviorScore(figma, registry))
    };
  }

  /**
   * Get differences between Figma component and registry component
   */
  getDifferences(figma, registry) {
    const differences = [];

    // Color differences
    const figmaColors = this.extractCSSValues(figma, 'colors');
    const registryColors = this.extractCSSValuesFromRegistry(registry, 'color');
    const colorDiff = figmaColors.filter(c => !registryColors.includes(c));
    if (colorDiff.length > 0) {
      differences.push({
        type: 'color',
        figma: colorDiff.slice(0, 3), // Limit to 3
        existing: registryColors.slice(0, 3),
        description: `Different colors: ${colorDiff.slice(0, 3).join(', ')}`
      });
    }

    // Spacing differences
    const figmaSpacing = this.extractCSSValues(figma, 'spacing');
    const registrySpacing = this.extractCSSValuesFromRegistry(registry, 'spacing');
    const spacingDiff = figmaSpacing.filter(s => {
      const val = parseInt(s) || 0;
      return !registrySpacing.some(rs => {
        const rsVal = parseInt(rs) || 0;
        return Math.abs(val - rsVal) <= 4;
      });
    });
    if (spacingDiff.length > 0) {
      differences.push({
        type: 'spacing',
        figma: spacingDiff.slice(0, 3),
        existing: registrySpacing.slice(0, 3),
        description: `Different spacing: ${spacingDiff.slice(0, 3).join(', ')}`
      });
    }

    // Structure differences
    const figmaChildren = figma.structure?.childCount || 0;
    const registryChildren = registry.childComponents?.length || 0;
    if (Math.abs(figmaChildren - registryChildren) > 2) {
      differences.push({
        type: 'structure',
        figma: figmaChildren,
        existing: registryChildren,
        description: `Child count: Figma has ${figmaChildren}, existing has ${registryChildren}`
      });
    }

    // Type differences
    if (figma.type !== registry.type) {
      differences.push({
        type: 'componentType',
        figma: figma.type,
        existing: registry.type,
        description: `Type: Figma is ${figma.type}, existing is ${registry.type}`
      });
    }

    return differences;
  }

  /**
   * Get suggestion based on score
   */
  getSuggestion(score) {
    if (score >= MATCH_CONFIG.thresholds.EXACT_MATCH) {
      return 'use';
    } else if (score >= MATCH_CONFIG.thresholds.STRONG_MATCH) {
      return 'use-with-adjustments';
    } else if (score >= MATCH_CONFIG.thresholds.VARIANT_CANDIDATE) {
      return 'add-variant';
    } else {
      return 'create-new';
    }
  }

  /**
   * Get overall suggestion for a component
   */
  getOverallSuggestion(figma, bestMatch) {
    if (!bestMatch) {
      return {
        action: 'create-new',
        reason: 'No matching components found in codebase',
        confidence: 'high'
      };
    }

    const score = bestMatch.score;

    if (score >= MATCH_CONFIG.thresholds.EXACT_MATCH) {
      return {
        action: 'use',
        component: bestMatch.registryComponent.name,
        path: bestMatch.registryComponent.path,
        reason: `${score}% match - use existing component directly`,
        confidence: 'high'
      };
    }

    if (score >= MATCH_CONFIG.thresholds.STRONG_MATCH) {
      return {
        action: 'use-with-adjustments',
        component: bestMatch.registryComponent.name,
        path: bestMatch.registryComponent.path,
        differences: bestMatch.differences,
        reason: `${score}% match - use with minor adjustments`,
        confidence: 'medium'
      };
    }

    if (score >= MATCH_CONFIG.thresholds.VARIANT_CANDIDATE) {
      return {
        action: 'add-variant',
        component: bestMatch.registryComponent.name,
        path: bestMatch.registryComponent.path,
        differences: bestMatch.differences,
        reason: `${score}% match - consider adding as new variant`,
        confidence: 'medium',
        suggestedVariantName: this.suggestVariantName(figma, bestMatch.registryComponent)
      };
    }

    return {
      action: 'create-new',
      similarTo: bestMatch.registryComponent.name,
      reason: `Only ${score}% match - recommend creating new component`,
      confidence: 'high',
      suggestedName: this.suggestComponentName(figma)
    };
  }

  suggestVariantName(figma, registry) {
    const figmaWords = (figma.name || '').split(/[-_\s]/).filter(w => w.length > 2);
    const registryWords = (registry.name || '').split(/[-_\s]/).filter(w => w.length > 2);
    const uniqueWords = figmaWords.filter(w =>
      !registryWords.some(rw => rw.toLowerCase() === w.toLowerCase())
    );

    if (uniqueWords.length > 0) {
      return uniqueWords[0].toLowerCase();
    }

    return 'variant';
  }

  suggestComponentName(figma) {
    return (figma.name || 'Component')
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .split(/\s+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }
}

// ============================================================
// CLI
// ============================================================

async function main() {
  const [,, input, ...args] = process.argv;

  // Load registry — support both codebase registry and Figma multi-page registry
  const figmaRegistryIndex = args.indexOf('--figma-registry');
  let registry;

  if (figmaRegistryIndex !== -1) {
    // Use the Figma-sourced multi-page registry
    const figmaRegistryPath = path.join(WORKFLOW_DIR, 'state', 'figma-component-registry.json');
    if (!fs.existsSync(figmaRegistryPath)) {
      error('Figma component registry not found.');
      console.error('   Run the multi-page scan first.');
      process.exit(1);
    }
    const figmaRegistry = safeJsonParse(figmaRegistryPath, { components: [] });
    registry = { components: figmaRegistry.components.map(c => c.representative || c) };
  } else {
    // Default: use codebase component registry
    if (!fs.existsSync(REGISTRY_PATH)) {
      error('Component registry not found.');
      console.error('   Run "flow figma scan" first to build the registry.');
      process.exit(1);
    }
    registry = safeJsonParse(REGISTRY_PATH, { components: [] });
  }

  const matcher = new SimilarityMatcher(registry);

  // Parse threshold argument
  let threshold = MATCH_CONFIG.thresholds.VARIANT_CANDIDATE;
  const thresholdIndex = args.indexOf('--threshold');
  if (thresholdIndex !== -1 && args[thresholdIndex + 1]) {
    threshold = parseInt(args[thresholdIndex + 1]);
  }

  if (input === '--stdin') {
    // Read from stdin
    let data = '';
    process.stdin.setEncoding('utf8');

    for await (const chunk of process.stdin) {
      data += chunk;
    }

    const figmaData = safeJsonParseString(data, { components: [] });
    const components = figmaData.components || [figmaData];

    const results = matcher.matchAll(components);
    console.log(JSON.stringify(results, null, 2));

  } else if (input && fs.existsSync(input)) {
    // Match from file
    const figmaData = safeJsonParse(input, { components: [] });
    const components = figmaData.components || [figmaData];

    const results = matcher.matchAll(components);
    console.log(JSON.stringify(results, null, 2));

  } else {
    console.log(`
Wogi Flow - Component Similarity Matcher

Usage:
  flow figma match <figma-components.json>   Match against registry
  flow figma match --stdin                   Read from stdin
  flow figma match --threshold 80            Set match threshold

Thresholds:
  95%+ = Use directly (exact match)
  80-95% = Use with adjustments (strong match)
  60-80% = Consider as variant
  <60% = Create new component

Example:
  ./scripts/flow-figma-extract.js figma-data.json | ./scripts/flow-figma-match.js --stdin
    `);
  }
}

module.exports = { SimilarityMatcher, MATCH_CONFIG };

if (require.main === module) {
  main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
