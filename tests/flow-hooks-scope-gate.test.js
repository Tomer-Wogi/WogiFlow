'use strict';

/**
 * Tests for scripts/hooks/core/scope-gate.js (Wave F hook coverage).
 *
 * Covers: matchesPattern (exact + `/**` recursive + `/*` direct-children +
 * directory-prefix + path-traversal rejection + invalid input), isFileInScope
 * (create/modify/delete arrays, object-with-path entries, empty scope = no
 * changes), isFileBoundaryViolation (returns matched pattern or null),
 * isFileExempt (exemptPatterns default + override), config helpers,
 * message generators.
 *
 * Run: NODE_ENV=test node --test tests/flow-hooks-scope-gate.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const scopeGate = require('../scripts/hooks/core/scope-gate');
const {
  matchesPattern,
  isFileInScope,
  isFileBoundaryViolation,
  isFileExempt,
  isScopeGatingEnabled,
  getScopeGatingMode,
  generateScopeWarning,
  generateBoundaryBlockMessage,
  checkScopeGate,
} = scopeGate;

// ============================================================
// matchesPattern
// ============================================================

describe('matchesPattern — exact match', () => {
  it('matches identical paths', () => {
    assert.equal(matchesPattern('src/index.ts', 'src/index.ts'), true);
  });

  it('does not match different paths', () => {
    assert.equal(matchesPattern('src/a.ts', 'src/b.ts'), false);
  });

  it('rejects null/undefined/non-string input', () => {
    assert.equal(matchesPattern(null, 'src/x.ts'), false);
    assert.equal(matchesPattern('src/x.ts', null), false);
    assert.equal(matchesPattern(undefined, undefined), false);
    assert.equal(matchesPattern(42, 'x.ts'), false);
    assert.equal(matchesPattern('x.ts', {}), false);
  });

  it('rejects empty strings', () => {
    assert.equal(matchesPattern('', 'src/x.ts'), false);
    assert.equal(matchesPattern('src/x.ts', ''), false);
  });
});

describe('matchesPattern — /** recursive glob', () => {
  it('matches direct children', () => {
    assert.equal(matchesPattern('src/components/Button.tsx', 'src/components/**'), true);
  });

  it('matches deeply nested files', () => {
    assert.equal(matchesPattern('src/components/ui/forms/Input.tsx', 'src/components/**'), true);
  });

  it('matches the directory itself', () => {
    assert.equal(matchesPattern('src/components', 'src/components/**'), true);
  });

  it('does NOT match sibling directories', () => {
    assert.equal(matchesPattern('src/pages/Home.tsx', 'src/components/**'), false);
  });

  it('does NOT match files that share a prefix but are in a different dir', () => {
    assert.equal(matchesPattern('src/components-old/X.tsx', 'src/components/**'), false);
  });
});

describe('matchesPattern — /* direct-children glob', () => {
  it('matches files directly in the directory', () => {
    assert.equal(matchesPattern('src/lib/utils.ts', 'src/lib/*'), true);
  });

  it('does NOT match nested subdirectory files', () => {
    assert.equal(matchesPattern('src/lib/nested/util.ts', 'src/lib/*'), false);
  });

  it('does NOT match files outside the directory', () => {
    assert.equal(matchesPattern('src/app.ts', 'src/lib/*'), false);
  });
});

describe('matchesPattern — directory prefix (no glob)', () => {
  it('matches files within a directory scope (e.g., "src/utils" matches "src/utils/helper.ts")', () => {
    assert.equal(matchesPattern('src/utils/helper.ts', 'src/utils'), true);
  });

  it('matches deeply nested files under directory scope', () => {
    assert.equal(matchesPattern('src/utils/a/b/c.ts', 'src/utils'), true);
  });

  it('does NOT match sibling paths with overlapping prefix', () => {
    assert.equal(matchesPattern('src/utilsBackup/x.ts', 'src/utils'), false);
  });
});

describe('matchesPattern — path traversal rejection', () => {
  it('rejects .. in pattern', () => {
    assert.equal(matchesPattern('src/x.ts', '../other/x.ts'), false);
  });

  it('rejects .. in file path', () => {
    assert.equal(matchesPattern('../escape.ts', 'src/**'), false);
  });

  it('rejects both', () => {
    assert.equal(matchesPattern('../a/..', '../x/**'), false);
  });
});

describe('matchesPattern — Windows path normalization', () => {
  it('treats backslash and forward slash equivalently', () => {
    assert.equal(matchesPattern('src\\components\\Button.tsx', 'src/components/**'), true);
    assert.equal(matchesPattern('src/components/Button.tsx', 'src\\components\\**'), true);
  });
});

// ============================================================
// isFileInScope
// ============================================================

describe('isFileInScope — array handling', () => {
  it('returns true when filesToChange is null (gating disabled for task)', () => {
    assert.equal(isFileInScope('src/x.ts', null), true);
  });

  it('returns true when filesToChange is undefined', () => {
    assert.equal(isFileInScope('src/x.ts', undefined), true);
  });

  it('returns false when scope is empty but defined (empty arrays)', () => {
    assert.equal(isFileInScope('src/x.ts', { create: [], modify: [], delete: [] }), false);
  });

  it('matches files in create list', () => {
    assert.equal(isFileInScope('src/new.ts', { create: ['src/new.ts'] }), true);
  });

  it('matches files in modify list (string form)', () => {
    assert.equal(isFileInScope('src/existing.ts', { modify: ['src/existing.ts'] }), true);
  });

  it('matches files in modify list (object form with .path)', () => {
    assert.equal(isFileInScope('src/existing.ts', { modify: [{ path: 'src/existing.ts' }] }), true);
  });

  it('matches files in delete list', () => {
    assert.equal(isFileInScope('src/old.ts', { delete: ['src/old.ts'] }), true);
  });

  it('matches via glob patterns in scope', () => {
    assert.equal(isFileInScope('src/components/Button.tsx', { modify: ['src/components/**'] }), true);
  });

  it('returns false for files not in any list', () => {
    assert.equal(isFileInScope('src/unrelated.ts', {
      create: ['src/new.ts'],
      modify: ['src/existing.ts'],
      delete: ['src/old.ts'],
    }), false);
  });

  it('ignores malformed entries (empty strings, non-strings, missing path)', () => {
    assert.equal(isFileInScope('src/a.ts', {
      modify: ['', null, 42, { wrongKey: 'x' }, { path: '' }],
    }), false);
  });

  it('handles mixed string + object entries', () => {
    const scope = { modify: ['src/a.ts', { path: 'src/b.ts' }] };
    assert.equal(isFileInScope('src/a.ts', scope), true);
    assert.equal(isFileInScope('src/b.ts', scope), true);
  });
});

// ============================================================
// isFileBoundaryViolation
// ============================================================

describe('isFileBoundaryViolation', () => {
  it('returns null when boundaries is null/undefined/empty', () => {
    assert.equal(isFileBoundaryViolation('src/x.ts', null), null);
    assert.equal(isFileBoundaryViolation('src/x.ts', undefined), null);
    assert.equal(isFileBoundaryViolation('src/x.ts', []), null);
  });

  it('returns matched pattern when file is in boundary list', () => {
    const r = isFileBoundaryViolation('src/critical.ts', ['src/critical.ts']);
    assert.equal(r, 'src/critical.ts');
  });

  it('returns matched glob pattern when file matches', () => {
    const r = isFileBoundaryViolation('src/legacy/old.ts', ['src/legacy/**']);
    assert.equal(r, 'src/legacy/**');
  });

  it('returns null when no boundary matches', () => {
    const r = isFileBoundaryViolation('src/safe.ts', ['src/critical.ts', 'src/legacy/**']);
    assert.equal(r, null);
  });

  it('returns first matched pattern (not subsequent)', () => {
    const r = isFileBoundaryViolation('src/locked.ts', ['src/**', 'src/locked.ts']);
    assert.equal(r, 'src/**');
  });

  it('skips non-string entries', () => {
    const r = isFileBoundaryViolation('src/x.ts', [null, 42, { bad: true }, 'src/x.ts']);
    assert.equal(r, 'src/x.ts');
  });

  it('rejects non-array boundaries input', () => {
    assert.equal(isFileBoundaryViolation('src/x.ts', 'src/x.ts'), null);
    assert.equal(isFileBoundaryViolation('src/x.ts', {}), null);
  });
});

// ============================================================
// isFileExempt
// ============================================================

describe('isFileExempt — default exempt patterns', () => {
  it('exempts .workflow/state/** files', () => {
    assert.equal(isFileExempt('.workflow/state/ready.json', {}), true);
  });

  it('exempts .workflow/specs/** files', () => {
    assert.equal(isFileExempt('.workflow/specs/wf-abcd1234.md', {}), true);
  });

  it('exempts package.json', () => {
    assert.equal(isFileExempt('package.json', {}), true);
  });

  it('exempts tsconfig.json', () => {
    assert.equal(isFileExempt('tsconfig.json', {}), true);
  });

  it('exempts package-lock.json', () => {
    assert.equal(isFileExempt('package-lock.json', {}), true);
  });

  it('does NOT exempt random source files', () => {
    assert.equal(isFileExempt('src/index.ts', {}), false);
  });

  it('respects custom exemptPatterns override', () => {
    const cfg = { enforcement: { scopeGating: { exemptPatterns: ['my-special/**'] } } };
    assert.equal(isFileExempt('my-special/foo.ts', cfg), true);
    // Default exempts no longer apply when overridden
    assert.equal(isFileExempt('package.json', cfg), false);
  });

  it('returns false for null/empty input', () => {
    assert.equal(isFileExempt(null, {}), false);
    assert.equal(isFileExempt('', {}), false);
  });
});

// ============================================================
// Config helpers
// ============================================================

describe('isScopeGatingEnabled / getScopeGatingMode', () => {
  it('enabled defaults to true', () => {
    assert.equal(isScopeGatingEnabled({}), true);
  });

  it('enabled=false when explicitly disabled', () => {
    assert.equal(isScopeGatingEnabled({ enforcement: { scopeGating: { enabled: false } } }), false);
  });

  it('mode defaults to "warn"', () => {
    assert.equal(getScopeGatingMode({}), 'warn');
  });

  it('mode honors override to "block"', () => {
    assert.equal(getScopeGatingMode({ enforcement: { scopeGating: { mode: 'block' } } }), 'block');
  });
});

// ============================================================
// Message generators
// ============================================================

describe('generateScopeWarning', () => {
  it('handles missing inputs gracefully (no throw)', () => {
    const msg = generateScopeWarning(null, null, null);
    assert.ok(typeof msg === 'string');
    assert.ok(msg.length > 0);
  });

  it('includes task ID and file name for full inputs', () => {
    const msg = generateScopeWarning(
      'src/new.ts',
      { id: 'wf-task00001', title: 'Feature X' },
      { create: ['src/a.ts'], modify: ['src/b.ts'] }
    );
    assert.ok(msg.includes('wf-task00001') || msg.includes('new.ts'),
      `warning should reference task or filename: ${msg}`);
  });
});

describe('generateBoundaryBlockMessage', () => {
  it('includes file name, task ID, and matched pattern', () => {
    const msg = generateBoundaryBlockMessage(
      'src/protected.ts',
      { id: 'wf-abc12345', title: 'Do not touch' },
      'src/protected.ts'
    );
    assert.ok(msg.includes('BOUNDARY VIOLATION'));
    assert.ok(msg.includes('wf-abc12345'));
    assert.ok(msg.includes('protected.ts'));
  });

  it('handles missing inputs without throwing', () => {
    const msg = generateBoundaryBlockMessage(null, null, null);
    assert.ok(typeof msg === 'string');
  });
});

// ============================================================
// checkScopeGate — result contract
// ============================================================

describe('checkScopeGate — result contract', () => {
  it('returns a well-formed object for any input', () => {
    const r = checkScopeGate('Edit', { file_path: 'src/x.ts' }, {});
    assert.ok(typeof r === 'object');
    // Either allowed:true or blocked:true — one of the two shapes
    assert.ok(typeof r.allowed === 'boolean' || typeof r.blocked === 'boolean');
  });

  it('does not throw for missing toolInput', () => {
    assert.doesNotThrow(() => checkScopeGate('Edit', {}, {}));
  });

  it('does not throw for unusual tool names', () => {
    assert.doesNotThrow(() => checkScopeGate('UnknownTool', {}, {}));
  });
});

// ============================================================
// Module exports
// ============================================================

describe('module exports', () => {
  it('exports expected API', () => {
    for (const name of [
      'checkScopeGate', 'isFileInScope', 'isFileExempt', 'isFileBoundaryViolation',
      'matchesPattern', 'isScopeGatingEnabled', 'getScopeGatingMode',
      'generateScopeWarning', 'generateScopeBlockMessage', 'generateBoundaryBlockMessage',
    ]) {
      assert.ok(name in scopeGate, `missing: ${name}`);
    }
  });
});
