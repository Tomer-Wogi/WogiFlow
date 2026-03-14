#!/usr/bin/env node

/**
 * Wogi Flow - Figma Component Registry (Multi-Page)
 *
 * Accumulates components discovered across multiple Figma pages.
 * Unlike the codebase registry (flow-figma-index.js), this registry
 * is built FROM Figma data — used for cross-page deduplication
 * before any code exists.
 *
 * Usage:
 *   Programmatic: const registry = new FigmaComponentRegistry();
 *   CLI: flow figma registry show | reset | stats
 */

const fs = require('node:fs');
const path = require('node:path');
const { getProjectRoot, readJson, writeJson } = require('./flow-utils');
const { SimilarityMatcher, MATCH_CONFIG } = require('./flow-figma-match');

const PROJECT_ROOT = getProjectRoot();
const REGISTRY_PATH = path.join(PROJECT_ROOT, '.workflow', 'state', 'figma-component-registry.json');

// ============================================================
// Registry Data Structure
// ============================================================

function createEmptyRegistry() {
  return {
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    lastUpdatedAt: null,
    fileKey: null,
    pagesProcessed: [],
    totalPagesProcessed: 0,

    components: [],
    // Each component: {
    //   id: string (registry-unique),
    //   canonicalName: string,
    //   type: 'atom' | 'molecule' | 'organism' | 'template',
    //   frequency: number (how many pages it appears on),
    //   sourceFrames: [{ pageId, pageName, frameId, frameName }],
    //   css: { colors, spacing, typography, radius, sizing, layout },
    //   structure: { childCount, depth, hasText, hasImage, hasIcon },
    //   figma: { componentId, isInstance, isComponent, variantProperties },
    //   variants: [{ name, description, sourceFrame }],
    //   states: {
    //     // dimension name -> { values: [...], sourceFrames: [...] }
    //   },
    //   children: [],
    //   textContent: string | null,
    //   representative: {} // the "best" extracted component data for code gen
    // }

    tokens: {
      colors: {},
      spacing: {},
      typography: {},
      radius: {}
    },

    // Layout templates (page-level patterns)
    layouts: []
    // Each layout: {
    //   id: string,
    //   name: string,
    //   frequency: number,
    //   pages: [{ pageId, pageName }],
    //   topLevelComponents: [componentId, ...],
    //   description: string
    // }
  };
}

// ============================================================
// Figma Component Registry
// ============================================================

class FigmaComponentRegistry {
  constructor(options = {}) {
    this.matchThreshold = options.matchThreshold || 85;
    this.stateThreshold = options.stateThreshold || 85;
    this.topComponentsLimit = options.topComponentsLimit || 15;
    this.registry = null;
    this._nextId = 1;
  }

  /**
   * Load existing registry or create new one
   */
  load() {
    if (fs.existsSync(REGISTRY_PATH)) {
      try {
        const loaded = readJson(REGISTRY_PATH, null);
        if (loaded && Array.isArray(loaded.components) && loaded.tokens) {
          this.registry = loaded;
          this._nextId = this.registry.components.length + 1;
          return this.registry;
        }
      } catch (err) {
        console.warn(`Warning: failed to load Figma registry: ${err.message}`);
      }
    }
    this.registry = createEmptyRegistry();
    return this.registry;
  }

  /**
   * Save registry to disk (atomic write)
   */
  save() {
    this.registry.lastUpdatedAt = new Date().toISOString();
    writeJson(REGISTRY_PATH, this.registry);
  }

  /**
   * Reset registry (start fresh)
   */
  reset(fileKey = null) {
    this.registry = createEmptyRegistry();
    this.registry.fileKey = fileKey;
    this._nextId = 1;
    this.save();
    return this.registry;
  }

  /**
   * Add components from a processed Figma page.
   * Returns classification of each component: 'new', 'existing', 'state', 'variant'
   *
   * @param {object} pageData - { pageId, pageName, components: [...], tokens: {...} }
   * @returns {object[]} classifications for each input component
   */
  addPage(pageData) {
    const { pageId, pageName, components, tokens } = pageData;

    // Track page
    if (!this.registry.pagesProcessed.find(p => p.pageId === pageId)) {
      this.registry.pagesProcessed.push({
        pageId,
        pageName,
        processedAt: new Date().toISOString(),
        componentCount: components.length
      });
      this.registry.totalPagesProcessed++;
    }

    // Merge tokens
    if (tokens) {
      this._mergeTokens(tokens);
    }

    // Classify each component
    const classifications = [];

    // Filter to meaningful components (skip low-level primitives)
    const meaningful = components.filter(c => this._isMeaningful(c));

    for (const component of meaningful) {
      const classification = this._classifyComponent(component, pageId, pageName);
      classifications.push(classification);
    }

    this.save();
    return classifications;
  }

  /**
   * Get the matcher for comparing against this registry
   */
  getMatcher() {
    return new SimilarityMatcher({
      components: this.registry.components.map(c => c.representative || c)
    });
  }

  /**
   * Find best match for a component in the registry
   */
  findMatch(component) {
    if (this.registry.components.length === 0) return null;

    const matcher = this.getMatcher();
    const result = matcher.matchComponent(component);

    if (result.bestMatch && result.bestMatch.score >= this.matchThreshold) {
      return {
        registryEntry: this.registry.components.find(
          c => (c.representative || c).name === result.bestMatch.registryComponent.name
        ),
        score: result.bestMatch.score,
        differences: result.bestMatch.differences,
        breakdown: result.bestMatch.breakdown
      };
    }

    return null;
  }

  /**
   * Add a state dimension to an existing registry component.
   * Called by the state analyzer when it detects state variation.
   */
  addState(registryComponentId, stateDimension, stateValue, sourceFrame) {
    const entry = this.registry.components.find(c => c.id === registryComponentId);
    if (!entry) return false;
    if (!sourceFrame || typeof sourceFrame !== 'object' || !sourceFrame.pageId) return false;

    if (!entry.states) entry.states = {};

    if (!entry.states[stateDimension]) {
      entry.states[stateDimension] = {
        values: [],
        sourceFrames: []
      };
    }

    const dim = entry.states[stateDimension];
    if (!dim.values.includes(stateValue)) {
      dim.values.push(stateValue);
      dim.sourceFrames.push(sourceFrame);
    }

    return true;
  }

  /**
   * Get architecture summary for output
   */
  getArchitectureSummary() {
    const components = this.registry.components;

    const atoms = components.filter(c => c.type === 'atom');
    const molecules = components.filter(c => c.type === 'molecule');
    const organisms = components.filter(c => c.type === 'organism');
    const templates = components.filter(c => c.type === 'template');

    const withStates = components.filter(c => c.states && Object.keys(c.states).length > 0);
    const withVariants = components.filter(c => c.variants && c.variants.length > 0);

    // Sort by frequency (most common first)
    const byFrequency = [...components].sort((a, b) => b.frequency - a.frequency);

    return {
      summary: {
        totalComponents: components.length,
        pagesProcessed: this.registry.totalPagesProcessed,
        atoms: atoms.length,
        molecules: molecules.length,
        organisms: organisms.length,
        templates: templates.length,
        componentsWithStates: withStates.length,
        componentsWithVariants: withVariants.length,
        totalTokens: {
          colors: Object.keys(this.registry.tokens.colors).length,
          spacing: Object.keys(this.registry.tokens.spacing).length,
          typography: Object.keys(this.registry.tokens.typography).length,
          radius: Object.keys(this.registry.tokens.radius).length
        }
      },

      layouts: this.registry.layouts,

      mostCommon: byFrequency.slice(0, this.topComponentsLimit).map(c => ({
        name: c.canonicalName,
        type: c.type,
        frequency: c.frequency,
        states: c.states ? Object.keys(c.states) : [],
        variants: (c.variants || []).map(v => v.name)
      })),

      pageSpecific: components.filter(c => c.frequency === 1).map(c => ({
        name: c.canonicalName,
        type: c.type,
        page: c.sourceFrames[0]?.pageName
      })),

      componentTree: {
        atoms: atoms.map(c => this._summarizeComponent(c)),
        molecules: molecules.map(c => this._summarizeComponent(c)),
        organisms: organisms.map(c => this._summarizeComponent(c)),
        templates: templates.map(c => this._summarizeComponent(c))
      },

      tokens: this.registry.tokens
    };
  }

  // ============================================================
  // Internal Methods
  // ============================================================

  _classifyComponent(component, pageId, pageName) {
    const sourceFrame = {
      pageId,
      pageName,
      frameId: component.id,
      frameName: component.name
    };

    // Try to find a match in existing registry
    const match = this.findMatch(component);

    if (!match) {
      // New component — add to registry
      const entry = this._createRegistryEntry(component, sourceFrame);
      this.registry.components.push(entry);

      return {
        component: component.name,
        classification: 'new',
        registryId: entry.id,
        registryName: entry.canonicalName
      };
    }

    const entry = match.registryEntry;

    // Increment frequency and add source frame
    entry.frequency++;
    if (!entry.sourceFrames.find(f => f.frameId === component.id)) {
      entry.sourceFrames.push(sourceFrame);
    }

    return {
      component: component.name,
      classification: 'existing',
      registryId: entry.id,
      registryName: entry.canonicalName,
      score: match.score,
      differences: match.differences
    };
  }

  _createRegistryEntry(component, sourceFrame) {
    const id = `figma-comp-${this._nextId++}`;

    return {
      id,
      canonicalName: this._canonicalizeName(component.name),
      type: component.type || 'unknown',
      frequency: 1,
      sourceFrames: [sourceFrame],
      css: component.css || {},
      structure: component.structure || {},
      figma: component.figma || {},
      variants: [],
      states: {},
      children: component.children || [],
      textContent: component.textContent || null,
      representative: component // store full extracted data for matching
    };
  }

  _canonicalizeName(name) {
    // Remove Figma naming patterns: "Component/Variant", "Component - State"
    return (name || 'Unnamed')
      .split('/').pop()
      .split(' - ')[0]
      .split(' / ')[0]
      .trim();
  }

  _isMeaningful(component) {
    // Skip very low-level nodes that are just layout wrappers
    if (!component.name) return false;

    // Skip unnamed frames with no distinguishing features
    if (component.name.match(/^(Frame|Group|Rectangle|Vector|Ellipse|Line)\s*\d*$/i)) {
      return false;
    }

    // Skip atoms that are just single text or vector nodes (too granular)
    if (component.figmaType === 'TEXT' && !component.figma?.isComponent) {
      return false;
    }
    if (component.figmaType === 'VECTOR' && !component.figma?.isComponent) {
      return false;
    }

    // Keep: COMPONENT, INSTANCE, COMPONENT_SET, named frames with children
    if (component.figma?.isComponent || component.figma?.isInstance) {
      return true;
    }

    // Keep named frames with meaningful structure
    if ((component.figmaType === 'FRAME' || component.figmaType === 'SECTION') &&
        (component.structure?.childCount || 0) >= 1) {
      return true;
    }

    return false;
  }

  _mergeTokens(tokens) {
    for (const category of ['colors', 'spacing', 'typography', 'radius']) {
      if (tokens[category]) {
        Object.assign(this.registry.tokens[category], tokens[category]);
      }
    }
  }

  _summarizeComponent(c) {
    return {
      id: c.id,
      name: c.canonicalName,
      frequency: c.frequency,
      states: c.states ? Object.entries(c.states).map(([dim, data]) => ({
        dimension: dim,
        values: data.values
      })) : [],
      variants: (c.variants || []).map(v => v.name),
      childCount: c.structure?.childCount || 0
    };
  }
}

// ============================================================
// CLI
// ============================================================

async function main() {
  const [,, command] = process.argv;
  const registry = new FigmaComponentRegistry();
  registry.load();

  switch (command) {
    case 'show': {
      const summary = registry.getArchitectureSummary();
      console.log(JSON.stringify(summary, null, 2));
      break;
    }

    case 'reset': {
      registry.reset();
      console.log('Registry reset.');
      break;
    }

    case 'stats': {
      const r = registry.registry;
      console.log(`\nFigma Component Registry`);
      console.log(`${'='.repeat(40)}`);
      console.log(`Pages processed: ${r.totalPagesProcessed}`);
      console.log(`Components:      ${r.components.length}`);
      console.log(`  Atoms:         ${r.components.filter(c => c.type === 'atom').length}`);
      console.log(`  Molecules:     ${r.components.filter(c => c.type === 'molecule').length}`);
      console.log(`  Organisms:     ${r.components.filter(c => c.type === 'organism').length}`);
      console.log(`  Templates:     ${r.components.filter(c => c.type === 'template').length}`);
      console.log(`With states:     ${r.components.filter(c => c.states && Object.keys(c.states).length > 0).length}`);
      console.log(`Layouts:         ${r.layouts.length}`);
      console.log(`Tokens:          ${Object.keys(r.tokens.colors).length} colors, ${Object.keys(r.tokens.spacing).length} spacing`);
      break;
    }

    default:
      console.log(`
Wogi Flow - Figma Component Registry (Multi-Page)

Commands:
  show     Output architecture summary as JSON
  reset    Clear registry and start fresh
  stats    Show registry statistics

Usage:
  ./scripts/flow-figma-registry.js show
  ./scripts/flow-figma-registry.js stats
      `);
  }
}

module.exports = { FigmaComponentRegistry, REGISTRY_PATH, createEmptyRegistry };

if (require.main === module) {
  main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
