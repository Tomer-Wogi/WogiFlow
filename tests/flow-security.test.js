'use strict';

/**
 * Tests for flow-security.js — security utilities
 *
 * Covers: CREDENTIAL_SCAN_PATTERNS, path validation, git ref validation,
 * repo format validation, IP detection, search pattern sanitization,
 * commit message sanitization.
 *
 * Development-only — not distributed to end users.
 * Run: NODE_ENV=test node --test tests/flow-security.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Suppress console output during tests
console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const {
  CREDENTIAL_SCAN_PATTERNS,
  validatePathWithinProject,
  sanitizePath,
  validateGitRef,
  validateRepoFormat,
  isPrivateIP,
  sanitizeSearchPattern,
  sanitizeCommitMessage,
  escapeRegex,
  MAX_REGEX_LENGTH,
  VALID_CODE_EXTENSIONS,
} = require('../scripts/flow-security');

// ============================================================
// CREDENTIAL_SCAN_PATTERNS
// ============================================================

describe('CREDENTIAL_SCAN_PATTERNS', () => {
  it('is an array with more than 5 patterns', () => {
    assert.ok(Array.isArray(CREDENTIAL_SCAN_PATTERNS));
    assert.ok(CREDENTIAL_SCAN_PATTERNS.length > 5,
      `Expected >5 patterns, got ${CREDENTIAL_SCAN_PATTERNS.length}`);
  });

  it('each pattern has pattern (RegExp) and name (string) fields', () => {
    for (const entry of CREDENTIAL_SCAN_PATTERNS) {
      assert.ok(entry.pattern instanceof RegExp,
        `Pattern "${entry.name}" should have a RegExp 'pattern' field`);
      assert.equal(typeof entry.name, 'string',
        `Pattern should have a string 'name' field`);
      assert.ok(entry.name.length > 0, 'name should not be empty');
    }
  });

  it('each pattern has severity and type fields', () => {
    for (const entry of CREDENTIAL_SCAN_PATTERNS) {
      assert.ok(['critical', 'high'].includes(entry.severity),
        `${entry.name}: severity should be critical or high, got ${entry.severity}`);
      assert.equal(entry.type, 'credential',
        `${entry.name}: type should be credential`);
    }
  });

  it('matches OpenAI API key format (sk-...)', () => {
    const text = '"sk-abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmn"';
    const matched = CREDENTIAL_SCAN_PATTERNS.some(p => {
      p.pattern.lastIndex = 0;
      return p.pattern.test(text);
    });
    assert.ok(matched, 'Should match sk- prefixed API keys');
  });

  it('matches AWS access key format (AKIA...)', () => {
    const text = 'AKIAIOSFODNN7EXAMPLE';
    const matched = CREDENTIAL_SCAN_PATTERNS.some(p => {
      p.pattern.lastIndex = 0;
      return p.pattern.test(text);
    });
    assert.ok(matched, 'Should match AKIA prefixed AWS keys');
  });

  it('matches GitHub personal token (ghp_...)', () => {
    const text = '"ghp_abcdefghijklmnopqrstuvwxyz1234567890"';
    const matched = CREDENTIAL_SCAN_PATTERNS.some(p => {
      p.pattern.lastIndex = 0;
      return p.pattern.test(text);
    });
    assert.ok(matched, 'Should match ghp_ prefixed tokens');
  });

  it('matches Stripe live key (sk_live_...)', () => {
    // Test the pattern regex directly (avoid triggering GitHub secret scanning)
    const _stripePattern = CREDENTIAL_SCAN_PATTERNS.find(p => p.name.toLowerCase().includes('stripe'));
    const text = 'sk_' + 'live_' + 'x'.repeat(24);
    const matched = CREDENTIAL_SCAN_PATTERNS.some(p => {
      p.pattern.lastIndex = 0;
      return p.pattern.test(text);
    });
    assert.ok(matched, 'Should match Stripe live keys');
  });

  it('matches Slack tokens (xoxb-...)', () => {
    const text = 'xoxb-123456789012-1234567890';
    const matched = CREDENTIAL_SCAN_PATTERNS.some(p => {
      p.pattern.lastIndex = 0;
      return p.pattern.test(text);
    });
    assert.ok(matched, 'Should match Slack tokens');
  });

  it('matches database connection strings with credentials', () => {
    const text = 'mongodb://user:password@host:27017/db';
    const matched = CREDENTIAL_SCAN_PATTERNS.some(p => {
      p.pattern.lastIndex = 0;
      return p.pattern.test(text);
    });
    assert.ok(matched, 'Should match DB connection strings');
  });

  it('matches private key headers', () => {
    const text = '-----BEGIN RSA PRIVATE KEY-----';
    const matched = CREDENTIAL_SCAN_PATTERNS.some(p => {
      p.pattern.lastIndex = 0;
      return p.pattern.test(text);
    });
    assert.ok(matched, 'Should match private key headers');
  });

  it('does not false-positive on normal variable names', () => {
    const normalCode = 'const isAuthenticated = true;';
    const matched = CREDENTIAL_SCAN_PATTERNS.some(p => {
      p.pattern.lastIndex = 0;
      return p.pattern.test(normalCode);
    });
    assert.equal(matched, false, 'Should not match normal code');
  });

  it('does not false-positive on short values', () => {
    const shortValue = 'password = "abc"';
    const matched = CREDENTIAL_SCAN_PATTERNS.some(p => {
      p.pattern.lastIndex = 0;
      return p.pattern.test(shortValue);
    });
    assert.equal(matched, false, 'Should not match short values (< 8 chars)');
  });

  it('does not false-positive on import statements', () => {
    const importStatement = "const token = require('./token-utils');";
    const matched = CREDENTIAL_SCAN_PATTERNS.some(p => {
      p.pattern.lastIndex = 0;
      return p.pattern.test(importStatement);
    });
    assert.equal(matched, false, 'Should not match require() statements');
  });
});

// ============================================================
// validatePathWithinProject
// ============================================================

describe('validatePathWithinProject', () => {
  it('returns true for path within project', () => {
    assert.equal(validatePathWithinProject('src/index.js', '/tmp/project'), true);
  });

  it('returns false for path traversal with ../', () => {
    assert.equal(validatePathWithinProject('../../etc/passwd', '/tmp/project'), false);
  });

  it('returns false for null filePath', () => {
    assert.equal(validatePathWithinProject(null, '/tmp/project'), false);
  });

  it('returns false for null projectRoot', () => {
    assert.equal(validatePathWithinProject('src/index.js', null), false);
  });

  it('returns true for exact project root', () => {
    assert.equal(validatePathWithinProject('.', '/tmp/project'), true);
  });

  it('returns false for sibling directory path', () => {
    // /tmp/project-other is not within /tmp/project
    assert.equal(validatePathWithinProject('/tmp/project-other/file.js', '/tmp/project'), false);
  });
});

// ============================================================
// sanitizePath
// ============================================================

describe('sanitizePath', () => {
  it('returns absolute path for valid relative path', () => {
    const result = sanitizePath('src/index.js', '/tmp/project');
    assert.ok(result);
    assert.ok(result.startsWith('/tmp/project'));
  });

  it('returns null for null input', () => {
    assert.equal(sanitizePath(null, '/tmp/project'), null);
  });

  it('returns null for non-string input', () => {
    assert.equal(sanitizePath(123, '/tmp/project'), null);
  });

  it('returns null for path traversal', () => {
    assert.equal(sanitizePath('../../etc/passwd', '/tmp/project'), null);
  });
});

// ============================================================
// validateGitRef
// ============================================================

describe('validateGitRef', () => {
  it('accepts valid branch name', () => {
    assert.equal(validateGitRef('main'), true);
    assert.equal(validateGitRef('feature/my-branch'), true);
    assert.equal(validateGitRef('release-1.0'), true);
  });

  it('rejects null', () => {
    assert.equal(validateGitRef(null), false);
  });

  it('rejects non-string', () => {
    assert.equal(validateGitRef(123), false);
  });

  it('rejects empty string', () => {
    assert.equal(validateGitRef(''), false);
  });

  it('rejects ref starting with dot', () => {
    assert.equal(validateGitRef('.hidden'), false);
  });

  it('rejects ref ending with dot', () => {
    assert.equal(validateGitRef('branch.'), false);
  });

  it('rejects ref with double dots', () => {
    assert.equal(validateGitRef('main..branch'), false);
  });

  it('rejects ref with space', () => {
    assert.equal(validateGitRef('my branch'), false);
  });

  it('rejects ref with tilde', () => {
    assert.equal(validateGitRef('branch~1'), false);
  });

  it('rejects ref with caret', () => {
    assert.equal(validateGitRef('branch^2'), false);
  });

  it('rejects ref with colon', () => {
    assert.equal(validateGitRef('refs:heads'), false);
  });

  it('rejects ref with backslash', () => {
    assert.equal(validateGitRef('branch\\name'), false);
  });

  it('rejects ref with @{', () => {
    assert.equal(validateGitRef('branch@{0}'), false);
  });

  it('rejects ref over 255 chars', () => {
    assert.equal(validateGitRef('a'.repeat(256)), false);
  });
});

// ============================================================
// validateRepoFormat
// ============================================================

describe('validateRepoFormat', () => {
  it('accepts valid owner/repo format', () => {
    assert.equal(validateRepoFormat('owner/repo'), true);
    assert.equal(validateRepoFormat('my-org/my-project'), true);
    assert.equal(validateRepoFormat('user123/repo.js'), true);
  });

  it('rejects null', () => {
    assert.equal(validateRepoFormat(null), false);
  });

  it('rejects non-string', () => {
    assert.equal(validateRepoFormat(42), false);
  });

  it('rejects missing slash', () => {
    assert.equal(validateRepoFormat('just-a-name'), false);
  });

  it('rejects multiple slashes', () => {
    assert.equal(validateRepoFormat('a/b/c'), false);
  });
});

// ============================================================
// isPrivateIP
// ============================================================

describe('isPrivateIP', () => {
  it('detects loopback (127.x.x.x)', () => {
    assert.equal(isPrivateIP('127.0.0.1'), true);
    assert.equal(isPrivateIP('127.255.255.255'), true);
  });

  it('detects 10.x.x.x range', () => {
    assert.equal(isPrivateIP('10.0.0.1'), true);
    assert.equal(isPrivateIP('10.255.255.255'), true);
  });

  it('detects 172.16-31.x.x range', () => {
    assert.equal(isPrivateIP('172.16.0.1'), true);
    assert.equal(isPrivateIP('172.31.255.255'), true);
  });

  it('does not match 172.15.x.x or 172.32.x.x', () => {
    assert.equal(isPrivateIP('172.15.0.1'), false);
    assert.equal(isPrivateIP('172.32.0.1'), false);
  });

  it('detects 192.168.x.x range', () => {
    assert.equal(isPrivateIP('192.168.0.1'), true);
    assert.equal(isPrivateIP('192.168.255.255'), true);
  });

  it('detects link-local (169.254.x.x)', () => {
    assert.equal(isPrivateIP('169.254.0.1'), true);
  });

  it('detects localhost string', () => {
    assert.equal(isPrivateIP('localhost'), true);
  });

  it('detects IPv6 loopback', () => {
    assert.equal(isPrivateIP('::1'), true);
  });

  it('returns false for public IP', () => {
    assert.equal(isPrivateIP('8.8.8.8'), false);
    assert.equal(isPrivateIP('1.2.3.4'), false);
  });

  it('returns false for null/empty', () => {
    assert.equal(isPrivateIP(null), false);
    assert.equal(isPrivateIP(''), false);
  });
});

// ============================================================
// sanitizeSearchPattern
// ============================================================

describe('sanitizeSearchPattern', () => {
  it('returns escaped pattern for valid input', () => {
    const result = sanitizeSearchPattern('hello.world');
    assert.equal(result, 'hello\\.world');
  });

  it('returns null for null input', () => {
    assert.equal(sanitizeSearchPattern(null), null);
  });

  it('returns null for non-string', () => {
    assert.equal(sanitizeSearchPattern(42), null);
  });

  it('returns null for pattern exceeding max length', () => {
    const longPattern = 'a'.repeat(MAX_REGEX_LENGTH + 1);
    assert.equal(sanitizeSearchPattern(longPattern), null);
  });

  it('returns unescaped pattern when escape=false', () => {
    const result = sanitizeSearchPattern('hello.*', { escape: false });
    assert.equal(result, 'hello.*');
  });

  it('respects custom maxLength', () => {
    assert.equal(sanitizeSearchPattern('hello', { maxLength: 3 }), null);
    assert.ok(sanitizeSearchPattern('hi', { maxLength: 3 }) !== null);
  });
});

// ============================================================
// sanitizeCommitMessage
// ============================================================

describe('sanitizeCommitMessage', () => {
  it('returns normal text unchanged', () => {
    assert.equal(sanitizeCommitMessage('fix: resolve bug in login'), 'fix: resolve bug in login');
  });

  it('strips control characters', () => {
    const result = sanitizeCommitMessage('hello\x00world\x07');
    assert.equal(result, 'helloworld');
  });

  it('preserves newlines', () => {
    const result = sanitizeCommitMessage('line1\nline2');
    assert.equal(result, 'line1\nline2');
  });

  it('truncates at 5000 chars', () => {
    const longMsg = 'a'.repeat(6000);
    const result = sanitizeCommitMessage(longMsg);
    assert.equal(result.length, 5000);
  });

  it('returns empty string for null', () => {
    assert.equal(sanitizeCommitMessage(null), '');
  });

  it('returns empty string for non-string', () => {
    assert.equal(sanitizeCommitMessage(42), '');
  });
});

// ============================================================
// escapeRegex
// ============================================================

describe('escapeRegex', () => {
  it('escapes regex special characters', () => {
    assert.equal(escapeRegex('hello.world'), 'hello\\.world');
    assert.equal(escapeRegex('a*b+c'), 'a\\*b\\+c');
    assert.equal(escapeRegex('(test)'), '\\(test\\)');
    assert.equal(escapeRegex('[a-z]'), '\\[a-z\\]');
  });

  it('returns empty string for null/undefined', () => {
    assert.equal(escapeRegex(null), '');
    assert.equal(escapeRegex(undefined), '');
  });

  it('returns empty string for non-string', () => {
    assert.equal(escapeRegex(123), '');
  });

  it('returns plain text unchanged', () => {
    assert.equal(escapeRegex('hello'), 'hello');
  });
});

// ============================================================
// Constants
// ============================================================

describe('MAX_REGEX_LENGTH', () => {
  it('is a positive number', () => {
    assert.equal(typeof MAX_REGEX_LENGTH, 'number');
    assert.ok(MAX_REGEX_LENGTH > 0);
    assert.ok(MAX_REGEX_LENGTH <= 1000);
  });
});

describe('VALID_CODE_EXTENSIONS', () => {
  it('is an array of strings', () => {
    assert.ok(Array.isArray(VALID_CODE_EXTENSIONS));
    assert.ok(VALID_CODE_EXTENSIONS.length > 0);
    for (const ext of VALID_CODE_EXTENSIONS) {
      assert.equal(typeof ext, 'string');
      assert.ok(ext.startsWith('.'), `Extension should start with dot: ${ext}`);
    }
  });

  it('includes common JS/TS extensions', () => {
    assert.ok(VALID_CODE_EXTENSIONS.includes('.js'));
    assert.ok(VALID_CODE_EXTENSIONS.includes('.ts'));
  });
});
