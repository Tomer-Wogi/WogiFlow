'use strict';

/**
 * Wogi Flow — UserPromptSubmit Orchestrator (wf-6e31850e A-3)
 *
 * Extracted from scripts/hooks/entry/claude-code/user-prompt-submit.js to
 * bring that entry file under the 120-LOC budget per
 * .claude/rules/architecture/hook-three-layer.md.
 *
 * Same control flow as before. Entry user-prompt-submit.js is now a thin
 * pass-through. Returns the coreResult that the entry forwards to the
 * adapter.
 */

const fs = require('node:fs');
const { checkImplementationGate } = require('./implementation-gate');
const { checkResearchRequirement } = require('./research-gate');
const { setRoutingPending, clearRoutingPending, ROUTING_CLEARED_PATH } = require('./routing-gate');
const { getPhaseContextPrompt } = require('./phase-gate');
const { buildOverdueContext } = require('./overdue-dispatches');
const { getDossierInjection } = require('./feature-dossier-gate');
const {
  shouldForceExtractReview,
  buildEnforcementMessage,
  markLongInputPending
} = require('./long-input-enforcement');
const { markSkillPending, loadDurableSession } = require('../../flow-durable-session');
const { captureCurrentPrompt } = require('../../flow-prompt-capture');
const { spawnBackgroundDetection } = require('../../flow-correction-detector');
const { getConfig } = require('../../flow-utils');

async function orchestrateUserPromptSubmit({ input, parsedInput }) {
  if (!input || Object.keys(input).length === 0) {
    return { __raw: true, continue: true, hookSpecificOutput: { hookEventName: 'UserPromptSubmit' } };
  }

  const prompt = parsedInput.prompt;
  const source = parsedInput.source;

  // wf-729ab5c0 follow-up — clear pending-question marker on user response.
  try {
    const { clearPendingQuestion } = require('../../flow-ask');
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
      if (process.env.DEBUG) console.error(`[Hook] Marked /${skillName} as pending execution`);
    }
  }

  let hookConfig;
  try { hookConfig = getConfig(); } catch (_err) { hookConfig = {}; }

  // v5.0: Capture prompt for learning system (non-blocking)
  if (hookConfig.hooks?.rules?.intelligence?.promptCapture?.enabled !== false) {
    if (typeof prompt === 'string' && prompt.trim().length > 0) {
      setImmediate(() => {
        try { captureCurrentPrompt(prompt); } catch (err) {
          if (process.env.DEBUG) console.error(`[Hook] Prompt capture failed: ${err.message}`);
        }
      });
    }
  }

  // wf-5cd71b1f: Research-required classifier
  if (typeof prompt === 'string' && prompt.trim().length > 0) {
    try {
      const { applyClassification: applyResearchClassification } = require('./research-required-classifier');
      const r = applyResearchClassification(prompt, hookConfig);
      if (r.applied && process.env.DEBUG) {
        console.error(`[Hook] Research-required classifier: category=${r.category}, match="${r.match}"`);
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[Hook] Research-required classifier failed: ${err.message}`);
    }
  }

  // wf-b8839d99: AI-based deferral classifier
  if (typeof prompt === 'string' && prompt.trim().length > 0) {
    try {
      const { applyClassification } = require('./deferral-classifier');
      const r = await applyClassification(prompt, hookConfig);
      if (r.applied && process.env.DEBUG) {
        console.error(`[Hook] Deferral classifier (AI): intent=${r.intent}, confidence=${r.confidence}, standing=${r.standing}, scope=${JSON.stringify(r.scope)}`);
      } else if (process.env.DEBUG && r.reason) {
        console.error(`[Hook] Deferral classifier (AI): no-op — ${r.reason}`);
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[Hook] Deferral classifier failed: ${err.message}`);
    }
  }

  // Correction detection (background)
  if (hookConfig.hooks?.rules?.intelligence?.correctionDetection?.enabled !== false) {
    if (typeof prompt === 'string' && prompt.trim().length > 0) {
      try {
        const session = loadDurableSession();
        spawnBackgroundDetection(prompt, session?.taskId || '');
      } catch (err) {
        if (process.env.DEBUG) console.error(`[Hook] Correction detection spawn failed: ${err.message}`);
      }
    }
  }

  // v6.0: Routing-pending flag set/clear
  const isWogiCommand = typeof prompt === 'string' && /^\/wogi-[a-z0-9-]+\b/i.test(prompt.trim());
  if (!isWogiCommand) {
    try { fs.unlinkSync(ROUTING_CLEARED_PATH); }
    catch (err) {
      if (err.code !== 'ENOENT' && process.env.DEBUG) console.error(`[Hook] Failed to delete cleared marker: ${err.message}`);
    }
    try { setRoutingPending(); }
    catch (err) {
      if (process.env.DEBUG) console.error(`[Hook] Routing gate set failed: ${err.message}`);
    }
  } else {
    try {
      clearRoutingPending();
      if (process.env.DEBUG) console.error(`[Hook] Cleared routing flag — prompt is a /wogi-* command`);
    } catch (err) {
      if (process.env.DEBUG) console.error(`[Hook] Routing gate clear failed: ${err.message}`);
    }
  }

  // Phase context + dossier injection
  let phasePrompt = null;
  try {
    const phaseContext = getPhaseContextPrompt();
    if (phaseContext.inject && phaseContext.prompt) phasePrompt = phaseContext.prompt;
  } catch (err) {
    if (process.env.DEBUG) console.error(`[Hook] Phase context injection failed: ${err.message}`);
  }
  let dossierPrompt = null;
  try { dossierPrompt = getDossierInjection(); } catch (err) {
    if (process.env.DEBUG) console.error(`[Hook] Dossier injection failed: ${err.message}`);
  }
  if (dossierPrompt) {
    phasePrompt = phasePrompt ? `${phasePrompt}\n\n${dossierPrompt}` : dossierPrompt;
  }

  // Research + implementation gates
  const researchResult = checkResearchRequirement({ prompt, source });
  let coreResult = checkImplementationGate({ prompt, source });

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

  if (phasePrompt) coreResult = { ...coreResult, phasePrompt };

  // wf-d3e67abe — overdue workspace dispatches
  try {
    const overduePrompt = buildOverdueContext();
    if (overduePrompt) coreResult = { ...coreResult, overduePrompt };
  } catch (err) {
    if (process.env.DEBUG) console.error(`[Hook] Overdue dispatches check failed: ${err.message}`);
  }

  // P11.5 mechanical enforcement — long-form prompts without source-link
  try {
    const enforce = shouldForceExtractReview({ text: prompt, source });
    if (enforce.forced) {
      const msg = buildEnforcementMessage(enforce.reason, enforce.level);
      coreResult = { ...coreResult, longInputEnforcement: msg };
      markLongInputPending({
        level: enforce.level,
        reason: enforce.reason,
        promptPreview: typeof prompt === 'string' ? prompt.slice(0, 200) : '(non-string)',
        source: source || null,
        repoName: process.env.WOGI_REPO_NAME || null
      });
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[Hook] Long-input enforcement check failed: ${err.message}`);
  }

  return coreResult;
}

module.exports = { orchestrateUserPromptSubmit };
