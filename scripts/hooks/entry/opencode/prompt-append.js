#!/usr/bin/env node

/**
 * Wogi Flow - OpenCode tui.prompt.append Hook Entry Point
 *
 * Called when user submits a prompt.
 * Checks for research-required questions and injects research protocol.
 */

const { opencodeAdapter } = require('../../adapters/opencode');

// Lazy-load research gate to avoid errors if not yet created
let researchGate = undefined;
function getResearchGate() {
  if (researchGate === undefined) {
    try {
      researchGate = require('../../core/research-gate');
    } catch (err) {
      // Log error if it's not just "module not found"
      if (err.code !== 'MODULE_NOT_FOUND' && process.env.DEBUG) {
        console.error(`[prompt-append] Failed to load research gate: ${err.message}`);
      }
      researchGate = null; // Mark as unavailable
    }
  }
  return researchGate;
}

/**
 * Handle tui.prompt.append event
 * @param {Object} ctx - OpenCode plugin context
 * @returns {Object} Plugin result with protocol injection
 */
async function handlePromptAppend(ctx) {
  try {
    const input = ctx || {};
    const parsedInput = opencodeAdapter.parseInput(input);

    const prompt = parsedInput.prompt;
    if (!prompt) {
      return {};
    }

    // Check if research gate is available
    const gate = getResearchGate();
    if (!gate) {
      return {};
    }

    // Check if prompt requires research
    const coreResult = gate.checkResearchRequirement({ prompt });

    // Transform to OpenCode format
    return opencodeAdapter.transformResult('tui.prompt.append', coreResult);
  } catch (err) {
    // Non-blocking error - log but don't fail
    if (process.env.DEBUG) {
      console.error(`[Wogi Flow Hook Error] ${err.message}`);
    }
    return {};
  }
}

// Export for plugin use
module.exports = handlePromptAppend;

// CLI interface if run directly (for testing)
if (require.main === module) {
  const runTest = async () => {
    const result = await handlePromptAppend({
      prompt: 'Does this library support X?'
    });
    console.log(JSON.stringify(result, null, 2));
  };
  runTest();
}
