#!/usr/bin/env node

/**
 * Wogi Flow — Auto-Correction Helpers (Story 14 / wf-d0937c83)
 *
 * Splits flow-orchestrate's autoCorrectCode into focused helpers:
 *
 *   - fixForbiddenImports       (section 1: doNotImport, default/combined/namespace forms)
 *   - fixComponentPaths         (section 2: shadcn @/components/ui/X mapping)
 *   - fixFeatureTypePaths       (section 3: ../types in /features/ files)
 *   - fixNoExternalUtils        (section 4: @/lib/utils removal + formatCurrency inline + cn() unwrap)
 *   - normalizeQuotes           (section 5: double-quote → single-quote when single dominates)
 *   - cleanupEmptyImports       (section 6: empty `import {} from "..."` cleanup)
 *   - collapseBlankLines        (section 7: 3+ blanks → 2)
 *
 * Each helper takes a `(code, ...args)` shape and returns
 * `{ corrected, corrections }`. The orchestrator (flow-orchestrate.js
 * `autoCorrectCode`) chains them in section order.
 *
 * Behavior is preserved verbatim from the pre-extraction implementation;
 * pinned by characterization tests in
 * `tests/flow-orchestrate-corrections.test.js` (Tier-3 integration test
 * per the Cross-Story Integration Tier-3 Rule — feeds real input through
 * the public `autoCorrectCode` API and asserts the output).
 *
 * Programmatic:
 *   const c = require('./flow-orchestrate-corrections');
 *   const { corrected, corrections } = c.fixForbiddenImports(code, ['React']);
 */

'use strict';

function fixForbiddenImports(code, doNotImport) {
  let corrected = code;
  const corrections = [];
  const list = Array.isArray(doNotImport) && doNotImport.length ? doNotImport : ['React'];
  for (const forbidden of list) {
    const defaultImportRegex = new RegExp(`^import ${forbidden} from ['"][^'"]+['"];?\\s*\\n?`, 'gm');
    if (defaultImportRegex.test(corrected)) {
      corrected = corrected.replace(defaultImportRegex, '');
      corrections.push(`Removed forbidden import: ${forbidden}`);
    }

    const combinedImportRegex = new RegExp(`^import ${forbidden},\\s*(\\{[^}]+\\})\\s+from\\s+(['"][^'"]+['"])`, 'gm');
    if (combinedImportRegex.test(corrected)) {
      corrected = corrected.replace(combinedImportRegex, 'import $1 from $2');
      corrections.push(`Removed ${forbidden} from combined import`);
    }

    const namespaceImportRegex = new RegExp(`^import \\* as ${forbidden} from ['"][^'"]+['"];?\\s*\\n?`, 'gm');
    if (namespaceImportRegex.test(corrected)) {
      corrected = corrected.replace(namespaceImportRegex, '');
      corrections.push(`Removed namespace import: ${forbidden}`);
    }
  }
  return { corrected, corrections };
}

function fixComponentPaths(code, componentPaths) {
  let corrected = code;
  const corrections = [];
  const map = (componentPaths && typeof componentPaths === 'object') ? componentPaths : {};
  const shadcnPattern = /@\/components\/ui\/(\w+)/g;
  corrected = corrected.replace(shadcnPattern, (match, component) => {
    const capitalName = component.charAt(0).toUpperCase() + component.slice(1);
    const configPath = map[capitalName];
    if (configPath) {
      corrections.push(`Fixed import: ${match} → ${configPath}`);
      return configPath;
    }
    return match;
  });
  return { corrected, corrections };
}

function fixFeatureTypePaths(code, filePath, typePaths) {
  let corrected = code;
  const corrections = [];
  const paths = (typePaths && typeof typePaths === 'object') ? typePaths : { features: '../api/types' };
  if (filePath && filePath.includes('/features/') && paths.features) {
    const wrongPaths = ["'../types'", '"../types"', "'./types'", '"./types"'];
    for (const wrong of wrongPaths) {
      if (corrected.includes(wrong)) {
        corrected = corrected.replace(new RegExp(wrong.replace(/['"]/g, '[\'"]'), 'g'), `'${paths.features}'`);
        corrections.push('Fixed type import path');
      }
    }
  }
  return { corrected, corrections };
}

function fixNoExternalUtils(code, ctx) {
  let corrected = code;
  const corrections = [];
  if (!(ctx && ctx.noExternalUtils && corrected.includes('@/lib/utils'))) {
    return { corrected, corrections };
  }

  const hadFormatCurrency = corrected.includes('formatCurrency');
  const hadCn = corrected.includes(' cn(') || corrected.includes(' cn`');

  corrected = corrected.replace(/^import.*from ['"]@\/lib\/utils['"];?\s*\n?/gm, '');
  corrections.push('Removed @/lib/utils import');

  if (hadFormatCurrency) {
    const formatCurrencyFn = `\nconst formatCurrency = (amount: number) =>\n  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);\n`;
    const lastImportMatch = corrected.match(/^import[^;]+;?\s*\n/gm);
    if (lastImportMatch) {
      const lastImport = lastImportMatch[lastImportMatch.length - 1];
      const insertPos = corrected.lastIndexOf(lastImport) + lastImport.length;
      corrected = corrected.slice(0, insertPos) + formatCurrencyFn + corrected.slice(insertPos);
    }
    corrections.push('Inlined formatCurrency');
  }

  if (hadCn) {
    corrected = corrected.replace(/cn\((['"`][^'"`]+['"`])\)/g, '$1');
    corrections.push('Removed cn() wrapper');
  }

  return { corrected, corrections };
}

function normalizeQuotes(code) {
  let corrected = code;
  const corrections = [];
  const singleQuoteCount = (corrected.match(/from '/g) || []).length;
  const doubleQuoteCount = (corrected.match(/from "/g) || []).length;
  if (singleQuoteCount > doubleQuoteCount && doubleQuoteCount > 0) {
    corrected = corrected.replace(/from "([^"]+)"/g, "from '$1'");
    corrections.push('Normalized import quotes to single quotes');
  }
  return { corrected, corrections };
}

function cleanupEmptyImports(code) {
  return {
    corrected: code.replace(/^import\s*\{\s*\}\s*from\s*['"][^'"]+['"];?\s*\n?/gm, ''),
    corrections: []
  };
}

function collapseBlankLines(code) {
  return {
    corrected: code.replace(/\n{3,}/g, '\n\n'),
    corrections: []
  };
}

module.exports = {
  fixForbiddenImports,
  fixComponentPaths,
  fixFeatureTypePaths,
  fixNoExternalUtils,
  normalizeQuotes,
  cleanupEmptyImports,
  collapseBlankLines
};
