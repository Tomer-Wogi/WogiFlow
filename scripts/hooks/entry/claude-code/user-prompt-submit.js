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
const { markSkillPending, loadDurableSession } = require('../../../flow-durable-session');
const { captureCurrentPrompt } = require('../../../flow-prompt-capture');
const { spawnBackgroundDetection } = require('../../../flow-correction-detector');
const { getConfig } = require('../../../flow-utils');
const { runHook } = require('../shared/hook-runner');

runHook('UserPromptSubmit', async ({ input, parsedInput }) => {
  // Handle empty input gracefully
  if (!input || Object.keys(input).length === 0) {
    return { __raw: true, continue: true, hookSpecificOutput: { hookEventName: 'UserPromptSubmit' } };
  }

  const prompt = parsedInput.prompt;
  const source = parsedInput.source;

  // wf-729ab5c0 follow-up — clear pending-question marker on user response.
  // This unblocks a deferred task-boundary restart. The AI may have asked a
  // question via `flow ask "..."` after task completion; user's response
  // releases the deferral, and the next Stop hook will fire the restart.
  try {
    const { clearPendingQuestion } = require('../../../flow-ask');
    const r = clearPendingQuestion();
    if (r.wasPresent && process.env.DEBUG) {
      console.error(`[UserPromptSubmit] Cleared pending-question marker — restart deferral released`);
    }
  } catch (_err) { /* non-fatal */ }

  // v4.1: Detect skill commands that need execution tracking
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
  if (hookConfig.hooks?.rules?.intelligence?.promptCapture?.enabled !== false) {
    if (typeof prompt === 'string' && prompt.trim().length > 0) {
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

  // v5.1->v7.0: Detect corrections for learning system (AI-only, non-blocking)
  if (hookConfig.hooks?.rules?.intelligence?.correctionDetection?.enabled !== false) {
    if (typeof prompt === 'string' && prompt.trim().length > 0) {
      try {
        const session = loadDurableSession();
        spawnBackgroundDetection(prompt, session?.taskId || '');
      } catch (err) {
        if (process.env.DEBUG) {
          console.error(`[Hook] Correction detection spawn failed: ${err.message}`);
        }
      }
    }
  }

  // v6.0: Set routing-pending flag for routing gate enforcement
  const isWogiCommand = typeof prompt === 'string' && /^\/wogi-[a-z0-9-]+\b/i.test(prompt.trim());
  if (!isWogiCommand) {
    // v8.1: Delete any stale cleared marker from previous turns.
    try {
      fs.unlinkSync(ROUTING_CLEARED_PATH);
    } catch (err) {
      if (err.code !== 'ENOENT' && process.env.DEBUG) {
        console.error(`[Hook] Failed to delete cleared marker: ${err.message}`);
      }
    }

    try {
      setRoutingPending();
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[Hook] Routing gate set failed: ${err.message}`);
      }
    }
  } else {
    // v6.2: Actively CLEAR any existing routing flag when user explicitly types a /wogi-* command.
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

  // Phase context injection
  let phasePrompt = null;
  try {
    const phaseContext = getPhaseContextPrompt();
    if (phaseContext.inject && phaseContext.prompt) {
      phasePrompt = phaseContext.prompt;
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[Hook] Phase context injection failed: ${err.message}`);
    }
  }

  // Check research gate first (before implementation gate)
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
    coreResult = {
      ...coreResult,
      warning: true,
      researchWarning: researchResult.message,
      suggestedCommand: researchResult.suggestedCommand
    };
  }

  // Inject phase-specific context prompt
  if (phasePrompt) {
    coreResult = {
      ...coreResult,
      phasePrompt
    };
  }

  return coreResult;
}, {
  failMode: 'block',
  failOutput: {
    decision: 'block',
    reason: 'WogiFlow validation error. Please check your WogiFlow setup or use /wogi-start to route your request.'
  }
});
