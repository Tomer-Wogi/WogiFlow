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
const crypto = require('node:crypto');

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
      // The sub-agent should work within the repo directory
      // The orchestrator (workspace manager) will read results after completion
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
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const createdTasks = [];

  for (const step of plan.executionOrder) {
    if (step.executor === 'manager') continue; // Manager steps don't create repo tasks

    const memberConfig = config.members[step.executor];
    if (!memberConfig) continue;

    const memberPath = path.resolve(workspaceRoot, memberConfig.path);
    const readyPath = path.join(memberPath, '.workflow', 'state', 'ready.json');

    if (!fs.existsSync(readyPath)) continue;

    try {
      const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'));
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
  const phaseOrder = { library: 0, provider: 1, both: 1, consumer: 2, standalone: 3 };

  for (const name of targetRepos) {
    const member = manifest.members[name];
    if (!member) continue;
    order.push({
      name,
      role: member.role,
      phase: member.role,
      order: phaseOrder[member.role] ?? 3
    });
  }

  // Sort by phase order (library first, then provider, then consumer)
  order.sort((a, b) => a.order - b.order);

  return order;
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
  getExecutionOrder
};
