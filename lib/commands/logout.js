#!/usr/bin/env node
'use strict';

/**
 * flow logout — Disconnect from WogiFlow Teams.
 *
 * Usage: node lib/commands/logout.js
 *
 * Removes team connection config. All local state is preserved.
 */

const { getTeamConnection, removeTeamConnection, apiRequest } = require('../../scripts/flow-team-adapter');

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
  } catch (err) {
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
