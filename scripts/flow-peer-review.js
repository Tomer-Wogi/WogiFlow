#!/usr/bin/env node

/**
 * Wogi Flow - Multi-Model Peer Review
 *
 * Get multiple AI perspectives focused on IMPROVEMENTS and ALTERNATIVES.
 * Different from regular review which focuses on correctness.
 *
 * Usage:
 *   node scripts/flow-peer-review.js [--files <glob>] [--task <id>] [--json]
 */

const { execSync } = require('child_process');
const path = require('path');
const {
  PATHS,
  parseFlags,
  outputJson,
  getConfig,
  getConfigValue,
  color,
  success,
  warn,
  error,
  info
} = require('./flow-utils');

const {
  callModel,
  getConfiguredModels,
  isModelCallingAvailable,
  formatManualPrompt,
  parseModelString
} = require('./flow-model-caller');

// ============================================================
// Review Prompt Templates
// ============================================================

const IMPROVEMENT_PROMPT = `You are reviewing code for IMPROVEMENT OPPORTUNITIES, not bugs.

Focus on:
1. **Optimization**: Can this be faster/more efficient?
2. **Alternatives**: Are there better approaches?
3. **Patterns**: Does this follow best practices?
4. **Readability**: Could this be clearer/simpler?
5. **Extensibility**: Will this be easy to extend?

Do NOT focus on:
- Bug detection (assume it works)
- Security issues (assume it's secure)
- Basic linting (assume style is fine)

CODE TO REVIEW:
\`\`\`
{CODE}
\`\`\`

Respond with a JSON object:
{
  "improvements": [
    {
      "type": "optimization|alternative|pattern|readability|extensibility",
      "description": "Brief description",
      "suggestion": "What to do instead",
      "impact": "high|medium|low"
    }
  ],
  "overallAssessment": "Brief overall quality assessment"
}

Be constructive. If the code is already good, say so.`;

// ============================================================
// Code Collection
// ============================================================

/**
 * Get staged changes for review
 */
function getStagedChanges() {
  try {
    const diff = execSync('git diff --cached', { encoding: 'utf-8' });
    if (diff.trim()) return diff;

    // If no staged changes, try unstaged
    const unstaged = execSync('git diff', { encoding: 'utf-8' });
    return unstaged;
  } catch (err) {
    return '';
  }
}

/**
 * Validate taskId format — must be wf-[8 hex chars] or legacy TASK-NNN/BUG-NNN.
 * Also prevents command injection and path traversal.
 */
function isValidTaskId(taskId) {
  return /^(wf-[a-f0-9]{8}(-\d{2})?|(TASK|BUG)-\d{3,})$/i.test(taskId);
}

/**
 * Validate commit hash format
 */
function isValidCommitHash(hash) {
  return /^[a-f0-9]{7,40}$/.test(hash);
}

/**
 * Get changes for a specific task
 */
function getTaskChanges(taskId) {
  // Validate taskId to prevent command injection
  if (!isValidTaskId(taskId)) {
    warn(`Invalid task ID format: ${taskId}`);
    return getStagedChanges();
  }

  // Try to find the task's commit
  try {
    const log = execSync(`git log --oneline --grep="${taskId}" -1`, { encoding: 'utf-8' });
    if (log.trim()) {
      const commitHash = log.split(' ')[0];
      // Validate commit hash format
      if (!isValidCommitHash(commitHash)) {
        return getStagedChanges();
      }
      return execSync(`git show ${commitHash} --no-notes`, { encoding: 'utf-8' });
    }
  } catch (err) {
    // Fall back to staged changes
  }
  return getStagedChanges();
}

/**
 * Validate glob pattern to prevent command injection
 */
function isValidGlob(glob) {
  // Reject patterns with shell metacharacters that could be exploited
  // Allow: alphanumeric, slashes, dots, asterisks, question marks, brackets, dashes, underscores
  return /^[a-zA-Z0-9./*?[\]_-]+$/.test(glob);
}

/**
 * Validate file path to prevent command injection
 */
function isValidFilePath(filePath) {
  // Reject paths with shell metacharacters
  // Allow: alphanumeric, slashes, dots, dashes, underscores, spaces
  return /^[a-zA-Z0-9./_\s-]+$/.test(filePath) && !filePath.includes('..');
}

/**
 * Get specific files for review
 */
function getFilesContent(glob) {
  // Validate glob to prevent command injection
  if (!isValidGlob(glob)) {
    warn(`Invalid glob pattern: ${glob}`);
    return '';
  }

  try {
    const files = execSync(`git ls-files -- "${glob}"`, { encoding: 'utf-8' })
      .trim()
      .split('\n')
      .filter(Boolean);

    let content = '';
    for (const file of files.slice(0, 5)) { // Limit to 5 files
      // Validate each file path before reading
      if (!isValidFilePath(file)) {
        warn(`Skipping invalid file path: ${file}`);
        continue;
      }
      try {
        const fileContent = require('fs').readFileSync(file, 'utf-8');
        content += `\n// File: ${file}\n${fileContent}\n`;
      } catch {
        // File may have been deleted, skip it
      }
    }
    return content;
  } catch (err) {
    return '';
  }
}

// ============================================================
// Review Analysis
// ============================================================

/**
 * Parse model response into structured format
 */
function parseModelResponse(response, modelName) {
  try {
    // Try to extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        success: true,
        model: modelName,
        improvements: parsed.improvements || [],
        overallAssessment: parsed.overallAssessment || ''
      };
    }
  } catch (err) {
    // Parse as free-form text
  }

  // Fall back to text extraction
  return {
    success: true,
    model: modelName,
    improvements: [{
      type: 'general',
      description: response.slice(0, 500),
      suggestion: '',
      impact: 'medium'
    }],
    overallAssessment: response.slice(0, 200)
  };
}

/**
 * Compare findings from multiple models
 */
function compareFindings(results) {
  const agreements = [];
  const disagreements = [];
  const uniqueInsights = [];

  // Group improvements by description similarity
  const allImprovements = [];
  for (const result of results) {
    for (const imp of result.improvements || []) {
      allImprovements.push({ ...imp, model: result.model });
    }
  }

  // Simple similarity check (could be improved with embeddings)
  const processedIndexes = new Set();

  for (let i = 0; i < allImprovements.length; i++) {
    if (processedIndexes.has(i)) continue;

    const imp1 = allImprovements[i];
    const similar = [];

    for (let j = i + 1; j < allImprovements.length; j++) {
      if (processedIndexes.has(j)) continue;

      const imp2 = allImprovements[j];

      // Check if types match and descriptions are similar
      if (imp1.type === imp2.type) {
        const desc1 = (imp1.description || '').toLowerCase();
        const desc2 = (imp2.description || '').toLowerCase();

        // Simple word overlap check
        const words1 = new Set(desc1.split(/\s+/));
        const words2 = new Set(desc2.split(/\s+/));
        const overlap = [...words1].filter(w => words2.has(w)).length;
        const maxWords = Math.max(words1.size, words2.size);

        if (overlap / maxWords > 0.3) {
          similar.push(imp2);
          processedIndexes.add(j);
        }
      }
    }

    processedIndexes.add(i);

    if (similar.length > 0) {
      // Agreement found
      agreements.push({
        improvement: imp1,
        agreedBy: [imp1.model, ...similar.map(s => s.model)]
      });
    } else {
      // Unique insight
      uniqueInsights.push(imp1);
    }
  }

  return { agreements, disagreements, uniqueInsights };
}

// ============================================================
// Output Formatting
// ============================================================

/**
 * Format peer review results for CLI
 */
function formatResults(comparison, results) {
  let output = '\n';
  output += color('cyan', '━'.repeat(50)) + '\n';
  output += color('cyan', '🔍 Peer Review Results') + '\n';
  output += color('cyan', '━'.repeat(50)) + '\n\n';

  // Agreements
  if (comparison.agreements.length > 0) {
    output += color('green', '✅ Agreement:') + '\n';
    for (const agreement of comparison.agreements) {
      const models = agreement.agreedBy.join(', ');
      output += `   • ${agreement.improvement.description}\n`;
      output += color('dim', `     [${models}]`) + '\n';
    }
    output += '\n';
  }

  // Unique insights
  if (comparison.uniqueInsights.length > 0) {
    output += color('yellow', '💡 Unique Insights:') + '\n';
    for (const insight of comparison.uniqueInsights) {
      output += `   • [${insight.model}] ${insight.description}\n`;
      if (insight.suggestion) {
        output += color('dim', `     → ${insight.suggestion}`) + '\n';
      }
    }
    output += '\n';
  }

  // Overall assessments
  output += color('cyan', '📊 Model Assessments:') + '\n';
  for (const result of results) {
    if (result.overallAssessment) {
      output += `   [${result.model}] ${result.overallAssessment.slice(0, 100)}\n`;
    }
  }
  output += '\n';

  // Summary
  const totalImprovements = comparison.agreements.length + comparison.uniqueInsights.length;
  output += color('cyan', '━'.repeat(50)) + '\n';
  output += `Summary: ${totalImprovements} improvements identified\n`;
  output += `         ${comparison.agreements.length} agreed, ${comparison.uniqueInsights.length} unique\n`;

  return output;
}

// ============================================================
// Main
// ============================================================

async function main() {
  const { flags, positional } = parseFlags(process.argv.slice(2));

  if (flags.help) {
    console.log(`
Usage: flow peer-review [options]

Multi-model peer review for improvement suggestions.

Options:
  --files <glob>    Review specific files
  --task <id>       Review task changes
  --model <name>    Add secondary model
  --provider <name> Override provider (api, mcp, manual)
  --json            Output JSON
  --verbose         Show full model responses

Examples:
  flow peer-review
  flow peer-review --files "src/**/*.ts"
  flow peer-review --task wf-abc123
`);
    process.exit(0);
  }

  const config = getConfig();
  const peerReviewConfig = config.peerReview || {};

  // Check if enabled
  if (peerReviewConfig.enabled === false) {
    error('Peer review is disabled in config');
    console.log('Enable with: flow config set peerReview.enabled true');
    process.exit(1);
  }

  // Collect code to review
  let code = '';

  if (flags.files) {
    code = getFilesContent(flags.files);
  } else if (flags.task) {
    code = getTaskChanges(flags.task);
  } else {
    code = getStagedChanges();
  }

  if (!code.trim()) {
    error('No code changes found to review');
    console.log('Stage changes or specify --files or --task');
    process.exit(1);
  }

  // Truncate if too long
  if (code.length > 10000) {
    code = code.slice(0, 10000) + '\n... (truncated)';
    warn('Code truncated to 10KB for review');
  }

  // Build prompt
  const prompt = IMPROVEMENT_PROMPT.replace('{CODE}', code);

  // Check model availability
  const availability = isModelCallingAvailable();

  // Get configured models
  const models = getConfiguredModels();

  console.log('');
  info(`Peer review with ${models.length} model(s)...`);
  console.log('');

  // Results collection
  const results = [];

  // Manual mode
  if (peerReviewConfig.provider === 'manual' || !availability.available) {
    console.log(formatManualPrompt(prompt, { code }));

    if (flags.json) {
      outputJson({
        success: true,
        mode: 'manual',
        prompt,
        message: 'Copy prompt to external AI and paste response'
      });
    } else {
      console.log('');
      info('Manual mode: Copy the prompt above to another AI model');
      console.log('Then paste the response and I will synthesize the results.');
    }
    return;
  }

  // Call each model
  for (const modelStr of models) {
    const { provider, model } = parseModelString(modelStr);
    console.log(`  Calling ${provider}:${model}...`);

    const result = await callModel(modelStr, prompt);

    if (result.success) {
      const parsed = parseModelResponse(result.response, `${provider}:${model}`);
      results.push(parsed);

      if (flags.verbose) {
        console.log(color('dim', `\n[${provider}:${model} response]`));
        console.log(color('dim', result.response.slice(0, 500)));
        console.log('');
      }
    } else {
      warn(`${provider}:${model} failed: ${result.error}`);
      results.push({
        success: false,
        model: `${provider}:${model}`,
        error: result.error,
        improvements: [],
        overallAssessment: ''
      });
    }
  }

  // Compare findings
  const comparison = compareFindings(results);

  // Output
  if (flags.json) {
    outputJson({
      success: true,
      models: models.map(m => parseModelString(m)),
      results,
      comparison,
      summary: {
        totalImprovements: comparison.agreements.length + comparison.uniqueInsights.length,
        agreements: comparison.agreements.length,
        unique: comparison.uniqueInsights.length
      }
    });
  } else {
    console.log(formatResults(comparison, results));
  }
}

// Run
if (require.main === module) {
  main().catch(err => {
    error(`Peer review failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  getStagedChanges,
  getTaskChanges,
  compareFindings,
  formatResults,
  IMPROVEMENT_PROMPT,
  // Security validation functions
  isValidTaskId,
  isValidCommitHash,
  isValidGlob,
  isValidFilePath
};
