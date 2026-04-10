#!/usr/bin/env node

/**
 * Wogi Flow - Deploy Gate CLI
 *
 * Commands:
 *   flow deploy-gate init     — Interactive setup wizard
 *   flow deploy-gate status   — Show gate status and artifact info
 *   flow deploy-gate verify   — Check if a valid artifact exists
 *   flow deploy-gate routes   — Show route inventory
 *   flow deploy-gate add-route <path> — Manually add a route
 *   flow deploy-gate history  — Show deploy history
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PATHS, getConfig, safeJsonParse, writeJson } = require('./flow-utils');
const {
  isDeployGateEnabled,
  getDeployGateConfig,
  findLatestArtifact,
  getRouteInventory,
  addRoute,
  getLastGoodDeploy,
  DEPLOY_ROUTES_PATH,
  DEPLOY_HISTORY_PATH
} = require('./hooks/core/deploy-gate');

// ============================================================
// CLI Commands
// ============================================================

function cmdInit() {
  console.log('━━━ Deploy Gate Setup Wizard ━━━\n');

  // 1. Detect package.json scripts
  const pkgPath = path.join(PATHS.root, 'package.json');
  const pkg = safeJsonParse(pkgPath, {});
  const scripts = pkg.scripts || {};
  const deployScripts = [];

  for (const [name, cmd] of Object.entries(scripts)) {
    if (/deploy|publish|release|sync|push/i.test(name) || /deploy|s3.*sync|vercel|netlify|fly.*deploy/i.test(cmd)) {
      deployScripts.push({ name, cmd });
    }
  }

  if (deployScripts.length > 0) {
    console.log('Detected deploy-related scripts:');
    for (const s of deployScripts) {
      console.log(`  - npm run ${s.name}: ${s.cmd}`);
    }
  } else {
    console.log('No deploy scripts detected in package.json.');
  }

  // 2. Suggest common deploy command patterns
  const suggestedCommands = [];
  for (const s of deployScripts) {
    suggestedCommands.push(`npm run ${s.name}`);
    // Also extract the raw command for direct matching
    if (s.cmd) suggestedCommands.push(s.cmd.split('&&')[0].trim());
  }

  // Add common defaults if none detected
  if (suggestedCommands.length === 0) {
    suggestedCommands.push(
      'aws s3 sync',
      'vercel deploy',
      'netlify deploy',
      'fly deploy',
      'docker push'
    );
    console.log('\nSuggested common deploy patterns (add the ones your project uses):');
    for (const cmd of suggestedCommands) {
      console.log(`  - ${cmd}`);
    }
  }

  // 3. Detect framework
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  let framework = 'unknown';
  if (deps['next']) framework = 'nextjs';
  else if (deps['vite'] || deps['@vitejs/plugin-react']) framework = 'vite';
  else if (deps['@angular/core']) framework = 'angular';
  else if (deps['vue']) framework = 'vue';
  else if (deps['svelte']) framework = 'svelte';
  else if (deps['express'] || deps['fastify'] || deps['@nestjs/core']) framework = 'backend';

  console.log(`\nDetected framework: ${framework}`);

  // 4. Suggest verification method
  let verificationMethod = 'checklist';
  if (deps['playwright'] || deps['@playwright/test']) verificationMethod = 'playwright';
  if (framework === 'backend') verificationMethod = 'api-test';

  console.log(`Suggested verification method: ${verificationMethod}`);

  // 5. Generate initial route inventory from common patterns
  console.log('\nScanning for routes...');
  const routes = scanForRoutes(framework);
  if (routes.length > 0) {
    console.log(`Found ${routes.length} route(s):`);
    for (const r of routes) {
      console.log(`  - ${r}`);
      addRoute(r, 'init-wizard');
    }
  } else {
    console.log('No routes auto-detected. Add routes manually with: flow deploy-gate add-route <path>');
  }

  // 6. Write suggested config
  console.log('\n━━━ Suggested Configuration ━━━');
  console.log('Add to .workflow/config.json under "enforcement":\n');
  const suggestedConfig = {
    deployGate: {
      enabled: true,
      commands: suggestedCommands.slice(0, 5),
      sourcePatterns: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.vue', '**/*.svelte', '**/*.css'],
      requireForPriorities: ['P0', 'P1'],
      blockWriteToVerifications: true
    }
  };
  console.log(JSON.stringify(suggestedConfig, null, 2));

  console.log('\n━━━ Setup Complete ━━━');
  console.log('Next steps:');
  console.log('  1. Add the config above to .workflow/config.json');
  console.log('  2. Customize the commands list for your deploy workflow');
  console.log('  3. Run `flow deploy-gate status` to verify setup');
}

function cmdStatus() {
  const config = getConfig();
  const enabled = isDeployGateEnabled(config);
  const gateConfig = getDeployGateConfig(config);

  console.log('━━━ Deploy Gate Status ━━━\n');
  console.log(`Enabled: ${enabled ? '✓ YES' : '✗ NO'}`);

  if (!enabled) {
    console.log('\nRun `flow deploy-gate init` to set up the deploy gate.');
    return;
  }

  console.log(`Commands blocked: ${gateConfig.commands.length > 0 ? gateConfig.commands.join(', ') : '(none configured)'}`);
  console.log(`Require verification for: ${gateConfig.requireForPriorities.join(', ')}`);
  console.log(`Block Write to artifacts: ${gateConfig.blockWriteToVerifications}`);

  // Check for valid artifact
  const artifactResult = findLatestArtifact();
  console.log(`\nLatest artifact: ${artifactResult.found ? '✓ VALID' : '✗ ' + (artifactResult.reason || 'NOT FOUND')}`);
  if (artifactResult.found) {
    const a = artifactResult.artifact;
    console.log(`  Method: ${a.method}`);
    console.log(`  Task: ${a.taskId}`);
    console.log(`  Created: ${a.createdAt}`);
    console.log(`  Routes verified: ${(a.routes || []).length}`);
    console.log(`  Evidence tier: ${a.evidenceTier}`);
  }

  // Route inventory
  const inventory = getRouteInventory();
  console.log(`\nRoute inventory: ${inventory.routes.length} route(s)`);

  // Deploy history
  const lastDeploy = getLastGoodDeploy();
  if (lastDeploy.found) {
    console.log(`Last deploy: ${lastDeploy.deploy.commitHash.slice(0, 8)} (${lastDeploy.deploy.timestamp})`);
  } else {
    console.log('Last deploy: (no history)');
  }
}

function cmdVerify() {
  const artifactResult = findLatestArtifact();
  if (artifactResult.found) {
    console.log('✓ Valid verification artifact found');
    console.log(JSON.stringify(artifactResult.artifact, null, 2));
    process.exit(0);
  } else {
    console.log(`✗ No valid artifact: ${artifactResult.reason}`);
    process.exit(1);
  }
}

function cmdRoutes() {
  const inventory = getRouteInventory();
  console.log('━━━ Route Inventory ━━━\n');
  if (inventory.routes.length === 0) {
    console.log('No routes registered. Add with: flow deploy-gate add-route <path>');
    return;
  }
  for (const r of inventory.routes) {
    console.log(`  ${r.path} — added ${r.addedAt} (${r.source})`);
  }
  console.log(`\nTotal: ${inventory.routes.length} route(s)`);
}

function cmdAddRoute(routePath) {
  if (!routePath) {
    console.error('Usage: flow deploy-gate add-route <path>');
    process.exit(1);
  }
  const added = addRoute(routePath, 'manual');
  if (added) {
    console.log(`✓ Added route: ${routePath}`);
  } else {
    console.log(`Route already exists: ${routePath}`);
  }
}

function cmdHistory() {
  const history = safeJsonParse(DEPLOY_HISTORY_PATH, { deploys: [] });
  console.log('━━━ Deploy History ━━━\n');
  if (history.deploys.length === 0) {
    console.log('No deploy history recorded.');
    return;
  }
  for (const d of history.deploys.slice(0, 10)) {
    console.log(`  ${d.commitHash.slice(0, 8)} | ${d.timestamp} | ${d.environment}`);
  }
  console.log(`\nShowing ${Math.min(10, history.deploys.length)} of ${history.deploys.length} deploys`);
}

// ============================================================
// Route Scanning Helpers
// ============================================================

function scanForRoutes(framework) {
  const routes = [];
  const { execSync } = require('node:child_process');

  try {
    // Next.js: pages or app directory
    if (framework === 'nextjs') {
      const patterns = ['app/**/page.tsx', 'app/**/page.jsx', 'pages/**/*.tsx', 'pages/**/*.jsx', 'src/app/**/page.tsx'];
      for (const pattern of patterns) {
        try {
          const files = execSync(`git ls-files '${pattern}'`, { encoding: 'utf-8', cwd: PATHS.root }).trim();
          if (files) {
            for (const f of files.split('\n')) {
              const route = '/' + f.replace(/^(src\/)?(app|pages)\//, '').replace(/(page|index)\.(tsx|jsx)$/, '').replace(/\/$/, '') || '/';
              if (!routes.includes(route)) routes.push(route);
            }
          }
        } catch (_err) {
          // Pattern didn't match
        }
      }
    }

    // React Router / Vite: look for route definitions
    if (framework === 'vite' || framework === 'unknown') {
      try {
        const routeFiles = execSync("git ls-files | grep -iE '(router|routes|App)\\.(tsx|jsx|ts|js)$'", { encoding: 'utf-8', cwd: PATHS.root }).trim();
        if (routeFiles) {
          for (const f of routeFiles.split('\n')) {
            try {
              const content = fs.readFileSync(path.join(PATHS.root, f), 'utf-8');
              const pathMatches = content.matchAll(/path:\s*['"]([^'"]+)['"]/g);
              for (const m of pathMatches) {
                if (!routes.includes(m[1])) routes.push(m[1]);
              }
            } catch (_err) {
              // Skip unreadable files
            }
          }
        }
      } catch (_err) {
        // No route files found
      }
    }

    // Express/backend: look for route handlers
    if (framework === 'backend') {
      try {
        const apiFiles = execSync("git ls-files | grep -iE '(routes|controller|api).*\\.(ts|js)$'", { encoding: 'utf-8', cwd: PATHS.root }).trim();
        if (apiFiles) {
          for (const f of apiFiles.split('\n').slice(0, 20)) {
            try {
              const content = fs.readFileSync(path.join(PATHS.root, f), 'utf-8');
              const pathMatches = content.matchAll(/\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/gi);
              for (const m of pathMatches) {
                const route = `${m[1].toUpperCase()} ${m[2]}`;
                if (!routes.includes(route)) routes.push(route);
              }
            } catch (_err) {
              // Skip unreadable files
            }
          }
        }
      } catch (_err) {
        // No API files found
      }
    }
  } catch (_err) {
    // Scanning failed — non-critical
  }

  return routes;
}

// ============================================================
// CLI Entrypoint
// ============================================================

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'init':
    cmdInit();
    break;
  case 'status':
    cmdStatus();
    break;
  case 'verify':
    cmdVerify();
    break;
  case 'routes':
    cmdRoutes();
    break;
  case 'add-route':
    cmdAddRoute(args[1]);
    break;
  case 'history':
    cmdHistory();
    break;
  default:
    console.log('Usage: flow deploy-gate <init|status|verify|routes|add-route|history>');
    process.exit(1);
}
