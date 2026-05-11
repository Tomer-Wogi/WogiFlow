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
const { buildOverdueContext } = require('../../core/overdue-dispatches');
const { getDossierInjection } = require('../../core/feature-dossier-gate');
const {
  shouldForceExtractReview,
  buildEnforcementMessage,
  markLongInputPending
} = require('../../core/long-input-enforcement');
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
  } catch (_err) {
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

  // wf-5cd71b1f: Research-required classifier — detect diagnostic prompts
  // (Tier 2/3 from CLAUDE.md routing) that require evidence-reading before
  // the AI answers. Writes a turn-scoped marker that the Stop hook checks;
  // if the AI answered with text-only and no Read calls against evidence
  // paths, the Stop hook re-prompts forcing a redo. Fail-open throughout.
  if (typeof prompt === 'string' && prompt.trim().length > 0) {
    try {
      const { applyClassification: applyResearchClassification } = require('../../core/research-required-classifier');
      const r = applyResearchClassification(prompt, hookConfig);
      if (r.applied && process.env.DEBUG) {
        console.error(`[Hook] Research-required classifier: category=${r.category}, match="${r.match}"`);
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[Hook] Research-required classifier failed: ${err.message}`);
      }
    }
  }

  // wf-b8839d99 (replaces wf-f9912af6 regex classifier): AI-based deferral-
  // intent classifier. Calls Haiku to interpret the user's prompt. NEGATIVE
  // ("fix all", "I don't like tech debt", any phrasing) writes a no-defer-pin;
  // POSITIVE ("defer F5", "option 2", "ship as-is") writes a scoped auth
  // marker. The marker now captures the verbatim user excerpt SEPARATELY from
  // the AI's interpretation — ending the false-attribution failure shape.
  // Fail-open throughout: classifier errors / missing API key → no state
  // change (status quo holds; gate's default-restrictive behavior preserved).
  if (typeof prompt === 'string' && prompt.trim().length > 0) {
    try {
      const { applyClassification } = require('../../core/deferral-classifier');
      const r = await applyClassification(prompt, hookConfig);
      if (r.applied && process.env.DEBUG) {
        console.error(`[Hook] Deferral classifier (AI): intent=${r.intent}, confidence=${r.confidence}, standing=${r.standing}, scope=${JSON.stringify(r.scope)}`);
      } else if (process.env.DEBUG && r.reason) {
        console.error(`[Hook] Deferral classifier (AI): no-op — ${r.reason}`);
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[Hook] Deferral classifier failed: ${err.message}`);
      }
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

  // wf-557cf08a — Feature dossier + logic rules auto-injection.
  // Surfaces canonical per-feature knowledge and cross-cutting logic rules
  // into the phase prompt so Claude doesn't have to fetch them under token
  // pressure. Fail-open: returns null on any error.
  let dossierPrompt = null;
  try {
    dossierPrompt = getDossierInjection();
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[Hook] Dossier injection failed: ${err.message}`);
    }
  }
  if (dossierPrompt) {
    phasePrompt = phasePrompt ? `${phasePrompt}\n\n${dossierPrompt}` : dossierPrompt;
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

  // wf-d3e67abe — surface overdue workspace dispatches (silent worker deaths)
  // to the manager model before it processes the next prompt. Manager-only;
  // fail-open (buildOverdueContext returns null on any error or wrong scope).
  try {
    const overduePrompt = buildOverdueContext();
    if (overduePrompt) {
      coreResult = {
        ...coreResult,
        overduePrompt
      };
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[Hook] Overdue dispatches check failed: ${err.message}`);
    }
  }

  // P11.5 mechanical enforcement (2026-04-27): long-form prompts without
  // source-link are forced through /wogi-extract-review. This is the
  // mechanical layer that complements the methodology rule. Applies in
  // worker mode (channel-dispatch with no source-link — wogi-hub failure
  // shape) AND in any session that receives a long task-creating prompt
  // without preserved source.
  try {
    const enforce = shouldForceExtractReview({ text: prompt, source });
    if (enforce.forced) {
      const msg = buildEnforcementMessage(enforce.reason, enforce.level);
      coreResult = {
        ...coreResult,
        longInputEnforcement: msg
      };
      markLongInputPending({
        level: enforce.level,
        reason: enforce.reason,
        promptPreview: typeof prompt === 'string' ? prompt.slice(0, 200) : '(non-string)',
        source: source || null,
        repoName: process.env.WOGI_REPO_NAME || null
      });
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[Hook] Long-input enforcement check failed: ${err.message}`);
    }
  }

  return coreResult;
}, {
  failMode: 'block',
  failOutput: {
    decision: 'block',
    reason: 'WogiFlow validation error. Please check your WogiFlow setup or use /wogi-start to route your request.'
  }
});
