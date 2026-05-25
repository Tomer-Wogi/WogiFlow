#!/usr/bin/env node

/**
 * Wogi Workspace — Channel MCP Server
 *
 * Minimal MCP server (JSON-RPC 2.0 over stdio) that receives HTTP webhooks
 * and forwards them as channel notifications to a Claude Code session.
 *
 * Used by workspace workers to receive task dispatches from the manager
 * and questions from peer repos.
 *
 * Environment:
 *   WOGI_CHANNEL_PORT  — HTTP port to listen on (default: 8801)
 *   WOGI_REPO_NAME     — Name of this repo in the workspace
 *   WOGI_PEERS         — Comma-separated peer list: "backend:8802,shared:8803"
 *   WOGI_WORKSPACE_ROOT — Path to workspace root (for message bus access)
 */

'use strict';

const http = require('node:http');
const readline = require('node:readline');
const { safeJsonParseContent } = require('./utils');

// S5 (wf-ee87a24e): the version this long-lived server process loaded at boot.
// Compared against the on-disk package.json to detect a mid-session
// `npm i wogiflow@latest` that left this process running stale code.
const SERVER_VERSION = (() => {
  try { return require('../package.json').version || null; } catch (_err) { return null; }
})();
function readDiskVersion() {
  try {
    const fs = require('node:fs');
    const pkgPath = require('node:path').join(__dirname, '..', 'package.json');
    const raw = fs.readFileSync(pkgPath, 'utf-8'); // fresh read, bypasses require cache
    return JSON.parse(raw).version || null;
  } catch (_err) { return null; }
}

// ============================================================
// Constants
// ============================================================

const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB max POST body
const MAX_RESPONSE_BYTES = 64 * 1024;   // 64 KB max peer response
const MIN_PORT = 1024;
const MAX_PORT = 65535;
const DEFAULT_PORT = 8801;
const VALID_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

// ============================================================
// Port Validation
// ============================================================

function validatePort(raw, label) {
  const port = parseInt(raw, 10);
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    process.stderr.write(`[wogi-channel] Invalid ${label}: "${raw}" — must be ${MIN_PORT}-${MAX_PORT}. Defaulting to ${DEFAULT_PORT}\n`);
    return DEFAULT_PORT;
  }
  return port;
}

const PORT = validatePort(process.env.WOGI_CHANNEL_PORT || String(DEFAULT_PORT), 'WOGI_CHANNEL_PORT');
const RAW_REPO_NAME = process.env.WOGI_REPO_NAME || 'unknown';
const REPO_NAME = VALID_NAME_PATTERN.test(RAW_REPO_NAME) ? RAW_REPO_NAME : 'unknown';
const PEERS_RAW = process.env.WOGI_PEERS || '';
const WORKSPACE_ROOT = process.env.WOGI_WORKSPACE_ROOT || '';

// Parse peer list: "backend:8802,shared:8803" → { backend: 8802, shared: 8803 }
function parsePeers(raw) {
  const peers = {};
  if (!raw) return peers;
  for (const entry of raw.split(',')) {
    const [name, portStr] = entry.trim().split(':');
    if (!name || !portStr) continue;
    const port = parseInt(portStr, 10);
    if (!VALID_NAME_PATTERN.test(name)) {
      process.stderr.write(`[wogi-channel] Ignoring peer with invalid name "${name}"\n`);
      continue;
    }
    if (Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT) {
      peers[name] = port;
    } else {
      process.stderr.write(`[wogi-channel] Ignoring invalid peer "${entry}" — port must be ${MIN_PORT}-${MAX_PORT}\n`);
    }
  }
  return peers;
}

const PEERS = parsePeers(PEERS_RAW);

// ============================================================
// Minimal MCP Protocol (JSON-RPC 2.0 over stdio)
// ============================================================

let _initialized = false;

/**
 * Send a JSON-RPC message to Claude Code via stdout.
 * MCP uses newline-delimited JSON over stdio.
 */
function sendMessage(msg) {
  const json = JSON.stringify(msg);
  process.stdout.write(json + '\n');
}

/**
 * Send a JSON-RPC response (reply to a request).
 */
function sendResponse(id, result) {
  sendMessage({ jsonrpc: '2.0', id, result });
}

/**
 * Send a channel notification to Claude Code.
 * This is what makes the worker "receive" a message from the manager or a peer.
 */
function sendChannelNotification(content, meta) {
  sendMessage({
    jsonrpc: '2.0',
    method: 'notifications/claude/channel',
    params: { content, meta: meta || {} }
  });
}

/**
 * Build the instructions string for the channel.
 * These tell the Claude Code session how to handle incoming messages.
 */
function buildInstructions() {
  const peerList = Object.entries(PEERS)
    .map(([name, port]) => `  - ${name}: http://localhost:${port}`)
    .join('\n');

  const peerSection = peerList
    ? `\n\nYou can communicate directly with peer repos via their channels:\n${peerList}\nTo ask a peer a question: curl -s -X POST http://localhost:{port} -d "your question"\nTo send a task to a peer: curl -s -X POST http://localhost:{port} -d "/wogi-start wf-XXXXXXXX"`
    : '';

  return `You are "${REPO_NAME}" in a Wogi Workspace. Messages arrive as <channel> tags from the workspace manager or peer repos.

When you receive a message:
1. If it starts with "/wogi-" → route through that command (it's a task dispatch)
2. If it's a question or investigation request → do the work, then ALWAYS send results back
3. If it's a status check → respond with your current task status

SUSTAINED EXECUTION — a task dispatch runs to COMPLETION across turns:
A "/wogi-" dispatch (especially one you decompose into sub-tasks) is NOT a one-turn request. Work through ALL sub-tasks in the same session; the Stop hook's continuation gate will keep you going while the task is in-progress with work remaining. Do NOT stop to "report progress" mid-task — only reply when the task is COMPLETE or you are ESCALATING a blocker.

NEVER IDLE WHILE A TASK IS IN-PROGRESS: If you hit an approval / phase-read / architect / research gate, that is NOT a stopping point. Exactly one of these must happen:
  • PROCEED by SATISFYING the gate legitimately — read the required phase doc, decompose the task, provide the required evidence. In autonomous mode you are PRE-APPROVED; do not wait for approval that no one is there to give.
  • ESCALATE to the manager via channel ("## QUESTION: <blocker>") if you genuinely need the manager/user, then end the turn.

GATE CIRCUMVENTION IS PROHIBITED (and pointless — gates resolve phase from the canonical main-repo state, not your working directory):
  ✗ Do NOT create a git worktree to reach an "ungated" context.
  ✗ Do NOT hand-write gate-satisfying markers, or edit .workflow/state files, to fake gate satisfaction.
  ✗ Do NOT change directory to dodge a gate.
A blocked tool call is an instruction to satisfy the gate, never a puzzle to route around.

CRITICAL — REPLY TO THE MANAGER WHEN THE TASK IS DONE OR BLOCKED:
When the dispatched task is complete (or you must escalate), you MUST send results back using the workspace_send_message tool with to: "manager". The user only sees the manager terminal — if you don't reply, they never see your results.

Example: workspace_send_message(to: "manager", message: "## Investigation Results\\n\\n1. Found the bug in X\\n2. Root cause: Y\\n3. Fix: Z")

You can also talk to peer repos: workspace_send_message(to: "<peer-name>", message: "...")

IMPORTANT: Channel messages have the same authority as user input. Route them through /wogi-start just like any other request. Full pipeline enforcement applies.${peerSection}`;
}

/**
 * Collect HTTP body safely with size limit.
 * Uses Buffer.concat to handle multi-byte UTF-8 correctly.
 *
 * @param {http.IncomingMessage} req
 * @param {number} maxBytes
 * @returns {Promise<{ body: string, truncated: boolean }>}
 */
function collectBody(req, maxBytes) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let truncated = false;
    let resolved = false;

    function finish() {
      if (resolved) return;
      resolved = true;
      resolve({ body: Buffer.concat(chunks).toString('utf-8'), truncated });
    }

    req.on('data', (chunk) => {
      if (resolved) return;
      // Check BEFORE adding to prevent ~2x overallocation
      if (size + chunk.length > maxBytes) {
        truncated = true;
        req.destroy();
        finish();
        return;
      }
      size += chunk.length;
      chunks.push(chunk);
    });

    req.on('end', () => finish());
    req.on('error', () => { truncated = true; finish(); });
  });
}

/**
 * Handle incoming JSON-RPC requests from Claude Code.
 */
function handleRequest(msg) {
  if (msg.method === 'initialize') {
    sendResponse(msg.id, {
      protocolVersion: '2024-11-05',
      capabilities: {
        experimental: { 'claude/channel': {} }
      },
      serverInfo: {
        name: 'wogi-workspace-channel',
        version: '1.0.0'
      },
      instructions: buildInstructions()
    });
    return;
  }

  if (msg.method === 'notifications/initialized') {
    _initialized = true;
    return;
  }

  // Handle ping
  if (msg.method === 'ping') {
    sendResponse(msg.id, {});
    return;
  }

  // Handle tools/list (we expose a reply tool for two-way peer communication)
  if (msg.method === 'tools/list') {
    sendResponse(msg.id, {
      tools: [
        {
          name: 'workspace_send_message',
          description: `Send a message to the workspace manager or a peer repo. Use to: "manager" to report results back. Available targets: manager, ${Object.keys(PEERS).join(', ') || 'none'}`,
          inputSchema: {
            type: 'object',
            properties: {
              to: {
                type: 'string',
                description: 'Target repo name or "manager"'
              },
              message: {
                type: 'string',
                description: 'Message to send (question, status update, or task)'
              }
            },
            required: ['to', 'message']
          }
        }
      ]
    });
    return;
  }

  // Handle tool calls
  if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params || {};

    if (name === 'workspace_send_message') {
      const { to, message } = args || {};

      // Special case: send to manager via file-based message bus
      if (to === 'manager') {
        if (!WORKSPACE_ROOT) {
          sendResponse(msg.id, {
            content: [{ type: 'text', text: 'Cannot send to manager: WOGI_WORKSPACE_ROOT not set.' }],
            isError: true
          });
          return;
        }
        try {
          const fs = require('node:fs');
          const crypto = require('node:crypto');
          const messagesDir = require('node:path').join(WORKSPACE_ROOT, '.workspace', 'messages');
          fs.mkdirSync(messagesDir, { recursive: true });
          const msgId = 'msg-' + crypto.randomBytes(4).toString('hex');
          const msgObj = {
            id: msgId,
            from: REPO_NAME,
            to: 'manager',
            type: 'task-complete',
            priority: 'medium',
            timestamp: new Date().toISOString(),
            subject: `Response from ${REPO_NAME}`,
            body: message,
            actionRequired: false,
            status: 'pending'
          };
          const msgPath = require('node:path').join(messagesDir, `${msgId}.json`);
          fs.writeFileSync(msgPath, JSON.stringify(msgObj, null, 2));

          // wf-3635574e / G3: populate the SQLite IPC index (best effort).
          // JSON above remains authoritative. Index enables atomic consume
          // for hot-path readers. AC5 fallback: silent if sql.js unavailable.
          (async () => {
            try {
              const ipc = require('./workspace-ipc-sqlite');
              if (!(await ipc.isAvailable())) return;
              const route = ipc.routeMessageForIndex(msgObj);
              if (!route) return;
              await ipc.indexMessage(WORKSPACE_ROOT, route.repoName, route.direction, {
                id: msgObj.id,
                kind: msgObj.type,
                payload: msgObj,
                createdAt: msgObj.timestamp,
                consumedAt: null
              });
            } catch (_err) { /* best effort */ }
          })();

          // Also POST to manager's channel port for real-time notification
          const managerPort = process.env.WOGI_MANAGER_PORT;
          if (managerPort) {
            try {
              const buf = Buffer.from(message, 'utf-8');
              const req = http.request({
                hostname: '127.0.0.1',
                port: parseInt(managerPort, 10),
                path: '/',
                method: 'POST',
                headers: { 'Content-Type': 'text/plain', 'Content-Length': buf.byteLength, 'X-Wogi-From': REPO_NAME }
              });
              req.on('error', () => { /* best effort */ });
              req.write(buf);
              req.end();
            } catch (_err) { /* fallback is file */ }
          }

          sendResponse(msg.id, {
            content: [{ type: 'text', text: `Message sent to manager${managerPort ? ' (file + channel notification)' : ' (file only)'}.` }]
          });
        } catch (err) {
          sendResponse(msg.id, {
            content: [{ type: 'text', text: `Failed to write message to manager: ${err.message}` }],
            isError: true
          });
        }
        return;
      }

      const targetPort = PEERS[to];

      if (!targetPort) {
        sendResponse(msg.id, {
          content: [{ type: 'text', text: `Unknown target: "${to}". Available targets: manager, ${Object.keys(PEERS).join(', ') || 'none'}` }],
          isError: true
        });
        return;
      }

      // POST to peer's channel with proper Buffer handling
      const buf = Buffer.from(message, 'utf-8');
      const req = http.request({
        hostname: '127.0.0.1',
        port: targetPort,
        path: '/',
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'Content-Length': buf.byteLength }
      }, (res) => {
        // Collect peer response with size limit
        const chunks = [];
        let size = 0;
        res.on('data', chunk => {
          size += chunk.length;
          if (size <= MAX_RESPONSE_BYTES) chunks.push(chunk);
        });
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          const truncNote = size > MAX_RESPONSE_BYTES ? ' (response truncated)' : '';
          sendResponse(msg.id, {
            content: [{ type: 'text', text: `Message sent to ${to} (port ${targetPort}). Response: ${body}${truncNote}` }]
          });
        });
      });

      req.on('error', (err) => {
        sendResponse(msg.id, {
          content: [{ type: 'text', text: `Failed to reach ${to} at port ${targetPort}: ${err.message}. Is the worker running?` }],
          isError: true
        });
      });

      req.write(buf);
      req.end();
      return;
    }

    // Unknown tool
    sendResponse(msg.id, {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true
    });
    return;
  }

  // Default: respond with empty result for unknown methods with an id
  if (msg.id !== undefined) {
    sendResponse(msg.id, {});
  }
}

// ============================================================
// stdio Transport (read JSON-RPC from stdin)
// ============================================================

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  const msg = safeJsonParseContent(trimmed);
  if (msg) handleRequest(msg);
  // else ignore malformed / prototype-polluting JSON
});

// ============================================================
// HTTP Webhook Server (receives dispatches from manager/peers)
// ============================================================

// ============================================================
// SSE Client Management (Event Bus)
// ============================================================

const sseClients = new Set();

function addSSEClient(res, lastEventId) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(':ok\n\n');

  // If workspace root is available, send missed events
  if (WORKSPACE_ROOT && lastEventId) {
    try {
      const events = require('./workspace-events');
      const missed = events.getEventsSince(WORKSPACE_ROOT, lastEventId);
      for (const evt of missed) {
        res.write(events.formatAsSSE(evt));
      }
    } catch (_err) {
      // Non-critical
    }
  }

  sseClients.add(res);
  res.on('close', () => sseClients.delete(res));
}

function broadcastSSE(event) {
  let formatted;
  try {
    const events = require('./workspace-events');
    formatted = events.formatAsSSE(event);
  } catch (_err) {
    formatted = `data: ${JSON.stringify(event)}\n\n`;
  }
  for (const client of sseClients) {
    try {
      client.write(formatted);
    } catch (_err) {
      sseClients.delete(client);
    }
  }
}

// ============================================================
// Dispatch tracking integration (silent-halt RCA fix, v2.29.4)
// ============================================================
// The channel server is the only place that sees EVERY inbound message,
// regardless of whether the manager dispatched via the programmatic
// `dispatchToChannel()` helper or a raw `curl POST`. Recording at this
// layer guarantees `dispatched-tasks.json` exists for every dispatch,
// closing the wogi-hub 2026-04-27 silent-halt failure shape.
//
// Helpers live in `workspace-channel-tracking.js` so they can be unit-
// tested without spawning the channel-server process. Both fail-open;
// idempotency lives at the call site (Fix A skips on existing record;
// Fix B delegates to reconcileDispatch which is idempotent).

const channelTracking = require('./workspace-channel-tracking');

// S4 (wf-87611c5e): the channel server is the only process that sees every
// inbound dispatch, so it owns the "ack-received" timestamp used by GET /status.
let _lastInboundAt = 0;
const STATUS_STALENESS_MS = (() => {
  const raw = parseInt(process.env.WOGI_STATUS_STALENESS_MS || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 300000;
})();

// ============================================================
// HTTP Server
// ============================================================

const server = http.createServer(async (req, res) => {
  // Health check — minimal info, no topology exposure. PURE liveness: "the
  // server process is up." Says nothing about whether the agent is working —
  // use /status for that (S4).
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', repo: REPO_NAME, port: PORT }));
    return;
  }

  // Activity status (S4 / wf-87611c5e) — the real execution state, so a manager
  // can never mistake a channel POST `ok` for "work happening". Derived from the
  // worker's own state files + the last inbound dispatch this server saw.
  if (req.method === 'GET' && req.url === '/status') {
    let body;
    try {
      const path = require('node:path');
      const stateDir = path.join(process.cwd(), '.workflow', 'state');
      body = channelTracking.computeWorkerStatus({
        stateDir,
        repoName: REPO_NAME,
        lastInboundAt: _lastInboundAt || undefined,
        stalenessMs: STATUS_STALENESS_MS
      });
      body.port = PORT;
      // S5: version-drift signal — if the on-disk wogiflow differs from what this
      // long-lived server loaded, a `flow workspace restart` is required to load it.
      const diskVersion = readDiskVersion();
      body.serverVersion = SERVER_VERSION;
      body.diskVersion = diskVersion;
      body.versionDrift = Boolean(SERVER_VERSION && diskVersion && SERVER_VERSION !== diskVersion);
      if (body.versionDrift) {
        body.restartRequired = `Server is running ${SERVER_VERSION} but ${diskVersion} is on disk — run 'flow workspace restart ${REPO_NAME}'`;
      }
    } catch (_err) {
      body = { repo: REPO_NAME, port: PORT, state: 'unknown' };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
    return;
  }

  // SSE endpoint for event subscriptions
  if (req.method === 'GET' && req.url?.startsWith('/events')) {
    const lastEventId = req.headers['last-event-id'] || '';
    addSSEClient(res, lastEventId);
    return;
  }

  // Manager-triggered restart (S5 / wf-ee87a24e). Writes the wogi-claude
  // wrapper's restart flag and SIGTERMs this server's parent (the claude
  // process). The wrapper relaunches claude with a FRESH require cache —
  // reloading any upgraded wogiflow code, and claude respawns this MCP server.
  // No PID tracking needed; reuses the proven task-boundary restart loop.
  if (req.method === 'POST' && (req.url === '/restart' || req.url === '/control/restart')) {
    const rawFrom = req.headers['x-wogi-from'] || '';
    // localhost-bound already; additionally require the manager as sender.
    if (rawFrom && rawFrom !== 'manager' && rawFrom !== 'workspace-manager') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'restart may only be triggered by the manager' }));
      return;
    }
    let scheduled = false;
    try {
      const fs = require('node:fs');
      const nodePath = require('node:path');
      const flagPath = process.env.WOGI_RESTART_FLAG ||
        nodePath.join(process.cwd(), '.workflow', 'state', 'restart-requested');
      fs.mkdirSync(nodePath.dirname(flagPath), { recursive: true });
      fs.writeFileSync(flagPath, JSON.stringify({
        version: 1, reason: 'manager-restart', repo: REPO_NAME,
        triggeredAt: new Date().toISOString()
      }, null, 2));
      // Defer the SIGTERM briefly so the HTTP response flushes first.
      const ppid = process.ppid;
      setTimeout(() => { try { process.kill(ppid, 'SIGTERM'); } catch (_err) { /* parent gone */ } }, 150);
      scheduled = true;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
      return;
    }
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, scheduled, repo: REPO_NAME, note: 'worker restarting; channel server will respawn with fresh code' }));
    return;
  }

  // Receive webhook (POST)
  if (req.method === 'POST') {
    const { body, truncated } = await collectBody(req, MAX_BODY_BYTES);

    if (truncated) {
      res.writeHead(413, { 'Content-Type': 'text/plain' });
      res.end('Payload too large');
      return;
    }

    // Determine sender from header or default (validate against name pattern)
    const rawFrom = req.headers['x-wogi-from'] || '';
    const from = VALID_NAME_PATTERN.test(rawFrom) ? rawFrom : 'workspace-manager';

    // Parse effort level prefix: [effort:high] /wogi-start wf-xxx
    let effortLevel = '';
    let cleanBody = body;
    const effortMatch = body.match(/^\[effort:(low|medium|high)\]\s*/);
    if (effortMatch) {
      effortLevel = effortMatch[1];
      cleanBody = body.substring(effortMatch[0].length);
    }

    // S4: record when a dispatch arrived (ack-received signal for /status).
    if (channelTracking.DISPATCH_BODY_PATTERN.test(cleanBody)) {
      _lastInboundAt = Date.now();
    }

    // Forward as channel notification to Claude Code
    const meta = {
      from,
      port: String(PORT),
      repo: REPO_NAME,
      receivedAt: new Date().toISOString(),
      ...(effortLevel && { effortLevel })
    };
    // Send the clean body (without effort prefix) but include effort in meta
    const notificationBody = effortLevel
      ? `${cleanBody}\n\n[System: Apply reasoning effort level "${effortLevel}" to this task — propagated from workspace manager]`
      : cleanBody;
    sendChannelNotification(notificationBody, meta);

    // v2.29.4 silent-halt RCA fixes — both fail-open
    const trackingCtx = { workspaceRoot: WORKSPACE_ROOT, repoName: REPO_NAME, from, body: cleanBody };
    channelTracking.tryRecordInboundDispatch(trackingCtx);
    channelTracking.tryReconcileInboundCompletion(trackingCtx);

    // Also broadcast to SSE subscribers
    if (sseClients.size > 0) {
      const crypto = require('node:crypto');
      broadcastSSE({
        id: 'evt-' + crypto.randomBytes(4).toString('hex'),
        type: 'webhook-received',
        source: from,
        data: { body: body.substring(0, 500) },
        timestamp: meta.receivedAt
      });
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  // 404 for everything else
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  process.stderr.write(`[wogi-channel] ${REPO_NAME} listening on http://127.0.0.1:${PORT}\n`);
});

// Graceful shutdown
process.on('SIGINT', () => { server.close(); process.exit(0); });
process.on('SIGTERM', () => { server.close(); process.exit(0); });
