#!/usr/bin/env node

/**
 * Wogi Flow - Figma Pipeline Orchestrator
 *
 * Coordinates the full Figma-to-code pipeline:
 * 1. Extract - Parse Figma MCP output for atomic components
 * 2. Match - Compare against codebase registry for reuse
 * 3. Confirm - Interactive user confirmation of matches
 * 4. Generate - Create code for new/modified components
 *
 * Usage:
 *   flow figma pipeline <figma-data.json>   # Run full pipeline
 *   flow figma pipeline --step extract      # Run specific step
 *   flow figma pipeline --auto              # Non-interactive mode
 */

const path = require('path');
const { FigmaExtractor, extractFromFile } = require('./flow-figma-extract');
const { ComponentMatcher, matchFromExtracted } = require('./flow-figma-match');
const { ConfirmationFlow, confirmMatches } = require('./flow-figma-confirm');
const { CodeGenerator, generateFromDecisions } = require('./flow-figma-generate');
const { getProjectRoot, readJson, writeJson, color } = require('./flow-utils');
const { readJson: safeReadJson } = require('./flow-file-ops');

const PROJECT_ROOT = getProjectRoot();
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const PIPELINE_STATE_PATH = path.join(WORKFLOW_DIR, 'state', 'figma-pipeline.json');

// ============================================================
// Pipeline State Management
// ============================================================

/**
 * Load pipeline state from disk
 */
function loadPipelineState() {
  return safeReadJson(PIPELINE_STATE_PATH, {
    lastRun: null,
    currentStep: null,
    extractedComponents: [],
    matchResults: [],
    decisions: [],
    generatedFiles: []
  });
}

/**
 * Save pipeline state to disk
 */
function savePipelineState(state) {
  state.updatedAt = new Date().toISOString();
  writeJson(PIPELINE_STATE_PATH, state);
}

// ============================================================
// Pipeline Orchestrator
// ============================================================

class FigmaPipeline {
  constructor(options = {}) {
    this.options = {
      interactive: options.interactive !== false,
      threshold: options.threshold || 80,
      outputDir: options.outputDir || path.join(PROJECT_ROOT, 'src', 'components'),
      verbose: options.verbose || false,
      ...options
    };
    this.state = loadPipelineState();
  }

  /**
   * Run the extract step
   */
  async extract(figmaData) {
    if (this.options.verbose) console.log(color('blue', '📦 Step 1: Extracting components from Figma data...'));

    const extractor = new FigmaExtractor();
    const extracted = typeof figmaData === 'string'
      ? extractFromFile(figmaData)
      : extractor.extract(figmaData);

    this.state.extractedComponents = extracted.components || [];
    this.state.tokens = extracted.tokens || {};
    this.state.currentStep = 'extract';
    savePipelineState(this.state);

    if (this.options.verbose) {
      console.log(`  ✓ Extracted ${this.state.extractedComponents.length} components`);
      console.log(`  ✓ Found ${Object.keys(this.state.tokens).length} design token categories`);
    }

    return extracted;
  }

  /**
   * Run the match step
   */
  async match(components = null) {
    if (this.options.verbose) console.log(color('blue', '🔍 Step 2: Matching against codebase registry...'));

    const toMatch = components || this.state.extractedComponents;
    if (!toMatch || toMatch.length === 0) {
      throw new Error('No components to match. Run extract step first.');
    }

    const matcher = new ComponentMatcher({ threshold: this.options.threshold });
    const matches = matchFromExtracted(toMatch);

    this.state.matchResults = matches;
    this.state.currentStep = 'match';
    savePipelineState(this.state);

    if (this.options.verbose) {
      const exact = matches.filter(m => m.matchType === 'exact').length;
      const partial = matches.filter(m => m.matchType === 'partial').length;
      const create = matches.filter(m => m.matchType === 'create').length;
      console.log(`  ✓ Exact matches: ${exact}`);
      console.log(`  ✓ Partial matches: ${partial}`);
      console.log(`  ✓ New components: ${create}`);
    }

    return matches;
  }

  /**
   * Run the confirm step (interactive)
   */
  async confirm(matches = null) {
    if (this.options.verbose) console.log(color('blue', '✅ Step 3: Confirming component decisions...'));

    const toConfirm = matches || this.state.matchResults;
    if (!toConfirm || toConfirm.length === 0) {
      throw new Error('No match results to confirm. Run match step first.');
    }

    let decisions;
    if (this.options.interactive) {
      decisions = await confirmMatches(toConfirm);
    } else {
      // Auto-confirm: use best match for exact/partial, create for new
      decisions = toConfirm.map(m => ({
        component: m.component,
        action: m.matchType === 'create' ? 'create' : 'use',
        match: m.bestMatch,
        confirmed: true
      }));
    }

    this.state.decisions = decisions;
    this.state.currentStep = 'confirm';
    savePipelineState(this.state);

    if (this.options.verbose) {
      const useExisting = decisions.filter(d => d.action === 'use').length;
      const createNew = decisions.filter(d => d.action === 'create').length;
      console.log(`  ✓ Using existing: ${useExisting}`);
      console.log(`  ✓ Creating new: ${createNew}`);
    }

    return decisions;
  }

  /**
   * Run the generate step
   */
  async generate(decisions = null) {
    if (this.options.verbose) console.log(color('blue', '🛠️ Step 4: Generating code...'));

    const toGenerate = decisions || this.state.decisions;
    if (!toGenerate || toGenerate.length === 0) {
      throw new Error('No decisions to generate from. Run confirm step first.');
    }

    const generator = new CodeGenerator({
      outputDir: this.options.outputDir,
      tokens: this.state.tokens
    });

    const generated = await generateFromDecisions(toGenerate, {
      outputDir: this.options.outputDir
    });

    this.state.generatedFiles = generated.files || [];
    this.state.currentStep = 'complete';
    this.state.lastRun = new Date().toISOString();
    savePipelineState(this.state);

    if (this.options.verbose) {
      console.log(`  ✓ Generated ${this.state.generatedFiles.length} files`);
      this.state.generatedFiles.forEach(f => console.log(`    - ${f}`));
    }

    return generated;
  }

  /**
   * Run the full pipeline
   */
  async runFull(figmaData) {
    console.log(color('cyan', '═'.repeat(50)));
    console.log(color('cyan', '  Figma-to-Code Pipeline'));
    console.log(color('cyan', '═'.repeat(50)));
    console.log();

    try {
      const extracted = await this.extract(figmaData);
      const matches = await this.match();
      const decisions = await this.confirm();
      const generated = await this.generate();

      console.log();
      console.log(color('green', '✓ Pipeline complete!'));
      console.log(`  Components processed: ${extracted.components?.length || 0}`);
      console.log(`  Files generated: ${generated.files?.length || 0}`);

      return {
        success: true,
        extracted,
        matches,
        decisions,
        generated
      };
    } catch (err) {
      console.error(color('red', `✗ Pipeline failed: ${err.message}`));
      return {
        success: false,
        error: err.message,
        step: this.state.currentStep
      };
    }
  }

  /**
   * Resume from last saved state
   */
  async resume() {
    const step = this.state.currentStep;
    if (!step) {
      throw new Error('No previous pipeline state to resume from.');
    }

    console.log(color('yellow', `Resuming from step: ${step}`));

    switch (step) {
      case 'extract':
        return this.runFromMatch();
      case 'match':
        return this.runFromConfirm();
      case 'confirm':
        return this.runFromGenerate();
      default:
        throw new Error(`Unknown step: ${step}`);
    }
  }

  async runFromMatch() {
    const matches = await this.match();
    const decisions = await this.confirm();
    const generated = await this.generate();
    return { matches, decisions, generated };
  }

  async runFromConfirm() {
    const decisions = await this.confirm();
    const generated = await this.generate();
    return { decisions, generated };
  }

  async runFromGenerate() {
    const generated = await this.generate();
    return { generated };
  }

  /**
   * Get pipeline status
   */
  getStatus() {
    return {
      currentStep: this.state.currentStep,
      lastRun: this.state.lastRun,
      componentCount: this.state.extractedComponents?.length || 0,
      matchCount: this.state.matchResults?.length || 0,
      decisionCount: this.state.decisions?.length || 0,
      generatedCount: this.state.generatedFiles?.length || 0
    };
  }

  /**
   * Reset pipeline state
   */
  reset() {
    this.state = {
      lastRun: null,
      currentStep: null,
      extractedComponents: [],
      matchResults: [],
      decisions: [],
      generatedFiles: []
    };
    savePipelineState(this.state);
    console.log(color('yellow', 'Pipeline state reset.'));
  }
}

// ============================================================
// CLI Interface
// ============================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Figma Pipeline Orchestrator

Usage:
  flow figma pipeline <figma-data.json>   Run full pipeline
  flow figma pipeline --resume            Resume from last state
  flow figma pipeline --status            Show pipeline status
  flow figma pipeline --reset             Reset pipeline state

Options:
  --step <name>       Run specific step (extract|match|confirm|generate)
  --auto              Non-interactive mode (auto-confirm matches)
  --threshold <n>     Match threshold percentage (default: 80)
  --output <dir>      Output directory for generated code
  --verbose           Show detailed progress
    `);
    return;
  }

  const pipeline = new FigmaPipeline({
    interactive: !args.includes('--auto'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    threshold: args.includes('--threshold')
      ? parseInt(args[args.indexOf('--threshold') + 1], 10)
      : 80,
    outputDir: args.includes('--output')
      ? args[args.indexOf('--output') + 1]
      : undefined
  });

  if (args.includes('--status')) {
    const status = pipeline.getStatus();
    console.log('Pipeline Status:');
    console.log(`  Current step: ${status.currentStep || 'not started'}`);
    console.log(`  Last run: ${status.lastRun || 'never'}`);
    console.log(`  Components: ${status.componentCount}`);
    console.log(`  Matches: ${status.matchCount}`);
    console.log(`  Decisions: ${status.decisionCount}`);
    console.log(`  Generated: ${status.generatedCount}`);
    return;
  }

  if (args.includes('--reset')) {
    pipeline.reset();
    return;
  }

  if (args.includes('--resume')) {
    await pipeline.resume();
    return;
  }

  const stepIndex = args.indexOf('--step');
  if (stepIndex !== -1) {
    const step = args[stepIndex + 1];
    const inputFile = args.find(a => !a.startsWith('--') && a.endsWith('.json'));

    switch (step) {
      case 'extract':
        if (!inputFile) throw new Error('Input file required for extract step');
        await pipeline.extract(inputFile);
        break;
      case 'match':
        await pipeline.match();
        break;
      case 'confirm':
        await pipeline.confirm();
        break;
      case 'generate':
        await pipeline.generate();
        break;
      default:
        throw new Error(`Unknown step: ${step}`);
    }
    return;
  }

  // Default: run full pipeline
  const inputFile = args.find(a => !a.startsWith('--') && a.endsWith('.json'));
  if (!inputFile) {
    console.error('Error: Input file required');
    console.log('Usage: flow figma pipeline <figma-data.json>');
    process.exit(1);
  }

  await pipeline.runFull(inputFile);
}

// Run if executed directly
if (require.main === module) {
  main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

module.exports = {
  FigmaPipeline,
  loadPipelineState,
  savePipelineState
};
