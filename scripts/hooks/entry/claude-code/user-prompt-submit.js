#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code UserPromptSubmit Hook
 *
 * Called when user submits a prompt (before processing).
 * Enforces implementation gate - blocks implementation requests without active task.
 */

const { checkImplementationGate } = require('../../core/implementation-gate');
const { checkResearchRequirement } = require('../../core/research-gate');
const { setRoutingPending } = require('../../core/routing-gate');
const { claudeCodeAdapter } = require('../../adapters/claude-code');
const { markSkillPending, loadDurableSession } = require('../../../flow-durable-session');
const { captureCurrentPrompt } = require('../../../flow-prompt-capture');
const { detectCorrectionRegex, queuePendingCorrection } = require('../../../flow-correction-detector');
const { safeJsonParseString } = require('../../../flow-utils');

// Maximum stdin size to prevent DoS (100KB should be more than enough for prompts)
const MAX_STDIN_SIZE = 100 * 1024;

async function main() {
  try {
    // Read input from stdin with size limit
    let inputData = '';
    let totalSize = 0;
    for await (const chunk of process.stdin) {
      totalSize += chunk.length;
      if (totalSize > MAX_STDIN_SIZE) {
        // Truncate at limit to prevent memory exhaustion
        inputData += chunk.slice(0, MAX_STDIN_SIZE - (totalSize - chunk.length));
        break;
      }
      inputData += chunk;
    }

    // Handle empty input gracefully
    if (!inputData || inputData.trim().length === 0) {
      console.log(JSON.stringify({ continue: true, hookSpecificOutput: { hookEventName: 'UserPromptSubmit' } }));
      process.exit(0);
      return;
    }

    // Parse JSON safely with prototype pollution protection
    let input;
    try {
      input = safeJsonParseString(inputData, null);
      if (!input) {
        // Invalid JSON - allow through (graceful degradation)
        console.log(JSON.stringify({ continue: true, hookSpecificOutput: { hookEventName: 'UserPromptSubmit' } }));
        process.exit(0);
        return;
      }
    } catch (_parseErr) {
      // Parse error - allow through (graceful degradation)
      console.log(JSON.stringify({ continue: true, hookSpecificOutput: { hookEventName: 'UserPromptSubmit' } }));
      process.exit(0);
      return;
    }

    const parsedInput = claudeCodeAdapter.parseInput(input);

    const prompt = parsedInput.prompt;
    const source = parsedInput.source;

    // v4.1: Detect skill commands that need execution tracking
    // This prevents premature exit when /wogi-bulk or /wogi-start is entered
    if (typeof prompt === 'string') {
      const skillMatch = prompt.match(/^\/(wogi-bulk|wogi-start)\b/i);
      if (skillMatch) {
        const skillName = skillMatch[1].toLowerCase();
        markSkillPending(skillName, { prompt });
        if (process.env.DEBUG) {
          console.error(`[Hook] Marked /${skillName} as pending execution`);
        }
      }
    }

    // v5.0: Capture prompt for learning system (non-blocking)
    // Captures all user prompts during task execution for refinement detection
    if (typeof prompt === 'string' && prompt.trim().length > 0) {
      try {
        captureCurrentPrompt(prompt);
      } catch (err) {
        // Non-blocking - don't fail the hook if capture fails
        if (process.env.DEBUG) {
          console.error(`[Hook] Prompt capture failed: ${err.message}`);
        }
      }
    }

    // v5.1: Detect corrections for learning system (non-blocking, regex-only)
    // Uses regex-only detection in hook context (API calls would slow down hook)
    // Semantic detection with Haiku deferred to session-end review
    if (typeof prompt === 'string' && prompt.trim().length > 0) {
      try {
        // Use regex detection only in hook context for speed
        const result = detectCorrectionRegex(prompt);
        if (result.isCorrection && result.confidence >= 50) {
          const session = loadDurableSession();
          queuePendingCorrection({
            taskId: session?.taskId || null,
            userMessage: prompt,
            correctionType: result.correctionType,
            whatWasWrong: null, // Regex can't determine this
            whatUserWants: null,
            confidence: result.confidence,
            method: 'regex-hook'
          });
        }
      } catch (err) {
        // Non-blocking - don't fail the hook if detection fails
        if (process.env.DEBUG) {
          console.error(`[Hook] Correction detection failed: ${err.message}`);
        }
      }
    }

    // v6.0: Set routing-pending flag for routing gate enforcement
    // This blocks Bash calls until a /wogi-* skill is invoked
    // Skipped when an active task exists (follow-ups during tracked work are allowed)
    // v6.1: Also skip when the prompt IS a /wogi-* command — the user is already routing.
    // When users type "/wogi-start ..." directly, Claude Code expands the skill inline
    // (not through the Skill tool), so clearRoutingPending() in PreToolUse never fires.
    // Setting the flag here would create an uncleable block.
    // Tightened regex: only match /wogi-[lowercase-alphanumeric-hyphens] to prevent
    // injection via crafted prompts like "/wogi-<script>" or "/wogi-../../path"
    const isWogiCommand = typeof prompt === 'string' && /^\/wogi-[a-z0-9-]+\b/i.test(prompt.trim());
    if (!isWogiCommand) {
      try {
        setRoutingPending();
      } catch (err) {
        // Non-blocking - don't fail the hook if routing gate fails (fail-open)
        if (process.env.DEBUG) {
          console.error(`[Hook] Routing gate set failed: ${err.message}`);
        }
      }
    } else if (process.env.DEBUG) {
      console.error(`[Hook] Skipping routing flag — prompt is a /wogi-* command`);
    }

    // Check research gate first (before implementation gate)
    // Auto-triggers research protocol for capability/existence/feasibility questions
    const researchResult = checkResearchRequirement({
      prompt,
      source
    });

    // Check implementation gate
    let coreResult = checkImplementationGate({
      prompt,
      source
    });

    // If research protocol should be injected, add it to system reminder
    if (researchResult.injectProtocol && researchResult.protocolSteps) {
      coreResult = {
        ...coreResult,
        systemReminder: researchResult.protocolSteps,
        researchTriggered: true,
        questionType: researchResult.questionType,
        suggestedDepth: researchResult.suggestedDepth
      };
    } else if (researchResult.warning && coreResult.allowed) {
      // Soft warning mode (not strict)
      coreResult = {
        ...coreResult,
        warning: true,
        researchWarning: researchResult.message,
        suggestedCommand: researchResult.suggestedCommand
      };
    }

    // Transform to Claude Code format
    const output = claudeCodeAdapter.transformResult('UserPromptSubmit', coreResult);

    // Output JSON
    console.log(JSON.stringify(output));
    process.exit(0);
  } catch (err) {
    // Fail-closed: block the prompt on hook errors to prevent untracked implementation
    // Users installed WogiFlow to enforce task tracking - failing open would bypass that
    if (process.env.DEBUG) {
      console.error(`[Wogi Flow Hook Error] ${err.message}`);
    } else {
      console.error('[Wogi Flow Hook] Validation error occurred');
    }
    console.log(JSON.stringify({
      decision: 'block',
      reason: 'WogiFlow validation error. Please check your WogiFlow setup or use /wogi-start to route your request.'
    }));
    process.exit(0);
  }
}

// Handle stdin properly
process.stdin.setEncoding('utf8');

// Must await async main() to prevent race conditions
// Without await, Node.js may exit before stdin finishes reading
(async () => {
  try {
    await main();
  } catch (err) {
    // Fail-closed: block on unexpected errors to prevent untracked implementation
    if (process.env.DEBUG) {
      console.error(`[Wogi Flow Hook] Unexpected error: ${err.message}`);
    }
    console.log(JSON.stringify({
      decision: 'block',
      reason: 'WogiFlow hook error. Use /wogi-start to route your request.'
    }));
    process.exit(0);
  }
})();
