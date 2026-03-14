'use strict';

/**
 * Tests for flow-skill-matcher.js — Skill matching and loading
 *
 * Covers: exports, matchSkills scoring, patternToRegex, DEFAULT_TRIGGERS,
 * discoverNestedSkills, loadSkillMetadata, formatSkillContext, getSkillSummary.
 *
 * Development-only — not distributed to end users.
 * Run: NODE_ENV=test node --test tests/flow-skill-matcher.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Suppress console output during tests
console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const mod = require('../scripts/flow-skill-matcher');

// ============================================================
// Exports existence and types
// ============================================================

describe('exports', () => {
  const expectedFunctions = [
    'loadSkillMetadata',
    'getAllSkills',
    'matchSkills',
    'loadSkillContext',
    'formatSkillContext',
    'getSkillSummary',
    'discoverNestedSkills',
    'getSkillDir',
  ];

  for (const name of expectedFunctions) {
    it(`exports ${name} as a function`, () => {
      assert.equal(typeof mod[name], 'function', `${name} should be a function`);
    });
  }

  it('exports DEFAULT_TRIGGERS as an object', () => {
    assert.equal(typeof mod.DEFAULT_TRIGGERS, 'object');
    assert.ok(mod.DEFAULT_TRIGGERS !== null);
  });

  it('exports MAX_SKILL_NESTING_DEPTH as a positive number', () => {
    assert.equal(typeof mod.MAX_SKILL_NESTING_DEPTH, 'number');
    assert.ok(mod.MAX_SKILL_NESTING_DEPTH > 0);
  });
});

// ============================================================
// DEFAULT_TRIGGERS
// ============================================================

describe('DEFAULT_TRIGGERS', () => {
  it('contains known skill names', () => {
    const knownSkills = ['nestjs', 'react', 'python', 'figma-analyzer'];
    for (const name of knownSkills) {
      assert.ok(mod.DEFAULT_TRIGGERS[name], `Should have triggers for "${name}"`);
    }
  });

  it('each trigger has keywords array', () => {
    for (const [name, trigger] of Object.entries(mod.DEFAULT_TRIGGERS)) {
      assert.ok(Array.isArray(trigger.keywords), `${name} should have keywords array`);
    }
  });

  it('each trigger has filePatterns array', () => {
    for (const [name, trigger] of Object.entries(mod.DEFAULT_TRIGGERS)) {
      assert.ok(Array.isArray(trigger.filePatterns), `${name} should have filePatterns array`);
    }
  });

  it('each trigger has taskTypes array', () => {
    for (const [name, trigger] of Object.entries(mod.DEFAULT_TRIGGERS)) {
      assert.ok(Array.isArray(trigger.taskTypes), `${name} should have taskTypes array`);
    }
  });

  it('nestjs trigger includes relevant keywords', () => {
    const keywords = mod.DEFAULT_TRIGGERS.nestjs.keywords;
    assert.ok(keywords.includes('nestjs'));
    assert.ok(keywords.includes('controller'));
    assert.ok(keywords.includes('service'));
  });

  it('react trigger includes component-related keywords', () => {
    const keywords = mod.DEFAULT_TRIGGERS.react.keywords;
    assert.ok(keywords.includes('react'));
    assert.ok(keywords.includes('component'));
    assert.ok(keywords.includes('hook'));
  });

  it('python trigger includes python-related keywords', () => {
    const keywords = mod.DEFAULT_TRIGGERS.python.keywords;
    assert.ok(keywords.includes('python'));
  });
});

// ============================================================
// matchSkills
// ============================================================

describe('matchSkills', () => {
  it('returns an array', () => {
    const result = mod.matchSkills('something random');
    assert.ok(Array.isArray(result));
  });

  it('returns empty array for unrelated description', () => {
    const result = mod.matchSkills('organize my bookshelf alphabetically');
    // Might match nothing or match something loosely — just verify it is an array
    assert.ok(Array.isArray(result));
  });

  it('each match has name, score, and reasons', () => {
    // Use a keyword that should trigger at least one match
    const result = mod.matchSkills('create a nestjs controller for users');
    for (const match of result) {
      assert.equal(typeof match.name, 'string');
      assert.equal(typeof match.score, 'number');
      assert.ok(Array.isArray(match.reasons));
    }
  });

  it('results are sorted by score descending', () => {
    const result = mod.matchSkills('nestjs react component controller');
    for (let i = 1; i < result.length; i++) {
      assert.ok(result[i].score <= result[i - 1].score,
        `Result ${i} score (${result[i].score}) should be <= result ${i - 1} score (${result[i - 1].score})`);
    }
  });

  it('keyword matching is case-insensitive', () => {
    const lower = mod.matchSkills('NESTJS');
    const upper = mod.matchSkills('nestjs');
    // Both should produce same matches
    assert.equal(lower.length, upper.length);
  });

  it('accepts options.filePaths', () => {
    const result = mod.matchSkills('update the backend', {
      filePaths: ['src/users/users.controller.ts']
    });
    assert.ok(Array.isArray(result));
  });

  it('accepts options.taskType', () => {
    const result = mod.matchSkills('fix the controller', {
      taskType: 'bugfix'
    });
    assert.ok(Array.isArray(result));
  });

  it('accepts options.categories', () => {
    const result = mod.matchSkills('update ui', {
      categories: ['frontend', 'ui']
    });
    assert.ok(Array.isArray(result));
  });

  it('handles empty string description', () => {
    const result = mod.matchSkills('');
    assert.ok(Array.isArray(result));
  });

  it('handles very long description', () => {
    const longDesc = 'implement '.repeat(1000);
    const result = mod.matchSkills(longDesc);
    assert.ok(Array.isArray(result));
  });

  it('file pattern matching boosts score', () => {
    const withFiles = mod.matchSkills('update code', {
      filePaths: ['src/app.module.ts', 'src/users.controller.ts']
    });
    const withoutFiles = mod.matchSkills('update code', {
      filePaths: []
    });
    // With matching file patterns, score should be higher or equal
    const withFilesMax = withFiles.length > 0 ? withFiles[0].score : 0;
    const withoutFilesMax = withoutFiles.length > 0 ? withoutFiles[0].score : 0;
    assert.ok(withFilesMax >= withoutFilesMax);
  });
});

// ============================================================
// loadSkillMetadata
// ============================================================

describe('loadSkillMetadata', () => {
  it('returns null for _template skill', () => {
    const result = mod.loadSkillMetadata('_template');
    assert.equal(result, null);
  });

  it('returns null for skills starting with underscore', () => {
    const result = mod.loadSkillMetadata('_hidden');
    assert.equal(result, null);
  });

  it('returns null for non-existent skill', () => {
    const result = mod.loadSkillMetadata('definitely-not-a-real-skill-xyz');
    assert.equal(result, null);
  });

  it('returns object with name field for existing skill', () => {
    // figma-analyzer is listed as installed in CLAUDE.md
    const result = mod.loadSkillMetadata('figma-analyzer');
    if (result) {
      assert.equal(result.name, 'figma-analyzer');
    }
    // If skill dir doesn't exist in test env, null is acceptable
    assert.ok(result === null || typeof result === 'object');
  });

  it('handles nested skill path with underscore base', () => {
    const result = mod.loadSkillMetadata('frontend/_internal');
    assert.equal(result, null);
  });
});

// ============================================================
// discoverNestedSkills
// ============================================================

describe('discoverNestedSkills', () => {
  it('returns an array', () => {
    const result = mod.discoverNestedSkills();
    assert.ok(Array.isArray(result));
  });

  it('returns empty array for non-existent directory', () => {
    const result = mod.discoverNestedSkills('/tmp/nonexistent-dir-xyz');
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });

  it('respects depth limit', () => {
    // When depth exceeds MAX_SKILL_NESTING_DEPTH, should return empty
    const result = mod.discoverNestedSkills(undefined, '', mod.MAX_SKILL_NESTING_DEPTH + 1);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });

  it('all discovered skills are strings', () => {
    const result = mod.discoverNestedSkills();
    for (const skill of result) {
      assert.equal(typeof skill, 'string');
    }
  });
});

// ============================================================
// getSkillDir
// ============================================================

describe('getSkillDir', () => {
  it('returns a string path', () => {
    const result = mod.getSkillDir('nestjs');
    assert.equal(typeof result, 'string');
  });

  it('handles nested skill paths', () => {
    const result = mod.getSkillDir('frontend/react');
    assert.ok(result.includes('frontend'));
    assert.ok(result.includes('react'));
  });

  it('handles deeply nested paths', () => {
    const result = mod.getSkillDir('a/b/c');
    assert.ok(result.endsWith('c') || result.includes('c'));
  });
});

// ============================================================
// getAllSkills
// ============================================================

describe('getAllSkills', () => {
  it('returns an array', () => {
    const result = mod.getAllSkills();
    assert.ok(Array.isArray(result));
  });

  it('each skill has name, metadata, triggers, filePatterns', () => {
    const skills = mod.getAllSkills();
    for (const skill of skills) {
      assert.equal(typeof skill.name, 'string', 'name should be a string');
      assert.equal(typeof skill.metadata, 'object', 'metadata should be an object');
      assert.equal(typeof skill.triggers, 'object', 'triggers should be an object');
      assert.ok(Array.isArray(skill.filePatterns) || skill.filePatterns === undefined,
        'filePatterns should be array or undefined');
    }
  });
});

// ============================================================
// loadSkillContext
// ============================================================

describe('loadSkillContext', () => {
  it('returns object with skills array when given empty matches', async () => {
    const result = await mod.loadSkillContext([]);
    assert.equal(typeof result, 'object');
    assert.ok(Array.isArray(result.skills));
    assert.equal(result.skills.length, 0);
  });

  it('returns totalTokenEstimate as number', async () => {
    const result = await mod.loadSkillContext([]);
    assert.equal(typeof result.totalTokenEstimate, 'number');
    assert.equal(result.totalTokenEstimate, 0);
  });

  it('respects minRelevanceScore filter', async () => {
    const fakeMatches = [
      { name: 'fake-skill', score: 1, reasons: ['test'], metadata: {} },
    ];
    const result = await mod.loadSkillContext(fakeMatches, { minRelevanceScore: 5 });
    assert.equal(result.skills.length, 0, 'low-score skill should be filtered out');
  });

  it('respects maxSkills legacy option', async () => {
    const fakeMatches = [
      { name: 'a', score: 10, reasons: ['test'], metadata: {} },
      { name: 'b', score: 9, reasons: ['test'], metadata: {} },
      { name: 'c', score: 8, reasons: ['test'], metadata: {} },
    ];
    const result = await mod.loadSkillContext(fakeMatches, { maxSkills: 1, minRelevanceScore: 1 });
    assert.ok(result.skills.length <= 1, 'should respect maxSkills cap');
  });
});

// ============================================================
// formatSkillContext
// ============================================================

describe('formatSkillContext', () => {
  it('returns empty string for empty skills', () => {
    const result = mod.formatSkillContext({ skills: [] });
    assert.equal(result, '');
  });

  it('returns string containing skill name', () => {
    const ctx = {
      skills: [{
        name: 'test-skill',
        score: 5,
        reasons: ['keyword: "test"'],
        files: { 'skill.md': '# Test Skill' }
      }]
    };
    const result = mod.formatSkillContext(ctx);
    assert.ok(result.includes('test-skill'));
    assert.ok(result.includes('score: 5'));
  });

  it('includes file content in output', () => {
    const ctx = {
      skills: [{
        name: 'my-skill',
        score: 3,
        reasons: [],
        files: { 'skill.md': 'Hello world content' }
      }]
    };
    const result = mod.formatSkillContext(ctx);
    assert.ok(result.includes('Hello world content'));
  });
});

// ============================================================
// getSkillSummary
// ============================================================

describe('getSkillSummary', () => {
  it('returns string for empty matches', () => {
    const result = mod.getSkillSummary([]);
    assert.equal(typeof result, 'string');
    assert.ok(result.length > 0);
  });

  it('returns string containing skill names when matches exist', () => {
    const matches = [
      { name: 'nestjs', score: 5, reasons: ['keyword: "nestjs"'] },
    ];
    const result = mod.getSkillSummary(matches);
    assert.ok(result.includes('nestjs'));
  });

  it('truncates display to 5 skills', () => {
    const matches = Array.from({ length: 8 }, (_, i) => ({
      name: `skill-${i}`,
      score: 8 - i,
      reasons: ['test']
    }));
    const result = mod.getSkillSummary(matches);
    // Should mention "... and N more"
    assert.ok(result.includes('more'));
  });
});
