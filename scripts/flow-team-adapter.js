#!/usr/bin/env node
'use strict';

/**
 * flow-team-adapter.js — Thin API client for WogiFlow Teams.
 * 
 * Uses only Node.js built-in modules (https, url). No npm dependencies.
 * Provides: login, logout, status, push, pull operations.
 * 
 * Usage:
 *   node scripts/flow-team-adapter.js status
 *   node scripts/flow-team-adapter.js push <projectId>
 *   node scripts/flow-team-adapter.js pull <projectId> [since]
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// ── CONFIG ─────────────────────────────────────────────────

const CONFIG_PATH = path.join(process.cwd(), '.workflow', 'config.json');
const TEAM_CONFIG_PATH = path.join(process.cwd(), '.workflow', 'team-connection.json');

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    return fallback || null;
  }
}

function writeJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function getTeamConnection() {
  return readJson(TEAM_CONFIG_PATH, null);
}

function saveTeamConnection(connection) {
  writeJson(TEAM_CONFIG_PATH, connection);
}

function removeTeamConnection() {
  try {
    if (fs.existsSync(TEAM_CONFIG_PATH)) {
      fs.unlinkSync(TEAM_CONFIG_PATH);
    }
  } catch (err) {
    // Ignore
  }
}

// ── HTTP CLIENT ────────────────────────────────────────────

/**
 * Make an HTTP(S) request. Returns { statusCode, headers, body }.
 */
function request(url, options) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;

    const req = client.request(url, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'wogiflow-cli',
        ...(options.headers || {})
      },
      timeout: options.timeout || 30000
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        let parsed = body;
        try { parsed = JSON.parse(body); } catch (err) { /* raw string */ }
        resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

/**
 * Make an authenticated API request.
 */
async function apiRequest(endpoint, options) {
  const conn = getTeamConnection();
  if (!conn || !conn.accessToken) {
    throw new Error('Not connected to a team. Run "flow login" first.');
  }

  const url = `${conn.apiBase}${endpoint}`;
  const result = await request(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${conn.accessToken}`,
      ...(options.headers || {})
    }
  });

  // Handle token expiry
  if (result.statusCode === 401 && conn.refreshToken) {
    const refreshed = await refreshAccessToken(conn);
    if (refreshed) {
      return request(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${refreshed.accessToken}`,
          ...(options.headers || {})
        }
      });
    }
  }

  return result;
}

async function refreshAccessToken(conn) {
  try {
    const result = await request(`${conn.apiBase}/api/auth/refresh`, {
      method: 'POST',
      body: { refreshToken: conn.refreshToken }
    });

    if (result.statusCode === 200 && result.body.accessToken) {
      const updated = {
        ...conn,
        accessToken: result.body.accessToken,
        refreshToken: result.body.refreshToken || conn.refreshToken
      };
      saveTeamConnection(updated);
      return updated;
    }
  } catch (err) {
    // Refresh failed
  }
  return null;
}

// ── COMMANDS ───────────────────────────────────────────────

async function status() {
  const conn = getTeamConnection();
  if (!conn) {
    console.log('Not connected to any team.');
    console.log('Run "flow login" to connect.');
    return { connected: false };
  }

  try {
    const result = await apiRequest(`/api/teams/${conn.teamId}`, { method: 'GET' });
    if (result.statusCode === 200) {
      console.log(`Team: ${result.body.name}`);
      console.log(`Role: ${conn.role || 'member'}`);
      console.log(`API: ${conn.apiBase}`);
      console.log(`Status: connected`);
      return { connected: true, team: result.body };
    }
    console.log('Connection error: could not reach team server.');
    return { connected: false, error: 'unreachable' };
  } catch (err) {
    console.log(`Connection error: ${err.message}`);
    return { connected: false, error: err.message };
  }
}

async function push(projectId) {
  if (!projectId) {
    console.error('Usage: flow-team-adapter.js push <projectId>');
    process.exit(1);
  }

  const conn = getTeamConnection();
  if (!conn) {
    console.error('Not connected. Run "flow login" first.');
    process.exit(1);
  }

  // Read local state files to push
  const stateDir = path.join(process.cwd(), '.workflow', 'state');
  const filesToSync = ['request-log.md', 'decisions.md', 'feedback-patterns.md', 'app-map.md'];
  const payload = { projectId, files: {} };

  for (const file of filesToSync) {
    const filePath = path.join(stateDir, file);
    try {
      payload.files[file] = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      // Skip missing files
    }
  }

  const result = await apiRequest(`/api/teams/${conn.teamId}/sync/push`, {
    method: 'POST',
    body: payload
  });

  if (result.statusCode === 200) {
    console.log('Sync push complete.');
    return result.body;
  }
  console.error(`Push failed: ${result.body.error || result.statusCode}`);
  return null;
}

async function pull(projectId, since) {
  const conn = getTeamConnection();
  if (!conn) {
    console.error('Not connected. Run "flow login" first.');
    process.exit(1);
  }

  let url = `/api/teams/${conn.teamId}/sync/pull?projectId=${projectId}`;
  if (since) url += `&since=${encodeURIComponent(since)}`;

  const result = await apiRequest(url, { method: 'GET' });
  if (result.statusCode === 200) {
    console.log(`Pulled ${Object.keys(result.body.files || {}).length} files.`);
    return result.body;
  }
  console.error(`Pull failed: ${result.body.error || result.statusCode}`);
  return null;
}

// ── CLI ────────────────────────────────────────────────────

const command = process.argv[2];

if (require.main === module) {
  const commands = { status, push, pull };
  const fn = commands[command];
  if (!fn) {
    console.log('Usage: flow-team-adapter.js <status|push|pull> [args...]');
    process.exit(1);
  }
  fn(process.argv[3], process.argv[4]).catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  getTeamConnection,
  saveTeamConnection,
  removeTeamConnection,
  apiRequest,
  request,
  status,
  push,
  pull
};
