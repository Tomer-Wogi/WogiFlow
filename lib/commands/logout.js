#!/usr/bin/env node
'use strict';

/**
 * flow logout — Disconnect from WogiFlow Teams.
 *
 * Usage: node lib/commands/logout.js
 *
 * Removes team connection config. All local state is preserved.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const CONNECTION_FILE = '.workflow/team-connection.json';

function getTeamConnection() {
  try {
    const filePath = path.resolve(process.cwd(), CONNECTION_FILE);
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function removeTeamConnection() {
  const filePath = path.resolve(process.cwd(), CONNECTION_FILE);
  try {
    fs.unlinkSync(filePath);
  } catch {
    // File may not exist
  }
}

function apiRequest(urlPath, options = {}) {
  const conn = getTeamConnection();
  if (!conn) throw new Error('Not connected');
  const base = conn.apiBase || 'https://api.wogiflow.com';
  const url = new URL(urlPath, base);
  const body = options.body ? JSON.stringify(options.body) : null;

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${conn.accessToken}`,
        ...(body && { 'Content-Length': Buffer.byteLength(body) }),
        ...(options.headers || {})
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ statusCode: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function logout() {
  const conn = getTeamConnection();

  if (!conn) {
    console.log('Not connected to any team. Nothing to do.');
    return;
  }

  const teamName = conn.teamName || conn.teamId || 'unknown';

  // Try to notify server (best-effort, don't fail if offline)
  try {
    await apiRequest('/api/auth/logout', {
      method: 'POST',
      body: { refreshToken: conn.refreshToken }
    });
  } catch {
    // Server notification is optional
  }

  // Remove local connection
  removeTeamConnection();

  console.log(`Disconnected from team "${teamName}".`);
  console.log('');
  console.log('Your local state is preserved:');
  console.log('  - .workflow/state/ files unchanged');
  console.log('  - .workflow/config.json unchanged');
  console.log('  - All local patterns and decisions kept');
  console.log('');
  console.log('Run "flow login" to reconnect at any time.');
}

if (require.main === module) {
  logout().catch(err => {
    console.error(`Logout failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { logout };
