#!/usr/bin/env node

/**
 * Wogi Flow — Workspace Autonomous-Run Completion Summary (Story B / wf-ab59f0e4)
 *
 * Workers emit completion summaries to the manager via the channel-dispatch
 * HTTP bus. The wire format is single-line:
 *
 *     ## COMPLETION-SUMMARY: <base64-JSON>
 *
 * Where <base64-JSON> is the same payload Story C produces locally, with a
 * `workerId` field added for manager-side aggregation. Base64 was chosen
 * over plain JSON because the channel-dispatch parser splits on `##`
 * line-prefixes — multi-line raw JSON would split mid-payload (Blocker 5
 * from the adversary critique).
 *
 * Chunked variant for >64KB payloads:
 *
 *     ## COMPLETION-SUMMARY-CHUNK-1/3: <base64-fragment>
 *     ## COMPLETION-SUMMARY-CHUNK-2/3: <base64-fragment>
 *     ## COMPLETION-SUMMARY-CHUNK-3/3: <base64-fragment>
 *
 * Programmatic:
 *   const ws = require('./flow-workspace-summary');
 *   const lines = ws.encodeMessage(payload);  // → ['## COMPLETION-SUMMARY: ...']
 *   const r = ws.parseMessage(line);          // → { ok, payload?, error? }
 *   const r = ws.parseChunked(lines);         // re-assemble chunks
 *   const text = ws.renderMultiWorker(summaries);
 */

const SINGLE_LINE_PREFIX = '## COMPLETION-SUMMARY: ';
const CHUNK_PREFIX_REGEX = /^## COMPLETION-SUMMARY-CHUNK-(\d+)\/(\d+):\s+/;
// Channel-dispatch lines are typically capped well under 64KB; pick a
// conservative single-line ceiling. Anything larger goes through chunking.
const SINGLE_LINE_MAX_BYTES = 60 * 1024;

const SEP = '━'.repeat(58);

function encodeBase64(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');
}

// SEC-005 + arch-006 fix (2026-04-26): decode through the canonical
// safeJsonParseStringStrip helper instead of raw JSON.parse. Channel-dispatch
// bytes are attacker-influenceable (any process that can POST to the manager
// port can inject a forged ## COMPLETION-SUMMARY: line). Stripping
// __proto__/constructor/prototype recursively defangs prototype-pollution
// before validatePayload runs.
const { safeJsonParseStringStrip } = require('./flow-io');

function decodeBase64(s) {
  let text;
  try {
    text = Buffer.from(s, 'base64').toString('utf-8');
  } catch (err) {
    throw new Error(`base64 decode failed: ${err.message}`);
  }
  // Sentinel — distinct object identity so callers can detect parse failure.
  const FAIL = decodeBase64.__failSentinel || (decodeBase64.__failSentinel = Symbol('decode-fail'));
  const parsed = safeJsonParseStringStrip(text, FAIL);
  if (parsed === FAIL) {
    throw new Error('base64-JSON decode failed: invalid JSON or unsafe payload');
  }
  return parsed;
}

/**
 * Encode a completion-summary payload into one or more channel-dispatch
 * message lines. Always returns at least one line; chunks when the payload
 * exceeds SINGLE_LINE_MAX_BYTES.
 */
function encodeMessage(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('encodeMessage: payload must be an object');
  }
  const encoded = encodeBase64(payload);
  if (encoded.length + SINGLE_LINE_PREFIX.length <= SINGLE_LINE_MAX_BYTES) {
    return [`${SINGLE_LINE_PREFIX}${encoded}`];
  }
  const chunkSize = SINGLE_LINE_MAX_BYTES - 64;
  const total = Math.ceil(encoded.length / chunkSize);
  const lines = [];
  for (let i = 0; i < total; i++) {
    const fragment = encoded.slice(i * chunkSize, (i + 1) * chunkSize);
    lines.push(`## COMPLETION-SUMMARY-CHUNK-${i + 1}/${total}: ${fragment}`);
  }
  return lines;
}

function isCompletionSummaryLine(line) {
  if (typeof line !== 'string') return false;
  if (line.startsWith(SINGLE_LINE_PREFIX)) return true;
  return CHUNK_PREFIX_REGEX.test(line);
}

function parseMessage(line) {
  if (typeof line !== 'string') {
    return { ok: false, error: 'line must be a string' };
  }
  if (!line.startsWith(SINGLE_LINE_PREFIX)) {
    return { ok: false, error: 'not a single-line COMPLETION-SUMMARY' };
  }
  const b64 = line.slice(SINGLE_LINE_PREFIX.length).trim();
  try {
    const payload = decodeBase64(b64);
    return validatePayload(payload);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function parseChunked(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { ok: false, error: 'lines must be a non-empty array' };
  }
  const fragments = [];
  // CL-004 fix (2026-04-26): track seen indices to reject duplicate chunks.
  // Without this, a replay or attacker-injected duplicate fragment silently
  // overwrites fragments[n-1]; the missing-chunks check still passes (slot
  // is non-undefined); the reassembled payload is corrupted/tampered.
  const seen = new Set();
  let total = null;
  for (const line of lines) {
    const m = CHUNK_PREFIX_REGEX.exec(line);
    if (!m) return { ok: false, error: 'non-chunk line in chunked input' };
    const n = parseInt(m[1], 10);
    const t = parseInt(m[2], 10);
    if (total === null) total = t;
    if (t !== total) return { ok: false, error: 'mismatched chunk totals' };
    if (!Number.isInteger(n) || n < 1 || n > total) {
      return { ok: false, error: `invalid chunk index: ${m[1]}` };
    }
    if (seen.has(n)) {
      return { ok: false, error: `duplicate chunk index: ${n}` };
    }
    seen.add(n);
    fragments[n - 1] = line.replace(CHUNK_PREFIX_REGEX, '');
  }
  // CL-004: use !==undefined instead of filter(Boolean) so empty-string
  // fragments (legitimate edge case for short tail chunks) aren't miscounted.
  if (fragments.length !== total || fragments.some(f => f === undefined)) {
    const have = fragments.filter(f => f !== undefined).length;
    return { ok: false, error: `missing chunks (have ${have} of ${total})` };
  }
  try {
    const payload = decodeBase64(fragments.join(''));
    return validatePayload(payload);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Validate the shape of a completion-summary payload. Returns
 * { ok: true, payload } or { ok: false, error }.
 */
function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'payload must be a JSON object' };
  }
  if (typeof payload.runId !== 'string' || !payload.runId) {
    return { ok: false, error: 'missing runId' };
  }
  for (const key of ['completed', 'queuedQuestions', 'skippedTasks']) {
    if (!Array.isArray(payload[key])) {
      return { ok: false, error: `${key} must be an array` };
    }
  }
  return { ok: true, payload };
}

/**
 * Render a multi-worker workspace summary block. `summaries` is an array
 * of validated payloads (each may include `workerId`).
 *
 * Empty-collection rule (decisions.md 2026-04-23): all 3 sections always
 * render per worker. Workers with no work still appear with empty-state
 * placeholders so the user never wonders if a worker is missing.
 */
function renderMultiWorker(summaries) {
  const list = Array.isArray(summaries) ? summaries : [];
  const lines = [];
  lines.push(SEP);
  lines.push('WORKSPACE AUTONOMOUS RUN COMPLETE');
  lines.push(SEP);
  lines.push('');

  if (list.length === 0) {
    lines.push('[no worker summaries received]');
    lines.push(SEP);
    return lines.join('\n');
  }

  let totalCompleted = 0;
  let totalQuestions = 0;
  let totalSkipped = 0;
  for (const s of list) {
    const workerId = s.workerId || 'unknown';
    const dur = formatDuration(s.startedAt, s.endedAt);
    const completed = Array.isArray(s.completed) ? s.completed : [];
    const queued = Array.isArray(s.queuedQuestions) ? s.queuedQuestions : [];
    const skipped = Array.isArray(s.skippedTasks) ? s.skippedTasks : [];
    totalCompleted += completed.length;
    totalQuestions += queued.length;
    totalSkipped += skipped.length;

    lines.push(`Worker: ${workerId} (runId: ${s.runId}, duration: ${dur})`);
    lines.push(`  ✓ Completed (${completed.length}):`);
    if (completed.length === 0) {
      lines.push('    [none]');
    } else {
      for (const t of completed) lines.push(`    - ${t.taskId}: ${t.title || '(no title)'}`);
    }
    lines.push(`  ? Queued questions (${queued.length}):`);
    if (queued.length === 0) {
      lines.push('    [none]');
    } else {
      for (const q of queued) {
        const blockers = Array.isArray(q.dependencies) && q.dependencies.length
          ? ` (blocks: ${q.dependencies.join(', ')})`
          : '';
        lines.push(`    - ${q.id}: ${q.text}${blockers}`);
      }
    }
    lines.push(`  ⊘ Skipped tasks (${skipped.length}):`);
    if (skipped.length === 0) {
      lines.push('    [none]');
    } else {
      for (const sk of skipped) {
        const ref = sk.blockingQuestionId ? ` (awaiting ${sk.blockingQuestionId})` : '';
        lines.push(`    - ${sk.taskId}: ${sk.reason}${ref}`);
      }
    }
    if (s.endReason && s.endReason !== 'queue-drained') {
      lines.push(`  ⚠ endReason: ${s.endReason}`);
    }
    lines.push('');
  }

  lines.push(`Total: ${totalCompleted} completed, ${totalQuestions} questions queued, ${totalSkipped} skipped across ${list.length} worker${list.length === 1 ? '' : 's'}`);
  lines.push(SEP);
  return lines.join('\n');
}

// CL-006 (2026-04-26): consolidated formatDuration to flow-time-format.
const { formatDuration } = require('./flow-time-format');

module.exports = {
  SINGLE_LINE_PREFIX,
  CHUNK_PREFIX_REGEX,
  SINGLE_LINE_MAX_BYTES,
  encodeMessage,
  parseMessage,
  parseChunked,
  isCompletionSummaryLine,
  validatePayload,
  renderMultiWorker
};

if (require.main === module) {
  const [,, cmd, ...rest] = process.argv;
  if (cmd === 'encode') {
    const payload = safeJsonParseStringStrip(rest.join(' '), null);
    if (!payload) {
      process.stderr.write('encode: invalid JSON or unsafe payload\n');
      process.exit(1);
    }
    console.log(encodeMessage(payload).join('\n'));
  } else if (cmd === 'parse') {
    const r = parseMessage(rest.join(' '));
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log('Usage: flow-workspace-summary <encode <json>|parse <line>>');
  }
}
