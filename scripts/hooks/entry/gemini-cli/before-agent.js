#!/usr/bin/env node

/**
 * Wogi Flow - Gemini CLI BeforeAgent Hook
 *
 * Called before the agent processes a user prompt.
 * Equivalent to Claude Code's UserPromptSubmit hook.
 * Implements the implementation gate - routes implementation requests through workflow.
 */

// Lazy-load adapter to handle errors gracefully
let geminiAdapter;
try {
  geminiAdapter = require('../../adapters/gemini').geminiAdapter;
} catch (err) {
  // Adapter not available - will use fallback in main()
  if (process.env.DEBUG) {
    console.error(`[Gemini Hook] Adapter load failed: ${err.message}`);
  }
  geminiAdapter = null;
}

// Lazy-load gates to avoid circular dependencies
let checkImplementationGate;
let checkResearchRequirement;
try {
  checkImplementationGate = require('../../core/implementation-gate').checkImplementationGate;
} catch (_err) {
  // Module not available - provide no-op fallback
  checkImplementationGate = () => ({ blocked: false });
}
try {
  checkResearchRequirement = require('../../core/research-gate').checkResearchRequirement;
} catch (_err) {
  // Module not available - provide no-op fallback
  checkResearchRequirement = () => ({ blocked: false, allowed: true });
}

// Maximum stdin size to prevent DoS (100KB should be enough)
const MAX_STDIN_SIZE = 100 * 1024;

async function main() {
  try {
    // Read input from stdin with size limit
    let inputData = '';
    let totalSize = 0;
    for await (const chunk of process.stdin) {
      totalSize += chunk.length;
      if (totalSize > MAX_STDIN_SIZE) {
        inputData += chunk.slice(0, MAX_STDIN_SIZE - (totalSize - chunk.length));
        break;
      }
      inputData += chunk;
    }

    // Handle empty input gracefully
    if (!inputData || inputData.trim().length === 0) {
      console.log(JSON.stringify({ continue: true, decision: 'allow' }));
      process.exit(0);
      return;
    }

    // Parse JSON safely
    let input;
    try {
      input = JSON.parse(inputData);
    } catch (_parseErr) {
      // Invalid JSON - allow through (graceful degradation)
      console.log(JSON.stringify({ continue: true, decision: 'allow' }));
      process.exit(0);
      return;
    }

    // Handle case where adapter failed to load
    if (!geminiAdapter) {
      console.log(JSON.stringify({ continue: true, decision: 'allow' }));
      process.exit(0);
      return;
    }

    const parsedInput = geminiAdapter.parseInput(input);
    const prompt = parsedInput.prompt || '';

    // Check research gate first (before implementation gate)
    // Auto-triggers research protocol for capability/existence/feasibility questions
    const researchResult = checkResearchRequirement({ prompt });

    // Check if this is an implementation request that should go through workflow
    let coreResult = checkImplementationGate({ prompt });

    // If research protocol should be injected, add it to system reminder
    if (researchResult.injectProtocol && researchResult.protocolSteps) {
      coreResult = {
        ...coreResult,
        systemReminder: researchResult.protocolSteps,
        researchTriggered: true,
        questionType: researchResult.questionType,
        suggestedDepth: researchResult.suggestedDepth
      };
    } else if (researchResult.warning && coreResult.allowed !== false) {
      // Soft warning mode (not strict)
      coreResult = {
        ...coreResult,
        warning: true,
        researchWarning: researchResult.message,
        suggestedCommand: researchResult.suggestedCommand
      };
    }

    // Transform to Gemini CLI format
    const output = geminiAdapter.transformResult('BeforeAgent', coreResult);

    // Output JSON (must be only output to stdout)
    console.log(JSON.stringify(output));
    process.exit(0);
  } catch (err) {
    // Non-blocking error - allow operation to continue
    if (process.env.DEBUG) {
      console.error(`[Wogi Flow Hook Error] ${err.message}`);
    }
    console.log(JSON.stringify({ continue: true, decision: 'allow' }));
    process.exit(0);
  }
}

// Handle stdin properly
process.stdin.setEncoding('utf8');

// Must await async main() to prevent race conditions
(async () => {
  try {
    await main();
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[Gemini Hook] Unexpected error: ${err.message}`);
    }
    console.log(JSON.stringify({ continue: true, decision: 'allow' }));
    process.exit(0);
  }
})();
