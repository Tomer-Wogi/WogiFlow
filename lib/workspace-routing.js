#!/usr/bin/env node

/**
 * Wogi Workspace — Task Routing & Sub-Agent Delegation
 *
 * Story 3 (wf-824638e4): The manager agent's brain — analyzes tasks,
 * determines which repo(s) to target, determines ordering,
 * and generates sub-agent delegation instructions.
 */

const fs = require('node:fs');
const path = require('node:path');
const { safeReadJson, safeJsonParseContent } = require('./utils');
const crypto = require('node:crypto');
const http = require('node:http');

let _workspaceMessages;
function getWorkspaceMessages() {
  if (!_workspaceMessages) {
    _workspaceMessages = require('./workspace-messages');
  }
  return _workspaceMessages;
}

// Shared phase ordering — used by both getExecutionOrder() and dispatchCrossRepoPlan()
const PHASE_ORDER = { library: 0, contract: 0, provider: 1, both: 1, consumer: 2, standalone: 3, verify: 4 };

// ============================================================
// Routing Keywords (Criterion 1)
// ============================================================

const ROLE_KEYWORDS = {
  consumer: [
    'page', 'component', 'ui', 'style', 'css', 'layout', 'form', 'button',
    'modal', 'screen', 'view', 'frontend', 'client', 'browser', 'render',
    'hook', 'state', 'redux', 'zustand', 'store', 'theme', 'responsive',
    'animation', 'toast', 'notification-ui', 'sidebar', 'navbar', 'header'
  ],
  provider: [
    'endpoint', 'route', 'controller', 'model', 'database', 'migration',
    'schema', 'backend', 'server', 'api', 'query', 'mutation', 'resolver',
    'middleware', 'auth', 'jwt', 'session', 'seed', 'fixture', 'orm',
    'sql', 'table', 'index', 'relation', 'service-layer'
  ],
  library: [
    'shared', 'utility', 'types', 'common', 'helper', 'constant', 'enum',
    'interface', 'typedef', 'lib', 'package', 'module'
  ],
  crossRepo: [
    'api', 'contract', 'schema', 'integration', 'full-stack', 'end-to-end',
    'e2e', 'both', 'cross', 'sync', 'together'
  ]
};

// ============================================================
// Route Analysis (Criterion 1)
// ============================================================

/**
 * Analyze a task description and determine which repo(s) should handle it.
 *
 * @param {string} taskDescription — the user's task description
 * @param {Object} manifest — workspace-manifest.json content
 * @returns {Object} routing decision
 */
function analyzeTaskRouting(taskDescription, manifest) {
  if (!manifest?.members) {
    return {
      type: 'single-repo',
      target: null,
      scores: {},
      reason: 'No members in manifest'
    };
  }

  const desc = taskDescription.toLowerCase();
  const scores = {}; // memberName → score
  const crossRepoScore = scoreKeywords(desc, ROLE_KEYWORDS.crossRepo);

  for (const [name, member] of Object.entries(manifest.members)) {
    let score = 0;

    // Score based on role keywords
    const roleKeywords = ROLE_KEYWORDS[member.role] || [];
    score += scoreKeywords(desc, roleKeywords);

    // Score based on member name appearing in description
    if (desc.includes(name.toLowerCase())) score += 3;

    // Score based on specific endpoint mentions
    for (const ep of (member.provides || [])) {
      const epPath = ep.split(' ').slice(1).join(' ').toLowerCase();
      if (desc.includes(epPath)) score += 2;
    }
    for (const ep of (member.consumes || [])) {
      const epPath = ep.split(' ').slice(1).join(' ').toLowerCase();
      if (desc.includes(epPath)) score += 2;
    }

    scores[name] = score;
  }

  // Determine routing
  const sortedMembers = Object.entries(scores)
    .sort((a, b) => b[1] - a[1]);

  const topScore = sortedMembers[0]?.[1] || 0;
  const secondScore = sortedMembers[1]?.[1] || 0;

  // Cross-repo if:
  // 1. Cross-repo keywords are dominant
  // 2. Two repos score similarly (within 30%)
  // 3. No repo scored above threshold
  const isCrossRepo =
    crossRepoScore >= 2 ||
    (topScore > 0 && secondScore > 0 && secondScore >= topScore * 0.7) ||
    topScore === 0;

  if (isCrossRepo && Object.keys(manifest.members).length >= 2) {
    return {
      type: 'cross-repo',
      targets: sortedMembers.filter(([_, s]) => s > 0).map(([name]) => name),
      allMembers: Object.keys(manifest.members),
      scores,
      crossRepoScore,
      reason: crossRepoScore >= 2
        ? 'Cross-repo keywords detected'
        : topScore === 0
          ? 'No clear repo match — routing to all'
          : 'Multiple repos score similarly'
    };
  }

  return {
    type: 'single-repo',
    target: sortedMembers[0]?.[0] || Object.keys(manifest.members)[0],
    scores,
    reason: `Best match: ${sortedMembers[0]?.[0]} (score: ${topScore})`
  };
}

function scoreKeywords(text, keywords) {
  let score = 0;
  for (const kw of keywords) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp('\\b' + escaped + '\\b', 'i').test(text)) score++;
  }
  return score;
}

// ============================================================
// Single-Repo Delegation (Criterion 2)
// ============================================================

/**
 * Generate a sub-agent delegation prompt for a single repo.
 *
 * @param {string} workspaceRoot
 * @param {string} repoName
 * @param {string} task — task description
 * @param {Object} manifest
 * @returns {Object} delegation instruction
 */
function generateSingleRepoDelegation(workspaceRoot, repoName, task, manifest) {
  const member = manifest.members[repoName];
  if (!member) throw new Error(`Unknown repo: ${repoName}`);

  const memberPath = member.path || `./${repoName}`;
  const repoPath = path.resolve(workspaceRoot, memberPath);
  const decisionsPath = path.join(repoPath, '.workflow', 'state', 'decisions.md');

  // Read repo's decisions for context injection
  let decisions = '';
  try {
    if (fs.existsSync(decisionsPath)) {
      decisions = fs.readFileSync(decisionsPath, 'utf-8').slice(0, 3000);
    }
  } catch (_err) {
    // Non-critical
  }

  // Get unread messages for this repo
  let messages = [];
  try {
    const { getUnreadMessages } = require('./workspace-messages');
    messages = getUnreadMessages(workspaceRoot, repoName);
  } catch (_err) {
    // Non-critical
  }

  const messageContext = messages.length > 0
    ? `\n\nUnread messages for your repo:\n${messages.map(m => `- [${m.type}] from ${m.from}: ${m.subject}`).join('\n')}`
    : '';

  // Read relevant contracts
  let contractContext = '';
  try {
    const contractsDir = path.join(workspaceRoot, '.workspace', 'contracts');
    if (fs.existsSync(contractsDir)) {
      const files = fs.readdirSync(contractsDir).filter(f => f.endsWith('.json') || f.endsWith('.yaml'));
      if (files.length > 0) {
        contractContext = '\n\nShared contracts available in .workspace/contracts/: ' + files.join(', ');
      }
    }
  } catch (_err) {
    // Non-critical
  }

  return {
    repoName,
    repoPath: member.path,
    prompt: `You are working in the ${repoName} repo (${member.stack?.language || 'unknown'}/${member.stack?.framework || 'unknown'}).

Task: ${task}

Your repo's role: ${member.role}
${decisions ? `\nProject rules (from decisions.md):\n${decisions}` : ''}${messageContext}${contractContext}

After completing the task:
1. Commit your changes
2. If your changes affect the API contract (endpoints, request/response shapes), write a message to .workspace/messages/ notifying other repos`,

    agentConfig: {
      description: `${repoName}: ${task.substring(0, 50)}...`,
      // Named subagent (2.1.88+): shows in @ mention typeahead as @repoName
      name: repoName,
      // Propagate reasoning effort from manager to worker
      ...(process.env.WOGI_EFFORT_LEVEL && { model_options: { effort: process.env.WOGI_EFFORT_LEVEL } })
    }
  };
}

// ============================================================
// Cross-Repo Delegation (Criterion 3)
// ============================================================

/**
 * Generate a cross-repo execution plan.
 * Order: contract update → provider(s) → consumer(s) → integration verify
 *
 * @param {string} workspaceRoot
 * @param {string} task
 * @param {Object} manifest
 * @param {Object} routing — from analyzeTaskRouting()
 * @returns {Object} execution plan with ordered steps
 */
function generateCrossRepoPlan(workspaceRoot, task, manifest, routing) {
  const steps = [];
  const members = manifest.members;

  // Step 1: Contract update (if API changes are involved)
  const apiKeywords = ['endpoint', 'api', 'route', 'schema', 'contract'];
  const needsContractUpdate = apiKeywords.some(kw => task.toLowerCase().includes(kw));

  if (needsContractUpdate) {
    steps.push({
      phase: 'contract',
      action: 'Update shared contract in .workspace/contracts/',
      executor: 'manager',
      description: 'Define the API contract before implementation'
    });
  }

  // Step 2: Provider repos first (they create the API)
  const providers = Object.entries(members)
    .filter(([_, m]) => m.role === 'provider' || m.role === 'both')
    .filter(([name]) => routing.targets?.includes(name) || routing.allMembers?.includes(name));

  for (const [name] of providers) {
    steps.push({
      phase: 'provider',
      action: `Implement provider-side changes in ${name}/`,
      executor: name,
      description: `${name} implements the API/backend side`,
      delegation: generateSingleRepoDelegation(workspaceRoot, name, task, manifest)
    });
  }

  // Step 3: Consumer repos (they use the API)
  const consumers = Object.entries(members)
    .filter(([_, m]) => m.role === 'consumer' || m.role === 'both')
    .filter(([name]) => routing.targets?.includes(name) || routing.allMembers?.includes(name))
    .filter(([name]) => !providers.some(([pName]) => pName === name)); // Skip if already in providers

  for (const [name] of consumers) {
    steps.push({
      phase: 'consumer',
      action: `Implement consumer-side changes in ${name}/`,
      executor: name,
      description: `${name} implements the frontend/client side`,
      delegation: generateSingleRepoDelegation(workspaceRoot, name, task, manifest)
    });
  }

  // Step 4: Library repos (if affected)
  const libraries = Object.entries(members)
    .filter(([_, m]) => m.role === 'library')
    .filter(([name]) => routing.targets?.includes(name));

  for (const [name] of libraries) {
    // Libraries go first (before providers and consumers)
    steps.unshift({
      phase: 'library',
      action: `Update shared library ${name}/`,
      executor: name,
      description: `${name} updates shared types/utilities`,
      delegation: generateSingleRepoDelegation(workspaceRoot, name, task, manifest)
    });
  }

  // Step 5: Integration verification
  steps.push({
    phase: 'verify',
    action: 'Verify cross-repo integration',
    executor: 'manager',
    description: 'Check that provider and consumer sides work together'
  });

  return {
    task,
    type: 'cross-repo',
    totalSteps: steps.length,
    executionOrder: steps,
    providers: providers.map(([n]) => n),
    consumers: consumers.map(([n]) => n),
    libraries: libraries.map(([n]) => n)
  };
}

// ============================================================
// Parallel Investigation (Criterion 4)
// ============================================================

/**
 * Generate parallel investigation instructions for bug reports.
 * Spawns one investigator per potentially affected repo.
 *
 * @param {string} workspaceRoot
 * @param {string} bugDescription
 * @param {Object} manifest
 * @returns {Object} investigation plan
 */
function generateParallelInvestigation(workspaceRoot, bugDescription, manifest) {
  const investigators = [];

  for (const [name, member] of Object.entries(manifest.members)) {
    const repoPath = path.resolve(workspaceRoot, member.path);

    investigators.push({
      repoName: name,
      repoPath: member.path,
      role: member.role,
      prompt: `You are investigating a bug in the ${name} repo (${member.role}).

Bug report: ${bugDescription}

Your job:
1. Check if the issue originates from YOUR repo
2. Check recent changes (git log) that might have caused this
3. Check relevant API endpoints, components, or services
4. Report your findings clearly:
   - Is the issue on YOUR side? (yes/no/maybe)
   - What did you find?
   - If yes: what's the fix?
   - If no: what should the OTHER repo(s) check?

Be specific about file names, line numbers, and error messages.`,
      agentConfig: {
        description: `Investigate: ${name} — ${bugDescription.substring(0, 40)}...`,
        name: `${name}-investigator`,
        model: 'sonnet' // Use cheaper model for investigation
      }
    });
  }

  return {
    type: 'parallel-investigation',
    bugDescription,
    investigators,
    synthesisPrompt: `Multiple investigators checked their repos. Synthesize their findings:
- Which repo is the root cause?
- What's the fix?
- Are there improvements needed in other repos?
- Create tasks in the appropriate repo(s) ready.json`
  };
}

// ============================================================
// Task Decomposition (Criterion 5)
// ============================================================

/**
 * Decompose a workspace-level task into repo-level tasks.
 * Creates entries in each affected repo's ready.json.
 *
 * @param {string} workspaceRoot
 * @param {Object} workspaceTask — { title, description, criteria }
 * @param {Object} plan — from generateCrossRepoPlan()
 * @returns {Array<Object>} created repo-level tasks
 */
function decomposeToRepoTasks(workspaceRoot, workspaceTask, plan) {
  const configPath = path.join(workspaceRoot, 'wogi-workspace.json');
  const config = safeReadJson(configPath);
  if (!config || typeof config !== 'object') return [];
  const createdTasks = [];

  for (const step of plan.executionOrder) {
    if (step.executor === 'manager') continue; // Manager steps don't create repo tasks

    const memberConfig = config.members[step.executor];
    if (!memberConfig) continue;

    const memberPath = path.resolve(workspaceRoot, memberConfig.path);
    const readyPath = path.join(memberPath, '.workflow', 'state', 'ready.json');

    if (!fs.existsSync(readyPath)) continue;

    try {
      const ready = safeReadJson(readyPath);
      const taskId = 'wf-' + crypto.randomBytes(4).toString('hex');

      const repoTask = {
        id: taskId,
        title: `[Workspace] ${workspaceTask.title} — ${step.executor} (${step.phase})`,
        type: workspaceTask.type || 'feature',
        level: 'L2',
        priority: 'P0',
        source: `workspace:${workspaceTask.id || 'direct'}`,
        status: 'ready',
        description: step.description + '\n\n' + (workspaceTask.description || ''),
        createdAt: new Date().toISOString()
      };

      if (!ready.ready) ready.ready = [];
      ready.ready.push(repoTask);
      ready.lastUpdated = new Date().toISOString();
      fs.writeFileSync(readyPath, JSON.stringify(ready, null, 2));

      createdTasks.push({ repo: step.executor, phase: step.phase, task: repoTask });
    } catch (_err) {
      // Non-critical — log and continue
    }
  }

  return createdTasks;
}

// ============================================================
// Dependency-Aware Ordering (Criterion 6)
// ============================================================

/**
 * Determine execution order respecting dependencies:
 * library → provider → consumer
 *
 * @param {Object} manifest
 * @param {string[]} targetRepos — repos involved in the task
 * @returns {Array<{ name: string, phase: string, order: number }>}
 */
function getExecutionOrder(manifest, targetRepos) {
  const order = [];

  for (const name of targetRepos) {
    const member = manifest.members[name];
    if (!member) continue;
    order.push({
      name,
      role: member.role,
      phase: member.role,
      order: PHASE_ORDER[member.role] ?? 3
    });
  }

  // Sort by phase order (library first, then provider, then consumer)
  order.sort((a, b) => a.order - b.order);

  return order;
}

// ============================================================
// Cross-Repo Dependency-Aware Task Blocking
// ============================================================

/**
 * Block consumer-side tasks until their provider dependencies are complete.
 * Reads workspace-level ready.json and each member's ready.json to find
 * cross-repo dependencies.
 *
 * @param {string} workspaceRoot
 * @param {Object} manifest
 * @returns {{ blockedTasks: Array<Object>, unblockedTasks: Array<Object> }}
 */
function updateCrossRepoBlocking(workspaceRoot, manifest) {
  const configPath = path.join(workspaceRoot, 'wogi-workspace.json');
  let config;
  try {
    config = safeReadJson(configPath);
  } catch (_err) {
    return { blockedTasks: [], unblockedTasks: [] };
  }

  const blockedTasks = [];
  const unblockedTasks = [];
  const memberTasks = {};

  // Collect all tasks from all member repos
  for (const [name, memberConfig] of Object.entries(config.members || {})) {
    const memberPath = path.resolve(workspaceRoot, memberConfig.path);
    const readyPath = path.join(memberPath, '.workflow', 'state', 'ready.json');
    try {
      if (fs.existsSync(readyPath)) {
        const ready = safeReadJson(readyPath);
        memberTasks[name] = {
          path: memberPath,
          readyPath,
          ready,
          inProgress: ready.inProgress || [],
          readyItems: ready.ready || [],
          completed: ready.recentlyCompleted || []
        };
      }
    } catch (_err) {
      // Skip
    }
  }

  // For each member's ready tasks, check if they depend on workspace tasks
  const executionOrder = getExecutionOrder(manifest, Object.keys(config.members));

  for (const [name, data] of Object.entries(memberTasks)) {
    const memberPhase = executionOrder.find(o => o.name === name);
    if (!memberPhase) continue;

    for (const task of data.readyItems) {
      // Check if this task has workspace source and blockedBy
      if (!task.source?.startsWith('workspace:')) continue;

      const blockedBy = task.blockedBy || [];
      let isBlocked = false;

      for (const depId of blockedBy) {
        // Check if the blocking task is completed in any member
        let depCompleted = false;
        for (const [depName, depData] of Object.entries(memberTasks)) {
          if (depData.completed.some(t => t.id === depId)) {
            depCompleted = true;
            break;
          }
        }

        if (!depCompleted) {
          isBlocked = true;
          break;
        }
      }

      if (isBlocked) {
        blockedTasks.push({ repo: name, task, blockedBy });
      } else if (blockedBy.length > 0) {
        unblockedTasks.push({ repo: name, task });
      }
    }
  }

  return { blockedTasks, unblockedTasks };
}

/**
 * Build a visual dependency tree for workspace tasks.
 *
 * @param {string} workspaceRoot
 * @param {Object} manifest
 * @returns {string} formatted tree
 */
function formatDependencyTree(workspaceRoot, manifest) {
  const configPath = path.join(workspaceRoot, 'wogi-workspace.json');
  let config;
  try {
    config = safeReadJson(configPath);
  } catch (_err) {
    return 'No workspace config found.';
  }

  const lines = ['Workspace Task Dependencies:'];
  const order = getExecutionOrder(manifest, Object.keys(config.members || {}));

  for (const entry of order) {
    const memberConfig = config.members[entry.name];
    if (!memberConfig) continue;

    const memberPath = path.resolve(workspaceRoot, memberConfig.path);
    const readyPath = path.join(memberPath, '.workflow', 'state', 'ready.json');

    try {
      if (!fs.existsSync(readyPath)) continue;
      const ready = safeReadJson(readyPath);
      const wsTasks = [...(ready.inProgress || []), ...(ready.ready || []), ...(ready.blocked || [])]
        .filter(t => t.source?.startsWith('workspace:'));

      if (wsTasks.length === 0) continue;

      lines.push(`\n  ${entry.name} (${entry.role}, phase ${entry.order}):`);
      for (const task of wsTasks) {
        const status = task.status === 'completed' ? '\u2713' :
          (ready.inProgress || []).some(t => t.id === task.id) ? '\u25B6' :
            task.blockedBy?.length ? '\u2718' : '\u25CB';
        const blockedNote = task.blockedBy?.length
          ? ` [blocked by: ${task.blockedBy.join(', ')}]`
          : '';
        lines.push(`    ${status} ${task.id} — ${task.title}${blockedNote}`);
      }
    } catch (_err) {
      // Skip
    }
  }

  return lines.join('\n');
}

// ============================================================
// Channel-Based Dispatch (wf-d4b98f60)
// ============================================================

/**
 * Send an HTTP POST to a worker's channel server.
 *
 * @param {string} host — hostname (default '127.0.0.1')
 * @param {number} port — worker's channel port
 * @param {string} message — message body to send
 * @param {Object} [opts] — options
 * @param {string} [opts.from] — sender identifier
 * @param {number} [opts.timeout] — request timeout in ms (default 5000)
 * @returns {Promise<{ ok: boolean, status: number, body: string }>}
 */
function httpPost(host, port, message, opts = {}) {
  const timeout = opts.timeout ?? 5000;
  const from = opts.from ?? 'workspace-manager';
  const buf = Buffer.from(message, 'utf-8');

  return new Promise((resolve) => {
    const req = http.request({
      hostname: host,
      port,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'Content-Length': buf.byteLength,
        'X-Wogi-From': from
      },
      timeout
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ ok: res.statusCode === 200, status: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') }));
    });

    req.on('error', (err) => resolve({ ok: false, status: 0, body: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, body: 'timeout' }); });
    req.write(buf);
    req.end();
  });
}

/**
 * Check if a worker's channel server is running.
 *
 * @param {number} port
 * @returns {Promise<{ up: boolean, repo: string }>}
 */
function checkWorkerHealth(port) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/health',
      method: 'GET',
      timeout: 3000
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        const data = safeJsonParseContent(body);
        if (data) resolve({ up: data.status === 'ok', repo: data.repo || 'unknown' });
        else resolve({ up: false, repo: 'unknown' });
      });
    });

    req.on('error', () => resolve({ up: false, repo: 'unknown' }));
    req.on('timeout', () => { req.destroy(); resolve({ up: false, repo: 'unknown' }); });
    req.end();
  });
}

/**
 * Dispatch a task to a single worker via its channel.
 *
 * @param {string} workspaceRoot
 * @param {string} repoName — target repo
 * @param {string} taskId — task ID to start
 * @param {Object} [opts] — dispatch options
 * @param {string} [opts.effortLevel] — reasoning effort to propagate ('low'|'medium'|'high')
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
async function dispatchToChannel(workspaceRoot, repoName, taskId, opts = {}) {
  // Validate taskId format to prevent injection into channel body
  if (!/^wf-[0-9a-f]{8}$/i.test(taskId)) {
    return { ok: false, message: `Invalid task ID format: "${taskId}" — expected wf-XXXXXXXX` };
  }

  const configPath = path.join(workspaceRoot, 'wogi-workspace.json');
  const config = safeReadJson(configPath);
  if (!config || typeof config !== 'object') {
    return { ok: false, message: `Cannot read workspace config at ${configPath}` };
  }

  const channelConfig = config.channels?.members?.[repoName];
  if (!channelConfig) {
    return { ok: false, message: `No channel config for repo "${repoName}"` };
  }

  const port = channelConfig.port;

  // Health check first
  const health = await checkWorkerHealth(port);
  if (!health.up) {
    return {
      ok: false,
      message: `Worker "${repoName}" is not running on port ${port}. Start it with: cd ${repoName}/ && flow workspace start`
    };
  }

  // Dispatch the task with effort level propagation
  // When the manager uses ultrathink/high effort, workers should too
  const VALID_EFFORTS = new Set(['low', 'medium', 'high']);
  const rawEffort = opts.effortLevel || process.env.WOGI_EFFORT_LEVEL || '';
  const effortLevel = VALID_EFFORTS.has(rawEffort) ? rawEffort : '';
  const effortPrefix = effortLevel ? `[effort:${effortLevel}] ` : '';
  const dispatchBody = `${effortPrefix}/wogi-start ${taskId}`;
  const result = await httpPost('127.0.0.1', port, dispatchBody);
  if (result.ok) {
    return { ok: true, message: `Dispatched /wogi-start ${taskId} to ${repoName} (port ${port})${effortLevel ? ` [effort: ${effortLevel}]` : ''}` };
  }

  return { ok: false, message: `Dispatch failed: HTTP ${result.status} — ${result.body}` };
}

/**
 * Dispatch a cross-repo execution plan to workers.
 * Respects phase ordering: library → provider → consumer.
 * Within a phase, dispatches in parallel. Between phases, waits for completion.
 *
 * @param {string} workspaceRoot
 * @param {Array} createdTasks — from decomposeToRepoTasks()
 * @param {Object} [opts]
 * @param {boolean} [opts.parallel] — dispatch all at once ignoring phases (default false)
 * @returns {Promise<{ dispatched: Array, failed: Array }>}
 */
async function dispatchCrossRepoPlan(workspaceRoot, createdTasks, opts = {}) {
  const dispatched = [];
  const failed = [];

  if (opts.parallel) {
    // Dispatch all tasks at once
    const results = await Promise.all(
      createdTasks.map(ct =>
        dispatchToChannel(workspaceRoot, ct.repo, ct.task.id)
          .then(r => ({ ...r, repo: ct.repo, taskId: ct.task.id, phase: ct.phase }))
      )
    );
    for (const r of results) {
      (r.ok ? dispatched : failed).push(r);
    }
  } else {
    // Group by phase order: library(0) → provider(1) → consumer(2) → standalone(3)
    const grouped = {};
    for (const ct of createdTasks) {
      const order = PHASE_ORDER[ct.phase] ?? 3;
      if (!grouped[order]) grouped[order] = [];
      grouped[order].push(ct);
    }

    // Execute phases in order
    const sortedPhases = Object.keys(grouped).map(Number).sort((a, b) => a - b);
    for (const phase of sortedPhases) {
      const tasks = grouped[phase];
      const results = await Promise.all(
        tasks.map(ct =>
          dispatchToChannel(workspaceRoot, ct.repo, ct.task.id)
            .then(r => ({ ...r, repo: ct.repo, taskId: ct.task.id, phase: ct.phase }))
        )
      );
      for (const r of results) {
        (r.ok ? dispatched : failed).push(r);
      }

      // Wait for this phase to complete before starting the next
      const phaseTaskIds = results.filter(r => r.ok).map(r => r.taskId);
      if (phaseTaskIds.length > 0 && phase !== sortedPhases[sortedPhases.length - 1]) {
        const completion = await waitForCompletion(workspaceRoot, phaseTaskIds, {
          timeoutMs: opts.phaseTimeoutMs ?? 15 * 60 * 1000 // 15 min per phase
        });
        if (completion.timedOut) {
          // Abort further phases — provider didn't finish
          failed.push({ ok: false, message: `Phase timed out waiting for: ${completion.pending.join(', ')}`, phase });
          break;
        }
      }
    }
  }

  return { dispatched, failed };
}

// ============================================================
// Completion Monitoring (wf-d4b98f60)
// ============================================================

/**
 * Wait for workspace tasks to complete by polling the message bus.
 *
 * @param {string} workspaceRoot
 * @param {string[]} taskIds — task IDs to wait for
 * @param {Object} [opts]
 * @param {number} [opts.pollIntervalMs] — poll interval (default 5000)
 * @param {number} [opts.timeoutMs] — max wait time (default 1800000 = 30min)
 * @returns {Promise<{ completed: string[], pending: string[], timedOut: boolean }>}
 */
async function waitForCompletion(workspaceRoot, taskIds, opts = {}) {
  const pollInterval = opts.pollIntervalMs ?? 5000;
  const timeout = opts.timeoutMs ?? 30 * 60 * 1000;
  const startTime = Date.now();
  const startIso = new Date(startTime).toISOString();
  const completed = new Set();
  const taskIdSet = new Set(taskIds);

  let readMessages, updateMessageStatus;
  try {
    const bus = getWorkspaceMessages();
    readMessages = bus.readMessages;
    updateMessageStatus = bus.updateMessageStatus;
  } catch (_err) {
    return { completed: [], pending: [...taskIds], timedOut: false, error: 'Cannot load workspace-messages module' };
  }

  while (completed.size < taskIds.length) {
    if (Date.now() - startTime > timeout) {
      return {
        completed: [...completed],
        pending: taskIds.filter(id => !completed.has(id)),
        timedOut: true
      };
    }

    // Read task-complete messages created AFTER we started waiting
    try {
      const messages = readMessages(workspaceRoot, { type: 'task-complete', status: 'pending' });
      for (const msg of messages) {
        // Only consider messages created after we started waiting
        if (msg.timestamp && msg.timestamp < startIso) continue;

        // Exact match on structured taskId field, or fallback to subject
        const msgTaskId = msg.taskId || msg.subject;
        if (msgTaskId && taskIdSet.has(msgTaskId) && !completed.has(msgTaskId)) {
          completed.add(msgTaskId);
          // Mark message as acknowledged so it's not re-processed
          try {
            if (updateMessageStatus) {
              updateMessageStatus(workspaceRoot, msg.id, 'acknowledged');
            }
          } catch (_err) {
            // Non-critical
          }
        }
      }
    } catch (_err) {
      // Non-critical — retry on next poll
    }

    if (completed.size < taskIds.length) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }

  return {
    completed: [...completed],
    pending: [],
    timedOut: false
  };
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Routing
  analyzeTaskRouting,
  ROLE_KEYWORDS,

  // Delegation
  generateSingleRepoDelegation,
  generateCrossRepoPlan,

  // Investigation
  generateParallelInvestigation,

  // Decomposition
  decomposeToRepoTasks,

  // Ordering
  getExecutionOrder,

  // Cross-repo blocking
  updateCrossRepoBlocking,
  formatDependencyTree,

  // Channel dispatch
  dispatchToChannel,
  dispatchCrossRepoPlan,
  checkWorkerHealth,

  // Completion monitoring
  waitForCompletion
};
