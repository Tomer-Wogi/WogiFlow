#!/usr/bin/env node

/**
 * Wogi Flow - Figma State Analyzer
 *
 * Analyzes structurally similar Figma frames to detect state variations.
 * When two frames are 85%+ similar, this module diffs them to determine:
 * - Tab/navigation state changes
 * - Section visibility toggles (form open/closed)
 * - Content swaps (loading/error/empty/loaded)
 * - Visual style changes (variant, not state)
 *
 * Uses structural diffing and AI-ready classification.
 * Confidence gating: high (auto), medium (inform), low (ask user).
 */

// ============================================================
// Diff Categories
// ============================================================

const DIFF_CATEGORIES = {
  TAB_CHANGE: {
    name: 'tab-change',
    stateDimension: 'activeTab',
    description: 'A tab or navigation item changed highlight/selection',
    confidenceBoost: 15
  },
  SECTION_TOGGLE: {
    name: 'section-toggle',
    stateDimension: 'sectionVisible',
    description: 'A section appeared or disappeared (expand/collapse)',
    confidenceBoost: 10
  },
  CONTENT_SWAP: {
    name: 'content-swap',
    stateDimension: 'contentState',
    description: 'Content area changed (loading/error/empty/data)',
    confidenceBoost: 5
  },
  VISUAL_ONLY: {
    name: 'visual-only',
    stateDimension: null,
    description: 'Only visual styling differs — likely a variant, not state',
    confidenceBoost: 0
  },
  LAYOUT_SAME_CONTENT_DIFFERENT: {
    name: 'layout-same-content-different',
    stateDimension: null,
    description: 'Same layout shell but completely different content — likely different pages using same layout',
    confidenceBoost: 0
  }
};

// ============================================================
// State Analyzer
// ============================================================

class FigmaStateAnalyzer {
  constructor(options = {}) {
    this.stateThreshold = options.stateThreshold || 85;
    this.highConfidence = options.highConfidence || 95;
    this.mediumConfidence = options.mediumConfidence || 70;
  }

  /**
   * Analyze two similar components and determine their relationship.
   *
   * @param {object} existing - The component already in the registry
   * @param {object} candidate - The new component being compared
   * @param {number} similarityScore - Pre-computed similarity score (0-100)
   * @returns {object} Analysis result with classification and confidence
   */
  analyze(existing, candidate, similarityScore) {
    if (similarityScore < this.stateThreshold) {
      return {
        relationship: 'different-component',
        confidence: 100,
        confidenceTier: 'high',
        reason: `Similarity ${similarityScore}% below state threshold ${this.stateThreshold}%`
      };
    }

    // Compute structural diff
    const diff = this._computeDiff(existing, candidate);

    // Classify the diff
    const classification = this._classifyDiff(diff, existing, candidate);

    // Compute confidence
    const confidence = this._computeConfidence(classification, diff, similarityScore);
    const confidenceTier = confidence >= this.highConfidence ? 'high'
      : confidence >= this.mediumConfidence ? 'medium' : 'low';

    return {
      relationship: classification.relationship,
      confidence,
      confidenceTier,
      category: classification.category,
      stateDimension: classification.stateDimension,
      stateValue: classification.stateValue,
      diff: {
        addedNodes: diff.addedNodes.length,
        removedNodes: diff.removedNodes.length,
        changedNodes: diff.changedNodes.length,
        cssChanges: diff.cssChanges.length,
        structuralChanges: diff.structuralChanges.length
      },
      reason: classification.reason,
      userPrompt: confidenceTier === 'low' ? this._generateUserPrompt(existing, candidate, classification, diff) : null,
      userInfo: confidenceTier === 'medium' ? this._generateUserInfo(existing, candidate, classification) : null
    };
  }

  /**
   * Analyze multiple candidates against one existing component.
   * Groups related state frames together.
   */
  analyzeGroup(existing, candidates, scores) {
    const analyses = candidates.map((candidate, i) => ({
      candidate,
      analysis: this.analyze(existing, candidate, scores[i])
    }));

    // Group by detected state dimension
    const stateGroups = {};
    for (const { candidate, analysis } of analyses) {
      if (analysis.relationship === 'state-variation' && analysis.stateDimension) {
        if (!stateGroups[analysis.stateDimension]) {
          stateGroups[analysis.stateDimension] = {
            dimension: analysis.stateDimension,
            values: [],
            frames: []
          };
        }
        stateGroups[analysis.stateDimension].values.push(analysis.stateValue);
        stateGroups[analysis.stateDimension].frames.push(candidate);
      }
    }

    return {
      analyses,
      stateGroups,
      stateDimensions: Object.keys(stateGroups)
    };
  }

  // ============================================================
  // Diff Engine
  // ============================================================

  _computeDiff(existing, candidate) {
    const diff = {
      addedNodes: [],
      removedNodes: [],
      changedNodes: [],
      cssChanges: [],
      structuralChanges: []
    };

    // Compare children count
    const existingChildren = existing.structure?.childCount || existing.children?.length || 0;
    const candidateChildren = candidate.structure?.childCount || candidate.children?.length || 0;

    if (existingChildren !== candidateChildren) {
      diff.structuralChanges.push({
        type: 'child-count',
        existing: existingChildren,
        candidate: candidateChildren,
        delta: candidateChildren - existingChildren
      });
    }

    // Compare CSS properties
    this._diffCSS(existing.css, candidate.css, diff);

    // Compare text content
    if (existing.textContent !== candidate.textContent) {
      diff.changedNodes.push({
        type: 'text-content',
        existing: existing.textContent,
        candidate: candidate.textContent
      });
    }

    // Check for section additions/removals based on child count delta
    if (candidateChildren > existingChildren) {
      diff.addedNodes.push({
        type: 'section',
        count: candidateChildren - existingChildren,
        description: `${candidateChildren - existingChildren} new child section(s) appeared`
      });
    } else if (existingChildren > candidateChildren) {
      diff.removedNodes.push({
        type: 'section',
        count: existingChildren - candidateChildren,
        description: `${existingChildren - candidateChildren} child section(s) disappeared`
      });
    }

    // Compare layout
    this._diffLayout(existing.css?.layout, candidate.css?.layout, diff);

    return diff;
  }

  _diffCSS(existingCSS, candidateCSS, diff) {
    if (!existingCSS || !candidateCSS) return;

    const categories = ['colors', 'spacing', 'typography', 'radius', 'sizing'];

    for (const category of categories) {
      const eProp = existingCSS[category] || [];
      const cProp = candidateCSS[category] || [];

      // Simple length comparison for now
      if (eProp.length !== cProp.length) {
        diff.cssChanges.push({
          category,
          type: 'count-diff',
          existing: eProp.length,
          candidate: cProp.length
        });
      }

      // Value comparison
      for (let i = 0; i < Math.min(eProp.length, cProp.length); i++) {
        const eVal = this._cssValue(eProp[i]);
        const cVal = this._cssValue(cProp[i]);

        if (eVal !== cVal) {
          diff.cssChanges.push({
            category,
            type: 'value-diff',
            property: eProp[i].property,
            existing: eVal,
            candidate: cVal
          });
        }
      }
    }
  }

  _diffLayout(existingLayout, candidateLayout, diff) {
    if (!existingLayout || !candidateLayout) return;

    const eMap = new Map(existingLayout.map(l => [l.property, l.value]));
    const cMap = new Map(candidateLayout.map(l => [l.property, l.value]));

    for (const [prop, val] of cMap) {
      if (!eMap.has(prop)) {
        diff.structuralChanges.push({ type: 'layout-added', property: prop, value: val });
      } else if (eMap.get(prop) !== val) {
        diff.structuralChanges.push({
          type: 'layout-changed',
          property: prop,
          existing: eMap.get(prop),
          candidate: val
        });
      }
    }
  }

  _cssValue(prop) {
    if (!prop) return '';
    if (typeof prop.value === 'object') return prop.shorthand || JSON.stringify(prop.value);
    return String(prop.value);
  }

  // ============================================================
  // Classification
  // ============================================================

  _classifyDiff(diff, existing, candidate) {
    // Heuristic 1: Section appeared/disappeared → section toggle
    if (diff.addedNodes.length > 0 || diff.removedNodes.length > 0) {
      const hasNewSection = diff.addedNodes.some(n => n.type === 'section');
      const hasRemovedSection = diff.removedNodes.some(n => n.type === 'section');

      if (hasNewSection || hasRemovedSection) {
        const sectionState = hasNewSection ? 'expanded' : 'collapsed';
        const dimensionName = this._inferToggleName(existing, candidate);

        return {
          relationship: 'state-variation',
          category: DIFF_CATEGORIES.SECTION_TOGGLE,
          stateDimension: dimensionName,
          stateValue: sectionState,
          reason: `Section ${sectionState}: ${diff.addedNodes.length || diff.removedNodes.length} section(s) ${hasNewSection ? 'appeared' : 'disappeared'}`
        };
      }
    }

    // Heuristic 2: Only CSS color changes on specific elements → tab change
    // Only classify as tab change if names suggest navigation context
    const onlyColorChanges = diff.cssChanges.length > 0 &&
      diff.cssChanges.every(c => c.category === 'colors') &&
      diff.structuralChanges.length === 0 &&
      diff.addedNodes.length === 0 &&
      diff.removedNodes.length === 0;

    if (onlyColorChanges && diff.cssChanges.length <= 5) {
      const eName = (existing.name || '').toLowerCase();
      const cName = (candidate.name || '').toLowerCase();
      const combinedNames = eName + ' ' + cName;
      const hasTabContext = /tab|nav|menu|sidebar|step|segment|pill/.test(combinedNames);

      if (hasTabContext) {
        const tabName = this._inferTabName(existing, candidate);
        return {
          relationship: 'state-variation',
          category: DIFF_CATEGORIES.TAB_CHANGE,
          stateDimension: 'activeTab',
          stateValue: tabName,
          reason: `Tab/selection change: ${diff.cssChanges.length} color changes, navigation context in name`
        };
      }

      // Color-only changes without tab context → visual variant
      return {
        relationship: 'variant',
        category: DIFF_CATEGORIES.VISUAL_ONLY,
        stateDimension: null,
        stateValue: null,
        reason: `Only color changes, no navigation context in names — likely visual variant`
      };
    }

    // Heuristic 3: Text content swap with same structure → content state
    const hasTextChange = diff.changedNodes.some(n => n.type === 'text-content');
    const noStructuralChange = diff.structuralChanges.length === 0 && diff.addedNodes.length === 0;

    if (hasTextChange && noStructuralChange) {
      const contentState = this._inferContentState(candidate);
      return {
        relationship: 'state-variation',
        category: DIFF_CATEGORIES.CONTENT_SWAP,
        stateDimension: 'contentState',
        stateValue: contentState,
        reason: `Content changed with same structure: likely loading/error/empty state`
      };
    }

    // Heuristic 4: Only CSS non-color changes → visual variant
    if (diff.cssChanges.length > 0 && diff.structuralChanges.length === 0 &&
        diff.addedNodes.length === 0 && diff.removedNodes.length === 0) {
      return {
        relationship: 'variant',
        category: DIFF_CATEGORIES.VISUAL_ONLY,
        stateDimension: null,
        stateValue: null,
        reason: `Only visual styling differs: ${diff.cssChanges.length} CSS changes`
      };
    }

    // Heuristic 5: Same outer structure, very different children → layout template
    if (diff.structuralChanges.length > 3 || diff.changedNodes.length > 5) {
      return {
        relationship: 'shared-layout',
        category: DIFF_CATEGORIES.LAYOUT_SAME_CONTENT_DIFFERENT,
        stateDimension: null,
        stateValue: null,
        reason: `Same shell, different content: likely shared layout with page-specific content`
      };
    }

    // Fallback: mixed changes, uncertain
    return {
      relationship: 'uncertain',
      category: null,
      stateDimension: null,
      stateValue: null,
      reason: `Mixed changes (${diff.cssChanges.length} CSS, ${diff.structuralChanges.length} structural, ${diff.addedNodes.length} added, ${diff.removedNodes.length} removed) — needs human judgment`
    };
  }

  // ============================================================
  // Inference Helpers
  // ============================================================

  _inferToggleName(existing, candidate) {
    // Try to extract from frame names
    const eName = (existing.name || '').toLowerCase();
    const cName = (candidate.name || '').toLowerCase();

    // Common patterns: "Panel_FormOpen", "Panel_Edit", "Panel_Expanded"
    const toggleKeywords = ['form', 'edit', 'expand', 'collapse', 'open', 'close', 'show', 'hide', 'detail', 'filter', 'search'];

    for (const keyword of toggleKeywords) {
      if (cName.includes(keyword) && !eName.includes(keyword)) {
        return `${keyword}Visible`;
      }
      if (eName.includes(keyword) && !cName.includes(keyword)) {
        return `${keyword}Visible`;
      }
    }

    return 'sectionExpanded';
  }

  _inferTabName(existing, candidate) {
    const cName = (candidate.name || '').toLowerCase();

    // Try to extract tab name from frame name
    // Patterns: "Panel_Overview", "Panel_Tab2", "Settings_General"
    const parts = cName.split(/[-_\s/]/);
    if (parts.length > 1) {
      return parts[parts.length - 1];
    }

    return cName;
  }

  _inferContentState(candidate) {
    const name = (candidate.name || '').toLowerCase();
    const text = (candidate.textContent || '').toLowerCase();

    if (name.includes('loading') || name.includes('spinner') || text.includes('loading')) return 'loading';
    if (name.includes('error') || name.includes('fail') || text.includes('error')) return 'error';
    if (name.includes('empty') || name.includes('no data') || text.includes('no ')) return 'empty';
    if (name.includes('success') || text.includes('success')) return 'success';

    return 'alternate';
  }

  // ============================================================
  // Confidence
  // ============================================================

  _computeConfidence(classification, diff, similarityScore) {
    let confidence = similarityScore;

    // Boost for clear category match
    if (classification.category?.confidenceBoost) {
      confidence = Math.min(100, confidence + classification.category.confidenceBoost);
    }

    // Penalize for mixed/complex diffs
    const totalChanges = diff.cssChanges.length + diff.structuralChanges.length +
      diff.addedNodes.length + diff.removedNodes.length;

    if (totalChanges > 10) {
      confidence -= 15;
    } else if (totalChanges > 5) {
      confidence -= 8;
    }

    // Penalize uncertain classification
    if (classification.relationship === 'uncertain') {
      confidence -= 20;
    }

    return Math.max(0, Math.min(100, Math.round(confidence)));
  }

  // ============================================================
  // User Communication
  // ============================================================

  _generateUserPrompt(existing, candidate, classification, diff) {
    const eName = existing.name || 'Unnamed';
    const cName = candidate.name || 'Unnamed';

    const diffSummary = [];
    if (diff.addedNodes.length > 0) {
      diffSummary.push(`${diff.addedNodes.length} section(s) appeared`);
    }
    if (diff.removedNodes.length > 0) {
      diffSummary.push(`${diff.removedNodes.length} section(s) disappeared`);
    }
    if (diff.cssChanges.length > 0) {
      diffSummary.push(`${diff.cssChanges.length} CSS property changes`);
    }
    if (diff.structuralChanges.length > 0) {
      diffSummary.push(`${diff.structuralChanges.length} structural changes`);
    }

    return {
      message: `I found two similar frames that I'm not sure about:\n\n` +
        `Frame A: "${eName}"\n` +
        `Frame B: "${cName}"\n\n` +
        `Differences: ${diffSummary.join(', ')}\n\n` +
        `${classification.reason}`,
      options: [
        { key: 'state', label: 'Same component with different state', description: 'These frames show the same component in different states (e.g., form open/closed, tab selected)' },
        { key: 'variant', label: 'Same component, different visual variant', description: 'Same component but styled differently (e.g., dark/light, compact/full)' },
        { key: 'different', label: 'Different components', description: 'These are unrelated components that happen to look similar' },
        { key: 'layout', label: 'Same layout, different page content', description: 'They share a layout template but the page content is different' },
        { key: 'context', label: 'Show me more context', description: 'I need to see more detail before deciding' }
      ]
    };
  }

  _generateUserInfo(existing, candidate, classification) {
    return `Auto-classified "${candidate.name}" as ${classification.relationship} of "${existing.name}" ` +
      `(${classification.stateDimension ? `state: ${classification.stateDimension}=${classification.stateValue}` : classification.reason}). ` +
      `Override? [y/N]`;
  }
}

module.exports = { FigmaStateAnalyzer, DIFF_CATEGORIES };

if (require.main === module) {
  console.log(`
Wogi Flow - Figma State Analyzer

This module is used programmatically by the multi-page orchestrator.
It analyzes structurally similar Figma frames to detect state variations.

Diff categories:
  tab-change            Tab/navigation selection changed
  section-toggle        Section expanded/collapsed
  content-swap          Content replaced (loading/error/empty)
  visual-only           Only CSS styling differs (variant)
  layout-same-content   Same shell, different content (layout template)

Confidence tiers:
  high (95%+)     Auto-classify
  medium (70-95%) Classify + inform user
  low (<70%)      Ask user to decide
  `);
}
