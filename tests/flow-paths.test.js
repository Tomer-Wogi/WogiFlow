'use strict';

/**
 * Tests for flow-paths.js — path constants and utilities
 *
 * Development-only — not distributed to end users.
 * Run: node --test tests/flow-paths.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  getProjectRoot,
  PROJECT_ROOT,
  PATHS,
  isPathWithinProject,
  getSpecFilePath,
  checkSpecMigration,
} = require('../scripts/flow-paths');

describe('PROJECT_ROOT', () => {
  it('is a string', () => {
    assert.equal(typeof PROJECT_ROOT, 'string');
  });

  it('is an absolute path', () => {
    assert.ok(path.isAbsolute(PROJECT_ROOT), `Expected absolute path, got: ${PROJECT_ROOT}`);
  });
});

describe('PATHS', () => {
  it('root equals PROJECT_ROOT', () => {
    assert.equal(PATHS.root, PROJECT_ROOT);
  });

  it('config ends with .workflow/config.json', () => {
    assert.ok(
      PATHS.config.endsWith(path.join('.workflow', 'config.json')),
      `Expected config to end with .workflow/config.json, got: ${PATHS.config}`
    );
  });

  it('ready ends with .workflow/state/ready.json', () => {
    assert.ok(
      PATHS.ready.endsWith(path.join('.workflow', 'state', 'ready.json')),
      `Expected ready to end with .workflow/state/ready.json, got: ${PATHS.ready}`
    );
  });

  it('all values are strings', () => {
    for (const [key, value] of Object.entries(PATHS)) {
      assert.equal(typeof value, 'string', `PATHS.${key} should be a string, got ${typeof value}`);
    }
  });
});

describe('isPathWithinProject', () => {
  it('returns true for paths inside project', () => {
    const inside = path.join(PROJECT_ROOT, 'scripts', 'flow-paths.js');
    assert.equal(isPathWithinProject(inside), true);
  });

  it('returns true for PROJECT_ROOT itself', () => {
    assert.equal(isPathWithinProject(PROJECT_ROOT), true);
  });

  it('returns false for paths outside project', () => {
    assert.equal(isPathWithinProject('/tmp/evil'), false);
  });

  it('handles path traversal attempts', () => {
    const traversal = path.join(PROJECT_ROOT, '..', '..', '..', 'etc', 'passwd');
    assert.equal(isPathWithinProject(traversal), false);
  });

  it('works with custom baseDir', () => {
    const customBase = '/tmp/test-base';
    const inside = path.join(customBase, 'subdir', 'file.txt');
    assert.equal(isPathWithinProject(inside, customBase), true);

    const outside = '/var/log/something';
    assert.equal(isPathWithinProject(outside, customBase), false);
  });
});

describe('getProjectRoot', () => {
  it('returns a string', () => {
    const result = getProjectRoot();
    assert.equal(typeof result, 'string');
  });

  it('returns an absolute path', () => {
    const result = getProjectRoot();
    assert.ok(path.isAbsolute(result), `Expected absolute path, got: ${result}`);
  });
});

describe('getSpecFilePath', () => {
  it('returns null for unknown spec name', () => {
    // Suppress console output from the warning
    const originalLog = console.log;
    console.log = () => {};
    try {
      const result = getSpecFilePath('nonexistent-spec');
      assert.equal(result, null);
    } finally {
      console.log = originalLog;
    }
  });

  it('returns a string or null for known spec names', () => {
    const originalLog = console.log;
    console.log = () => {};
    try {
      for (const name of ['stack', 'architecture', 'testing']) {
        const result = getSpecFilePath(name);
        assert.ok(
          result === null || typeof result === 'string',
          `getSpecFilePath('${name}') should return string or null, got: ${typeof result}`
        );
      }
    } finally {
      console.log = originalLog;
    }
  });
});

describe('checkSpecMigration', () => {
  it('returns an array', () => {
    const result = checkSpecMigration();
    assert.ok(Array.isArray(result), `Expected array, got: ${typeof result}`);
  });

  it('array items have name, from, and to properties', () => {
    const result = checkSpecMigration();
    for (const item of result) {
      assert.equal(typeof item.name, 'string');
      assert.equal(typeof item.from, 'string');
      assert.equal(typeof item.to, 'string');
    }
  });
});
