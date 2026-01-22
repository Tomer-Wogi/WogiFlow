#!/usr/bin/env node

/**
 * Wogi Flow - Create Bug Report
 *
 * Creates a bug report with hash-based ID and discovered-from tracking.
 *
 * Usage:
 *   node scripts/flow-bug.js "<title>" [--from wf-XXXXXXXX] [--priority P0-P4] [--json]
 *
 * Options:
 *   --from       Task ID that discovered this bug (auto-detected if omitted)
 *   --priority   Priority level P0-P4 (default: P1 if discovered during task, else P2)
 *   --severity   Severity: critical, high, medium, low (default: medium)
 *   --json       Output JSON instead of human-readable
 */

const fs = require('fs');
const path = require('path');
const {
  PATHS,
  fileExists,
  dirExists,
  writeFile,
  writeJson,
  generateTaskId,
  parseFlags,
  outputJson,
  getConfig,
  getConfigValue,
  safeJsonParse,
  withLock,
  color,
  success,
  warn,
  info,
  error
} = require('./flow-utils');

// Try to load session state for auto-detecting current task
let loadSessionState;
try {
  const sessionModule = require('./flow-session-state');
  loadSessionState = sessionModule.loadSessionState;
} catch (importError) {
  // Log in debug mode - don't silently hide potential syntax errors
  if (process.env.DEBUG) {
    console.warn(`[DEBUG] Could not load flow-session-state: ${importError.message}`);
  }
  loadSessionState = () => ({});
}

/**
 * Get current task from session state (for auto-populating discovered-from)
 */
function getCurrentTask() {
  try {
    const sessionState = loadSessionState();
    return sessionState.currentTask || null;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[DEBUG] getCurrentTask error: ${err.message}`);
    }
    return null;
  }
}

/**
 * Create bug report content
 */
function createBugContent(bug) {
  const {
    id,
    title,
    severity,
    priority,
    discoveredFrom,
    discoveredDuring,
    createdAt
  } = bug;

  const date = createdAt.split('T')[0];
  const discoveredSection = discoveredFrom
    ? `**Discovered From**: ${discoveredFrom}\n**Discovered During**: ${discoveredDuring || 'implementation'}\n`
    : '';

  return `# ${id}: ${title}

**Created**: ${date}
**Status**: Open
**Severity**: ${severity.charAt(0).toUpperCase() + severity.slice(1)}
**Priority**: ${priority}
**Tags**: #bug
${discoveredSection}
## Bug Summary
[1-2 sentences: What is broken and what is the impact?]

## Reproduction

### Steps to Reproduce
1. [Step 1]
2. [Step 2]
3. [Step 3]

### Expected Behavior
[What should happen]

### Actual Behavior
[What actually happens]

### Environment
- Browser: [if applicable]
- OS: [if applicable]
- Version: [app version]
- Node/Runtime: [if applicable]

### Screenshots/Logs
[Attach screenshots, error logs, or stack traces]

---

## Root Cause Analysis

### What Went Wrong?
[Technical explanation of the bug - what part of the code/logic is failing and why]

### Why Did This Happen?
[Choose one or more]
- [ ] Logic error in implementation
- [ ] Missing edge case handling
- [ ] Incorrect assumption about inputs/state
- [ ] Race condition / timing issue
- [ ] External dependency failure
- [ ] Configuration/environment issue
- [ ] Prompt/instruction unclear or ambiguous
- [ ] Other: [explain]

### Source of the Problem
<!-- For AI-assisted development, this helps us learn -->
- **Prompt issue**: [Was the original request ambiguous or missing context?]
- **Logic gap**: [What reasoning led to the bug?]
- **Missing context**: [What information would have prevented this?]

---

## Fix Approaches

### Approach 1: [Name] (Recommended)
**Description**: [How this approach fixes the bug]
**Pros**: [Benefits]
**Cons**: [Drawbacks]
**Files affected**: [List files]

### Approach 2: [Name] (Alternative)
**Description**: [How this approach fixes the bug]
**Pros**: [Benefits]
**Cons**: [Drawbacks]
**Files affected**: [List files]

### Chosen Approach
[Which approach and why]

---

## Acceptance Criteria

### Scenario 1: Bug is fixed
**Given** [the conditions that previously triggered the bug]
**When** [the action that caused the bug]
**Then** [the expected correct behavior]

### Scenario 2: No regression
**Given** [related functionality]
**When** [normal usage]
**Then** [existing behavior is preserved]

### Scenario 3: Edge case handling
**Given** [edge case conditions]
**When** [edge case action]
**Then** [graceful handling]

---

## Test Strategy
- [ ] Unit test: [What to test]
- [ ] Integration test: [What to test]
- [ ] Manual verification: [Steps to verify fix]

## Verification Checklist
<!-- Quick steps to confirm the bug is fixed -->
1. [ ] [Step to verify the bug no longer occurs]
2. [ ] [Step to verify no regression]
3. [ ] [Step to verify edge cases]

---

## Prevention & Learning

### How to Prevent Similar Bugs
[What changes to process, prompts, or code patterns would prevent this?]

### Learnings to Capture
<!-- These should be added to decisions.md or skill learnings -->
- [ ] Pattern to add to decisions.md: [describe]
- [ ] Skill learning to record: [describe]
- [ ] Prompt improvement: [describe]

---

## Related
- [Related request-log entries]
- [Related components from app-map]
${discoveredFrom ? `- Discovered while working on: ${discoveredFrom}` : ''}

## Resolution
<!-- Fill in when fixed -->
- **Fixed in**: [commit hash or PR]
- **Root cause confirmed**: [yes/no - was initial analysis correct?]
- **Learnings applied**: [what was added to decisions.md/skills?]
- **Tests added**: [what tests were added?]
`;
}

/**
 * Main function
 */
async function main() {
  const { flags, positional } = parseFlags(process.argv.slice(2));

  // Handle help
  if (flags.help) {
    console.log(`
Usage: flow bug "<title>" [options]

Create a bug report with automatic tracking.

Options:
  --from <id>      Task ID that discovered this bug
  --priority <P>   Priority P0-P4 (default: P1 if during task, else P2)
  --severity <s>   Severity: critical, high, medium, low (default: medium)
  --json           Output JSON

Examples:
  flow bug "Login button not responding"
  flow bug "Null pointer in Profile API" --from wf-a1b2c3d4 --priority P0
  flow bug "Fix auth header" --severity critical
`);
    process.exit(0);
  }

  // Validate title
  const title = positional[0];
  if (!title) {
    error('Title is required');
    console.log('Usage: flow bug "<title>" [--from <task-id>] [--priority P0-P4]');
    process.exit(1);
  }

  // Ensure bugs directory exists
  if (!dirExists(PATHS.bugs)) {
    fs.mkdirSync(PATHS.bugs, { recursive: true });
  }

  // Get current task for auto-detection
  const currentTask = getCurrentTask();

  // Determine discovered-from (explicit flag or auto-detect)
  const discoveredFrom = flags.from || (currentTask ? currentTask.id : null);
  const discoveredDuring = currentTask ? 'implementation' : null;

  // Determine priority
  const config = getConfig();
  const defaultPriority = getConfigValue('priorities.defaultPriority', 'P2');

  let priority = flags.priority;
  if (!priority) {
    // Bugs discovered during task work get higher priority
    priority = discoveredFrom ? 'P1' : defaultPriority;
  }

  // Validate priority format
  if (!/^P[0-4]$/.test(priority)) {
    warn(`Invalid priority "${priority}", using ${defaultPriority}`);
    priority = defaultPriority;
  }

  // Determine severity
  const validSeverities = ['critical', 'high', 'medium', 'low'];
  let severity = (flags.severity || 'medium').toLowerCase();
  if (!validSeverities.includes(severity)) {
    warn(`Invalid severity "${severity}", using medium`);
    severity = 'medium';
  }

  // Generate bug ID
  const id = generateTaskId(title);
  const createdAt = new Date().toISOString();

  // Create bug object
  const bug = {
    id,
    title,
    severity,
    priority,
    discoveredFrom,
    discoveredDuring,
    status: 'Open',
    createdAt
  };

  // Write bug file
  const bugPath = path.join(PATHS.bugs, `${id}.md`);
  const content = createBugContent(bug);
  writeFile(bugPath, content);

  // v4.2: Add bug to ready.json so it can be started with /wogi-start
  let addedToReady = false;
  try {
    await withLock(PATHS.ready, async () => {
      const ready = safeJsonParse(PATHS.ready, { ready: [], inProgress: [], completed: [] });

      // Check if already exists (duplicate prevention)
      const exists = ready.ready?.some(t => t.id === id) ||
                     ready.inProgress?.some(t => t.id === id) ||
                     ready.completed?.some(t => t.id === id);

      if (!exists) {
        if (!Array.isArray(ready.ready)) {
          ready.ready = [];
        }

        ready.ready.push({
          id,
          title,
          type: 'bug',
          priority,
          severity,
          discoveredFrom,
          status: 'ready',
          createdAt,
          specPath: bugPath
        });

        writeJson(PATHS.ready, ready);
        addedToReady = true;
      }
    });
  } catch (err) {
    // Non-fatal: bug file was created, just couldn't add to ready.json
    if (process.env.DEBUG) {
      console.error(`[DEBUG] Could not add to ready.json: ${err.message}`);
    }
  }

  // Output result
  if (flags.json) {
    outputJson({
      success: true,
      bug,
      file: bugPath,
      addedToReady
    });
  } else {
    console.log('');
    success(`Created: ${id}`);
    console.log(`  ${color('cyan', bugPath)}`);
    console.log('');
    console.log(`Title: ${title}`);
    console.log(`Priority: ${priority} | Severity: ${severity}`);

    if (discoveredFrom) {
      console.log(`Discovered from: ${color('yellow', discoveredFrom)}`);
    }

    if (addedToReady) {
      console.log('');
      console.log(color('green', `✓ Added to ready.json`));
      console.log(`Start with: ${color('cyan', `/wogi-start ${id}`)}`);
    }

    console.log('');
    info('Edit the file to add description, steps to reproduce, etc.');
  }
}

// Run only when executed directly
if (require.main === module) {
  main().catch(err => {
    error(err.message);
    process.exit(1);
  });
}

module.exports = { main, createBugContent, getCurrentTask };
