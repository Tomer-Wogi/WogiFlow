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

let initialized = false;

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

CRITICAL — ALWAYS REPLY TO THE MANAGER:
After completing ANY work triggered by a channel message, you MUST send results back using the workspace_send_message tool with to: "manager". The user only sees the manager terminal — if you don't reply, they never see your results.

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
    initialized = true;
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

  try {
    const msg = JSON.parse(trimmed);
    handleRequest(msg);
  } catch (_err) {
    // Ignore malformed JSON
  }
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
// HTTP Server
// ============================================================

const server = http.createServer(async (req, res) => {
  // Health check — minimal info, no topology exposure
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', repo: REPO_NAME, port: PORT }));
    return;
  }

  // SSE endpoint for event subscriptions
  if (req.method === 'GET' && req.url?.startsWith('/events')) {
    const lastEventId = req.headers['last-event-id'] || '';
    addSSEClient(res, lastEventId);
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

    // Determine sender from header or default
    const from = req.headers['x-wogi-from'] || 'workspace-manager';

    // Parse effort level prefix: [effort:high] /wogi-start wf-xxx
    let effortLevel = '';
    let cleanBody = body;
    const effortMatch = body.match(/^\[effort:(low|medium|high)\]\s*/);
    if (effortMatch) {
      effortLevel = effortMatch[1];
      cleanBody = body.substring(effortMatch[0].length);
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
