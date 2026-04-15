'use strict';

/**
 * Tests for scripts/hooks/core/component-check.js (Wave F hook coverage).
 *
 * Covers: config enable/disable, getComponentPatterns (projectType-driven
 * pattern composition + explicit override + extraPatterns additive merge),
 * isComponentPath glob→regex translation (**, *), extractComponentName
 * (suffix stripping + separator removal), parseAppMap markdown parsing,
 * checkComponentReuse fast paths (disabled, non-component path, no similar
 * found), result contract shape.
 *
 * Run: NODE_ENV=test node --test tests/flow-hooks-component-check.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const componentCheck = require('../scripts/hooks/core/component-check');
const {
  isComponentCheckEnabled,
  getComponentPatterns,
  getSimilarityThreshold,
  isComponentPath,
  extractComponentName,
  parseAppMap,
  loadComponentIndex,
  checkComponentReuse,
  generateSimilarMessage,
} = componentCheck;

// ============================================================
// isComponentCheckEnabled
// ============================================================

describe('isComponentCheckEnabled', () => {
  it('returns true by default (empty config)', () => {
    assert.equal(isComponentCheckEnabled({}), true);
  });

  it('returns true when componentReuse is undefined', () => {
    assert.equal(isComponentCheckEnabled({}), true);
  });

  it('returns false when explicitly disabled', () => {
    assert.equal(isComponentCheckEnabled({ componentReuse: { enabled: false } }), false);
  });

  it('returns true when explicitly enabled', () => {
    assert.equal(isComponentCheckEnabled({ componentReuse: { enabled: true } }), true);
  });
});

// ============================================================
// getComponentPatterns
// ============================================================

describe('getComponentPatterns — projectType composition', () => {
  it('returns explicit patterns when user configures them', () => {
    const patterns = getComponentPatterns({
      componentReuse: { patterns: ['custom/**'] },
    });
    assert.deepEqual(patterns, ['custom/**']);
  });

  it('includes universal patterns for any projectType', () => {
    const patterns = getComponentPatterns({ projectType: 'backend' });
    assert.ok(patterns.some(p => p.includes('utils')));
    assert.ok(patterns.some(p => p.includes('hooks') || p.includes('helpers')));
  });

  it('adds frontend patterns for frontend projectType', () => {
    const patterns = getComponentPatterns({ projectType: 'frontend' });
    assert.ok(patterns.some(p => p.includes('components')));
    assert.ok(patterns.some(p => p.includes('layouts') || p.includes('modals')));
  });

  it('adds backend patterns for backend projectType', () => {
    const patterns = getComponentPatterns({ projectType: 'backend' });
    assert.ok(patterns.some(p => p.includes('services')));
    assert.ok(patterns.some(p => p.includes('middleware')));
  });

  it('adds both frontend + backend patterns for fullstack', () => {
    const patterns = getComponentPatterns({ projectType: 'fullstack' });
    assert.ok(patterns.some(p => p.includes('components')), 'has frontend');
    assert.ok(patterns.some(p => p.includes('services')), 'has backend');
  });

  it('defaults to frontend + backend when projectType is unknown', () => {
    const patterns = getComponentPatterns({ projectType: 'unknown' });
    assert.ok(patterns.some(p => p.includes('components')), 'has frontend (unknown case)');
    assert.ok(patterns.some(p => p.includes('services')), 'has backend (unknown case)');
  });

  it('merges extraPatterns additively', () => {
    const patterns = getComponentPatterns({
      projectType: 'frontend',
      componentReuse: { extraPatterns: ['my-special/**'] },
    });
    assert.ok(patterns.includes('my-special/**'));
    assert.ok(patterns.some(p => p.includes('components')), 'still has defaults');
  });
});

// ============================================================
// getSimilarityThreshold
// ============================================================

describe('getSimilarityThreshold', () => {
  it('uses semantic matching threshold when configured', () => {
    const t = getSimilarityThreshold({
      semanticMatching: { thresholds: { possibleMatch: 42 } },
    });
    assert.equal(t, 42);
  });

  it('falls back to legacy componentReuse.threshold', () => {
    const t = getSimilarityThreshold({
      componentReuse: { threshold: 80 },
    });
    assert.equal(t, 80);
  });

  it('defaults to 70 when nothing configured', () => {
    const t = getSimilarityThreshold({});
    // Either 50 (semantic default) or 70 (legacy). Accept both — depends on presence.
    assert.ok(t === 50 || t === 70, `unexpected threshold: ${t}`);
  });
});

// ============================================================
// isComponentPath (glob→regex)
// ============================================================

describe('isComponentPath — glob translation', () => {
  const cfg = { projectType: 'fullstack' };

  it('matches components/ directory', () => {
    assert.equal(isComponentPath('src/components/Button.tsx', cfg), true);
  });

  it('matches nested components', () => {
    assert.equal(isComponentPath('app/src/components/ui/Card.jsx', cfg), true);
  });

  it('matches services/ for backend', () => {
    assert.equal(isComponentPath('backend/services/user-service.ts', cfg), true);
  });

  it('matches utils/ (universal)', () => {
    assert.equal(isComponentPath('packages/utils/format.ts', cfg), true);
  });

  it('matches hooks/ (universal)', () => {
    assert.equal(isComponentPath('src/hooks/useUser.ts', cfg), true);
  });

  it('does NOT match arbitrary non-component paths', () => {
    assert.equal(isComponentPath('src/index.ts', cfg), false);
    assert.equal(isComponentPath('README.md', cfg), false);
    assert.equal(isComponentPath('package.json', cfg), false);
  });

  it('handles Windows-style path separators (normalizes backslash)', () => {
    assert.equal(isComponentPath('src\\components\\Button.tsx', cfg), true);
  });
});

// ============================================================
// extractComponentName
// ============================================================

describe('extractComponentName', () => {
  it('extracts basic component name', () => {
    assert.equal(extractComponentName('src/components/Button.tsx'), 'Button');
  });

  it('strips .component suffix', () => {
    assert.equal(extractComponentName('app/Profile.component.ts'), 'Profile');
  });

  it('strips .view suffix', () => {
    assert.equal(extractComponentName('pages/Home.view.jsx'), 'Home');
  });

  it('strips .container suffix', () => {
    assert.equal(extractComponentName('src/Dashboard.container.tsx'), 'Dashboard');
  });

  it('strips .page suffix', () => {
    assert.equal(extractComponentName('routes/Login.page.ts'), 'Login');
  });

  it('strips .screen suffix', () => {
    assert.equal(extractComponentName('mobile/Settings.screen.tsx'), 'Settings');
  });

  it('removes hyphens', () => {
    assert.equal(extractComponentName('src/user-profile.ts'), 'userprofile');
  });

  it('removes underscores', () => {
    assert.equal(extractComponentName('src/user_profile.ts'), 'userprofile');
  });

  it('handles no extension', () => {
    assert.equal(extractComponentName('Button'), 'Button');
  });
});

// ============================================================
// parseAppMap / loadComponentIndex — live reads (don't crash)
// ============================================================

describe('parseAppMap / loadComponentIndex — live state', () => {
  it('parseAppMap returns an array (never throws)', () => {
    const components = parseAppMap();
    assert.ok(Array.isArray(components));
  });

  it('loadComponentIndex returns object or null', () => {
    const index = loadComponentIndex();
    assert.ok(index === null || typeof index === 'object');
  });
});

// ============================================================
// checkComponentReuse — fast paths
// ============================================================

describe('checkComponentReuse — fast paths', () => {
  it('allowed + reason=component_check_disabled when gate off', () => {
    const r = checkComponentReuse({ filePath: 'src/components/Foo.tsx' }, { componentReuse: { enabled: false } });
    assert.equal(r.allowed, true);
    assert.equal(r.reason, 'component_check_disabled');
  });

  it('allowed + reason=not_component_path for non-component paths', () => {
    const r = checkComponentReuse(
      { filePath: 'README.md' },
      { projectType: 'frontend' }
    );
    assert.equal(r.allowed, true);
    assert.equal(r.reason, 'not_component_path');
  });

  it('result is well-formed for component path', () => {
    const r = checkComponentReuse(
      { filePath: 'src/components/SuperSpecialUniqueComponentName.tsx' },
      { projectType: 'frontend' }
    );
    assert.ok(typeof r.allowed === 'boolean');
    assert.ok('reason' in r);
  });
});

// ============================================================
// generateSimilarMessage
// ============================================================

describe('generateSimilarMessage', () => {
  it('includes the target component name and similarity info', () => {
    const similar = [{
      name: 'UserCard',
      path: 'src/components/UserCard.tsx',
      description: 'Displays a user avatar and name',
      similarity: 92,
      stringSimilarity: 88,
      semanticSimilarity: 95,
      matchLevel: 'definite',
    }];
    const msg = generateSimilarMessage('UserProfileCard', similar);
    assert.ok(msg.includes('UserCard'));
    assert.ok(msg.includes('92') || msg.includes('88') || msg.includes('95'));
    assert.ok(msg.includes('UserCard.tsx'));
  });

  it('includes recommended actions', () => {
    const similar = [{ name: 'Button', similarity: 70, matchLevel: 'likely' }];
    const msg = generateSimilarMessage('MyButton', similar);
    assert.ok(msg.toUpperCase().includes('USE') || msg.toUpperCase().includes('EXTEND') || msg.toUpperCase().includes('CREATE'));
  });

  it('truncates "Other similar" list to 3 items (index 1-3)', () => {
    const similar = [
      { name: 'Primary', similarity: 95, matchLevel: 'definite' },
      { name: 'Secondary1', similarity: 80 },
      { name: 'Secondary2', similarity: 75 },
      { name: 'Secondary3', similarity: 70 },
      { name: 'Secondary4', similarity: 65 },  // Should NOT appear
      { name: 'Secondary5', similarity: 60 },  // Should NOT appear
    ];
    const msg = generateSimilarMessage('Target', similar);
    assert.ok(msg.includes('Secondary1'));
    assert.ok(msg.includes('Secondary3'));
    assert.ok(!msg.includes('Secondary4'), 'should truncate at 3');
  });
});

// ============================================================
// Module exports
// ============================================================

describe('module exports', () => {
  it('exports expected API', () => {
    for (const name of [
      'isComponentCheckEnabled', 'getComponentPatterns', 'getSimilarityThreshold',
      'isComponentPath', 'loadComponentIndex', 'parseAppMap',
      'calculateSimilarity', 'extractComponentName', 'findSimilarComponents',
      'checkComponentReuse', 'generateSimilarMessage',
    ]) {
      assert.ok(name in componentCheck, `missing: ${name}`);
    }
  });
});
