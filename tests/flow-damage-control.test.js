'use strict';

/**
 * Tests for flow-damage-control.js — damage control / destructive command protection
 *
 * Development-only — not distributed to end users.
 * Run: node --test tests/flow-damage-control.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const dc = require('../scripts/flow-damage-control');

// ============================================================
// 1. Module loads without errors and exports expected API
// ============================================================

describe('module exports', () => {
  it('loads without errors', () => {
    assert.ok(dc, 'Module should export an object');
  });

  it('exports checkEvent function', () => {
    assert.equal(typeof dc.checkEvent, 'function');
  });

  it('exports checkBashEvent function', () => {
    assert.equal(typeof dc.checkBashEvent, 'function');
  });

  it('exports checkFileEvent function', () => {
    assert.equal(typeof dc.checkFileEvent, 'function');
  });

  it('exports checkCommand function', () => {
    assert.equal(typeof dc.checkCommand, 'function');
  });

  it('exports checkPath function', () => {
    assert.equal(typeof dc.checkPath, 'function');
  });

  it('exports isSafeCommand function', () => {
    assert.equal(typeof dc.isSafeCommand, 'function');
  });

  it('exports parseSimpleYaml function', () => {
    assert.equal(typeof dc.parseSimpleYaml, 'function');
  });

  it('exports safeRegExp function', () => {
    assert.equal(typeof dc.safeRegExp, 'function');
  });

  it('exports safeRegexTest function', () => {
    assert.equal(typeof dc.safeRegexTest, 'function');
  });

  it('exports promptHookCheck function', () => {
    assert.equal(typeof dc.promptHookCheck, 'function');
  });

  it('exports loadPatterns function', () => {
    assert.equal(typeof dc.loadPatterns, 'function');
  });

  it('exports getStatus function', () => {
    assert.equal(typeof dc.getStatus, 'function');
  });

  it('exports EVENT_TYPES array', () => {
    assert.ok(Array.isArray(dc.EVENT_TYPES));
    assert.ok(dc.EVENT_TYPES.includes('bash'));
    assert.ok(dc.EVENT_TYPES.includes('file'));
    assert.ok(dc.EVENT_TYPES.includes('stop'));
    assert.ok(dc.EVENT_TYPES.includes('prompt'));
  });

  it('exports ACTIONS array', () => {
    assert.ok(Array.isArray(dc.ACTIONS));
    assert.ok(dc.ACTIONS.includes('block'));
    assert.ok(dc.ACTIONS.includes('allow'));
    assert.ok(dc.ACTIONS.includes('ask'));
    assert.ok(dc.ACTIONS.includes('warn'));
  });

  it('exports SAFE_COMMANDS array', () => {
    assert.ok(Array.isArray(dc.SAFE_COMMANDS));
    assert.ok(dc.SAFE_COMMANDS.length > 0);
  });

  it('exports MAX_REGEX_LENGTH constant', () => {
    assert.equal(typeof dc.MAX_REGEX_LENGTH, 'number');
    assert.equal(dc.MAX_REGEX_LENGTH, 100);
  });

  it('exports MAX_INPUT_LENGTH constant', () => {
    assert.equal(typeof dc.MAX_INPUT_LENGTH, 'number');
  });
});

// ============================================================
// 2. isSafeCommand — safe command whitelist
// ============================================================

describe('isSafeCommand', () => {
  const safeCommands = [
    'ls',
    'ls -la',
    'ls /tmp',
    'cat file.txt',
    'head -20 file.js',
    'tail -f logfile',
    'grep -r pattern .',
    'rg pattern',
    'find . -name "*.js"',
    'git status',
    'git log --oneline',
    'git diff HEAD',
    'git branch -a',
    'git show HEAD',
    'git remote -v',
    'git tag',
    'npm test',
    'npm run build',
    'npm list',
    'npm ls',
    'npm view wogiflow',
    'npm search something',
    'npm info wogiflow',
    'node --check file.js',
    'node -c file.js',
    'echo hello',
    'pwd',
    'which node',
    'type node',
    'whoami',
    'hostname',
    'date',
    'wc -l file.txt',
    'sort file.txt',
    'uniq file.txt',
    'diff a.txt b.txt',
    'file something',
    'tree .',
    'du -sh .',
    'df -h',
  ];

  for (const cmd of safeCommands) {
    it(`allows: ${cmd}`, () => {
      assert.ok(dc.isSafeCommand(cmd), `Expected "${cmd}" to be safe`);
    });
  }

  const unsafeCommands = [
    'rm -rf /',
    'rm file.txt',
    'git push --force',
    'git reset --hard',
    'npm publish',
    'curl http://evil.com',
    'wget http://evil.com',
    'chmod 777 file',
    'sudo rm -rf /',
  ];

  for (const cmd of unsafeCommands) {
    it(`does not classify as safe: ${cmd}`, () => {
      assert.ok(!dc.isSafeCommand(cmd), `Expected "${cmd}" to NOT be safe`);
    });
  }

  it('trims whitespace before checking', () => {
    assert.ok(dc.isSafeCommand('  ls -la  '));
  });
});

// ============================================================
// 3. safeRegExp — ReDoS protection
// ============================================================

describe('safeRegExp', () => {
  it('accepts simple patterns', () => {
    const re = dc.safeRegExp('hello');
    assert.ok(re instanceof RegExp);
    assert.ok(re.test('hello world'));
  });

  it('accepts patterns with flags', () => {
    const re = dc.safeRegExp('hello', 'i');
    assert.ok(re instanceof RegExp);
    assert.ok(re.test('HELLO'));
  });

  it('accepts character class patterns', () => {
    const re = dc.safeRegExp('[a-z]+');
    assert.ok(re instanceof RegExp);
  });

  it('accepts word boundary patterns', () => {
    const re = dc.safeRegExp('\\bword\\b');
    assert.ok(re instanceof RegExp);
  });

  it('rejects overly long patterns (>100 chars)', () => {
    const longPattern = 'a'.repeat(101);
    const re = dc.safeRegExp(longPattern);
    assert.equal(re, null);
  });

  it('accepts patterns at exactly 100 chars', () => {
    const exactPattern = 'a'.repeat(100);
    const re = dc.safeRegExp(exactPattern);
    assert.ok(re instanceof RegExp);
  });

  it('rejects nested quantifiers (a+)+', () => {
    const re = dc.safeRegExp('(a+)+');
    assert.equal(re, null);
  });

  it('rejects nested quantifiers (a*)+', () => {
    const re = dc.safeRegExp('(a*)+');
    assert.equal(re, null);
  });

  it('rejects nested quantifiers (a+)*', () => {
    const re = dc.safeRegExp('(a+)*');
    assert.equal(re, null);
  });

  it('rejects nested quantifiers (a*)*', () => {
    const re = dc.safeRegExp('(a*)*');
    assert.equal(re, null);
  });

  it('rejects nested quantifiers (a+){n}', () => {
    const re = dc.safeRegExp('(a+){3}');
    assert.equal(re, null);
  });

  it('rejects nested quantifiers (a*){n}', () => {
    const re = dc.safeRegExp('(a*){3}');
    assert.equal(re, null);
  });

  it('rejects greedy double wildcards .*.*', () => {
    const re = dc.safeRegExp('.*.*');
    assert.equal(re, null);
  });

  it('rejects greedy double wildcards .+.+', () => {
    const re = dc.safeRegExp('.+.+');
    assert.equal(re, null);
  });

  it('rejects alternation with quantifier (a|b)+', () => {
    const re = dc.safeRegExp('(a|b)+');
    assert.equal(re, null);
  });

  it('returns null for invalid regex syntax', () => {
    const re = dc.safeRegExp('[invalid');
    assert.equal(re, null);
  });
});

// ============================================================
// 4. safeRegexTest — input length protection
// ============================================================

describe('safeRegexTest', () => {
  it('returns false for null regex', () => {
    assert.equal(dc.safeRegexTest(null, 'test'), false);
  });

  it('matches normal input', () => {
    const re = /hello/;
    assert.ok(dc.safeRegexTest(re, 'hello world'));
  });

  it('handles non-string input by converting', () => {
    const re = /123/;
    assert.ok(dc.safeRegexTest(re, 123));
  });

  it('truncates overly long input', () => {
    const re = /end$/;
    const longInput = 'a'.repeat(dc.MAX_INPUT_LENGTH + 100) + 'end';
    // After truncation, 'end' is cut off, so it should not match
    assert.equal(dc.safeRegexTest(re, longInput), false);
  });

  it('does not truncate input within limit', () => {
    const re = /end$/;
    const input = 'a'.repeat(100) + 'end';
    assert.ok(dc.safeRegexTest(re, input));
  });
});

// ============================================================
// 5. parseSimpleYaml — YAML parsing
// ============================================================

describe('parseSimpleYaml', () => {
  it('returns default structure for empty input', () => {
    const result = dc.parseSimpleYaml('');
    assert.ok(result);
    assert.ok(Array.isArray(result.rules));
    assert.ok(Array.isArray(result.blocked));
    assert.ok(Array.isArray(result.ask));
    assert.ok(result.paths && typeof result.paths === 'object');
  });

  it('parses blocked section with simple strings', () => {
    const yaml = `blocked:
  - "rm -rf /"
  - "DROP TABLE"`;
    const result = dc.parseSimpleYaml(yaml);
    assert.equal(result.blocked.length, 2);
    assert.equal(result.blocked[0], 'rm -rf /');
    assert.equal(result.blocked[1], 'DROP TABLE');
  });

  it('parses ask section with simple strings', () => {
    const yaml = `ask:
  - "git reset"
  - "npm publish"`;
    const result = dc.parseSimpleYaml(yaml);
    assert.equal(result.ask.length, 2);
    assert.equal(result.ask[0], 'git reset');
    assert.equal(result.ask[1], 'npm publish');
  });

  it('parses ask section with objects (pattern + reason)', () => {
    const yaml = `ask:
  - pattern: "rm -rf node_modules"
    reason: "Removes dependencies"`;
    const result = dc.parseSimpleYaml(yaml);
    assert.equal(result.ask.length, 1);
    assert.equal(result.ask[0].pattern, 'rm -rf node_modules');
    assert.equal(result.ask[0].reason, 'Removes dependencies');
  });

  it('parses paths section with subsections', () => {
    const yaml = `paths:
  zeroAccess:
    - ".env"
    - ".ssh"
  readOnly:
    - "package-lock.json"
  noDelete:
    - "README.md"`;
    const result = dc.parseSimpleYaml(yaml);
    assert.deepEqual(result.paths.zeroAccess, ['.env', '.ssh']);
    assert.deepEqual(result.paths.readOnly, ['package-lock.json']);
    assert.deepEqual(result.paths.noDelete, ['README.md']);
  });

  it('parses rules section with conditions', () => {
    const yaml = `rules:
  - name: block-force-push
    event: bash
    action: block
    message: "Force push not allowed"
    conditions:
      - field: command
        pattern: "git push --force"`;
    const result = dc.parseSimpleYaml(yaml);
    assert.equal(result.rules.length, 1);
    assert.equal(result.rules[0].name, 'block-force-push');
    assert.equal(result.rules[0].event, 'bash');
    assert.equal(result.rules[0].action, 'block');
    assert.equal(result.rules[0].message, 'Force push not allowed');
    assert.ok(Array.isArray(result.rules[0].conditions));
    assert.equal(result.rules[0].conditions.length, 1);
    assert.equal(result.rules[0].conditions[0].field, 'command');
    assert.equal(result.rules[0].conditions[0].pattern, 'git push --force');
  });

  it('skips comments', () => {
    const yaml = `# This is a comment
blocked:
  # Another comment
  - "dangerous"`;
    const result = dc.parseSimpleYaml(yaml);
    assert.equal(result.blocked.length, 1);
    assert.equal(result.blocked[0], 'dangerous');
  });

  it('skips empty lines', () => {
    const yaml = `blocked:

  - "dangerous"

  - "also bad"`;
    const result = dc.parseSimpleYaml(yaml);
    assert.equal(result.blocked.length, 2);
  });

  it('handles malformed YAML gracefully (no crash)', () => {
    const malformed = `:::
  ---
  [[[
  }}}`;
    assert.doesNotThrow(() => {
      dc.parseSimpleYaml(malformed);
    });
  });

  it('handles YAML with only comments', () => {
    const yaml = `# Just comments
# Nothing else`;
    const result = dc.parseSimpleYaml(yaml);
    assert.ok(result);
    assert.equal(result.rules.length, 0);
    assert.equal(result.blocked.length, 0);
  });

  it('processes YAML escape sequences in double-quoted strings', () => {
    const yaml = `blocked:
  - "line1\\nline2"`;
    const result = dc.parseSimpleYaml(yaml);
    assert.equal(result.blocked[0], 'line1\nline2');
  });

  it('parses multiple rules', () => {
    const yaml = `rules:
  - name: rule-one
    event: bash
    action: block
  - name: rule-two
    event: file
    action: warn`;
    const result = dc.parseSimpleYaml(yaml);
    assert.equal(result.rules.length, 2);
    assert.equal(result.rules[0].name, 'rule-one');
    assert.equal(result.rules[1].name, 'rule-two');
  });
});

// ============================================================
// 6. checkEventRule — rule matching logic
// ============================================================

describe('checkEventRule', () => {
  it('returns null when event type does not match', () => {
    const rule = { event: 'bash', action: 'block', conditions: [] };
    const result = dc.checkEventRule(rule, 'file', { command: 'rm -rf /' });
    assert.equal(result, null);
  });

  it('matches when event type matches and no conditions', () => {
    const rule = { event: 'bash', action: 'block' };
    const result = dc.checkEventRule(rule, 'bash', { command: 'anything' });
    assert.equal(result, 'block');
  });

  it('matches "all" event type against any event', () => {
    const rule = { event: 'all', action: 'warn' };
    assert.equal(dc.checkEventRule(rule, 'bash', {}), 'warn');
    assert.equal(dc.checkEventRule(rule, 'file', {}), 'warn');
    assert.equal(dc.checkEventRule(rule, 'stop', {}), 'warn');
  });

  it('matches when all conditions are satisfied (AND logic)', () => {
    const rule = {
      event: 'bash',
      action: 'block',
      conditions: [
        { field: 'command', pattern: 'rm' },
        { field: 'command', pattern: '-rf' },
      ],
    };
    const result = dc.checkEventRule(rule, 'bash', { command: 'rm -rf /tmp' });
    assert.equal(result, 'block');
  });

  it('returns null when only some conditions match', () => {
    const rule = {
      event: 'bash',
      action: 'block',
      conditions: [
        { field: 'command', pattern: 'rm' },
        { field: 'command', pattern: 'NOTPRESENT' },
      ],
    };
    const result = dc.checkEventRule(rule, 'bash', { command: 'rm -rf /tmp' });
    assert.equal(result, null);
  });

  it('returns null when condition field does not exist in context', () => {
    const rule = {
      event: 'bash',
      action: 'block',
      conditions: [{ field: 'nonexistent', pattern: 'test' }],
    };
    const result = dc.checkEventRule(rule, 'bash', { command: 'test' });
    assert.equal(result, null);
  });

  it('returns null for unsafe regex in condition pattern', () => {
    const rule = {
      event: 'bash',
      action: 'block',
      conditions: [{ field: 'command', pattern: '(a+)+' }],
    };
    const result = dc.checkEventRule(rule, 'bash', { command: 'aaa' });
    assert.equal(result, null);
  });
});

// ============================================================
// 7. checkCommand — legacy command checking
// ============================================================

describe('checkCommand', () => {
  // Note: checkCommand reads config via getConfig(). If damageControl
  // is not enabled in config, it returns { action: 'allow' } for everything.
  // We test the function's behavior given the project's current config.

  it('returns an object with action property', () => {
    const result = dc.checkCommand('ls');
    assert.ok(result);
    assert.ok('action' in result);
  });

  it('allows safe commands regardless of config', () => {
    // isSafeCommand is checked before patterns, so safe commands always pass
    const result = dc.checkCommand('ls -la');
    assert.equal(result.action, 'allow');
  });

  it('allows git status', () => {
    const result = dc.checkCommand('git status');
    assert.equal(result.action, 'allow');
  });

  it('allows npm test', () => {
    const result = dc.checkCommand('npm test');
    assert.equal(result.action, 'allow');
  });
});

// ============================================================
// 8. checkPath — file path safety
// ============================================================

describe('checkPath', () => {
  // checkPath reads config. If damageControl is not enabled, it returns
  // { allowed: true } for all paths. We test that it returns proper structure.

  it('returns an object with allowed property', () => {
    const result = dc.checkPath('/some/normal/file.js', 'read');
    assert.ok(result);
    assert.ok('allowed' in result);
  });

  it('returns allowed: true for normal code files when DC is disabled', () => {
    // With DC disabled in config, all paths are allowed
    const result = dc.checkPath('/project/src/index.js', 'write');
    assert.equal(result.allowed, true);
  });
});

// ============================================================
// 9. pathMatchesPattern (tested indirectly through checkPath)
//    We test the parseSimpleYaml + checkPath integration
// ============================================================

// ============================================================
// 10. checkEvent — main event checking
// ============================================================

describe('checkEvent', () => {
  it('returns an object with allowed, action, and message', () => {
    const result = dc.checkEvent('bash', { command: 'ls' });
    assert.ok(result);
    assert.ok('allowed' in result);
    assert.ok('action' in result);
    assert.ok('message' in result);
  });

  it('returns allowed: true for safe bash commands', () => {
    const result = dc.checkEvent('bash', { command: 'git status' });
    assert.equal(result.allowed, true);
  });

  it('handles missing context gracefully', () => {
    const result = dc.checkEvent('bash');
    assert.ok(result);
    assert.ok('allowed' in result);
  });

  it('handles unknown event types', () => {
    const result = dc.checkEvent('unknown_type', { something: 'test' });
    assert.ok(result);
    assert.ok('allowed' in result);
  });
});

// ============================================================
// 11. Convenience wrappers
// ============================================================

describe('convenience wrappers', () => {
  it('checkBashEvent returns result for command', () => {
    const result = dc.checkBashEvent('ls');
    assert.ok(result);
    assert.ok('allowed' in result);
    assert.equal(result.allowed, true);
  });

  it('checkFileEvent returns result for file path', () => {
    const result = dc.checkFileEvent('/some/file.js', 'edit');
    assert.ok(result);
    assert.ok('allowed' in result);
  });

  it('checkStopEvent returns result', () => {
    const result = dc.checkStopEvent();
    assert.ok(result);
    assert.ok('allowed' in result);
  });

  it('checkPromptEvent returns result', () => {
    const result = dc.checkPromptEvent('do something');
    assert.ok(result);
    assert.ok('allowed' in result);
  });
});

// ============================================================
// 12. promptHookCheck — async prompt hook
// ============================================================

describe('promptHookCheck', () => {
  it('is an async function', () => {
    assert.equal(dc.promptHookCheck.constructor.name, 'AsyncFunction');
  });

  it('returns a result with action property', async () => {
    const result = await dc.promptHookCheck('ls');
    assert.ok(result);
    assert.ok('action' in result);
  });

  it('allows safe commands', async () => {
    const result = await dc.promptHookCheck('git status');
    assert.equal(result.action, 'allow');
  });
});

// ============================================================
// 13. getStatus — status reporting
// ============================================================

describe('getStatus', () => {
  it('returns status object with expected keys', () => {
    const status = dc.getStatus();
    assert.ok(status);
    assert.ok('enabled' in status);
    assert.ok('promptHook' in status);
    assert.ok('patternsFile' in status);
    assert.ok('events' in status);
    assert.ok('patternsLoaded' in status);
    assert.ok('safeCommandPatterns' in status);
  });

  it('safeCommandPatterns matches SAFE_COMMANDS length', () => {
    const status = dc.getStatus();
    assert.equal(status.safeCommandPatterns, dc.SAFE_COMMANDS.length);
  });

  it('patternsLoaded has expected structure', () => {
    const status = dc.getStatus();
    const pl = status.patternsLoaded;
    assert.equal(typeof pl.rules, 'number');
    assert.equal(typeof pl.blocked, 'number');
    assert.equal(typeof pl.ask, 'number');
    assert.ok(pl.paths);
    assert.equal(typeof pl.paths.zeroAccess, 'number');
    assert.equal(typeof pl.paths.readOnly, 'number');
    assert.equal(typeof pl.paths.noDelete, 'number');
  });
});

// ============================================================
// 14. loadPatterns — pattern loading
// ============================================================

describe('loadPatterns', () => {
  it('returns object with expected structure', () => {
    const patterns = dc.loadPatterns();
    assert.ok(patterns);
    assert.ok(Array.isArray(patterns.rules));
    assert.ok(Array.isArray(patterns.blocked));
    assert.ok(Array.isArray(patterns.ask));
    assert.ok(patterns.paths && typeof patterns.paths === 'object');
  });
});
