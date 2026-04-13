---
alwaysApply: true
description: "Security patterns for file operations, JSON parsing, and path handling"
---

# Security Patterns

Critical security patterns for this project.

## 1. File Read Safety

Always wrap `fs.readFileSync()` in try-catch, even after `fileExists()` check.

**Reason**: Race conditions, permission changes, symlink issues can still cause failures.

```javascript
// Good
try {
  const content = fs.readFileSync(path, 'utf-8');
} catch (err) {
  // Handle gracefully
}

// Bad - can still throw even if file existed
if (fs.existsSync(path)) {
  const content = fs.readFileSync(path, 'utf-8');
}
```

## 2. JSON Parsing Safety

Use `safeJsonParse()` from flow-utils.js instead of raw `JSON.parse()`.

- Check for `__proto__`, `constructor`, `prototype` injection
- Validate parsed structure has expected fields before use
- Located in: `scripts/flow-utils.js`

```javascript
// Good
const config = safeJsonParse(filePath, {});

// Bad - vulnerable to prototype pollution
const config = JSON.parse(fs.readFileSync(filePath));
```

## 3. Template Substitution Safety

When implementing **any** template engine, prompt composer, or path-resolver that walks dotted/bracket key paths supplied by a template, you MUST guard against prototype-chain traversal. The exact 3-line guard pattern is below — copy-paste it into your resolver.

**Mandatory guard pattern** (any function that resolves `obj[part]` where `part` is template-supplied):

```js
const DANGEROUS_TEMPLATE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// ...inside the per-part traversal loop:
if (DANGEROUS_TEMPLATE_KEYS.has(part)) return undefined;
if (!Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
cur = cur[part];
```

**Why both checks**: blocking the three dangerous keys stops `{{__proto__.X}}` from walking the prototype chain. The `hasOwnProperty.call` guard additionally blocks any other inherited-property access — even untagged keys like `toString`, `valueOf`, etc.

**Known instances**:
- `applyTemplate()` in `flow-prompt-composer.js`
- `getByPath()` in `flow-intent-bootstrap.js` (guard added 2026-04-13 per IGR review SEC-003)
- Any new `getByPath`-style resolver MUST use this pattern.

**Enforcement gap**: a future standards-gate check should grep new template engines for the literal `DANGEROUS_TEMPLATE_KEYS` set or equivalent guard. Absence in a path-resolver function = MUST_FIX.

## 4. Path Safety

- Validate patterns before `path.join()` with user/config data
- Use `isPathWithinProject()` for defense-in-depth
- Glob-to-regex: Use `[^/]*` not `.*` to prevent path separator matching

```javascript
// Good
if (!isPathWithinProject(targetPath)) {
  throw new Error('Path outside project');
}

// Bad - allows path traversal
const fullPath = path.join(baseDir, userInput);
```

## 5. Module Dependencies

- Check for circular dependencies when refactoring shared functions
- Node.js handles circular deps but can cause undefined exports during load

## 6. Claude Code Permission Patterns (2.1.7+)

When configuring permission rules in Claude Code, avoid overly permissive wildcards.

**Vulnerability fixed in 2.1.7**: Wildcard permission rules could match compound commands containing shell operators (`;`, `&&`, `||`, `|`).

**Destructive git commands** must NOT be auto-allowed. WogiFlow's `generateSettings()` scopes these to safe variants:

```javascript
// DANGEROUS - auto-allows destructive operations
"allow": "Bash(git reset *)"    // matches git reset --hard
"allow": "Bash(git restore *)"  // matches git restore . (discard all)
"allow": "Bash(git clean *)"    // matches git clean -f

// SAFE - only non-destructive variants auto-allowed
"allow": "Bash(git reset HEAD *)"       // unstage files only
"allow": "Bash(git reset --soft *)"     // soft reset, preserves changes
"allow": "Bash(git restore --staged *)" // unstage files only
// git reset --hard, git restore ., git clean -f require manual approval
```

**Best practices:**
- Scope destructive commands to safe variants instead of blanket wildcards
- `git reset --hard`, `git restore .`, `git clean -f` should always require user approval
- Prefer semantic permission prompts over literal command matching
- Never allow broad patterns like `rm *` or `git *`
- Review permission rules after Claude Code updates

## 7. Windows Path Safety

On Windows, be aware of path-related issues:

- Temp directory paths may contain characters like `\t` or `\n` that could be misinterpreted as escape sequences
- Use raw strings or proper escaping when constructing paths
- Cloud sync tools (OneDrive, Dropbox) and antivirus may touch file timestamps without changing content

```javascript
// Good - use path.join() which handles platform differences
const tempPath = path.join(os.tmpdir(), 'myfile.txt');

// Bad - manual concatenation can break on Windows
const tempPath = os.tmpdir() + '/myfile.txt';
```

## 8. Shell Command Parameter Validation

When executing shell commands with dynamic parameters, always validate inputs.

**Risk**: Command injection via unvalidated parameters passed to execSync/spawn.

```javascript
// DANGEROUS - lang parameter not validated
execSync(`sg --pattern "${pattern}" --lang ${lang} --json "${path}"`);

// SAFER - validate against whitelist
const ALLOWED_LANGUAGES = new Set(['typescript', 'javascript', 'python', 'go']);
if (!ALLOWED_LANGUAGES.has(lang)) {
  throw new Error(`Unsupported language: ${lang}`);
}

// BEST - use execFile with array arguments (no shell interpretation)
const { execFileSync } = require('child_process');
execFileSync('sg', ['--pattern', pattern, '--lang', lang, '--json', path]);
```

**Best practices:**
- Validate all dynamic parameters against allowlists
- Prefer `execFile`/`execFileSync` with array arguments over `exec`/`execSync` with template strings
- When using template strings, escape all user-controlled values
- Never interpolate user input directly into shell commands

## 9. Temp Directory Isolation (Claude Code 2.1.23+)

On shared systems (CI servers, multi-user machines), use per-user temp directories to prevent permission conflicts.

**Fixed in Claude Code 2.1.23**: Per-user temp directory isolation prevents permission conflicts.

```javascript
// Good - per-user isolation
const userId = process.getuid?.() ?? process.env.USER ?? process.env.USERNAME ?? 'default';
const tempDir = path.join(os.tmpdir(), `myapp-${userId}`);

// Bad - global temp path on shared systems
const tempDir = path.join(os.tmpdir(), 'myapp');
```

**Best practices:**
- Use UID on Unix systems (`process.getuid()`)
- Fall back to username environment variables on Windows
- Always provide a 'default' fallback for edge cases
- This pattern is used in `flow-worktree.js` for worktree isolation

## 10. Search/Grep Timeout Handling (Claude Code 2.1.23+)

**Fixed in Claude Code 2.1.23**: Ripgrep search timeouts now report errors instead of silently returning empty results.

**Impact on WogiFlow:** Component detection, auto-context loading, and pattern matching rely on search operations. Before 2.1.23, search timeouts could cause false negatives.

**Best practices:**
- Handle empty search results gracefully - they may indicate timeout
- Add retry logic for search-dependent operations
- Log warnings when searches return unexpectedly empty
- Consider fallback strategies (glob-based search if grep fails)
