#!/usr/bin/env node

/**
 * Wogi Flow - Multi-Page Figma Orchestrator
 *
 * Processes all pages from a Figma file incrementally:
 * 1. Fetch page list via Figma MCP (get_metadata on root)
 * 2. Process each page: extract components, match against growing registry
 * 3. Detect state variations using structural diffing
 * 4. Output architecture summary when done
 *
 * This script is designed to be called by Claude Code during a
 * /wogi-start task. It orchestrates the flow but relies on the AI
 * to make Figma MCP calls and handle user prompts.
 *
 * Usage:
 *   Programmatic: const orchestrator = new FigmaOrchestrator(fileKey);
 *   CLI: flow figma orchestrate <fileKey> [options]
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot, writeJson, readJson } = require('./flow-utils');
const { FigmaExtractor } = require('./flow-figma-extract');
const { FigmaComponentRegistry } = require('./flow-figma-registry');
const { FigmaStateAnalyzer } = require('./flow-figma-state-analyzer');

const PROJECT_ROOT = getProjectRoot();
const ORCHESTRATOR_STATE_PATH = path.join(PROJECT_ROOT, '.workflow', 'state', 'figma-orchestrator-state.json');

// ============================================================
// Orchestrator
// ============================================================

class FigmaOrchestrator {
  constructor(fileKey, options = {}) {
    this.fileKey = fileKey;
    this.options = {
      matchThreshold: options.matchThreshold || 85,
      stateThreshold: options.stateThreshold || 85,
      highConfidence: options.highConfidence || 95,
      mediumConfidence: options.mediumConfidence || 70,
      ...options
    };

    this.extractor = new FigmaExtractor();
    this.registry = new FigmaComponentRegistry({
      matchThreshold: this.options.matchThreshold,
      stateThreshold: this.options.stateThreshold
    });
    this.stateAnalyzer = new FigmaStateAnalyzer({
      stateThreshold: this.options.stateThreshold,
      highConfidence: this.options.highConfidence,
      mediumConfidence: this.options.mediumConfidence
    });

    // Load or create registry
    this.registry.load();
    if (!this.registry.registry.fileKey) {
      this.registry.registry.fileKey = fileKey;
    }

    // Pending user questions (accumulated during processing)
    this.pendingQuestions = [];

    // Progress tracking
    this.progress = {
      totalPages: 0,
      processedPages: 0,
      newComponents: 0,
      existingComponents: 0,
      stateVariations: 0,
      uncertainClassifications: 0
    };
  }

  /**
   * Process a single page's Figma data.
   * Called by the AI after fetching data via Figma MCP.
   *
   * @param {object} pageInfo - { pageId, pageName }
   * @param {object|string} figmaData - Raw Figma MCP response for this page
   * @returns {object} Page processing result
   */
  processPage(pageInfo, figmaData) {
    const { pageId, pageName } = pageInfo;

    // Step 1: Extract components from Figma data
    const extracted = this.extractor.parse(figmaData);

    if (!extracted.components || extracted.components.length === 0) {
      return {
        pageId,
        pageName,
        status: 'empty',
        message: 'No components found on this page',
        newComponents: 0,
        existingComponents: 0,
        stateVariations: 0
      };
    }

    // Step 2: Add to registry (handles basic matching)
    const classifications = this.registry.addPage({
      pageId,
      pageName,
      components: extracted.components,
      tokens: extracted.tokens
    });

    // Step 3: For "existing" matches, run state analysis
    const pageResult = {
      pageId,
      pageName,
      status: 'processed',
      totalExtracted: extracted.components.length,
      meaningful: classifications.length,
      newComponents: 0,
      existingComponents: 0,
      stateVariations: 0,
      variants: 0,
      classifications: []
    };

    for (const classification of classifications) {
      if (classification.classification === 'new') {
        pageResult.newComponents++;
        pageResult.classifications.push(classification);
        continue;
      }

      // This matched an existing component — run state analysis
      const registryEntry = this.registry.registry.components.find(
        c => c.id === classification.registryId
      );

      if (!registryEntry || !classification.differences || classification.differences.length === 0) {
        // Exact or near-exact match, no state analysis needed
        pageResult.existingComponents++;
        pageResult.classifications.push(classification);
        continue;
      }

      // Find the original extracted component for this classification
      const candidateComponent = extracted.components.find(
        c => c.name === classification.component
      );

      if (!candidateComponent) {
        pageResult.existingComponents++;
        pageResult.classifications.push(classification);
        continue;
      }

      // Run state analysis
      const stateResult = this.stateAnalyzer.analyze(
        registryEntry.representative || registryEntry,
        candidateComponent,
        classification.score
      );

      classification.stateAnalysis = stateResult;

      if (stateResult.relationship === 'state-variation') {
        pageResult.stateVariations++;

        // Auto-apply high-confidence state classifications
        if (stateResult.confidenceTier === 'high') {
          this.registry.addState(
            classification.registryId,
            stateResult.stateDimension,
            stateResult.stateValue,
            { pageId, pageName, frameId: candidateComponent.id, frameName: candidateComponent.name }
          );
          classification.stateApplied = true;
        } else if (stateResult.confidenceTier === 'medium') {
          // Apply but flag for user review
          this.registry.addState(
            classification.registryId,
            stateResult.stateDimension,
            stateResult.stateValue,
            { pageId, pageName, frameId: candidateComponent.id, frameName: candidateComponent.name }
          );
          classification.stateApplied = true;
          classification.userInfo = stateResult.userInfo;
        } else {
          // Low confidence — queue for user
          this.pendingQuestions.push({
            type: 'state-classification',
            registryId: classification.registryId,
            registryName: classification.registryName,
            candidateName: classification.component,
            pageId,
            pageName,
            prompt: stateResult.userPrompt,
            stateResult
          });
          classification.stateApplied = false;
          classification.pendingUserDecision = true;
        }
      } else if (stateResult.relationship === 'variant') {
        pageResult.variants++;
        // Add as variant to existing component
        const entry = this.registry.registry.components.find(c => c.id === classification.registryId);
        if (entry) {
          const variantName = this._inferVariantName(candidateComponent, entry);
          entry.variants.push({
            name: variantName,
            description: stateResult.reason,
            sourceFrame: { pageId, pageName, frameId: candidateComponent.id, frameName: candidateComponent.name }
          });
        }
      } else if (stateResult.relationship === 'shared-layout') {
        // Track as layout template
        this._trackLayout(registryEntry, pageId, pageName);
        pageResult.existingComponents++;
      } else {
        pageResult.existingComponents++;
      }

      pageResult.classifications.push(classification);
    }

    // Update progress
    this.progress.processedPages++;
    this.progress.newComponents += pageResult.newComponents;
    this.progress.existingComponents += pageResult.existingComponents;
    this.progress.stateVariations += pageResult.stateVariations;
    this.progress.uncertainClassifications += this.pendingQuestions.length;

    // Save registry after each page
    this.registry.save();
    this._saveState();

    return pageResult;
  }

  /**
   * Apply a user decision for a pending question.
   *
   * @param {number} questionIndex - Index in pendingQuestions
   * @param {string} decision - 'state' | 'variant' | 'different' | 'layout'
   * @param {object} [extra] - Optional extra data (e.g., custom state dimension name)
   */
  applyUserDecision(questionIndex, decision, extra = {}) {
    const question = this.pendingQuestions[questionIndex];
    if (!question) return false;

    const entry = this.registry.registry.components.find(c => c.id === question.registryId);
    if (!entry) return false;

    switch (decision) {
      case 'state': {
        const dimension = extra.stateDimension || question.stateResult.stateDimension || 'userDefined';
        const value = extra.stateValue || question.stateResult.stateValue || question.candidateName;
        this.registry.addState(question.registryId, dimension, value, {
          pageId: question.pageId,
          pageName: question.pageName,
          frameId: question.candidateName,
          frameName: question.candidateName
        });
        break;
      }

      case 'variant': {
        const variantName = extra.variantName || this._inferVariantNameFromQuestion(question);
        entry.variants.push({
          name: variantName,
          description: 'User classified as variant',
          sourceFrame: { pageId: question.pageId, pageName: question.pageName }
        });
        break;
      }

      case 'different': {
        // User says these are different components — the candidate should be its own entry
        // It was already classified as 'existing', so we need to split it out
        // For now, just mark the question as resolved
        break;
      }

      case 'layout': {
        this._trackLayout(entry, question.pageId, question.pageName);
        break;
      }
    }

    // Remove from pending
    this.pendingQuestions.splice(questionIndex, 1);
    this.registry.save();
    this._saveState();

    return true;
  }

  /**
   * Get pending user questions
   */
  getPendingQuestions() {
    return this.pendingQuestions.map((q, i) => ({
      index: i,
      registryName: q.registryName,
      candidateName: q.candidateName,
      pageName: q.pageName,
      prompt: q.prompt
    }));
  }

  /**
   * Get current progress
   */
  getProgress() {
    return {
      ...this.progress,
      registrySize: this.registry.registry.components.length,
      pendingQuestions: this.pendingQuestions.length,
      pagesRemaining: this.progress.totalPages - this.progress.processedPages
    };
  }

  /**
   * Get architecture summary (call after all pages processed)
   */
  getArchitectureSummary() {
    return this.registry.getArchitectureSummary();
  }

  /**
   * Generate the instruction set for the AI to execute this workflow.
   * Returns step-by-step instructions for Claude Code to follow.
   */
  static generateWorkflowInstructions(fileKey) {
    return `
## Multi-Page Figma Analysis Workflow

### Setup
\`\`\`javascript
const { FigmaOrchestrator } = require('./scripts/flow-figma-orchestrator');
const orchestrator = new FigmaOrchestrator('${fileKey}');
\`\`\`

### Step 1: Get all pages
Call Figma MCP: \`get_metadata(nodeId="0:1", fileKey="${fileKey}")\`
Parse the response to get page IDs and names.

### Step 2: Process each page
For each page:
1. Call \`get_design_context(nodeId=pageNodeId, fileKey="${fileKey}")\`
2. Pass the response to \`orchestrator.processPage({ pageId, pageName }, figmaData)\`
3. Report progress: "Page X/Y: N new, M existing, K states detected"
4. If there are pending questions, present them to the user

### Step 3: Handle user questions
For each pending question:
1. Present the prompt from \`orchestrator.getPendingQuestions()\`
2. Get user's choice
3. Call \`orchestrator.applyUserDecision(index, decision)\`

### Step 4: Architecture summary
Call \`orchestrator.getArchitectureSummary()\` and present:
- Component tree (atoms/molecules/organisms)
- State maps for stateful components
- Layout templates
- Design tokens
- Page-specific components

### Step 5: Ready for code generation
The registry is saved at \`.workflow/state/figma-component-registry.json\`
Use existing \`flow-figma-generate.js\` pipeline with this registry as input.
`;
  }

  // ============================================================
  // Internal Helpers
  // ============================================================

  _inferVariantName(component, entry) {
    const cName = (component.name || '').toLowerCase();
    const eName = (entry.canonicalName || '').toLowerCase();

    // Find unique words in candidate name
    const cWords = cName.split(/[-_\s/]/).filter(w => w.length > 2);
    const eWords = eName.split(/[-_\s/]/).filter(w => w.length > 2);
    const unique = cWords.filter(w => !eWords.some(ew => ew === w));

    if (unique.length > 0) return unique[0];
    return 'variant-' + (entry.variants.length + 1);
  }

  _inferVariantNameFromQuestion(question) {
    const parts = (question.candidateName || '').split(/[-_\s/]/);
    if (parts.length > 1) return parts[parts.length - 1].toLowerCase();
    return 'variant';
  }

  _trackLayout(entry, pageId, pageName) {
    const existing = this.registry.registry.layouts.find(l => l.name === entry.canonicalName);
    if (existing) {
      existing.frequency++;
      if (!existing.pages.find(p => p.pageId === pageId)) {
        existing.pages.push({ pageId, pageName });
      }
    } else {
      this.registry.registry.layouts.push({
        id: `layout-${this.registry.registry.layouts.length + 1}`,
        name: entry.canonicalName,
        frequency: 1,
        pages: [{ pageId, pageName }],
        topLevelComponents: entry.children || [],
        description: `Layout template based on ${entry.canonicalName}`
      });
    }
  }

  _saveState() {
    writeJson(ORCHESTRATOR_STATE_PATH, {
      fileKey: this.fileKey,
      progress: this.progress,
      pendingQuestions: this.pendingQuestions.length,
      savedAt: new Date().toISOString()
    });
  }

  /**
   * Resume from saved state
   */
  static loadState() {
    if (fs.existsSync(ORCHESTRATOR_STATE_PATH)) {
      const state = readJson(ORCHESTRATOR_STATE_PATH, null);
      if (state && state.progress && typeof state.pendingQuestions === 'number') {
        return state;
      }
    }
    return null;
  }
}

// ============================================================
// CLI
// ============================================================

async function main() {
  const [,, command, ...args] = process.argv;

  switch (command) {
    case 'instructions': {
      const fileKey = args[0];
      if (!fileKey) {
        console.error('Usage: flow figma orchestrate instructions <fileKey>');
        process.exit(1);
      }
      console.log(FigmaOrchestrator.generateWorkflowInstructions(fileKey));
      break;
    }

    case 'progress': {
      const state = FigmaOrchestrator.loadState();
      if (state) {
        console.log('\nOrchestrator Progress:');
        console.log(JSON.stringify(state, null, 2));
      } else {
        console.log('No orchestrator state found. Start a scan first.');
      }
      break;
    }

    case 'summary': {
      const registry = new FigmaComponentRegistry();
      registry.load();
      const summary = registry.getArchitectureSummary();
      console.log(JSON.stringify(summary, null, 2));
      break;
    }

    case 'reset': {
      const registry = new FigmaComponentRegistry();
      registry.reset(args[0] || null);
      try { fs.unlinkSync(ORCHESTRATOR_STATE_PATH); } catch (err) {
        if (err.code !== 'ENOENT') console.warn(`Warning: could not delete state file: ${err.message}`);
      }
      console.log('Orchestrator state and registry reset.');
      break;
    }

    default:
      console.log(`
Wogi Flow - Multi-Page Figma Orchestrator

Commands:
  instructions <fileKey>   Generate AI workflow instructions
  progress                 Show current scan progress
  summary                  Show architecture summary
  reset [fileKey]          Reset all state and start fresh

Usage:
  ./scripts/flow-figma-orchestrator.js instructions abc123
  ./scripts/flow-figma-orchestrator.js progress
  ./scripts/flow-figma-orchestrator.js summary

This orchestrator is designed to be driven by Claude Code:
1. AI calls get_metadata to enumerate pages
2. AI calls get_design_context per page
3. AI passes data to orchestrator.processPage()
4. AI presents user questions from orchestrator
5. AI outputs architecture summary when done
      `);
  }
}

module.exports = { FigmaOrchestrator };

if (require.main === module) {
  main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
