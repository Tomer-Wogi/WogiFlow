const { safeJsonParseString } = require('../../../flow-utils');

const MAX_STDIN_SIZE = 100 * 1024;

/**
 * Read and parse hook input from stdin with size limit and graceful degradation.
 * Shared across all hook entry points to eliminate 12x code duplication.
 * @returns {Promise<{input: object|null, raw: string}>}
 */
async function readHookInput() {
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

  if (!inputData || inputData.trim().length === 0) {
    return { input: null, raw: '' };
  }

  const parsed = safeJsonParseString(inputData, null);
  return { input: parsed, raw: inputData };
}

module.exports = { readHookInput, MAX_STDIN_SIZE };
