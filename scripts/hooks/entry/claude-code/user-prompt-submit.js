#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code UserPromptSubmit Hook
 *
 * Called when user submits a prompt (before processing).
 * Enforces implementation gate - blocks implementation requests without active task.
 */

const fs = require('node:fs');
const { checkImplementationGate } = require('../../core/implementation-gate');
const { checkResearchRequirement } = require('../../core/research-gate');
const { setRoutingPending, clearRoutingPending, ROUTING_CLEARED_PATH } = require('../../core/routing-gate');
const { getPhaseContextPrompt } = require('../../core/phase-gate');
const { claudeCodeAdapter } = require('../../adapters/claude-code');
const { markSkillPending, loadDurableSession } = require('../../../flow-durable-session');
const { captureCurrentPrompt } = require('../../../flow-prompt-capture');
const { spawnBackgroundDetection } = require('../../../flow-correction-detector');
const { getConfig } = require('../../../flow-utils');
const { readHookInput } = require('../shared/read-stdin');

async function main() {
  try {
    const { input: parsedStdin } = await readHookInput();

    // Handle empty input gracefully
    if (!parsedStdin) {
      console.log(JSON.stringify({ continue: true, hookSpecificOutput: { hookEventName: 'UserPromptSubmit' } }));
      process.exit(0);
      return;
    }

    // Parse JSON safely with prototype pollution protection
    let input;
    try {
      input = parsedStdin;
      if (!input) {
        // Invalid JSON - allow through (graceful degradation)
        console.log(JSON.stringify({ continue: true, hookSpecificOutput: { hookEventName: 'UserPromptSubmit' } }));
        process.exit(0);
        return;
      }
    } catch (err) {
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

    // Load config once for feature flag checks
    let hookConfig;
    try {
      hookConfig = getConfig();
    } catch (err) {
      hookConfig = {};
    }

    // v5.0: Capture prompt for learning system (non-blocking)
    // Controlled by hooks.rules.intelligence.promptCapture.enabled
    if (hookConfig.hooks?.rules?.intelligence?.promptCapture?.enabled !== false) {
      if (typeof prompt === 'string' && prompt.trim().length > 0) {
        // Fire-and-forget: capture prompt after hook output is sent
        setImmediate(() => {
          try {
            captureCurrentPrompt(prompt);
          } catch (err) {
            if (process.env.DEBUG) {
              console.error(`[Hook] Prompt capture failed: ${err.message}`);
            }
          }
        });
      }
    }

    // v5.1→v7.0: Detect corrections for learning system (AI-only, non-blocking)
    // Controlled by hooks.rules.intelligence.correctionDetection.enabled
    if (hookConfig.hooks?.rules?.intelligence?.correctionDetection?.enabled !== false) {
      if (typeof prompt === 'string' && prompt.trim().length > 0) {
        try {
          const session = loadDurableSession();
          spawnBackgroundDetection(prompt, session?.taskId || '');
        } catch (err) {
          // Non-blocking - don't fail the hook if detection spawn fails
          if (process.env.DEBUG) {
            console.error(`[Hook] Correction detection spawn failed: ${err.message}`);
          }
        }
      }
    }

    // v6.0: Set routing-pending flag for routing gate enforcement
    // This blocks ALL gated tool calls until a /wogi-* skill is invoked
    // v8.0: Always set, even with active tasks — every turn must route through /wogi-start.
    // Exception: skipped when the prompt IS a /wogi-* command (see isWogiCommand below).
    // v6.1: Also skip when the prompt IS a /wogi-* command — the user is already routing.
    // When users type "/wogi-start ..." directly, Claude Code expands the skill inline
    // (not through the Skill tool), so clearRoutingPending() in PreToolUse never fires.
    // Setting the flag here would create an uncleable block.
    // Tightened regex: only match /wogi-[lowercase-alphanumeric-hyphens] to prevent
    // injection via crafted prompts like "/wogi-<script>" or "/wogi-../../path"
    const isWogiCommand = typeof prompt === 'string' && /^\/wogi-[a-z0-9-]+\b/i.test(prompt.trim());
    if (!isWogiCommand) {
      // v8.1: Delete any stale cleared marker from previous turns.
      // The cleared marker prevents flag re-setting during skill chains (same AI response).
      // But across user turns, it must not persist — otherwise tools are unblocked without
      // routing for the duration of the marker's TTL. A new user prompt (non-wogi-command)
      // is unambiguously a new turn, so the old marker is invalidated.
      try {
        fs.unlinkSync(ROUTING_CLEARED_PATH);
      } catch (err) {
        // ENOENT is fine — no marker to delete
        if (err.code !== 'ENOENT' && process.env.DEBUG) {
          console.error(`[Hook] Failed to delete cleared marker: ${err.message}`);
        }
      }

      try {
        setRoutingPending();
      } catch (err) {
        // Non-blocking - don't fail the hook if routing gate fails (fail-open)
        if (process.env.DEBUG) {
          console.error(`[Hook] Routing gate set failed: ${err.message}`);
        }
      }
    } else {
      // v6.2: Actively CLEAR any existing routing flag when user explicitly types a /wogi-* command.
      // Previously we only skipped setting it, but a flag from a prior prompt would persist and
      // block tool calls inside the /wogi-* command when Claude Code expands it inline (not via Skill tool).
      try {
        clearRoutingPending();
        if (process.env.DEBUG) {
          console.error(`[Hook] Cleared routing flag — prompt is a /wogi-* command`);
        }
      } catch (err) {
        if (process.env.DEBUG) {
          console.error(`[Hook] Routing gate clear failed: ${err.message}`);
        }
      }
    }

    // Phase context injection (just-in-time phase-specific instructions)
    let phasePrompt = null;
    try {
      const phaseContext = getPhaseContextPrompt();
      if (phaseContext.inject && phaseContext.prompt) {
        phasePrompt = phaseContext.prompt;
      }
    } catch (err) {
      // Non-blocking - phase context is best-effort
      if (process.env.DEBUG) {
        console.error(`[Hook] Phase context injection failed: ${err.message}`);
      }
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

    // Inject phase-specific context prompt (additionalSystemPrompt)
    if (phasePrompt) {
      coreResult = {
        ...coreResult,
        phasePrompt
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
