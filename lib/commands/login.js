#!/usr/bin/env node
'use strict';

/**
 * flow login — Connect to WogiFlow Teams via device OAuth flow.
 *
 * Usage: node lib/commands/login.js [--api-base URL]
 *
 * Flow:
 * 1. Request device code from server
 * 2. Open browser for user authentication
 * 3. Poll for token
 * 4. Save team connection to .workflow/team-connection.json
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');

const DEFAULT_API_BASE = 'https://api.wogiflow.com';
const CLIENT_ID = 'wogiflow-cli';
const POLL_INTERVAL_MS = 5000;
const MAX_POLLS = 60; // 5 minutes max
const CONNECTION_FILE = '.workflow/team-connection.json';

function getTeamConnection() {
  try {
    const filePath = path.resolve(process.cwd(), CONNECTION_FILE);
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function saveTeamConnection(connection) {
  const filePath = path.resolve(process.cwd(), CONNECTION_FILE);
  fs.writeFileSync(filePath, JSON.stringify(connection, null, 2));
}

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const body = options.body ? JSON.stringify(options.body) : null;
    const req = https.request({
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
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

function openBrowser(url) {
  const platform = process.platform;
  let cmd;
  if (platform === 'darwin') cmd = `open "${url}"`;
  else if (platform === 'win32') cmd = `start "" "${url}"`;
  else cmd = `xdg-open "${url}"`;

  exec(cmd, (err) => {
    if (err) {
      console.log(`\nCould not open browser automatically.`);
      console.log(`Please open this URL manually: ${url}`);
    }
  });
}

async function login(apiBase) {
  const existing = getTeamConnection();
  if (existing && existing.accessToken) {
    console.log(`Already connected to team.`);
    console.log(`Run "flow logout" first to disconnect, or "flow team status" to check.`);
    return;
  }

  const base = apiBase || DEFAULT_API_BASE;
  console.log('Starting WogiFlow Teams login...\n');

  // Step 1: Request device code
  let deviceResponse;
  try {
    deviceResponse = await request(`${base}/api/auth/device`, {
      method: 'POST',
      body: { client_id: CLIENT_ID }
    });
  } catch (err) {
    console.error(`Could not reach server at ${base}`);
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  if (deviceResponse.statusCode !== 200) {
    console.error(`Server error: ${deviceResponse.body.error || deviceResponse.statusCode}`);
    process.exit(1);
  }

  const { deviceCode, userCode, verificationUrl } = deviceResponse.body;

  // Step 2: Show code and open browser
  console.log(`Your verification code: ${userCode}\n`);
  console.log(`Opening browser to: ${verificationUrl}`);
  console.log('Enter the code above when prompted.\n');
  openBrowser(verificationUrl);

  // Step 3: Poll for token
  console.log('Waiting for authentication...');
  let polls = 0;

  while (polls < MAX_POLLS) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    polls++;

    try {
      const tokenResponse = await request(`${base}/api/auth/device/token`, {
        method: 'POST',
        body: { client_id: CLIENT_ID, device_code: deviceCode }
      });

      if (tokenResponse.statusCode === 200 && tokenResponse.body.accessToken) {
        const connection = {
          apiBase: base,
          accessToken: tokenResponse.body.accessToken,
          refreshToken: tokenResponse.body.refreshToken,
          teamId: tokenResponse.body.teamId,
          teamName: tokenResponse.body.teamName,
          userId: tokenResponse.body.userId,
          role: tokenResponse.body.role,
          connectedAt: new Date().toISOString()
        };

        saveTeamConnection(connection);

        console.log(`\nLogin successful!`);
        console.log(`Team: ${connection.teamName}`);
        console.log(`Role: ${connection.role}`);
        console.log(`\nYour CLI is now connected to WogiFlow Teams.`);
        console.log(`Run "flow onboard" in a project to connect it.`);
        return;
      }

      if (tokenResponse.statusCode === 400 && tokenResponse.body.error === 'authorization_pending') {
        process.stdout.write('.');
        continue;
      }

      if (tokenResponse.body.error === 'expired_token') {
        console.error('\n\nLogin expired. Please try again.');
        process.exit(1);
      }

      if (tokenResponse.body.error === 'access_denied') {
        console.error('\n\nLogin was denied.');
        process.exit(1);
      }
    } catch {
      process.stdout.write('x');
    }
  }

  console.error('\n\nLogin timed out. Please try again.');
  process.exit(1);
}

// Parse args
const args = process.argv.slice(2);
let apiBase = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--api-base' && args[i + 1]) {
    apiBase = args[i + 1];
    i++;
  }
}

if (require.main === module) {
  login(apiBase).catch(err => {
    console.error(`Login failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { login };
