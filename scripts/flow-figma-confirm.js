#!/usr/bin/env node

/**
 * Wogi Flow - Interactive Component Confirmation
 *
 * Presents match results to developer and collects decisions
 * for each component (use existing, add variant, create new, skip).
 *
 * Usage:
 *   flow figma confirm <match-results.json>   # Interactive mode
 *   flow figma confirm --auto                 # Auto-confirm high matches
 */

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { getProjectRoot, colors: c, readJson, PATHS } = require('./flow-utils');

const DECISIONS_PATH = path.join(PATHS.workflow, 'state', 'figma-decisions.json');

const sym = {
  check: '✅',
  cross: '❌',
  warning: '⚠️',
  new: '🆕',
  variant: '➕',
  skip: '⏭️',
  match: '🎯'
};

// ============================================================
// Interactive Confirmer
// ============================================================

class InteractiveConfirmer {
  constructor() {
    this.decisions = [];
    this.rl = null;
  }

  async confirm(matchResults) {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    // Print header
    this.printHeader(matchResults.summary);

    // Process each component
    for (const match of matchResults.matches) {
      const decision = await this.confirmComponent(match);
      this.decisions.push(decision);
    }

    this.rl.close();

    // Print summary
    this.printSummary();

    // Save decisions
    this.saveDecisions();

    return this.decisions;
  }

  printHeader(summary) {
    console.log(`
${c.cyan}╔═══════════════════════════════════════════════════════════════════╗
║                    FIGMA COMPONENT ANALYZER                        ║
║                   Interactive Confirmation Flow                    ║
╚═══════════════════════════════════════════════════════════════════╝${c.reset}

${c.bold}Analysis Summary:${c.reset}
  Total components:    ${summary.total}
  ${c.green}Exact matches:       ${summary.exactMatches}${c.reset}
  ${c.yellow}Strong matches:      ${summary.strongMatches}${c.reset}
  ${c.blue}Variant candidates:  ${summary.variantCandidates}${c.reset}
  ${c.magenta}New components:      ${summary.newComponents}${c.reset}

Let's go through each component:
`);
  }

  async confirmComponent(match) {
    const { figmaComponent, bestMatch, suggestion } = match;

    console.log(`\n${'━'.repeat(70)}`);
    console.log(`\n${c.bold}📦 ${figmaComponent.name}${c.reset} (${figmaComponent.type})`);

    if (!bestMatch) {
      console.log(`\n   ${c.dim}No matching components found in codebase${c.reset}`);
      console.log(`   Suggestion: ${c.magenta}Create new component${c.reset}`);

      return this.promptNewComponent(figmaComponent, suggestion);
    }

    // Show match details
    const score = bestMatch.score;
    const scoreColor = score >= 80 ? c.green : score >= 60 ? c.yellow : c.red;

    console.log(`\n   ${c.bold}Best Match:${c.reset} ${bestMatch.registryComponent.name}`);
    console.log(`   ${c.bold}Score:${c.reset} ${scoreColor}${score}%${c.reset}`);
    console.log(`   ${c.bold}Path:${c.reset} ${c.dim}${bestMatch.registryComponent.path}${c.reset}`);

    // Show score breakdown
    console.log(`\n   ${c.dim}Score Breakdown:${c.reset}`);
    console.log(`   ${c.dim}├─ CSS:       ${bestMatch.breakdown.css}%${c.reset}`);
    console.log(`   ${c.dim}├─ Structure: ${bestMatch.breakdown.structure}%${c.reset}`);
    console.log(`   ${c.dim}├─ Naming:    ${bestMatch.breakdown.naming}%${c.reset}`);
    console.log(`   ${c.dim}└─ Behavior:  ${bestMatch.breakdown.behavior}%${c.reset}`);

    // Show differences if any
    if (bestMatch.differences && bestMatch.differences.length > 0) {
      console.log(`\n   ${c.yellow}Differences:${c.reset}`);
      bestMatch.differences.forEach(diff => {
        console.log(`   ${c.dim}• ${diff.description}${c.reset}`);
      });
    }

    // Show suggestion
    console.log(`\n   ${c.bold}Suggestion:${c.reset} ${this.formatSuggestion(suggestion)}`);

    // Prompt for decision
    return this.promptDecision(figmaComponent, bestMatch, suggestion);
  }

  formatSuggestion(suggestion) {
    switch (suggestion.action) {
      case 'use':
        return `${c.green}${sym.check} Use existing ${suggestion.component}${c.reset}`;
      case 'use-with-adjustments':
        return `${c.yellow}${sym.warning} Use ${suggestion.component} with adjustments${c.reset}`;
      case 'add-variant':
        return `${c.blue}${sym.variant} Add variant "${suggestion.suggestedVariantName || 'new'}" to ${suggestion.component}${c.reset}`;
      case 'create-new':
        return `${c.magenta}${sym.new} Create new component${c.reset}`;
      default:
        return suggestion.action;
    }
  }

  async promptDecision(figmaComponent, bestMatch, suggestion) {
    console.log(`\n   ${c.bold}Options:${c.reset}`);
    console.log(`   ${c.cyan}[1]${c.reset} ${sym.check} Use existing ${bestMatch.registryComponent.name}`);
    console.log(`   ${c.cyan}[2]${c.reset} ${sym.variant} Add as variant to ${bestMatch.registryComponent.name}`);
    console.log(`   ${c.cyan}[3]${c.reset} ${sym.new} Create new component`);
    console.log(`   ${c.cyan}[4]${c.reset} ${sym.skip} Skip - I'll handle manually`);
    console.log(`   ${c.cyan}[Enter]${c.reset} Accept suggestion`);

    const choice = await this.prompt('\n   Your choice: ');

    let action;
    switch (choice.trim()) {
      case '1':
        action = 'use';
        break;
      case '2':
        action = 'add-variant';
        break;
      case '3':
        action = 'create-new';
        break;
      case '4':
        action = 'skip';
        break;
      case '':
        action = suggestion.action;
        break;
      default:
        console.log(`   ${c.dim}Invalid choice, using suggestion${c.reset}`);
        action = suggestion.action;
    }

    // Get additional info based on action
    let extraInfo = {};

    if (action === 'add-variant') {
      const defaultVariant = suggestion.suggestedVariantName || 'variant';
      const variantName = await this.prompt(`   Variant name [${defaultVariant}]: `);
      extraInfo.variantName = variantName.trim() || defaultVariant;
    }

    if (action === 'create-new') {
      const suggestedName = suggestion.suggestedName || this.suggestName(figmaComponent.name);
      const componentName = await this.prompt(`   Component name [${suggestedName}]: `);
      extraInfo.componentName = componentName.trim() || suggestedName;
    }

    console.log(`\n   undefined✓ ${this.formatAction(action, bestMatch?.registryComponent, extraInfo)}${c.reset}`);

    return {
      figmaComponent: figmaComponent,
      action: action,
      existingComponent: action !== 'create-new' && action !== 'skip' ? bestMatch.registryComponent : null,
      score: bestMatch?.score || 0,
      ...extraInfo
    };
  }

  async promptNewComponent(figmaComponent, suggestion) {
    console.log(`\n   ${c.bold}Options:${c.reset}`);
    console.log(`   ${c.cyan}[1]${c.reset} ${sym.new} Create new component`);
    console.log(`   ${c.cyan}[2]${c.reset} ${sym.skip} Skip - I'll handle manually`);

    const choice = await this.prompt('\n   Your choice [1]: ');

    if (choice.trim() === '2') {
      return {
        figmaComponent: figmaComponent,
        action: 'skip'
      };
    }

    const suggestedName = suggestion.suggestedName || this.suggestName(figmaComponent.name);
    const componentName = await this.prompt(`   Component name [${suggestedName}]: `);

    console.log(`\n   undefined✓ Will create new component: ${componentName || suggestedName}${c.reset}`);

    return {
      figmaComponent: figmaComponent,
      action: 'create-new',
      componentName: componentName.trim() || suggestedName
    };
  }

  formatAction(action, existingComponent, extraInfo) {
    switch (action) {
      case 'use':
        return `Will use existing ${existingComponent?.name || 'component'}`;
      case 'use-with-adjustments':
        return `Will use ${existingComponent?.name || 'component'} with adjustments`;
      case 'add-variant':
        return `Will add variant "${extraInfo.variantName}" to ${existingComponent?.name || 'component'}`;
      case 'create-new':
        return `Will create new component: ${extraInfo.componentName}`;
      case 'skip':
        return `Skipped - handle manually`;
      default:
        return action;
    }
  }

  suggestName(figmaName) {
    return (figmaName || 'Component')
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .split(/\s+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }

  prompt(question) {
    return new Promise(resolve => {
      this.rl.question(question, resolve);
    });
  }

  printSummary() {
    const summary = {
      use: 0,
      'use-with-adjustments': 0,
      'add-variant': 0,
      'create-new': 0,
      skip: 0
    };

    this.decisions.forEach(d => {
      summary[d.action] = (summary[d.action] || 0) + 1;
    });

    console.log(`

${'═'.repeat(70)}

${c.bold}CONFIRMATION SUMMARY${c.reset}

  ${c.green}${sym.check} Use existing:${c.reset}       ${summary.use + summary['use-with-adjustments']}
  ${c.blue}${sym.variant} Add variant:${c.reset}        ${summary['add-variant']}
  ${c.magenta}${sym.new} Create new:${c.reset}         ${summary['create-new']}
  ${c.dim}${sym.skip} Skipped:${c.reset}            ${summary.skip}

`);
  }

  saveDecisions() {
    const stateDir = path.dirname(DECISIONS_PATH);
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }

    fs.writeFileSync(DECISIONS_PATH, JSON.stringify({
      timestamp: new Date().toISOString(),
      decisions: this.decisions
    }, null, 2));

    console.log(`${c.dim}Decisions saved to: ${path.relative(PATHS.root, DECISIONS_PATH)}${c.reset}`);
  }
}

// ============================================================
// Auto-Confirm Mode
// ============================================================

class AutoConfirmer {
  constructor(threshold = 80) {
    this.threshold = threshold;
  }

  confirm(matchResults) {
    const decisions = [];

    for (const match of matchResults.matches) {
      const { figmaComponent, bestMatch, suggestion } = match;

      let decision;

      if (!bestMatch || bestMatch.score < this.threshold) {
        // Create new for low/no matches
        decision = {
          figmaComponent: figmaComponent,
          action: 'create-new',
          componentName: suggestion.suggestedName || figmaComponent.name
        };
      } else if (bestMatch.score >= 95) {
        // Use directly for very high matches
        decision = {
          figmaComponent: figmaComponent,
          action: 'use',
          existingComponent: bestMatch.registryComponent,
          score: bestMatch.score
        };
      } else {
        // Use with adjustments for medium-high matches
        decision = {
          figmaComponent: figmaComponent,
          action: 'use-with-adjustments',
          existingComponent: bestMatch.registryComponent,
          score: bestMatch.score,
          differences: bestMatch.differences
        };
      }

      decisions.push(decision);
    }

    return decisions;
  }
}

// ============================================================
// CLI
// ============================================================

async function main() {
  const [,, input, ...args] = process.argv;

  const autoMode = args.includes('--auto');

  if (!input || !fs.existsSync(input)) {
    if (input && input !== '--auto') {
      console.error(`File not found: ${input}`);
    }
    console.log(`
Wogi Flow - Interactive Component Confirmation

Usage:
  flow figma confirm <match-results.json>         Interactive mode
  flow figma confirm <match-results.json> --auto  Auto-confirm high matches

Example:
  ./scripts/flow-figma-match.js figma-data.json > matches.json
  ./scripts/flow-figma-confirm.js matches.json
    `);
    process.exit(1);
  }

  const matchResults = readJson(input, null);
  if (!matchResults) {
    console.error(`${c.red}Error: Failed to parse match results file${c.reset}`);
    process.exit(1);
  }

  let decisions;

  if (autoMode) {
    const confirmer = new AutoConfirmer();
    decisions = confirmer.confirm(matchResults);
    console.log(JSON.stringify({ decisions }, null, 2));
  } else {
    const confirmer = new InteractiveConfirmer();
    decisions = await confirmer.confirm(matchResults);
  }
}

module.exports = { InteractiveConfirmer, AutoConfirmer };

if (require.main === module) {
  main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
