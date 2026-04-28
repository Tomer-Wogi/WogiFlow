'use strict';

/**
 * Tests for scripts/hooks/core/deletion-log.js (Fork C, v2.29.5).
 *
 * Pin the wogi-hub 2026-04-27 IntegrationConnectionSection.tsx incident:
 * AI deletes a user-facing component justified by static-import-graph
 * analysis; owner notices days later. The deletion log must produce an
 * append-only audit trail with provenance so the owner can grep for
 * "did we ever delete a feature called X?"
 *
 * Run: node --test tests/flow-hooks-deletion-log.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dl = require('../scripts/hooks/core/deletion-log');

// ───────────────────────────────────────────────────────────────────────
// detectDeletionShape
// ───────────────────────────────────────────────────────────────────────

describe('detectDeletionShape', () => {
  it('detects Bash rm with single file', () => {
    const r = dl.detectDeletionShape({
      toolName: 'Bash',
      toolInput: { command: 'rm packages/admin/src/pages/Customers/X.tsx' }
    });
    assert.equal(r.deleted, true);
    assert.equal(r.shape, 'rm');
    assert.deepEqual(r.files, ['packages/admin/src/pages/Customers/X.tsx']);
  });

  it('detects Bash rm with -rf flags', () => {
    const r = dl.detectDeletionShape({
      toolName: 'Bash',
      toolInput: { command: 'rm -rf src/components/oldDir' }
    });
    assert.equal(r.shape, 'rm');
    assert.deepEqual(r.files, ['src/components/oldDir']);
  });

  it('detects Bash rm with multiple files', () => {
    const r = dl.detectDeletionShape({
      toolName: 'Bash',
      toolInput: { command: 'rm -f a.tsx b.tsx c.tsx' }
    });
    assert.deepEqual(r.files, ['a.tsx', 'b.tsx', 'c.tsx']);
  });

  it('detects git rm', () => {
    const r = dl.detectDeletionShape({
      toolName: 'Bash',
      toolInput: { command: 'git rm packages/admin/src/pages/X.tsx' }
    });
    assert.equal(r.shape, 'git-rm');
    assert.deepEqual(r.files, ['packages/admin/src/pages/X.tsx']);
  });

  it('rejects compound commands (semicolon, pipe)', () => {
    assert.equal(dl.detectDeletionShape({
      toolName: 'Bash',
      toolInput: { command: 'rm a.tsx; echo done' }
    }), null);
    assert.equal(dl.detectDeletionShape({
      toolName: 'Bash',
      toolInput: { command: 'find . | xargs rm' }
    }), null);
  });

  it('rejects rm-related strings that are not deletion commands', () => {
    assert.equal(dl.detectDeletionShape({
      toolName: 'Bash',
      toolInput: { command: 'echo "rm is dangerous"' }
    }), null);
  });

  it('detects Edit with empty new_string and substantial old_string', () => {
    const oldStr = 'a'.repeat(250);
    const r = dl.detectDeletionShape({
      toolName: 'Edit',
      toolInput: { file_path: 'src/components/Foo.tsx', old_string: oldStr, new_string: '' }
    });
    assert.equal(r.shape, 'edit-empty');
    assert.deepEqual(r.files, ['src/components/Foo.tsx']);
  });

  it('skips Edit with empty new_string but small old_string (snippet edit)', () => {
    assert.equal(dl.detectDeletionShape({
      toolName: 'Edit',
      toolInput: { file_path: 'src/components/Foo.tsx', old_string: 'short', new_string: '' }
    }), null);
  });

  it('skips Edit with non-empty new_string', () => {
    assert.equal(dl.detectDeletionShape({
      toolName: 'Edit',
      toolInput: { file_path: 'src/x.tsx', old_string: 'a'.repeat(250), new_string: 'b'.repeat(250) }
    }), null);
  });

  it('detects Write with empty content', () => {
    const r = dl.detectDeletionShape({
      toolName: 'Write',
      toolInput: { file_path: 'src/components/Foo.tsx', content: '' }
    });
    assert.equal(r.shape, 'write-empty');
    assert.deepEqual(r.files, ['src/components/Foo.tsx']);
  });

  it('skips Write with non-empty content', () => {
    assert.equal(dl.detectDeletionShape({
      toolName: 'Write',
      toolInput: { file_path: 'src/x.tsx', content: 'export default function X(){}' }
    }), null);
  });

  it('skips when toolResponse signals failure', () => {
    assert.equal(dl.detectDeletionShape({
      toolName: 'Bash',
      toolInput: { command: 'rm src/x.tsx' },
      toolResponse: { error: 'File not found' }
    }), null);
    assert.equal(dl.detectDeletionShape({
      toolName: 'Bash',
      toolInput: { command: 'rm src/x.tsx' },
      toolResponse: { isError: true }
    }), null);
  });

  it('returns null for unrelated tools', () => {
    assert.equal(dl.detectDeletionShape({ toolName: 'Read', toolInput: { file_path: 'a' } }), null);
    assert.equal(dl.detectDeletionShape({ toolName: 'Glob', toolInput: { pattern: '*' } }), null);
  });

  it('returns null for missing/invalid context', () => {
    assert.equal(dl.detectDeletionShape(null), null);
    assert.equal(dl.detectDeletionShape({}), null);
    assert.equal(dl.detectDeletionShape({ toolName: 'Bash' }), null);
  });
});

// ───────────────────────────────────────────────────────────────────────
// isUiSurfaceFile
// ───────────────────────────────────────────────────────────────────────

describe('isUiSurfaceFile', () => {
  it('matches monorepo packages/<x>/src/pages/...', () => {
    assert.equal(dl.isUiSurfaceFile('packages/admin/src/pages/Customers/X.tsx'), true);
    assert.equal(dl.isUiSurfaceFile('packages/admin/src/pages/Customers/X.jsx'), true);
    assert.equal(dl.isUiSurfaceFile('packages/admin/src/pages/Customers/X.vue'), true);
  });

  it('matches monorepo apps/<x>/src/views/...', () => {
    assert.equal(dl.isUiSurfaceFile('apps/portal/src/views/Login.vue'), true);
    assert.equal(dl.isUiSurfaceFile('apps/portal/src/screens/Home.tsx'), true);
  });

  it('matches packages/<x>/src/components/...', () => {
    assert.equal(dl.isUiSurfaceFile('packages/ui/src/components/Button.tsx'), true);
  });

  it('matches single-package src/pages/... fallback', () => {
    assert.equal(dl.isUiSurfaceFile('src/pages/Home.tsx'), true);
  });

  it('does not match non-UI directories', () => {
    assert.equal(dl.isUiSurfaceFile('src/utils/helpers.ts'), false);
    assert.equal(dl.isUiSurfaceFile('lib/api/handler.js'), false);
    assert.equal(dl.isUiSurfaceFile('packages/server/src/routes/api.ts'), false);
  });

  it('does not match non-UI extensions', () => {
    assert.equal(dl.isUiSurfaceFile('packages/admin/src/pages/Customers/data.json'), false);
    assert.equal(dl.isUiSurfaceFile('packages/admin/src/pages/Customers/styles.css'), false);
  });

  it('handles Windows-style backslash paths', () => {
    assert.equal(
      dl.isUiSurfaceFile('packages\\admin\\src\\pages\\Customers\\X.tsx'),
      true
    );
  });

  it('returns false for non-string/null', () => {
    assert.equal(dl.isUiSurfaceFile(null), false);
    assert.equal(dl.isUiSurfaceFile(undefined), false);
    assert.equal(dl.isUiSurfaceFile(''), false);
  });

  it('honors caller-provided uiGlobs (regex)', () => {
    const customGlobs = [/^backend\/.*\.go$/i];
    assert.equal(dl.isUiSurfaceFile('backend/api.go', customGlobs), true);
    assert.equal(dl.isUiSurfaceFile('packages/admin/src/pages/X.tsx', customGlobs), false);
  });

  it('honors caller-provided uiGlobs (string with **)', () => {
    const customGlobs = ['**/critical/**/*.ts'];
    assert.equal(dl.isUiSurfaceFile('packages/x/src/critical/foo/bar.ts', customGlobs), true);
    assert.equal(dl.isUiSurfaceFile('packages/x/src/util/foo.ts', customGlobs), false);
  });
});

// ───────────────────────────────────────────────────────────────────────
// extractUserVisibleStrings
// ───────────────────────────────────────────────────────────────────────

describe('extractUserVisibleStrings', () => {
  it('extracts JSX text nodes starting with capital', () => {
    const content = `<div>Communication Rule</div><span>Save Changes</span>`;
    const out = dl.extractUserVisibleStrings(content);
    assert.ok(out.includes('Communication Rule'));
    assert.ok(out.includes('Save Changes'));
  });

  it('extracts label/title/aria-label/placeholder/alt props', () => {
    const content = `<button aria-label="Delete customer record">x</button>
                     <input placeholder="Search by name or email" />
                     <img alt="Customer avatar placeholder" />`;
    const out = dl.extractUserVisibleStrings(content);
    assert.ok(out.includes('Delete customer record'));
    assert.ok(out.includes('Search by name or email'));
    assert.ok(out.includes('Customer avatar placeholder'));
  });

  it('skips strings under 5 chars', () => {
    const out = dl.extractUserVisibleStrings(`<button>OK</button>`);
    assert.equal(out.length, 0);
  });

  it('skips strings over 80 chars (likely code, not UI text)', () => {
    const long = 'A'.repeat(120);
    const out = dl.extractUserVisibleStrings(`<div>${long}</div>`);
    assert.equal(out.length, 0);
  });

  it('returns up to max strings sorted longest-first', () => {
    const content = `<div>Short title here</div><span>A much longer descriptive label string</span>`;
    const out = dl.extractUserVisibleStrings(content, 5);
    assert.equal(out[0], 'A much longer descriptive label string');
  });

  it('deduplicates identical strings', () => {
    const content = `<div>Communication Rule</div><div>Communication Rule</div>`;
    const out = dl.extractUserVisibleStrings(content);
    assert.equal(out.filter(s => s === 'Communication Rule').length, 1);
  });

  it('returns [] for non-string', () => {
    assert.deepEqual(dl.extractUserVisibleStrings(null), []);
    assert.deepEqual(dl.extractUserVisibleStrings(undefined), []);
    assert.deepEqual(dl.extractUserVisibleStrings(42), []);
  });
});

// ───────────────────────────────────────────────────────────────────────
// lookupOriginalAdd (with injected runGit mock)
// ───────────────────────────────────────────────────────────────────────

describe('lookupOriginalAdd', () => {
  function makeMockGit(responses) {
    return (args) => {
      const key = args.join(' ');
      for (const [pattern, val] of Object.entries(responses)) {
        if (key.includes(pattern)) {
          if (val instanceof Error) throw val;
          return val;
        }
      }
      throw new Error(`mock git: no match for ${key}`);
    };
  }

  it('parses add commit + content + extracts user-visible strings', () => {
    const dateIso = new Date(Date.now() - 18 * 86400000).toISOString();
    const mock = makeMockGit({
      'log --diff-filter=A': `00ebd1c\t${dateIso}\tFE Worker\tfeat(admin): customers integration connection section`,
      'show 00ebd1c:': `<div>Communication Rule</div><label>Paste as is</label>\n` + 'a'.repeat(900)
    });
    const r = dl.lookupOriginalAdd('packages/admin/src/pages/Customers/X.tsx', { runGit: mock });
    assert.ok(r);
    assert.equal(r.sha, '00ebd1c');
    assert.equal(r.author, 'FE Worker');
    assert.equal(r.subject, 'feat(admin): customers integration connection section');
    assert.ok(r.ageDays >= 17 && r.ageDays <= 19, `expected ~18 days, got ${r.ageDays}`);
    assert.ok(r.originalLOC > 0);
    assert.ok(r.userVisibleStrings.includes('Communication Rule'));
  });

  it('returns null on git unavailable / error', () => {
    const mock = () => { throw new Error('git: command not found'); };
    assert.equal(dl.lookupOriginalAdd('any.tsx', { runGit: mock }), null);
  });

  it('returns null on empty git output (untracked file)', () => {
    const mock = () => '';
    assert.equal(dl.lookupOriginalAdd('untracked.tsx', { runGit: mock }), null);
  });

  it('takes the FIRST line (oldest add when --reverse) when multiple adds present', () => {
    const oldDate = new Date(Date.now() - 100 * 86400000).toISOString();
    const newDate = new Date(Date.now() - 5 * 86400000).toISOString();
    const out = `aaaaaaa\t${oldDate}\tA\tfirst add\nbbbbbbb\t${newDate}\tB\tre-add after delete`;
    const mock = makeMockGit({
      'log --diff-filter=A': out,
      'show aaaaaaa:': '<div>X</div>'
    });
    const r = dl.lookupOriginalAdd('any.tsx', { runGit: mock });
    assert.equal(r.sha, 'aaaaaaa');
    assert.equal(r.subject, 'first add');
  });

  it('handles malformed log output (insufficient fields)', () => {
    const mock = makeMockGit({ 'log --diff-filter=A': 'incomplete-line' });
    assert.equal(dl.lookupOriginalAdd('any.tsx', { runGit: mock }), null);
  });

  it('rejects bogus SHA format', () => {
    const mock = makeMockGit({
      'log --diff-filter=A': `notasha\t2026-01-01T00:00:00Z\tA\tsubject`
    });
    assert.equal(dl.lookupOriginalAdd('any.tsx', { runGit: mock }), null);
  });

  it('falls open on git show failure (returns provenance without LOC/strings)', () => {
    const dateIso = new Date(Date.now() - 5 * 86400000).toISOString();
    const mock = (args) => {
      const key = args.join(' ');
      if (key.includes('log --diff-filter=A')) {
        return `00ebd1c\t${dateIso}\tA\tsubject`;
      }
      throw new Error('git show failed');
    };
    const r = dl.lookupOriginalAdd('any.tsx', { runGit: mock });
    assert.ok(r);
    assert.equal(r.sha, '00ebd1c');
    assert.equal(r.originalLOC, null);
    assert.deepEqual(r.userVisibleStrings, []);
  });
});

// ───────────────────────────────────────────────────────────────────────
// formatLogEntry
// ───────────────────────────────────────────────────────────────────────

describe('formatLogEntry', () => {
  it('renders all fields when provenance is present', () => {
    const entry = {
      timestamp: '2026-04-28T14:32:11.000Z',
      filePath: 'packages/admin/src/pages/Customers/X.tsx',
      shape: 'git-rm',
      taskId: 'wf-c23dc072',
      sessionId: 'sess-deadbeefcafe',
      currentCommitSubject: 'AC2 + dead-code cleanup',
      provenance: {
        sha: '00ebd1c',
        date: '2026-04-10T12:00:00Z',
        author: 'FE Worker',
        subject: 'feat(admin): customers integration',
        ageDays: 18,
        originalLOC: 896,
        userVisibleStrings: ['Communication Rule', 'Paste as is']
      }
    };
    const out = dl.formatLogEntry(entry);
    assert.match(out, /## 2026-04-28T14:32:11\.000Z — `packages\/admin\/src\/pages\/Customers\/X\.tsx`/);
    assert.match(out, /\*\*Shape\*\*: git-rm/);
    assert.match(out, /\*\*Task\*\*: wf-c23dc072/);
    assert.match(out, /\*\*Original add\*\*: `00ebd1c`.*FE Worker/);
    assert.match(out, /Subject: feat\(admin\):/);
    assert.match(out, /Age: 18 days/);
    assert.match(out, /Lines deleted: 896/);
    assert.match(out, /"Communication Rule"/);
    assert.match(out, /"Paste as is"/);
  });

  it('says "not discoverable" when provenance is null', () => {
    const out = dl.formatLogEntry({
      filePath: 'src/x.tsx',
      shape: 'rm',
      provenance: null
    });
    assert.match(out, /not discoverable/);
  });

  it('uses default timestamp if not provided', () => {
    const out = dl.formatLogEntry({ filePath: 'x', shape: 'rm' });
    assert.match(out, /^## 20\d{2}-/);
  });

  it('escapes embedded quotes in user-visible strings', () => {
    const out = dl.formatLogEntry({
      filePath: 'x',
      shape: 'rm',
      provenance: {
        sha: 'abc1234',
        date: '2026-01-01T00:00:00Z',
        author: 'A',
        subject: 's',
        userVisibleStrings: ['Has "embedded" quotes']
      }
    });
    assert.match(out, /Has \\"embedded\\" quotes/);
  });
});

// ───────────────────────────────────────────────────────────────────────
// appendLogEntry (real filesystem)
// ───────────────────────────────────────────────────────────────────────

describe('appendLogEntry', () => {
  let tmpRoot;
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-deletion-log-'));
  });
  afterEach(() => {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_err) { /* ignore */ }
  });

  it('creates parent dirs and header on first append', () => {
    const ok = dl.appendLogEntry(tmpRoot, '## entry one\n');
    assert.equal(ok, true);
    const logPath = path.join(tmpRoot, '.workflow/state/deletions-log.md');
    assert.equal(fs.existsSync(logPath), true);
    const content = fs.readFileSync(logPath, 'utf-8');
    assert.match(content, /^# Deletions Log/);
    assert.match(content, /## entry one/);
  });

  it('appends without re-adding header on subsequent calls', () => {
    dl.appendLogEntry(tmpRoot, '## entry one\n');
    dl.appendLogEntry(tmpRoot, '## entry two\n');
    const content = fs.readFileSync(path.join(tmpRoot, '.workflow/state/deletions-log.md'), 'utf-8');
    const headerCount = (content.match(/^# Deletions Log/gm) || []).length;
    assert.equal(headerCount, 1);
    assert.match(content, /## entry one/);
    assert.match(content, /## entry two/);
  });

  it('returns false on non-string entry', () => {
    assert.equal(dl.appendLogEntry(tmpRoot, null), false);
    assert.equal(dl.appendLogEntry(tmpRoot, ''), false);
  });

  it('honors custom logPath', () => {
    dl.appendLogEntry(tmpRoot, '## x\n', { logPath: '.custom/log.md' });
    assert.equal(fs.existsSync(path.join(tmpRoot, '.custom/log.md')), true);
  });
});

// ───────────────────────────────────────────────────────────────────────
// recordDeletion (orchestrator)
// ───────────────────────────────────────────────────────────────────────

describe('recordDeletion (end-to-end)', () => {
  let tmpRoot;
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-deletion-log-'));
  });
  afterEach(() => {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_err) { /* ignore */ }
  });

  function mockGitWithProvenance() {
    const dateIso = new Date(Date.now() - 18 * 86400000).toISOString();
    // Build a realistic multi-line file content above the min-LOC threshold
    const fileLines = [
      'import React from "react";',
      'export function IntegrationConnectionSection() {',
      '  return (',
      '    <div>Communication Rule</div>',
      '    <label>Paste as is</label>',
      '    <button>Save Changes</button>',
      '  );',
      '}'
    ];
    const padding = Array(50).fill('// padding line').join('\n');
    const content = fileLines.join('\n') + '\n' + padding;
    return (args) => {
      const key = args.join(' ');
      if (key.includes('log --diff-filter=A')) {
        return `00ebd1c\t${dateIso}\tFE Worker\tfeat(admin): customers integration connection section`;
      }
      if (key.includes('show 00ebd1c:')) {
        return content;
      }
      throw new Error('mock-git no-match');
    };
  }

  it('logs the wogi-hub incident scenario end-to-end', () => {
    const r = dl.recordDeletion({
      toolName: 'Bash',
      toolInput: { command: 'git rm packages/admin/src/pages/Customers/IntegrationConnectionSection.tsx' },
      workspaceRoot: tmpRoot,
      sessionId: 'sess-deadbeefcafe',
      taskId: 'wf-c23dc072',
      currentCommitSubject: 'AC2 + dead-code cleanup',
      runGit: mockGitWithProvenance()
    });
    assert.equal(r.logged, 1);
    assert.equal(r.entries[0].provenance.subject, 'feat(admin): customers integration connection section');
    assert.ok(r.entries[0].provenance.userVisibleStrings.includes('Communication Rule'));

    const content = fs.readFileSync(path.join(tmpRoot, '.workflow/state/deletions-log.md'), 'utf-8');
    assert.match(content, /IntegrationConnectionSection\.tsx/);
    assert.match(content, /Communication Rule/);
    assert.match(content, /wf-c23dc072/);
    assert.match(content, /AC2 \+ dead-code cleanup/);
  });

  it('skips files outside the UI globs', () => {
    const r = dl.recordDeletion({
      toolName: 'Bash',
      toolInput: { command: 'rm src/utils/helpers.ts' },
      workspaceRoot: tmpRoot
    });
    assert.equal(r.logged, 0);
    assert.equal(r.skipped, 1);
    assert.ok(r.reasons.some(s => s.startsWith('glob-miss:')));
  });

  it('skips when config.enabled === false', () => {
    const r = dl.recordDeletion({
      toolName: 'Bash',
      toolInput: { command: 'git rm packages/admin/src/pages/X.tsx' },
      workspaceRoot: tmpRoot,
      config: { enabled: false }
    });
    assert.equal(r.logged, 0);
    assert.deepEqual(r.reasons, ['disabled']);
  });

  it('skips below-min-LOC files', () => {
    const tinyMock = (args) => {
      const dateIso = new Date().toISOString();
      const key = args.join(' ');
      if (key.includes('log --diff-filter=A')) return `abc1234\t${dateIso}\tA\tinit`;
      if (key.includes('show abc1234:')) return 'tiny\n';
      throw new Error('no');
    };
    const r = dl.recordDeletion({
      toolName: 'Bash',
      toolInput: { command: 'git rm packages/admin/src/pages/X.tsx' },
      workspaceRoot: tmpRoot,
      runGit: tinyMock
    });
    assert.equal(r.logged, 0);
    assert.ok(r.reasons.some(s => s.startsWith('below-min-loc:')));
  });

  it('still logs when provenance is unavailable (UI glob match alone is enough)', () => {
    const failingGit = () => { throw new Error('shallow clone'); };
    const r = dl.recordDeletion({
      toolName: 'Bash',
      toolInput: { command: 'git rm packages/admin/src/pages/X.tsx' },
      workspaceRoot: tmpRoot,
      runGit: failingGit
    });
    assert.equal(r.logged, 1);
    assert.equal(r.entries[0].provenance, null);
    const content = fs.readFileSync(path.join(tmpRoot, '.workflow/state/deletions-log.md'), 'utf-8');
    assert.match(content, /not discoverable/);
  });

  it('returns not-a-deletion for unrelated tool calls', () => {
    const r = dl.recordDeletion({
      toolName: 'Read',
      toolInput: { file_path: 'x' },
      workspaceRoot: tmpRoot
    });
    assert.equal(r.logged, 0);
    assert.deepEqual(r.reasons, ['not-a-deletion']);
  });

  it('handles multi-file rm — one in glob, one out — logs only the in-glob', () => {
    const r = dl.recordDeletion({
      toolName: 'Bash',
      toolInput: { command: 'rm -f packages/admin/src/pages/X.tsx src/utils/Y.ts' },
      workspaceRoot: tmpRoot,
      runGit: mockGitWithProvenance()
    });
    assert.equal(r.logged, 1);
    assert.equal(r.skipped, 1);
  });

  it('never throws on missing context', () => {
    assert.doesNotThrow(() => dl.recordDeletion(null));
    assert.doesNotThrow(() => dl.recordDeletion({}));
    const r = dl.recordDeletion(null);
    assert.deepEqual(r.reasons, ['no-context']);
  });
});
