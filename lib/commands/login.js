#!/usr/bin/env node
'use strict';

/**
 * flow login — Connect to WogiFlow Teams via device OAuth flow.
 *
 * Usage: flow login [--api-base URL] [--allow-http]
 *
 * Flow:
 * 1. If already authenticated with a saved project, reconnect automatically
 * 2. Request device code from server
 * 3. Open browser for user authentication
 * 4. Poll for token
 * 5. Fetch list of team projects
 * 6. Interactive arrow-key selection of project
 * 7. Save team connection + project mapping to .workflow/team-connection.json
 */

const readline = require('readline');
const { execFile } = require('child_process');

const {
  getTeamConnection,
  saveTeamConnection,
  validateUrl,
  request
} = require('./team-connection');

const DEFAULT_API_BASE = 'https://api.wogiflow.com';
const CLIENT_ID = 'wogiflow-cli';
const POLL_INTERVAL_MS = 5000;
const MAX_POLLS = 60; // 5 minutes max

/**
 * Validate that a URL is safe to open in a browser (https: only).
 * @param {string} url - URL to validate
 * @returns {boolean}
 */
function isSafeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function openBrowser(url) {
  // Validate URL protocol before opening
  if (!isSafeUrl(url)) {
    showManualUrl(url);
    return;
  }

  const platform = process.platform;
  // Use execFile with array args to avoid shell injection via URL
  if (platform === 'darwin') {
    execFile('open', [url], (err) => {
      if (err) showManualUrl(url);
    });
  } else if (platform === 'win32') {
    execFile('cmd', ['/c', 'start', '', url], (err) => {
      if (err) showManualUrl(url);
    });
  } else {
    execFile('xdg-open', [url], (err) => {
      if (err) showManualUrl(url);
    });
  }
}

function showManualUrl(url) {
  console.log(`\nCould not open browser automatically.`);
  console.log(`Please open this URL manually: ${url}`);
}

/**
 * Interactive arrow-key project selector.
 * Returns the selected project object or null if cancelled.
 */
function selectProject(projects) {
  return new Promise((resolve) => {
    if (!projects || projects.length === 0) {
      console.log('No projects found in your team.');
      resolve(null);
      return;
    }

    if (projects.length === 1) {
      console.log(`Only one project available: ${projects[0].name}`);
      console.log('Auto-selecting it.\n');
      resolve(projects[0]);
      return;
    }

    let selectedIndex = 0;
    const CYAN = '\x1b[36m';
    const BOLD = '\x1b[1m';
    const DIM = '\x1b[2m';
    const RESET = '\x1b[0m';

    function render() {
      // drawList outputs: 1 blank line (\n prefix) + 1 header line + 1 blank (\n suffix) + N project lines = N + 3
      const lines = projects.length + 3;
      process.stdout.write(`\x1b[${lines}A\x1b[0J`);
      drawList();
    }

    function drawList() {
      console.log('\nSelect a project (use arrow keys, Enter to confirm, q to cancel):\n');
      projects.forEach((project, i) => {
        const prefix = i === selectedIndex ? `${CYAN}>${RESET} ` : '  ';
        const name = i === selectedIndex ? `${BOLD}${project.name}${RESET}` : project.name;
        const desc = project.description ? ` ${DIM}— ${project.description}${RESET}` : '';
        console.log(`${prefix}${name}${desc}`);
      });
    }

    drawList();

    if (!process.stdin.isTTY) {
      console.log('\nNon-interactive terminal detected. Enter project number:');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('> ', (answer) => {
        rl.close();
        const num = parseInt(answer, 10);
        if (num >= 1 && num <= projects.length) {
          resolve(projects[num - 1]);
        } else {
          console.log('Invalid selection.');
          resolve(null);
        }
      });
      return;
    }

    // Ensure terminal is restored on exit (even on process.exit calls)
    const restoreTerminal = () => {
      try { process.stdin.setRawMode(false); } catch { /* ignore */ }
    };
    process.on('exit', restoreTerminal);

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    // Buffer for multi-byte escape sequences (arrow keys)
    let escBuffer = '';
    let escTimer = null;

    function onKeypress(key) {
      // Handle escape sequence buffering
      if (escBuffer) {
        escBuffer += key;
        clearTimeout(escTimer);
        if (escBuffer === '\x1b[A') {
          escBuffer = '';
          selectedIndex = Math.max(0, selectedIndex - 1);
          render();
          return;
        }
        if (escBuffer === '\x1b[B') {
          escBuffer = '';
          selectedIndex = Math.min(projects.length - 1, selectedIndex + 1);
          render();
          return;
        }
        // Unknown sequence — reset and ignore
        if (escBuffer.length >= 3) {
          escBuffer = '';
        }
        return;
      }

      // Start of escape sequence
      if (key === '\x1b') {
        escBuffer = '\x1b';
        // Wait a short time for the rest of the sequence
        escTimer = setTimeout(() => {
          // Standalone Escape — cancel
          escBuffer = '';
          cleanup();
          console.log('\nCancelled.');
          resolve(null);
        }, 50);
        return;
      }

      if (key === '\r' || key === '\n') {
        cleanup();
        console.log('');
        resolve(projects[selectedIndex]);
        return;
      }
      if (key === 'q' || key === '\x03') {
        cleanup();
        console.log('\nCancelled.');
        resolve(null);
        return;
      }
    }

    function cleanup() {
      if (escTimer) clearTimeout(escTimer);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', onKeypress);
      process.removeListener('exit', restoreTerminal);
    }

    process.stdin.on('data', onKeypress);
  });
}

/**
 * Fetch the list of projects the authenticated user has access to.
 */
async function fetchProjects(apiBase, accessToken) {
  try {
    const response = await request(`${apiBase}/api/teams/projects`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (response.statusCode === 200 && Array.isArray(response.body.projects)) {
      return response.body.projects;
    }

    if (response.statusCode === 200 && Array.isArray(response.body)) {
      return response.body;
    }

    const errMsg = (typeof response.body === 'object' && response.body !== null)
      ? response.body.error || response.statusCode
      : response.statusCode;
    console.error(`Failed to fetch projects: ${errMsg}`);
    return [];
  } catch (err) {
    console.error(`Could not fetch projects: ${err.message}`);
    return [];
  }
}

/**
 * Link this local project directory to a team project on the server.
 */
async function linkProject(apiBase, accessToken, projectId) {
  try {
    await request(`${apiBase}/api/teams/projects/${projectId}/link`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}` },
      body: { localPath: process.cwd() }
    });
  } catch {
    // Best-effort — server link is optional
  }
}

/**
 * Extract .error from a response body safely (handles non-JSON string bodies).
 */
function getBodyError(body) {
  if (typeof body === 'object' && body !== null) {
    return body.error || null;
  }
  return null;
}

async function login(args) {
  let apiBase = null;
  let allowHttp = false;
  const argList = Array.isArray(args) ? args : [];
  for (let i = 0; i < argList.length; i++) {
    if (argList[i] === '--api-base' && argList[i + 1]) {
      apiBase = argList[i + 1];
      i++;
    }
    if (argList[i] === '--allow-http') {
      allowHttp = true;
    }
  }

  // Validate --api-base URL if provided
  if (apiBase) {
    try {
      validateUrl(apiBase, allowHttp);
    } catch (err) {
      console.error(`Invalid --api-base: ${err.message}`);
      process.exit(1);
    }
  }

  const existing = getTeamConnection();
  const base = apiBase || (existing && existing.apiBase) || DEFAULT_API_BASE;

  // Quick re-login: if we already have a token + projectId, just verify and reconnect
  if (existing && existing.accessToken && existing.projectId) {
    console.log('Existing connection found. Verifying...\n');
    try {
      const verifyResponse = await request(`${base}/api/auth/verify`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${existing.accessToken}` }
      });
      if (verifyResponse.statusCode === 200) {
        console.log(`Reconnected to project "${existing.projectName}" in team "${existing.teamName}".`);
        console.log('Connection is active.\n');
        return;
      }
    } catch {
      // Token expired or invalid — proceed with fresh login
    }
    console.log('Existing token expired. Starting fresh login...\n');
  } else if (existing && existing.accessToken) {
    console.log('Authenticated but no project selected. Starting project selection...\n');
    const projects = await fetchProjects(base, existing.accessToken);
    const selected = await selectProject(projects);
    if (!selected) {
      console.log('No project selected. Run "flow login" again to choose.');
      return;
    }

    existing.projectId = selected.id;
    existing.projectName = selected.name;
    saveTeamConnection(existing);
    await linkProject(base, existing.accessToken, selected.id);

    console.log(`\nConnected to project "${selected.name}".`);
    console.log('Your CLI is now linked to this team project.\n');
    return;
  }

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
    const errMsg = getBodyError(deviceResponse.body) || deviceResponse.statusCode;
    console.error(`Server error: ${errMsg}`);
    process.exit(1);
  }

  const { deviceCode, userCode, verificationUrl } = deviceResponse.body;

  // Validate required fields from server response
  if (!deviceCode || typeof deviceCode !== 'string') {
    console.error('Server returned incomplete device auth response (missing deviceCode).');
    process.exit(1);
  }
  if (!userCode || typeof userCode !== 'string') {
    console.error('Server returned incomplete device auth response (missing userCode).');
    process.exit(1);
  }
  if (!verificationUrl || typeof verificationUrl !== 'string') {
    console.error('Server returned incomplete device auth response (missing verificationUrl).');
    process.exit(1);
  }

  // Step 2: Show code and open browser
  console.log(`Your verification code: ${userCode}\n`);
  console.log(`Opening browser to: ${verificationUrl}`);
  console.log('Enter the code above when prompted.\n');
  openBrowser(verificationUrl);

  // Step 3: Poll for token
  console.log('Waiting for authentication...');
  let polls = 0;
  let tokenData = null;

  while (polls < MAX_POLLS) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    polls++;

    try {
      const tokenResponse = await request(`${base}/api/auth/device/token`, {
        method: 'POST',
        body: { client_id: CLIENT_ID, device_code: deviceCode }
      });

      if (tokenResponse.statusCode === 200 && tokenResponse.body.accessToken) {
        tokenData = tokenResponse.body;
        break;
      }

      const bodyError = getBodyError(tokenResponse.body);

      if (tokenResponse.statusCode === 400 && bodyError === 'authorization_pending') {
        process.stdout.write('.');
        continue;
      }

      if (bodyError === 'expired_token') {
        console.error('\n\nLogin expired. Please try again.');
        process.exit(1);
      }

      if (bodyError === 'access_denied') {
        console.error('\n\nLogin was denied.');
        process.exit(1);
      }

      // Handle unexpected server errors
      if (tokenResponse.statusCode >= 500) {
        console.error(`\n\nServer error (${tokenResponse.statusCode}). Retrying...`);
        process.stdout.write('x');
      }
    } catch (err) {
      process.stdout.write('x');
    }
  }

  if (!tokenData) {
    console.error('\n\nLogin timed out. Please try again.');
    process.exit(1);
  }

  console.log('\n\nAuthenticated successfully!\n');

  // Step 4: Fetch team projects
  console.log('Fetching your team projects...\n');
  const projects = await fetchProjects(base, tokenData.accessToken);

  // Step 5: Interactive project selection
  const selected = await selectProject(projects);
  if (!selected) {
    saveTeamConnection({
      apiBase: base,
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      teamId: tokenData.teamId,
      teamName: tokenData.teamName,
      userId: tokenData.userId,
      role: tokenData.role,
      connectedAt: new Date().toISOString()
    });
    console.log('\nAuthenticated but no project selected.');
    console.log('Run "flow login" again in any project folder to select one.\n');
    return;
  }

  // Step 6: Save full connection with project
  const connection = {
    apiBase: base,
    accessToken: tokenData.accessToken,
    refreshToken: tokenData.refreshToken,
    teamId: tokenData.teamId,
    teamName: tokenData.teamName,
    userId: tokenData.userId,
    role: tokenData.role,
    projectId: selected.id,
    projectName: selected.name,
    connectedAt: new Date().toISOString()
  };

  saveTeamConnection(connection);
  await linkProject(base, tokenData.accessToken, selected.id);

  console.log(`\nLogin successful!`);
  console.log(`Team: ${connection.teamName}`);
  console.log(`Project: ${connection.projectName}`);
  console.log(`Role: ${connection.role}`);
  console.log(`\nYour CLI is now connected to WogiFlow Teams.\n`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  login(args).catch(err => {
    console.error(`Login failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { login };
