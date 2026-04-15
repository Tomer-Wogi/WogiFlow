'use strict';

/**
 * Tests for scripts/hooks/core/manager-boundary-gate.js (Wave F hook coverage).
 *
 * Covers: activation guard (WOGI_REPO_NAME !== 'manager' → fail-open), fail-open
 * when no members manifest, isAllowedReadCommand pattern matching (cat/ls/head/
 * tail/wc/git log/git status/git diff/grep/find/curl/wget), clearCache idempotency,
 * checkManagerBoundary result contract for each tool class.
 *
 * Tests scope env var changes with save/restore to avoid polluting the session.
 *
 * Run: NODE_ENV=test node --test tests/flow-hooks-manager-boundary-gate.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const {
  checkManagerBoundary,
  isAllowedReadCommand,
  clearCache,
  getMemberPaths,
  getMemberPort,
  findMemberForPath,
} = require('../scripts/hooks/core/manager-boundary-gate');

const ORIGINAL_REPO = process.env.WOGI_REPO_NAME;
const ORIGINAL_WS_ROOT = process.env.WOGI_WORKSPACE_ROOT;

function restoreEnv() {
  if (ORIGINAL_REPO !== undefined) process.env.WOGI_REPO_NAME = ORIGINAL_REPO;
  else delete process.env.WOGI_REPO_NAME;
  if (ORIGINAL_WS_ROOT !== undefined) process.env.WOGI_WORKSPACE_ROOT = ORIGINAL_WS_ROOT;
  else delete process.env.WOGI_WORKSPACE_ROOT;
  clearCache();
}

// ============================================================
// Activation — WOGI_REPO_NAME guard
// ============================================================

describe('checkManagerBoundary — activation guard', () => {
  beforeEach(() => clearCache());
  afterEach(restoreEnv);

  it('fails open when WOGI_REPO_NAME is undefined', () => {
    delete process.env.WOGI_REPO_NAME;
    const r = checkManagerBoundary('Edit', { file_path: '/any/path.js' });
    assert.equal(r.blocked, false);
  });

  it('fails open when WOGI_REPO_NAME is not "manager"', () => {
    process.env.WOGI_REPO_NAME = 'worker-a';
    const r = checkManagerBoundary('Edit', { file_path: '/any/path.js' });
    assert.equal(r.blocked, false);
  });

  it('fails open when manager mode but no members manifest', () => {
    process.env.WOGI_REPO_NAME = 'manager';
    // No WOGI_WORKSPACE_ROOT set → getMemberPaths returns []
    delete process.env.WOGI_WORKSPACE_ROOT;
    clearCache();
    const r = checkManagerBoundary('Edit', { file_path: '/any/path.js' });
    assert.equal(r.blocked, false);
  });
});

// ============================================================
// isAllowedReadCommand — allowlist
// ============================================================

describe('isAllowedReadCommand — allowlist patterns', () => {
  it('allows cat .workflow/*', () => {
    assert.equal(isAllowedReadCommand('cat /path/to/.workflow/state/ready.json'), true);
  });

  it('allows ls .workflow', () => {
    assert.equal(isAllowedReadCommand('ls /path/.workflow/'), true);
  });

  it('allows head/tail/wc on .workflow', () => {
    assert.equal(isAllowedReadCommand('head /path/.workflow/log.md'), true);
    assert.equal(isAllowedReadCommand('tail /path/.workflow/log.md'), true);
    assert.equal(isAllowedReadCommand('wc /path/.workflow/log.md'), true);
  });

  it('allows cat package.json', () => {
    assert.equal(isAllowedReadCommand('cat /path/package.json'), true);
  });

  it('allows git log', () => {
    assert.equal(isAllowedReadCommand('git log -5'), true);
  });

  it('allows git log with -C', () => {
    assert.equal(isAllowedReadCommand('git -C /some/path log'), true);
  });

  it('allows git status, diff, show, blame, rev-parse, branch', () => {
    assert.equal(isAllowedReadCommand('git status'), true);
    assert.equal(isAllowedReadCommand('git diff HEAD'), true);
    assert.equal(isAllowedReadCommand('git show abc123'), true);
    assert.equal(isAllowedReadCommand('git blame foo.js'), true);
    assert.equal(isAllowedReadCommand('git rev-parse HEAD'), true);
    assert.equal(isAllowedReadCommand('git branch'), true);
  });

  it('allows git tag -l', () => {
    assert.equal(isAllowedReadCommand('git tag -l'), true);
  });

  it('allows git ls-files', () => {
    assert.equal(isAllowedReadCommand('git ls-files'), true);
  });

  it('allows grep/find for reading', () => {
    assert.equal(isAllowedReadCommand('grep pattern file.js'), true);
    assert.equal(isAllowedReadCommand('find . -name "*.js"'), true);
  });

  it('allows curl (dispatch mechanism)', () => {
    assert.equal(isAllowedReadCommand('curl -X POST http://localhost:3000'), true);
  });

  it('allows wget for health checks', () => {
    assert.equal(isAllowedReadCommand('wget http://localhost:3000/health'), true);
  });

  it('does NOT allow npm install / test / run', () => {
    assert.equal(isAllowedReadCommand('npm install'), false);
    assert.equal(isAllowedReadCommand('npm test'), false);
    assert.equal(isAllowedReadCommand('npm run build'), false);
  });

  it('does NOT allow rm / mv / cp', () => {
    assert.equal(isAllowedReadCommand('rm foo.js'), false);
    assert.equal(isAllowedReadCommand('mv a.js b.js'), false);
    assert.equal(isAllowedReadCommand('cp a.js b.js'), false);
  });

  it('does NOT allow git push / pull / commit / reset', () => {
    assert.equal(isAllowedReadCommand('git push origin master'), false);
    assert.equal(isAllowedReadCommand('git pull'), false);
    assert.equal(isAllowedReadCommand('git commit -m "x"'), false);
    assert.equal(isAllowedReadCommand('git reset --hard'), false);
  });

  it('does NOT allow arbitrary shell commands', () => {
    assert.equal(isAllowedReadCommand('node script.js'), false);
    assert.equal(isAllowedReadCommand('bash install.sh'), false);
  });
});

// ============================================================
// findMemberForPath / getMemberPort
// ============================================================

describe('findMemberForPath — no-members case', () => {
  beforeEach(() => clearCache());
  afterEach(restoreEnv);

  it('returns null when no workspace root set', () => {
    delete process.env.WOGI_WORKSPACE_ROOT;
    clearCache();
    assert.equal(findMemberForPath('/any/path'), null);
  });

  it('returns null for non-absolute paths', () => {
    clearCache();
    assert.equal(findMemberForPath('relative/path'), null);
    assert.equal(findMemberForPath(null), null);
    assert.equal(findMemberForPath(''), null);
  });
});

describe('getMemberPort', () => {
  beforeEach(() => clearCache());
  afterEach(restoreEnv);

  it('returns null when no workspace root', () => {
    delete process.env.WOGI_WORKSPACE_ROOT;
    assert.equal(getMemberPort('any'), null);
  });

  it('returns null when manifest does not exist', () => {
    process.env.WOGI_WORKSPACE_ROOT = '/nonexistent/path';
    assert.equal(getMemberPort('some-member'), null);
  });
});

// ============================================================
// getMemberPaths
// ============================================================

describe('getMemberPaths', () => {
  beforeEach(() => clearCache());
  afterEach(restoreEnv);

  it('returns empty array when WOGI_WORKSPACE_ROOT is unset', () => {
    delete process.env.WOGI_WORKSPACE_ROOT;
    clearCache();
    const paths = getMemberPaths();
    assert.ok(Array.isArray(paths));
    assert.equal(paths.length, 0);
  });

  it('returns empty array when workspace root is relative (not absolute)', () => {
    process.env.WOGI_WORKSPACE_ROOT = 'relative/path';
    clearCache();
    assert.deepEqual(getMemberPaths(), []);
  });

  it('returns empty array when manifest does not exist', () => {
    process.env.WOGI_WORKSPACE_ROOT = '/tmp/nonexistent-workspace-xyz';
    clearCache();
    assert.deepEqual(getMemberPaths(), []);
  });
});

// ============================================================
// clearCache
// ============================================================

describe('clearCache', () => {
  it('does not throw on repeated calls', () => {
    assert.doesNotThrow(() => clearCache());
    assert.doesNotThrow(() => clearCache());
  });
});

// ============================================================
// checkManagerBoundary — result contract
// ============================================================

describe('checkManagerBoundary — result contract', () => {
  afterEach(restoreEnv);

  it('returns { blocked: false } for all tool names when not in manager mode', () => {
    delete process.env.WOGI_REPO_NAME;
    for (const tool of ['Edit', 'Write', 'Read', 'Glob', 'Grep', 'Bash', 'TodoWrite']) {
      const r = checkManagerBoundary(tool, {});
      assert.equal(r.blocked, false, `${tool} should not be blocked`);
    }
  });

  it('never throws for missing toolInput', () => {
    delete process.env.WOGI_REPO_NAME;
    assert.doesNotThrow(() => checkManagerBoundary('Edit', null));
    assert.doesNotThrow(() => checkManagerBoundary('Edit', undefined));
  });
});
