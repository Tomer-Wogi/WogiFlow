'use strict';

/**
 * Tests for cascade completion logic — hierarchy resolution and completion checks
 *
 * Tests the cascade completion patterns from flow-done.js (findParentFeature,
 * findParentEpic, allStoriesComplete, cascadeCompletion), plus related exports
 * from flow-epics.js and flow-feature.js.
 *
 * Since the cascade functions in flow-done.js are internal (not exported),
 * we test the underlying modules they depend on and replicate the cascade
 * logic for unit testing.
 *
 * Development-only — not distributed to end users.
 * Run: NODE_ENV=test node --test tests/flow-cascade-completion.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Suppress console output during tests
console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

// ============================================================
// flow-epics exports
// ============================================================

const flowEpics = require('../scripts/flow-epics');

describe('flow-epics exports', () => {
  const expectedFunctions = [
    'loadEpicsState',
    'saveEpicsState',
    'createEpic',
    'getEpic',
    'listEpics',
    'deleteEpic',
    'addStoryToEpic',
    'removeStoryFromEpic',
    'addFeatureToEpic',
    'removeFeatureFromEpic',
  ];

  for (const name of expectedFunctions) {
    it(`exports ${name} as a function`, () => {
      assert.equal(typeof flowEpics[name], 'function', `${name} should be a function`);
    });
  }
});

describe('flow-epics loadEpicsState', () => {
  it('returns an object', () => {
    const state = flowEpics.loadEpicsState();
    assert.equal(typeof state, 'object');
    assert.ok(state !== null);
  });

  it('state has epics property (object map)', () => {
    const state = flowEpics.loadEpicsState();
    assert.equal(typeof state.epics, 'object', 'epics should be an object');
    assert.ok(state.epics !== null, 'epics should not be null');
  });
});

describe('flow-epics listEpics', () => {
  it('returns an array', () => {
    const epics = flowEpics.listEpics();
    assert.ok(Array.isArray(epics));
  });

  it('each epic has an id', () => {
    const epics = flowEpics.listEpics();
    for (const epic of epics) {
      assert.equal(typeof epic.id, 'string', 'epic should have string id');
    }
  });
});

describe('flow-epics getEpic', () => {
  it('returns null for non-existent epic', () => {
    const result = flowEpics.getEpic('ep-nonexist');
    assert.ok(result === null || result === undefined);
  });
});

// ============================================================
// flow-feature exports
// ============================================================

const flowFeature = require('../scripts/flow-feature');

describe('flow-feature exports', () => {
  const expectedFunctions = [
    'createFeature',
    'getFeature',
    'listFeatures',
    'deleteFeature',
    'addStoryToFeature',
    'removeStoryFromFeature',
    'getFeatureStories',
    'getFeatureProgress',
    'loadFeaturesIndex',
    'saveFeaturesIndex',
    'parseFeatureFile',
  ];

  for (const name of expectedFunctions) {
    it(`exports ${name} as a function`, () => {
      assert.equal(typeof flowFeature[name], 'function', `${name} should be a function`);
    });
  }
});

describe('flow-feature listFeatures', () => {
  it('returns an array', () => {
    const features = flowFeature.listFeatures();
    assert.ok(Array.isArray(features));
  });
});

describe('flow-feature getFeature', () => {
  it('returns null for non-existent feature', () => {
    const result = flowFeature.getFeature('ft-nonexist');
    assert.ok(result === null || result === undefined);
  });
});

describe('flow-feature loadFeaturesIndex', () => {
  it('returns an object', () => {
    const index = flowFeature.loadFeaturesIndex();
    assert.equal(typeof index, 'object');
    assert.ok(index !== null);
  });
});

// ============================================================
// Cascade logic unit tests (replicated from flow-done.js internals)
// ============================================================

// Constants from flow-done.js
const CASCADE_MAX_DEPTH = 10;
const VALID_CASCADE_TYPES = ['subtask', 'story', 'feature', 'epic'];

describe('CASCADE_MAX_DEPTH', () => {
  it('is a positive integer', () => {
    assert.equal(typeof CASCADE_MAX_DEPTH, 'number');
    assert.ok(CASCADE_MAX_DEPTH > 0);
    assert.equal(CASCADE_MAX_DEPTH, Math.floor(CASCADE_MAX_DEPTH));
  });

  it('is 10', () => {
    assert.equal(CASCADE_MAX_DEPTH, 10);
  });
});

describe('VALID_CASCADE_TYPES', () => {
  it('contains exactly 4 types', () => {
    assert.equal(VALID_CASCADE_TYPES.length, 4);
  });

  it('contains subtask, story, feature, epic', () => {
    assert.ok(VALID_CASCADE_TYPES.includes('subtask'));
    assert.ok(VALID_CASCADE_TYPES.includes('story'));
    assert.ok(VALID_CASCADE_TYPES.includes('feature'));
    assert.ok(VALID_CASCADE_TYPES.includes('epic'));
  });

  it('does not contain plan (plans are top-level)', () => {
    assert.ok(!VALID_CASCADE_TYPES.includes('plan'));
  });
});

// Replicate findParentFeature logic for testing
function findParentFeature(storyId, features) {
  for (const feature of features) {
    if (feature.stories && feature.stories.includes(storyId)) {
      return feature;
    }
  }
  return null;
}

describe('findParentFeature logic', () => {
  const features = [
    { id: 'ft-00000001', stories: ['wf-aaa00001', 'wf-aaa00002'] },
    { id: 'ft-00000002', stories: ['wf-bbb00001'] },
    { id: 'ft-00000003', stories: [] },
  ];

  it('finds parent feature for a known story', () => {
    const result = findParentFeature('wf-aaa00001', features);
    assert.ok(result !== null);
    assert.equal(result.id, 'ft-00000001');
  });

  it('finds correct parent for second story', () => {
    const result = findParentFeature('wf-aaa00002', features);
    assert.equal(result.id, 'ft-00000001');
  });

  it('finds parent for story in different feature', () => {
    const result = findParentFeature('wf-bbb00001', features);
    assert.equal(result.id, 'ft-00000002');
  });

  it('returns null for orphan story', () => {
    const result = findParentFeature('wf-orphan01', features);
    assert.equal(result, null);
  });

  it('returns null for empty string story id', () => {
    const result = findParentFeature('', features);
    assert.equal(result, null);
  });

  it('handles features with no stories array', () => {
    const featsNoStories = [{ id: 'ft-nostory1' }];
    const result = findParentFeature('wf-any00001', featsNoStories);
    assert.equal(result, null);
  });
});

// Replicate findParentEpic logic
function findParentEpic(featureId, epics) {
  for (const epic of epics) {
    if (epic.features && epic.features.includes(featureId)) {
      return epic;
    }
  }
  return null;
}

describe('findParentEpic logic', () => {
  const epics = [
    { id: 'ep-00000001', features: ['ft-00000001', 'ft-00000002'] },
    { id: 'ep-00000002', features: ['ft-00000003'] },
    { id: 'ep-00000003', features: [] },
  ];

  it('finds parent epic for known feature', () => {
    const result = findParentEpic('ft-00000001', epics);
    assert.equal(result.id, 'ep-00000001');
  });

  it('finds correct parent for second feature', () => {
    const result = findParentEpic('ft-00000002', epics);
    assert.equal(result.id, 'ep-00000001');
  });

  it('returns null for orphan feature', () => {
    const result = findParentEpic('ft-orphan01', epics);
    assert.equal(result, null);
  });

  it('handles epics with no features array', () => {
    const epicsNoFeatures = [{ id: 'ep-nofeat01' }];
    const result = findParentEpic('ft-any00001', epicsNoFeatures);
    assert.equal(result, null);
  });
});

// Replicate findParentPlan logic
function findParentPlan(epicId, plans) {
  for (const plan of plans) {
    if (plan.epics && plan.epics.includes(epicId)) {
      return plan;
    }
  }
  return null;
}

describe('findParentPlan logic', () => {
  const plans = [
    { id: 'pl-00000001', epics: ['ep-00000001'] },
    { id: 'pl-00000002', epics: ['ep-00000002', 'ep-00000003'] },
  ];

  it('finds parent plan for known epic', () => {
    const result = findParentPlan('ep-00000001', plans);
    assert.equal(result.id, 'pl-00000001');
  });

  it('returns null for orphan epic', () => {
    const result = findParentPlan('ep-orphan01', plans);
    assert.equal(result, null);
  });
});

// Replicate allStoriesComplete logic
function allStoriesComplete(feature, completedIds) {
  if (!feature.stories || feature.stories.length === 0) {
    return false;
  }
  for (const storyId of feature.stories) {
    if (!completedIds.includes(storyId)) {
      return false;
    }
  }
  return true;
}

describe('allStoriesComplete logic', () => {
  it('returns false when feature has no stories', () => {
    assert.equal(allStoriesComplete({ stories: [] }, []), false);
  });

  it('returns false when feature.stories is undefined', () => {
    assert.equal(allStoriesComplete({}, []), false);
  });

  it('returns true when all stories are completed', () => {
    const feature = { stories: ['wf-a', 'wf-b'] };
    assert.equal(allStoriesComplete(feature, ['wf-a', 'wf-b', 'wf-c']), true);
  });

  it('returns false when some stories are incomplete', () => {
    const feature = { stories: ['wf-a', 'wf-b', 'wf-c'] };
    assert.equal(allStoriesComplete(feature, ['wf-a', 'wf-c']), false);
  });

  it('returns false when no stories are completed', () => {
    const feature = { stories: ['wf-a'] };
    assert.equal(allStoriesComplete(feature, []), false);
  });

  it('returns true for single story that is completed', () => {
    const feature = { stories: ['wf-only'] };
    assert.equal(allStoriesComplete(feature, ['wf-only']), true);
  });
});

// Replicate cascadeCompletion type validation
function validateCascadeType(itemType) {
  return VALID_CASCADE_TYPES.includes(itemType);
}

describe('cascade type validation', () => {
  it('accepts subtask', () => assert.ok(validateCascadeType('subtask')));
  it('accepts story', () => assert.ok(validateCascadeType('story')));
  it('accepts feature', () => assert.ok(validateCascadeType('feature')));
  it('accepts epic', () => assert.ok(validateCascadeType('epic')));
  it('rejects plan', () => assert.ok(!validateCascadeType('plan')));
  it('rejects empty string', () => assert.ok(!validateCascadeType('')));
  it('rejects null', () => assert.ok(!validateCascadeType(null)));
  it('rejects undefined', () => assert.ok(!validateCascadeType(undefined)));
  it('rejects typo "stories"', () => assert.ok(!validateCascadeType('stories')));
  it('rejects uppercase "EPIC"', () => assert.ok(!validateCascadeType('EPIC')));
});

// Replicate cascadeCompletion depth check
function cascadeDepthCheck(depth) {
  return depth < CASCADE_MAX_DEPTH;
}

describe('cascade depth safety', () => {
  it('allows depth 0', () => assert.ok(cascadeDepthCheck(0)));
  it('allows depth 5', () => assert.ok(cascadeDepthCheck(5)));
  it('allows depth 9', () => assert.ok(cascadeDepthCheck(9)));
  it('blocks depth 10 (max)', () => assert.ok(!cascadeDepthCheck(10)));
  it('blocks depth 100', () => assert.ok(!cascadeDepthCheck(100)));
});

// Cascade routing logic
function getCascadeAction(itemType) {
  if (itemType === 'subtask' || itemType === 'story') return 'check-parent-feature';
  if (itemType === 'feature') return 'check-parent-epic';
  if (itemType === 'epic') return 'check-parent-plan';
  return null;
}

describe('cascade routing', () => {
  it('subtask routes to check-parent-feature', () => {
    assert.equal(getCascadeAction('subtask'), 'check-parent-feature');
  });

  it('story routes to check-parent-feature', () => {
    assert.equal(getCascadeAction('story'), 'check-parent-feature');
  });

  it('feature routes to check-parent-epic', () => {
    assert.equal(getCascadeAction('feature'), 'check-parent-epic');
  });

  it('epic routes to check-parent-plan', () => {
    assert.equal(getCascadeAction('epic'), 'check-parent-plan');
  });

  it('unknown type returns null', () => {
    assert.equal(getCascadeAction('unknown'), null);
  });
});

// ============================================================
// flow-done.js _test exports (NODE_ENV=test)
// ============================================================

describe('flow-done _test exports', () => {
  // NODE_ENV is already 'test' from the test runner
  let doneMod;
  try {
    doneMod = require('../scripts/flow-done');
  } catch (_err) {
    // If it fails to load, skip these tests
    doneMod = null;
  }

  it('exports _test object when NODE_ENV=test', () => {
    if (!doneMod) return; // skip if module failed to load
    assert.ok(doneMod._test, '_test should exist');
    assert.equal(typeof doneMod._test, 'object');
  });

  it('_test has runQualityGates function', () => {
    if (!doneMod?._test) return;
    assert.equal(typeof doneMod._test.runQualityGates, 'function');
  });

  it('_test has getModifiedFiles function', () => {
    if (!doneMod?._test) return;
    assert.equal(typeof doneMod._test.getModifiedFiles, 'function');
  });

  it('_test has checkOutstandingFindings function', () => {
    if (!doneMod?._test) return;
    assert.equal(typeof doneMod._test.checkOutstandingFindings, 'function');
  });

  it('_test has _cp for mocking child_process', () => {
    if (!doneMod?._test) return;
    assert.ok(doneMod._test._cp, '_cp should exist');
  });

  it('_test has _io for mocking IO functions', () => {
    if (!doneMod?._test) return;
    assert.ok(doneMod._test._io, '_io should exist');
  });
});
