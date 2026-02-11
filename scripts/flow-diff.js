#!/usr/bin/env node

/**
 * Wogi Flow - Diff Generation and Preview
 *
 * Generates unified diffs for file operations.
 * Supports preview mode and interactive apply.
 *
 * Usage as module:
 *   const { generateDiff, applyDiffs } = require('./flow-diff');
 *
 * Usage as CLI:
 *   flow diff <file1> <file2>           # Show diff between files
 *   flow diff --preview <operations.json>  # Preview proposed changes
 *   flow diff --apply <operations.json>    # Apply changes from JSON
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { colors: c, getProjectRoot } = require('./flow-utils');

/**
 * Simple diff implementation (line-based)
 * Creates unified diff format
 */
function createUnifiedDiff(oldContent, newContent, oldPath, newPath) {
  const oldLines = (oldContent || '').split('\n');
  const newLines = (newContent || '').split('\n');

  // LCS-based diff
  const diff = computeDiff(oldLines, newLines);

  // Format as unified diff
  let output = '';
  output += `--- ${oldPath}\n`;
  output += `+++ ${newPath}\n`;

  // Group changes into hunks
  const hunks = groupIntoHunks(diff, oldLines, newLines);

  for (const hunk of hunks) {
    output += `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@\n`;
    output += hunk.lines.join('\n') + '\n';
  }

  return output;
}

/**
 * Compute line-by-line diff using LCS algorithm
 */
function computeDiff(oldLines, newLines) {
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS matrix
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find diff
  const diff = [];
  let i = m, j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      diff.unshift({ type: 'same', oldLine: i, newLine: j, content: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diff.unshift({ type: 'add', newLine: j, content: newLines[j - 1] });
      j--;
    } else {
      diff.unshift({ type: 'remove', oldLine: i, content: oldLines[i - 1] });
      i--;
    }
  }

  return diff;
}

/**
 * Group diff entries into hunks with context
 */
function groupIntoHunks(diff, oldLines, newLines, contextLines = 3) {
  const hunks = [];
  let currentHunk = null;
  let lastChangeIdx = -contextLines - 1;

  for (let i = 0; i < diff.length; i++) {
    const entry = diff[i];
    const isChange = entry.type !== 'same';

    if (isChange) {
      // Start new hunk if too far from last change
      if (i - lastChangeIdx > contextLines * 2 + 1) {
        if (currentHunk) {
          hunks.push(currentHunk);
        }
        currentHunk = {
          oldStart: entry.oldLine || 1,
          oldCount: 0,
          newStart: entry.newLine || 1,
          newCount: 0,
          lines: []
        };

        // Add leading context
        for (let c = Math.max(0, i - contextLines); c < i; c++) {
          if (diff[c].type === 'same') {
            currentHunk.lines.push(' ' + diff[c].content);
            currentHunk.oldCount++;
            currentHunk.newCount++;
          }
        }
      }

      lastChangeIdx = i;
    }

    if (currentHunk) {
      if (entry.type === 'same') {
        // Check if within trailing context
        if (i - lastChangeIdx <= contextLines) {
          currentHunk.lines.push(' ' + entry.content);
          currentHunk.oldCount++;
          currentHunk.newCount++;
        }
      } else if (entry.type === 'remove') {
        currentHunk.lines.push('-' + entry.content);
        currentHunk.oldCount++;
      } else if (entry.type === 'add') {
        currentHunk.lines.push('+' + entry.content);
        currentHunk.newCount++;
      }
    }
  }

  if (currentHunk && currentHunk.lines.length > 0) {
    hunks.push(currentHunk);
  }

  return hunks;
}

/**
 * Generate diff for a single file operation
 */
function generateDiff(filePath, originalContent, newContent) {
  return createUnifiedDiff(
    originalContent || '',
    newContent,
    `a/${filePath}`,
    `b/${filePath}`
  );
}

/**
 * Parse file operations and generate diffs
 */
function generateDiffsForOperations(operations) {
  const diffs = [];

  for (const op of operations) {
    const filePath = op.path;

    if (op.type === 'write' || op.type === 'modify' || op.type === 'create') {
      const originalContent = fs.existsSync(filePath)
        ? fs.readFileSync(filePath, 'utf-8')
        : '';

      const isNew = !fs.existsSync(filePath);
      const diff = generateDiff(filePath, originalContent, op.content);

      // Count additions and deletions
      const diffLines = diff.split('\n');
      const additions = diffLines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
      const deletions = diffLines.filter(l => l.startsWith('-') && !l.startsWith('---')).length;

      diffs.push({
        path: filePath,
        operation: isNew ? 'create' : 'modify',
        diff: diff,
        additions,
        deletions,
        content: op.content
      });
    } else if (op.type === 'delete') {
      const originalContent = fs.existsSync(filePath)
        ? fs.readFileSync(filePath, 'utf-8')
        : '';

      const diff = generateDiff(filePath, originalContent, '');

      diffs.push({
        path: filePath,
        operation: 'delete',
        diff: diff,
        additions: 0,
        deletions: originalContent.split('\n').length
      });
    }
  }

  return diffs;
}

/**
 * Format diffs for terminal display
 */
function formatDiffsForDisplay(diffs, options = {}) {
  const showLineNumbers = options.showLineNumbers !== false;
  let output = '';

  for (const d of diffs) {
    // Header
    const opIcon = d.operation === 'create' ? '🆕' :
                   d.operation === 'delete' ? '🗑️' : '📝';
    const opColor = d.operation === 'create' ? c.green :
                    d.operation === 'delete' ? c.red : c.yellow;

    output += `\n${c.cyan}${'━'.repeat(60)}${c.reset}\n`;
    output += `${opIcon} ${opColor}${c.bold}${d.operation.toUpperCase()}${c.reset}: ${d.path}\n`;
    output += `${c.dim}+${d.additions} -${d.deletions}${c.reset}\n`;
    output += `${c.cyan}${'─'.repeat(60)}${c.reset}\n`;

    // Diff content
    for (const line of d.diff.split('\n')) {
      if (line.startsWith('+++') || line.startsWith('---')) {
        output += `${c.bold}${line}${c.reset}\n`;
      } else if (line.startsWith('@@')) {
        output += `${c.cyan}${line}${c.reset}\n`;
      } else if (line.startsWith('+')) {
        output += `${c.green}${line}${c.reset}\n`;
      } else if (line.startsWith('-')) {
        output += `${c.red}${line}${c.reset}\n`;
      } else {
        output += `${line}\n`;
      }
    }
  }

  return output;
}

/**
 * Save diffs to a run's artifacts
 */
function saveDiffsToRun(runId, diffs) {
  const runDir = path.join(getProjectRoot(), '.workflow', 'runs', runId);

  if (!fs.existsSync(runDir)) {
    return false;
  }

  const artifactsDir = path.join(runDir, 'artifacts');
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  // Save combined diff
  let combinedDiff = '';
  for (const d of diffs) {
    combinedDiff += d.diff + '\n';
  }
  fs.writeFileSync(path.join(artifactsDir, 'proposed-changes.diff'), combinedDiff);

  // Save structured JSON
  fs.writeFileSync(
    path.join(artifactsDir, 'proposed-changes.json'),
    JSON.stringify(diffs, null, 2)
  );

  return true;
}

/**
 * Parse SEARCH/REPLACE blocks from LLM output
 * Format:
 *   <<<<<<< SEARCH
 *   old content
 *   =======
 *   new content
 *   >>>>>>> REPLACE
 *
 * IMPORTANT: Uses EXACT matching only - no fuzzy matching.
 * If the search text doesn't match exactly, the operation fails.
 */
function parseSearchReplaceBlocks(content) {
  const blocks = [];
  const regex = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;

  let match;
  while ((match = regex.exec(content)) !== null) {
    blocks.push({
      search: match[1],
      replace: match[2]
    });
  }

  return blocks;
}

/**
 * Apply SEARCH/REPLACE blocks to file content
 * EXACT MATCH ONLY - fails if search text not found exactly
 *
 * @returns { content: string, applied: number, failed: { search: string, reason: string }[] }
 */
function applySearchReplaceBlocks(fileContent, blocks) {
  let content = fileContent;
  let applied = 0;
  const failed = [];

  for (const block of blocks) {
    // Exact match only - no fuzzy matching
    if (content.includes(block.search)) {
      // Count occurrences
      const occurrences = content.split(block.search).length - 1;

      if (occurrences > 1) {
        // Multiple matches - fail to avoid unintended changes
        failed.push({
          search: block.search.slice(0, 100) + (block.search.length > 100 ? '...' : ''),
          reason: `Found ${occurrences} matches - search text is not unique. Add more context.`
        });
      } else {
        // Single exact match - apply
        content = content.replace(block.search, block.replace);
        applied++;
      }
    } else {
      // No match found
      failed.push({
        search: block.search.slice(0, 100) + (block.search.length > 100 ? '...' : ''),
        reason: 'Search text not found (exact match required)'
      });
    }
  }

  return { content, applied, failed };
}

/**
 * Apply SEARCH/REPLACE changes to a file
 * Returns success status and details
 */
function applySearchReplaceToFile(filePath, searchReplaceContent) {
  const blocks = parseSearchReplaceBlocks(searchReplaceContent);

  if (blocks.length === 0) {
    return {
      success: false,
      error: 'No SEARCH/REPLACE blocks found in content',
      applied: 0,
      failed: []
    };
  }

  if (!fs.existsSync(filePath)) {
    return {
      success: false,
      error: `File not found: ${filePath}`,
      applied: 0,
      failed: blocks.map(b => ({
        search: b.search.slice(0, 50),
        reason: 'File does not exist'
      }))
    };
  }

  const originalContent = fs.readFileSync(filePath, 'utf-8');
  const result = applySearchReplaceBlocks(originalContent, blocks);

  if (result.failed.length === 0) {
    // All blocks applied successfully
    fs.writeFileSync(filePath, result.content);
    return {
      success: true,
      applied: result.applied,
      failed: [],
      originalContent,
      newContent: result.content
    };
  }

  if (result.applied > 0) {
    // Partial success - write what we could apply
    fs.writeFileSync(filePath, result.content);
    return {
      success: false,
      partial: true,
      applied: result.applied,
      failed: result.failed,
      originalContent,
      newContent: result.content
    };
  }

  // Complete failure
  return {
    success: false,
    applied: 0,
    failed: result.failed
  };
}

/**
 * Apply diffs (write files)
 */
function applyDiffs(operations) {
  const results = [];

  for (const op of operations) {
    try {
      if (op.type === 'delete') {
        if (fs.existsSync(op.path)) {
          fs.unlinkSync(op.path);
        }
        results.push({ path: op.path, success: true, operation: 'delete' });
      } else {
        // Ensure directory exists
        const dir = path.dirname(op.path);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(op.path, op.content);
        results.push({
          path: op.path,
          success: true,
          operation: fs.existsSync(op.path) ? 'modify' : 'create'
        });
      }
    } catch (err) {
      results.push({
        path: op.path,
        success: false,
        error: err.message
      });
    }
  }

  return results;
}

/**
 * Interactive confirmation prompt
 */
async function confirmApply(diffs) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(`\nApply these changes? [${c.green}y${c.reset}/${c.red}N${c.reset}]: `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Preview and optionally apply operations
 */
async function previewAndApply(operations, options = {}) {
  const diffs = generateDiffsForOperations(operations);

  // Show preview
  console.log(formatDiffsForDisplay(diffs, options));

  // Summary
  const totalAdds = diffs.reduce((sum, d) => sum + d.additions, 0);
  const totalDels = diffs.reduce((sum, d) => sum + d.deletions, 0);
  console.log(`\n${c.bold}Summary:${c.reset} ${diffs.length} files, ${c.green}+${totalAdds}${c.reset} ${c.red}-${totalDels}${c.reset} lines\n`);

  // Handle apply modes
  if (options.dryRun) {
    console.log(`${c.dim}(dry run - no changes applied)${c.reset}`);
    return { applied: false, diffs };
  }

  if (options.apply) {
    // Auto-apply
    const results = applyDiffs(operations);
    const successCount = results.filter(r => r.success).length;
    console.log(`${c.green}✅ Applied ${successCount}/${results.length} changes${c.reset}`);
    return { applied: true, results, diffs };
  }

  if (options.nonInteractive) {
    console.log(`${c.yellow}⚠️  Non-interactive mode: use --apply to apply changes${c.reset}`);
    return { applied: false, diffs };
  }

  // Interactive confirmation
  const confirmed = await confirmApply(diffs);

  if (confirmed) {
    const results = applyDiffs(operations);
    const successCount = results.filter(r => r.success).length;
    console.log(`${c.green}✅ Applied ${successCount}/${results.length} changes${c.reset}`);
    return { applied: true, results, diffs };
  }

  console.log(`${c.dim}Changes not applied.${c.reset}`);
  return { applied: false, diffs };
}

// Module exports
module.exports = {
  generateDiff,
  generateDiffsForOperations,
  formatDiffsForDisplay,
  saveDiffsToRun,
  applyDiffs,
  previewAndApply,
  confirmApply,
  // SEARCH/REPLACE exact-match functions
  parseSearchReplaceBlocks,
  applySearchReplaceBlocks,
  applySearchReplaceToFile
};

// CLI Handler
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log(`
${c.cyan}Wogi Flow - Diff Generation and Preview${c.reset}

${c.bold}Usage:${c.reset}
  flow diff <file1> <file2>              Show diff between two files
  flow diff --preview <operations.json>  Preview proposed changes
  flow diff --apply <operations.json>    Apply changes from JSON
  flow diff --dry-run <operations.json>  Show diff without prompting
  flow diff --search-replace <file> <changes.txt>  Apply SEARCH/REPLACE blocks

${c.bold}Options:${c.reset}
  --apply         Auto-apply without confirmation
  --dry-run       Show preview only, don't apply
  --json          Output diff in JSON format
  --search-replace Apply SEARCH/REPLACE format changes (exact match only)

${c.bold}Operations JSON Format:${c.reset}
  [
    { "type": "write", "path": "src/file.ts", "content": "..." },
    { "type": "delete", "path": "old-file.ts" }
  ]

${c.bold}SEARCH/REPLACE Format:${c.reset}
  <<<<<<< SEARCH
  old code to find (must match exactly)
  =======
  new code to replace with
  >>>>>>> REPLACE

  ${c.yellow}Note: Uses EXACT matching only. No fuzzy matching.${c.reset}
  If search text isn't found exactly, the operation fails.
    `);
    process.exit(0);
  }

  const jsonOutput = args.includes('--json');
  const dryRun = args.includes('--dry-run');
  const apply = args.includes('--apply');

  // Filter out flags
  const positionalArgs = args.filter(a => !a.startsWith('--'));

  if (args.includes('--search-replace')) {
    // Apply SEARCH/REPLACE blocks to a file
    if (positionalArgs.length < 2) {
      console.error(`${c.red}Error: --search-replace requires <target-file> <changes-file>${c.reset}`);
      process.exit(1);
    }

    const [targetFile, changesFile] = positionalArgs;

    if (!fs.existsSync(targetFile)) {
      console.error(`${c.red}Error: Target file not found: ${targetFile}${c.reset}`);
      process.exit(1);
    }

    let changesContent;
    if (fs.existsSync(changesFile)) {
      changesContent = fs.readFileSync(changesFile, 'utf-8');
    } else {
      // Maybe it's inline content
      changesContent = changesFile;
    }

    const blocks = parseSearchReplaceBlocks(changesContent);
    console.log(`\n${c.cyan}Applying ${blocks.length} SEARCH/REPLACE block(s) to ${targetFile}${c.reset}\n`);

    if (blocks.length === 0) {
      console.error(`${c.red}No SEARCH/REPLACE blocks found in changes${c.reset}`);
      process.exit(1);
    }

    if (dryRun) {
      // Show preview only
      for (let i = 0; i < blocks.length; i++) {
        console.log(`${c.yellow}Block ${i + 1}:${c.reset}`);
        console.log(`${c.red}- ${blocks[i].search.split('\n')[0]}...${c.reset}`);
        console.log(`${c.green}+ ${blocks[i].replace.split('\n')[0]}...${c.reset}`);
        console.log('');
      }
      console.log(`${c.dim}(dry run - no changes applied)${c.reset}`);
      process.exit(0);
    }

    const result = applySearchReplaceToFile(targetFile, changesContent);

    if (result.success) {
      console.log(`${c.green}✅ Applied ${result.applied} change(s) successfully${c.reset}`);
    } else if (result.partial) {
      console.log(`${c.yellow}⚠️  Partial success: ${result.applied} applied, ${result.failed.length} failed${c.reset}`);
      for (const f of result.failed) {
        console.log(`   ${c.red}✗${c.reset} ${f.reason}`);
        console.log(`     ${c.dim}Search: ${f.search}${c.reset}`);
      }
      process.exit(1);
    } else {
      console.log(`${c.red}❌ All changes failed${c.reset}`);
      for (const f of result.failed) {
        console.log(`   ${c.red}✗${c.reset} ${f.reason}`);
        console.log(`     ${c.dim}Search: ${f.search}${c.reset}`);
      }
      process.exit(1);
    }
  } else if (args.includes('--preview') || args.includes('--apply') || args.includes('--dry-run')) {
    // Preview/apply operations from JSON file
    const jsonFile = positionalArgs[0];
    if (!jsonFile || !fs.existsSync(jsonFile)) {
      console.error(`${c.red}Error: Operations JSON file required${c.reset}`);
      process.exit(1);
    }

    const operations = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));

    previewAndApply(operations, {
      dryRun,
      apply,
      nonInteractive: process.env.CI === 'true'
    }).catch(err => {
      console.error(`${c.red}Error: ${err.message}${c.reset}`);
      process.exit(1);
    });
  } else if (positionalArgs.length >= 2) {
    // Diff between two files
    const [file1, file2] = positionalArgs;

    if (!fs.existsSync(file1)) {
      console.error(`${c.red}Error: File not found: ${file1}${c.reset}`);
      process.exit(1);
    }
    if (!fs.existsSync(file2)) {
      console.error(`${c.red}Error: File not found: ${file2}${c.reset}`);
      process.exit(1);
    }

    const content1 = fs.readFileSync(file1, 'utf-8');
    const content2 = fs.readFileSync(file2, 'utf-8');
    const diff = generateDiff(file1, content1, content2);

    if (jsonOutput) {
      console.log(JSON.stringify({ diff }, null, 2));
    } else {
      // Colorize output
      for (const line of diff.split('\n')) {
        if (line.startsWith('+++') || line.startsWith('---')) {
          console.log(`${c.bold}${line}${c.reset}`);
        } else if (line.startsWith('@@')) {
          console.log(`${c.cyan}${line}${c.reset}`);
        } else if (line.startsWith('+')) {
          console.log(`${c.green}${line}${c.reset}`);
        } else if (line.startsWith('-')) {
          console.log(`${c.red}${line}${c.reset}`);
        } else {
          console.log(line);
        }
      }
    }
  } else {
    console.error(`${c.red}Error: Not enough arguments${c.reset}`);
    console.log(`${c.dim}Run "flow diff --help" for usage${c.reset}`);
    process.exit(1);
  }
}
