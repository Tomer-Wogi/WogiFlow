#!/usr/bin/env node

/**
 * Wogi Flow - CLI + artifact parsing utilities (shared)
 *
 * Extracted from 5 IGR scripts during review-fix pass (2026-04-13).
 * Fixes ARCH-002, ARCH-003, CL-001 from IGR review.
 *
 * Provides:
 *   - parseArgs(argv)       — --key=val / --flag / positional parser
 *   - parsePinSections(text, requiredPins) — PIN-structured artifact parser
 *   - parseListItems(block) — bullet list → string array, skipping placeholders
 *
 * Consumers: flow-intent-framing.js, flow-architect-pass.js,
 *            flow-logic-adversary.js, flow-intent-bootstrap.js,
 *            flow-migrate-igr.js.
 */

/**
 * Parse CLI argv into { _:[positional], key:value, flag:true }.
 * Handles: --key=value, --flag, and positional args.
 */
function parseArgs(argv) {
  const out = { _: [] };
  for (const tok of argv) {
    const m = String(tok).match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
    else if (String(tok).startsWith('--')) out[String(tok).slice(2)] = true;
    else out._.push(tok);
  }
  return out;
}

/**
 * Parse PIN-structured markdown into { [pinName]: content }.
 *
 * Recognizes `<!-- PIN: name -->\n<content>` blocks where content ends at
 * the next `<!-- PIN: ... -->`, `<!-- PINS: ... -->`, `\n## ` header, or EOF.
 *
 * @param {string} text
 * @param {string[]} [requiredPins] - If provided, returns errors for missing PINs.
 * @returns {{ sections: Object<string,string>, errors: string[] }}
 */
function parsePinSections(text, requiredPins) {
  if (typeof text !== 'string' || !text.trim()) {
    return { sections: {}, errors: ['empty input'] };
  }
  const sections = {};
  const pinRegex = /<!--\s*PIN:\s*([\w-]+)\s*-->\s*\n([\s\S]*?)(?=<!--\s*PIN:|<!--\s*PINS:|\n##\s|$)/g;
  let m;
  while ((m = pinRegex.exec(text)) !== null) {
    sections[m[1]] = m[2].trim();
  }
  const errors = [];
  if (Array.isArray(requiredPins)) {
    for (const pin of requiredPins) {
      if (!(pin in sections)) errors.push(`missing required PIN: ${pin}`);
    }
  }
  return { sections, errors };
}

/**
 * Parse a bulleted-list block into an array of item strings.
 * Treats placeholder values like "_(none)_", "(empty)", "n/a" as no-items.
 */
function parseListItems(block) {
  if (!block) return [];
  const items = [];
  for (const raw of String(block).split('\n')) {
    const line = raw.trim();
    if (/^_?\(?(none|empty|n\/a)\)?_?$/i.test(line)) continue;
    if (line.startsWith('- ') || line.startsWith('* ')) {
      const v = line.slice(2).trim();
      if (v && !/^_?\(?(none|empty|n\/a)\)?_?$/i.test(v)) items.push(v);
    }
  }
  return items;
}

module.exports = {
  parseArgs,
  parsePinSections,
  parseListItems,
};
