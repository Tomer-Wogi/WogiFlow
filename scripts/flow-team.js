#!/usr/bin/env node

/**
 * Wogi Flow - Team Collaboration Module
 *
 * Manages team features including:
 * - Team login/logout with invite codes
 * - Setup selection from team configurations
 * - Knowledge sync with AWS backend
 * - Proposal management with offline queue
 *
 * Part of v1.8.0 Team Collaboration
 *
 * Note: Team features require a subscription and hosted backend.
 * Without subscription, features gracefully degrade to local-only mode.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  getConfig,
  saveConfig,
  STATE_DIR,
  colors,
  color,
  success,
  warn,
  error,
  info,
  printHeader,
  fileExists,
  readFile,
  writeFile
} = require('./flow-utils');

// Use shared database for proposals
const memoryDb = require('./flow-memory-db');

// Decisions file path
const DECISIONS_PATH = path.join(STATE_DIR, 'decisions.md');

// ============================================================
// Constants
// ============================================================

const TEAM_STATE_FILE = path.join(STATE_DIR, 'team-state.json');
const OFFLINE_QUEUE_FILE = path.join(STATE_DIR, 'offline-queue.json');
const DEFAULT_BACKEND_URL = 'https://api.wogi-flow.com';

// Token refresh threshold (refresh 5 minutes before expiry)
const TOKEN_REFRESH_THRESHOLD = 5 * 60 * 1000;

// ============================================================
// Team State Management
// ============================================================

/**
 * Get current team state
 */
function getTeamState() {
  if (!fileExists(TEAM_STATE_FILE)) {
    return {
      loggedIn: false,
      teamId: null,
      userId: null,
      teamName: null,
      setupId: null,
      setupName: null,
      lastSync: null,
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null
    };
  }

  try {
    const state = JSON.parse(readFile(TEAM_STATE_FILE));
    // Decrypt tokens if encrypted
    if (state.accessToken && state.encrypted) {
      state.accessToken = decryptToken(state.accessToken);
      state.refreshToken = decryptToken(state.refreshToken);
    }
    return state;
  } catch (err) {
    return { loggedIn: false };
  }
}

/**
 * Save team state (with encrypted tokens)
 */
function saveTeamState(state) {
  const stateToSave = { ...state };

  // Encrypt tokens before saving
  if (stateToSave.accessToken) {
    stateToSave.accessToken = encryptToken(stateToSave.accessToken);
    stateToSave.refreshToken = encryptToken(stateToSave.refreshToken);
    stateToSave.encrypted = true;
  }

  writeFile(TEAM_STATE_FILE, JSON.stringify(stateToSave, null, 2));
}

/**
 * Simple token encryption (better than plain text)
 */
function encryptToken(token) {
  if (!token) return null;
  const key = crypto.createHash('sha256').update(getMachineId()).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decryptToken(encrypted) {
  if (!encrypted) return null;
  try {
    const key = crypto.createHash('sha256').update(getMachineId()).digest();
    const parts = encrypted.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(parts[1], 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    return null;
  }
}

function getMachineId() {
  // Use a combination of machine-specific values
  return process.env.USER + process.env.HOME + __dirname;
}

/**
 * Check if team features are enabled and configured
 */
function isTeamEnabled() {
  const config = getConfig();
  return config.team?.enabled === true && config.team?.teamId;
}

/**
 * Get backend URL from config or default
 */
function getBackendUrl() {
  const config = getConfig();
  return config.team?.backendUrl || DEFAULT_BACKEND_URL;
}

// ============================================================
// Offline Queue
// ============================================================

function getOfflineQueue() {
  if (!fileExists(OFFLINE_QUEUE_FILE)) return [];
  try {
    return JSON.parse(readFile(OFFLINE_QUEUE_FILE));
  } catch (err) {
    return [];
  }
}

function saveOfflineQueue(queue) {
  writeFile(OFFLINE_QUEUE_FILE, JSON.stringify(queue, null, 2));
}

function addToOfflineQueue(operation) {
  const queue = getOfflineQueue();
  queue.push({
    ...operation,
    queuedAt: new Date().toISOString(),
    retries: 0
  });
  saveOfflineQueue(queue);
}

async function processOfflineQueue() {
  const queue = getOfflineQueue();
  if (queue.length === 0) return { processed: 0, failed: 0 };

  let processed = 0;
  let failed = 0;
  const remaining = [];

  for (const item of queue) {
    try {
      const result = await executeQueuedOperation(item);
      if (result.success) {
        processed++;
      } else if (item.retries < 3) {
        remaining.push({ ...item, retries: item.retries + 1 });
        failed++;
      }
    } catch (err) {
      if (item.retries < 3) {
        remaining.push({ ...item, retries: item.retries + 1 });
      }
      failed++;
    }
  }

  saveOfflineQueue(remaining);
  return { processed, failed, remaining: remaining.length };
}

async function executeQueuedOperation(item) {
  switch (item.type) {
    case 'proposal':
      return await apiRequest(`/teams/${item.teamId}/proposals`, {
        method: 'POST',
        body: JSON.stringify(item.data)
      });
    case 'knowledge':
      return await apiRequest(`/teams/${item.teamId}/knowledge`, {
        method: 'POST',
        body: JSON.stringify(item.data)
      });
    default:
      return { success: false, error: 'Unknown operation type' };
  }
}

// ============================================================
// API Client (with JWT refresh and offline support)
// ============================================================

/**
 * Ensure valid access token, refresh if needed
 */
async function ensureValidToken() {
  const state = getTeamState();

  if (!state.accessToken || !state.refreshToken) {
    return null;
  }

  // Check if token is about to expire
  const expiresAt = state.tokenExpiresAt ? new Date(state.tokenExpiresAt).getTime() : 0;
  const now = Date.now();

  if (now > expiresAt - TOKEN_REFRESH_THRESHOLD) {
    // Token expired or about to expire, refresh it
    const backendUrl = getBackendUrl();

    try {
      const response = await fetch(`${backendUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: state.refreshToken })
      });

      if (response.ok) {
        const data = await response.json();
        state.accessToken = data.accessToken;
        state.tokenExpiresAt = new Date(now + (data.expiresIn || 3600) * 1000).toISOString();
        saveTeamState(state);
        return state.accessToken;
      }
    } catch (err) {
      // Token refresh failed, return existing token and hope for the best
      console.error('Token refresh failed:', err.message);
    }
  }

  return state.accessToken;
}

/**
 * Make authenticated request to backend
 */
async function apiRequest(endpoint, options = {}) {
  const backendUrl = getBackendUrl();
  const url = `${backendUrl}${endpoint}`;

  // Get valid token (will refresh if needed)
  const token = await ensureValidToken();

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...options.headers
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers
    });

    if (response.status === 401) {
      return { error: 'unauthorized', message: 'Token expired or invalid' };
    }

    if (response.status === 403) {
      return { error: 'forbidden', message: 'Access denied' };
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return { error: 'api_error', message: data.error || response.statusText, status: response.status };
    }

    return await response.json();
  } catch (err) {
    // Network error - add to offline queue if it's a write operation
    if (options.method && ['POST', 'PUT', 'DELETE'].includes(options.method)) {
      // Extract teamId from endpoint
      const teamIdMatch = endpoint.match(/\/teams\/([^/]+)/);
      if (teamIdMatch && options.body) {
        addToOfflineQueue({
          type: inferOperationType(endpoint),
          teamId: teamIdMatch[1],
          endpoint,
          data: JSON.parse(options.body)
        });
        return { error: 'queued', message: 'Operation queued for sync when online' };
      }
    }
    return { error: 'network', message: `Backend unavailable: ${err.message}` };
  }
}

function inferOperationType(endpoint) {
  if (endpoint.includes('/proposals')) return 'proposal';
  if (endpoint.includes('/knowledge')) return 'knowledge';
  return 'unknown';
}

// ============================================================
// Auto-Apply Approved Proposals (v1.8.0)
// ============================================================

/**
 * Apply approved team proposals to local decisions.md
 */
async function applyApprovedProposals(approvedProposals) {
  if (!approvedProposals || approvedProposals.length === 0) return { applied: 0 };

  // Load current decisions.md
  let decisionsContent = '';
  if (fileExists(DECISIONS_PATH)) {
    decisionsContent = readFile(DECISIONS_PATH);
  } else {
    decisionsContent = '# Decisions\n\nProject coding rules and patterns.\n\n';
  }

  let applied = 0;
  let currentContent = decisionsContent;

  for (const proposal of approvedProposals) {
    // Check if already in decisions.md
    if (isRuleInDecisions(proposal.rule, currentContent)) {
      continue;
    }

    // Format and add to decisions.md
    const formatted = formatProposalForDecisions(proposal);
    currentContent = appendToDecisions(formatted, currentContent);
    applied++;

    // Mark as applied in local memory
    try {
      await memoryDb.markFactPromoted(`proposal:${proposal.id}`, 'decisions.md');
    } catch (err) {
      // Ignore if fact doesn't exist locally
    }
  }

  if (applied > 0) {
    writeFile(DECISIONS_PATH, currentContent);
  }

  return { applied };
}

/**
 * Check if rule is already in decisions.md
 */
function isRuleInDecisions(rule, content) {
  const keywords = rule.split(/\s+/)
    .filter(w => w.length > 4)
    .slice(0, 5);

  let matches = 0;
  for (const keyword of keywords) {
    if (content.toLowerCase().includes(keyword.toLowerCase())) {
      matches++;
    }
  }

  return matches > keywords.length / 2;
}

/**
 * Format proposal for decisions.md
 */
function formatProposalForDecisions(proposal) {
  const sectionMap = {
    'naming': 'Naming Conventions',
    'pattern': 'Coding Patterns',
    'architecture': 'Architecture Decisions',
    'styling': 'Styling Rules',
    'testing': 'Testing Conventions',
    'error-handling': 'Error Handling',
    'general': 'General Rules',
    'api': 'API Patterns',
    'component': 'Component Patterns'
  };

  return {
    section: sectionMap[proposal.category] || 'Team-Approved Rules',
    rule: `- ${proposal.rule}`,
    source: '(Team-approved)'
  };
}

/**
 * Append formatted rule to decisions.md content
 */
function appendToDecisions(formatted, content) {
  const lines = content.split('\n');
  let sectionIndex = -1;

  // Find the section
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(formatted.section) && lines[i].startsWith('#')) {
      sectionIndex = i;
      break;
    }
  }

  if (sectionIndex === -1) {
    // Section doesn't exist, append at end
    return content.trim() + `\n\n## ${formatted.section}\n\n${formatted.rule} ${formatted.source}\n`;
  }

  // Find end of section (next heading or end of file)
  let insertIndex = lines.length;
  for (let i = sectionIndex + 1; i < lines.length; i++) {
    if (lines[i].startsWith('#')) {
      insertIndex = i;
      break;
    }
  }

  // Insert before next section
  lines.splice(insertIndex, 0, `${formatted.rule} ${formatted.source}`);

  return lines.join('\n');
}

// ============================================================
// Team Commands
// ============================================================

/**
 * Login to team with invite code or credentials
 */
async function login(inviteCodeOrEmail, password) {
  printHeader('Team Login');

  if (!inviteCodeOrEmail) {
    console.log('To join a team, you need an invite code from your team admin.');
    console.log('');
    console.log('Options:');
    console.log('  1. Join with invite: ./scripts/flow team login <invite-code>');
    console.log('  2. Login with email: ./scripts/flow team login <email> <password>');
    console.log('');
    info('Team features require a subscription at https://wogi-flow.com');
    return;
  }

  const backendUrl = getBackendUrl();

  // Determine if invite code or email login
  const isEmail = inviteCodeOrEmail.includes('@');
  let body;

  if (isEmail) {
    if (!password) {
      error('Password required for email login');
      return;
    }
    body = { email: inviteCodeOrEmail, password };
    info('Logging in...');
  } else {
    // Prompt for email and password for invite code login
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    console.log('Setting up your account for this team...');

    const email = await new Promise(resolve => rl.question('Email: ', resolve));
    const pwd = await new Promise(resolve => {
      process.stdout.write('Password: ');
      // Note: In production, use a proper password input
      rl.question('', resolve);
    });
    rl.close();

    body = { inviteCode: inviteCodeOrEmail, email, password: pwd };
    info('Validating invite and creating account...');
  }

  try {
    const response = await fetch(`${backendUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        error(data.error || 'Invalid credentials or invite code');
      } else {
        error(`Login failed: ${data.error || response.statusText}`);
      }
      return;
    }

    const result = await response.json();

    // Save team state with tokens
    const teamState = {
      loggedIn: true,
      teamId: result.teamId,
      userId: result.userId,
      teamName: result.teamName,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      tokenExpiresAt: new Date(Date.now() + (result.expiresIn || 3600) * 1000).toISOString(),
      setupId: null,
      setupName: null,
      lastSync: null
    };
    saveTeamState(teamState);

    // Update config
    const config = getConfig();
    config.team = {
      ...config.team,
      enabled: true,
      teamId: result.teamId,
      userId: result.userId,
      backendUrl
    };
    saveConfig(config);

    success(`Logged in to team: ${result.teamName || result.teamId}`);

    // Trigger initial sync
    console.log('');
    info('Running initial sync...');
    await sync({ silent: true });
    success('Initial sync complete');

  } catch (err) {
    error(`Could not connect to team backend: ${err.message}`);
    info('Check your internet connection or try again later.');
  }
}

/**
 * Logout from team
 */
async function logout() {
  printHeader('Team Logout');

  const state = getTeamState();

  if (!state.loggedIn) {
    warn('Not logged in to any team.');
    return;
  }

  const teamName = state.teamName || 'team';

  // Clear team state
  saveTeamState({
    loggedIn: false,
    teamId: null,
    userId: null,
    teamName: null,
    setupId: null,
    setupName: null,
    lastSync: null,
    accessToken: null,
    refreshToken: null,
    tokenExpiresAt: null
  });

  // Update config
  const config = getConfig();
  config.team = {
    ...config.team,
    enabled: false
  };
  saveConfig(config);

  success(`Logged out from ${teamName}`);
  info('Local data preserved. Team features disabled.');
}

/**
 * Sync with team backend
 */
async function sync(options = {}) {
  if (!options.silent) printHeader('Team Sync');

  const state = getTeamState();

  if (!state.loggedIn) {
    error('Not logged in to a team.');
    return { pulled: 0, pushed: 0 };
  }

  const { silent = false } = options;

  if (!silent) info('Syncing with team...');

  // 1. Process offline queue first
  const queueResult = await processOfflineQueue();
  if (queueResult.processed > 0 && !silent) {
    info(`Processed ${queueResult.processed} queued operations`);
  }

  // 2. Get unsynced proposals from local database
  const localProposals = await memoryDb.getUnsyncedProposals();
  let pushed = 0;

  // Push local proposals
  for (const proposal of localProposals) {
    const result = await apiRequest(`/teams/${state.teamId}/proposals`, {
      method: 'POST',
      body: JSON.stringify({
        rule: proposal.rule,
        category: proposal.category,
        rationale: proposal.rationale,
        sourceContext: proposal.source_context,
        localId: proposal.id
      })
    });

    if (!result.error || result.error === 'queued') {
      await memoryDb.updateProposal(proposal.id, {
        synced: true,
        remoteId: result.id
      });
      pushed++;
    }
  }

  // 3. Pull new knowledge
  const pullResult = await apiRequest(`/teams/${state.teamId}/knowledge?since=${state.lastSync || ''}`);

  let pulled = 0;
  if (!pullResult.error && pullResult.knowledge) {
    for (const item of pullResult.knowledge) {
      await memoryDb.storeFact({
        fact: item.fact,
        category: item.category,
        scope: 'team',
        model: item.modelSpecific,
        sourceContext: `team:${state.teamId}`
      });
      pulled++;
    }
  }

  // 4. Pull approved proposals and auto-apply to decisions.md (v1.8.0)
  let appliedProposals = 0;
  const config = getConfig();
  const autoApply = config.automaticPromotion?.autoApplyTeamApproved !== false;

  if (autoApply) {
    const approvedResult = await apiRequest(`/teams/${state.teamId}/proposals?status=approved&since=${state.lastSync || ''}`);

    if (!approvedResult.error && approvedResult.proposals && approvedResult.proposals.length > 0) {
      const applyResult = await applyApprovedProposals(approvedResult.proposals);
      appliedProposals = applyResult.applied;

      if (!silent && appliedProposals > 0) {
        success(`Applied ${appliedProposals} team-approved rule(s) to decisions.md`);
      }
    }
  }

  // Update last sync time
  state.lastSync = new Date().toISOString();
  saveTeamState(state);

  if (!silent) {
    success(`Sync complete: ${pulled} pulled, ${pushed} pushed`);
    if (appliedProposals > 0) {
      info(`${appliedProposals} approved rule(s) added to decisions.md`);
    }
    if (queueResult.remaining > 0) {
      warn(`${queueResult.remaining} operations still queued (will retry)`);
    }
  }

  return { pulled, pushed, appliedProposals };
}

/**
 * Show/vote on team proposals
 */
async function proposals(action, proposalId, vote) {
  printHeader('Team Proposals');

  const state = getTeamState();

  if (!state.loggedIn) {
    error('Not logged in to a team.');
    return;
  }

  if (action === 'vote' && proposalId && vote) {
    if (!['approve', 'reject'].includes(vote)) {
      error('Vote must be "approve" or "reject"');
      return;
    }

    const result = await apiRequest(`/teams/${state.teamId}/proposals/${proposalId}/vote`, {
      method: 'POST',
      body: JSON.stringify({ vote, comment: '' })
    });

    if (result.error) {
      if (result.error === 'queued') {
        info('Vote queued for sync when online');
      } else {
        error(`Failed to vote: ${result.message}`);
      }
      return;
    }

    success(`Vote recorded: ${vote} on proposal #${proposalId}`);

    if (result.status === 'approved') {
      success('Proposal approved and added to team knowledge!');
    } else if (result.status === 'rejected') {
      info('Proposal rejected');
    }
    return;
  }

  // List pending proposals
  const result = await apiRequest(`/teams/${state.teamId}/proposals?status=pending`);

  if (result.error) {
    error(`Failed to fetch proposals: ${result.message}`);
    return;
  }

  if (!result.proposals || result.proposals.length === 0) {
    info('No pending proposals.');
    return;
  }

  console.log('');
  console.log('Pending proposals:');
  console.log('');

  for (const p of result.proposals) {
    const votes = p.votes || [];
    const approvals = votes.filter(v => v.vote === 'approve').length;
    const rejections = votes.filter(v => v.vote === 'reject').length;

    console.log(`  #${p.id} | ${p.category}`);
    console.log(color('dim', '  ' + '─'.repeat(50)));
    console.log(`  Rule: "${p.rule}"`);
    if (p.rationale) {
      console.log(color('dim', `  Rationale: ${p.rationale}`));
    }
    console.log(`  Votes: ${approvals} approve, ${rejections} reject`);
    console.log('');
  }

  info('Vote with: ./scripts/flow team proposals vote <id> <approve|reject>');
}

/**
 * Generate invite code (admin only)
 */
async function invite(expiresInDays = 7) {
  printHeader('Generate Invite');

  const state = getTeamState();

  if (!state.loggedIn) {
    error('Not logged in to a team.');
    return;
  }

  const result = await apiRequest(`/teams/${state.teamId}/invites`, {
    method: 'POST',
    body: JSON.stringify({ expiresInDays: parseInt(expiresInDays) || 7 })
  });

  if (result.error) {
    if (result.error === 'forbidden') {
      error('Only team admins can generate invite codes.');
    } else {
      error(`Failed to generate invite: ${result.message}`);
    }
    return;
  }

  console.log('');
  console.log('Invite code generated:');
  console.log('');
  console.log(`  ${color('green', result.code)}`);
  console.log('');
  console.log(`Valid for: ${expiresInDays} days`);
  if (result.url) {
    console.log(`Join URL: ${result.url}`);
  }
  console.log('');
  info('Share this code with team members to join.');
}

/**
 * Show team status
 */
async function status() {
  printHeader('Team Status');

  const state = getTeamState();
  const config = getConfig();

  if (!state.loggedIn) {
    console.log('Status: ' + color('yellow', 'Not logged in'));
    console.log('');
    info('Join a team: ./scripts/flow team login <invite-code>');
    info('Learn more: https://wogi-flow.com/teams');
    return;
  }

  console.log('Status: ' + color('green', 'Logged in'));
  console.log('');
  console.log(`Team:      ${state.teamName || state.teamId}`);
  console.log(`Setup:     ${state.setupName || 'None selected'}`);
  console.log(`Last sync: ${state.lastSync || 'Never'}`);
  console.log('');

  // Check token status
  const expiresAt = state.tokenExpiresAt ? new Date(state.tokenExpiresAt) : null;
  if (expiresAt) {
    const now = new Date();
    if (expiresAt < now) {
      warn('Access token expired - will refresh on next request');
    } else {
      const hours = Math.round((expiresAt - now) / (1000 * 60 * 60));
      console.log(`Token:     Valid for ~${hours} hours`);
    }
  }
  console.log('');

  // Show offline queue status
  const queue = getOfflineQueue();
  if (queue.length > 0) {
    warn(`${queue.length} operation(s) queued for sync`);
  }

  // Show stats from database
  const stats = await memoryDb.getStats();
  console.log('Local stats:');
  console.log(`  Facts:     ${stats.facts.total}`);
  console.log(`  Proposals: ${stats.proposals.total} (${stats.proposals.pending} pending)`);
}

// ============================================================
// CLI
// ============================================================

function printUsage() {
  console.log(`
Wogi Flow - Team Collaboration

Usage: ./scripts/flow team <command> [args]

Commands:
  login <code>           Join team with invite code
  login <email> <pass>   Login with email and password
  logout                 Leave current team
  sync                   Sync knowledge with team
  proposals              List pending proposals
  proposals vote <id> <approve|reject>
                         Vote on a proposal
  invite [days]          Generate invite code (admin only)
  status                 Show team status

Examples:
  ./scripts/flow team login ABC123XY
  ./scripts/flow team login user@example.com mypassword
  ./scripts/flow team sync
  ./scripts/flow team proposals vote prop_abc123 approve
  ./scripts/flow team invite 14

Team features require a subscription at https://wogi-flow.com
`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'login':
      await login(args[1], args[2]);
      break;

    case 'logout':
      await logout();
      break;

    case 'sync':
      await sync();
      break;

    case 'proposals':
      await proposals(args[1], args[2], args[3]);
      break;

    case 'invite':
      await invite(args[1]);
      break;

    case 'status':
      await status();
      break;

    case '--help':
    case '-h':
    case 'help':
      printUsage();
      break;

    default:
      if (command) {
        error(`Unknown command: ${command}`);
      }
      printUsage();
      process.exit(command ? 1 : 0);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  getTeamState,
  saveTeamState,
  isTeamEnabled,
  login,
  logout,
  sync,
  proposals,
  invite,
  status,
  processOfflineQueue
};

if (require.main === module) {
  main().catch(e => {
    error(`Error: ${err.message}`);
    process.exit(1);
  });
}
