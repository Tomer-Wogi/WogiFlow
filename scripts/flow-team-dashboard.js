#!/usr/bin/env node

/**
 * Wogi Flow - Team Observability Dashboard
 *
 * Local web dashboard for viewing task progress, execution history,
 * and team-wide metrics.
 *
 * Part of Phase 6: Team & Integrations
 *
 * Usage:
 *   flow team dashboard           # Start dashboard on port 3850
 *   flow team dashboard --port 8080  # Custom port
 *   flow team dashboard --open    # Auto-open in browser
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
  PROJECT_ROOT,
  STATE_DIR,
  parseFlags,
  color,
  info,
  warn,
  error,
  fileExists,
  safeJsonParse,
  getConfig
} = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

const DEFAULT_PORT = 3850;
const READY_PATH = path.join(STATE_DIR, 'ready.json');
const REQUEST_LOG_PATH = path.join(STATE_DIR, 'request-log.md');
const PROGRESS_PATH = path.join(STATE_DIR, 'progress.md');
const RUN_HISTORY_PATH = path.join(STATE_DIR, 'run-history.json');
const TEAM_STATE_PATH = path.join(STATE_DIR, 'team-state.json');

// ============================================================
// Data Loaders
// ============================================================

/**
 * Load ready.json for task status
 */
function loadTaskStatus() {
  const data = safeJsonParse(READY_PATH);
  if (!data) {
    return {
      ready: [],
      inProgress: [],
      blocked: [],
      recentlyCompleted: []
    };
  }
  return data;
}

/**
 * Load run history for execution tracking
 */
function loadRunHistory() {
  const data = safeJsonParse(RUN_HISTORY_PATH);
  if (!data) {
    return { runs: [] };
  }
  return data;
}

/**
 * Load team state
 */
function loadTeamState() {
  const data = safeJsonParse(TEAM_STATE_PATH);
  if (!data) {
    return { loggedIn: false };
  }
  return data;
}

/**
 * Parse request-log.md for recent activity
 */
function parseRequestLog() {
  if (!fileExists(REQUEST_LOG_PATH)) {
    return [];
  }

  try {
    const content = fs.readFileSync(REQUEST_LOG_PATH, 'utf-8');
    const entries = [];
    const entryPattern = /### R-(\d+)\s*\|\s*(.+?)\n\*\*Type\*\*:\s*(.+?)\n\*\*Tags\*\*:\s*(.+?)\n\*\*Request\*\*:\s*"(.+?)"\n\*\*Result\*\*:\s*(.+?)\n\*\*Files\*\*:\s*(.+?)(?=\n###|\n$)/gs;

    let match;
    while ((match = entryPattern.exec(content)) !== null) {
      entries.push({
        id: `R-${match[1]}`,
        timestamp: match[2].trim(),
        type: match[3].trim(),
        tags: match[4].trim().split(/\s+/).filter(t => t.startsWith('#')),
        request: match[5].trim(),
        result: match[6].trim(),
        files: match[7].trim()
      });
    }

    return entries.slice(-50); // Last 50 entries
  } catch (e) {
    return [];
  }
}

/**
 * Get project statistics
 */
function getProjectStats() {
  const tasks = loadTaskStatus();
  const runHistory = loadRunHistory();
  const config = getConfig();

  const totalCompleted = tasks.recentlyCompleted?.length || 0;
  const totalRuns = runHistory.runs?.length || 0;
  const successfulRuns = runHistory.runs?.filter(r => r.status === 'success').length || 0;

  return {
    tasksReady: tasks.ready?.length || 0,
    tasksInProgress: tasks.inProgress?.length || 0,
    tasksBlocked: tasks.blocked?.length || 0,
    tasksCompleted: totalCompleted,
    totalRuns,
    successRate: totalRuns > 0 ? ((successfulRuns / totalRuns) * 100).toFixed(1) : 0,
    projectName: config?.projectName || path.basename(PROJECT_ROOT),
    lastUpdated: tasks.lastUpdated || new Date().toISOString()
  };
}

/**
 * Get git branch and recent commits
 */
function getGitInfo() {
  try {
    const branch = execSync('git branch --show-current', { encoding: 'utf-8', cwd: PROJECT_ROOT }).trim();
    const commits = execSync('git log --oneline -10', { encoding: 'utf-8', cwd: PROJECT_ROOT })
      .trim()
      .split('\n')
      .map(line => {
        const [hash, ...msgParts] = line.split(' ');
        return { hash, message: msgParts.join(' ') };
      });

    return { branch, commits };
  } catch (e) {
    return { branch: 'unknown', commits: [] };
  }
}

// ============================================================
// Dashboard HTML
// ============================================================

function getDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Wogi Flow Dashboard</title>
  <style>
    :root {
      --bg-primary: #0d1117;
      --bg-secondary: #161b22;
      --bg-tertiary: #21262d;
      --text-primary: #c9d1d9;
      --text-secondary: #8b949e;
      --border: #30363d;
      --accent-green: #3fb950;
      --accent-yellow: #d29922;
      --accent-red: #f85149;
      --accent-blue: #58a6ff;
      --accent-purple: #a371f7;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.5;
    }
    .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 0;
      border-bottom: 1px solid var(--border);
      margin-bottom: 24px;
    }
    h1 { font-size: 24px; font-weight: 600; }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
    }
    .badge-success { background: rgba(63, 185, 80, 0.2); color: var(--accent-green); }
    .badge-warning { background: rgba(210, 153, 34, 0.2); color: var(--accent-yellow); }
    .badge-danger { background: rgba(248, 81, 73, 0.2); color: var(--accent-red); }
    .badge-info { background: rgba(88, 166, 255, 0.2); color: var(--accent-blue); }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }
    .stat-card h3 {
      font-size: 12px;
      text-transform: uppercase;
      color: var(--text-secondary);
      margin-bottom: 8px;
    }
    .stat-card .value {
      font-size: 32px;
      font-weight: 600;
    }
    .stat-card .subtext {
      font-size: 12px;
      color: var(--text-secondary);
      margin-top: 4px;
    }

    .section {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 24px;
    }
    .section-header {
      padding: 16px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .section-header h2 {
      font-size: 16px;
      font-weight: 600;
    }
    .section-content { padding: 16px; }

    .task-list { list-style: none; }
    .task-item {
      display: flex;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid var(--border);
    }
    .task-item:last-child { border-bottom: none; }
    .task-status {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      margin-right: 12px;
    }
    .task-status.ready { background: var(--accent-blue); }
    .task-status.in-progress { background: var(--accent-yellow); }
    .task-status.blocked { background: var(--accent-red); }
    .task-status.completed { background: var(--accent-green); }
    .task-info { flex: 1; }
    .task-title { font-weight: 500; }
    .task-meta { font-size: 12px; color: var(--text-secondary); }

    .log-entry {
      padding: 12px;
      border-bottom: 1px solid var(--border);
      font-size: 14px;
    }
    .log-entry:last-child { border-bottom: none; }
    .log-entry:hover { background: var(--bg-tertiary); }
    .log-id { color: var(--accent-purple); font-weight: 500; }
    .log-time { color: var(--text-secondary); font-size: 12px; }
    .log-request { margin-top: 4px; }
    .log-tags { margin-top: 4px; }
    .log-tags .tag {
      display: inline-block;
      padding: 2px 8px;
      background: var(--bg-tertiary);
      border-radius: 4px;
      font-size: 11px;
      margin-right: 4px;
    }

    .git-info {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .branch-name {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--accent-purple);
    }
    .commit-list {
      max-height: 300px;
      overflow-y: auto;
    }
    .commit-item {
      padding: 8px 0;
      border-bottom: 1px solid var(--border);
      font-size: 13px;
    }
    .commit-hash {
      color: var(--accent-blue);
      font-family: monospace;
    }

    .refresh-btn {
      background: var(--bg-tertiary);
      border: 1px solid var(--border);
      color: var(--text-primary);
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
    }
    .refresh-btn:hover { background: var(--border); }

    .two-col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
    }
    @media (max-width: 900px) {
      .two-col { grid-template-columns: 1fr; }
    }

    .empty-state {
      text-align: center;
      padding: 40px;
      color: var(--text-secondary);
    }

    #loading {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: var(--accent-blue);
      display: none;
    }
    #loading.active { display: block; animation: loading 1s infinite; }
    @keyframes loading {
      0% { transform: scaleX(0); transform-origin: left; }
      50% { transform: scaleX(1); transform-origin: left; }
      51% { transform-origin: right; }
      100% { transform: scaleX(0); transform-origin: right; }
    }
  </style>
</head>
<body>
  <div id="loading"></div>
  <div class="container">
    <header>
      <div>
        <h1>Wogi Flow Dashboard</h1>
        <div id="project-name" style="color: var(--text-secondary); font-size: 14px;"></div>
      </div>
      <div style="display: flex; align-items: center; gap: 16px;">
        <div class="git-info">
          <span class="branch-name" id="branch-name"></span>
        </div>
        <button class="refresh-btn" onclick="loadData()">Refresh</button>
      </div>
    </header>

    <div class="stats-grid" id="stats-grid"></div>

    <div class="two-col">
      <div class="section">
        <div class="section-header">
          <h2>Tasks</h2>
          <span id="task-count" class="badge badge-info"></span>
        </div>
        <div class="section-content">
          <ul class="task-list" id="task-list"></ul>
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <h2>Recent Activity</h2>
        </div>
        <div class="section-content">
          <div id="activity-log"></div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-header">
        <h2>Recent Commits</h2>
      </div>
      <div class="section-content">
        <div class="commit-list" id="commit-list"></div>
      </div>
    </div>
  </div>

  <script>
    async function loadData() {
      document.getElementById('loading').classList.add('active');

      try {
        const [stats, tasks, logs, git] = await Promise.all([
          fetch('/api/stats').then(r => r.json()),
          fetch('/api/tasks').then(r => r.json()),
          fetch('/api/logs').then(r => r.json()),
          fetch('/api/git').then(r => r.json())
        ]);

        renderStats(stats);
        renderTasks(tasks);
        renderLogs(logs);
        renderGit(git);

        document.getElementById('project-name').textContent = stats.projectName;

      } catch (e) {
        console.error('Failed to load data:', e);
      }

      document.getElementById('loading').classList.remove('active');
    }

    function renderStats(stats) {
      const grid = document.getElementById('stats-grid');
      grid.innerHTML = \`
        <div class="stat-card">
          <h3>Ready</h3>
          <div class="value" style="color: var(--accent-blue)">\${stats.tasksReady}</div>
          <div class="subtext">tasks waiting</div>
        </div>
        <div class="stat-card">
          <h3>In Progress</h3>
          <div class="value" style="color: var(--accent-yellow)">\${stats.tasksInProgress}</div>
          <div class="subtext">currently active</div>
        </div>
        <div class="stat-card">
          <h3>Completed</h3>
          <div class="value" style="color: var(--accent-green)">\${stats.tasksCompleted}</div>
          <div class="subtext">recently done</div>
        </div>
        <div class="stat-card">
          <h3>Success Rate</h3>
          <div class="value">\${stats.successRate}%</div>
          <div class="subtext">from \${stats.totalRuns} runs</div>
        </div>
      \`;
    }

    function renderTasks(tasks) {
      const list = document.getElementById('task-list');
      const allTasks = [
        ...(tasks.inProgress || []).map(t => ({ ...t, status: 'in-progress' })),
        ...(tasks.ready || []).map(t => ({ ...t, status: 'ready' })),
        ...(tasks.blocked || []).map(t => ({ ...t, status: 'blocked' })),
        ...(tasks.recentlyCompleted || []).slice(0, 5).map(t => ({ ...t, status: 'completed' }))
      ];

      document.getElementById('task-count').textContent = allTasks.length + ' tasks';

      if (allTasks.length === 0) {
        list.innerHTML = '<div class="empty-state">No tasks found</div>';
        return;
      }

      list.innerHTML = allTasks.map(task => \`
        <li class="task-item">
          <div class="task-status \${task.status}"></div>
          <div class="task-info">
            <div class="task-title">\${task.title || task.id}</div>
            <div class="task-meta">\${task.id} • \${task.type || 'task'} • \${task.priority || 'P2'}</div>
          </div>
        </li>
      \`).join('');
    }

    function renderLogs(logs) {
      const container = document.getElementById('activity-log');

      if (logs.length === 0) {
        container.innerHTML = '<div class="empty-state">No recent activity</div>';
        return;
      }

      container.innerHTML = logs.slice(0, 10).map(log => \`
        <div class="log-entry">
          <div>
            <span class="log-id">\${log.id}</span>
            <span class="log-time">\${log.timestamp}</span>
          </div>
          <div class="log-request">\${log.request}</div>
          <div class="log-tags">
            \${log.tags.map(t => \`<span class="tag">\${t}</span>\`).join('')}
          </div>
        </div>
      \`).join('');
    }

    function renderGit(git) {
      document.getElementById('branch-name').innerHTML = \`
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z"/>
        </svg>
        \${git.branch}
      \`;

      const commitList = document.getElementById('commit-list');
      commitList.innerHTML = git.commits.map(c => \`
        <div class="commit-item">
          <span class="commit-hash">\${c.hash}</span>
          \${c.message}
        </div>
      \`).join('');
    }

    // Initial load and auto-refresh
    loadData();
    setInterval(loadData, 30000);
  </script>
</body>
</html>`;
}

// ============================================================
// HTTP Server
// ============================================================

function startServer(port) {
  const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Route handling
    const url = new URL(req.url, `http://localhost:${port}`);
    const pathname = url.pathname;

    try {
      if (pathname === '/' || pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(getDashboardHTML());
        return;
      }

      if (pathname === '/api/stats') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getProjectStats()));
        return;
      }

      if (pathname === '/api/tasks') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(loadTaskStatus()));
        return;
      }

      if (pathname === '/api/logs') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(parseRequestLog()));
        return;
      }

      if (pathname === '/api/git') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getGitInfo()));
        return;
      }

      if (pathname === '/api/runs') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(loadRunHistory()));
        return;
      }

      if (pathname === '/api/team') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(loadTeamState()));
        return;
      }

      if (pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
        return;
      }

      // 404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));

    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });

  server.listen(port, () => {
    console.log(`
${color('cyan', '╔══════════════════════════════════════════════════════════════╗')}
${color('cyan', '║')}           ${color('white', 'Wogi Flow - Team Observability Dashboard')}           ${color('cyan', '║')}
${color('cyan', '╚══════════════════════════════════════════════════════════════╝')}

  Dashboard: ${color('green', `http://localhost:${port}`)}

  API Endpoints:
    GET /api/stats    Project statistics
    GET /api/tasks    Task status (ready, in-progress, blocked)
    GET /api/logs     Recent activity from request-log
    GET /api/git      Git branch and recent commits
    GET /api/runs     Run history
    GET /api/team     Team state
    GET /health       Health check

  Press Ctrl+C to stop the server.
`);
  });

  return server;
}

// ============================================================
// CLI
// ============================================================

function showHelp() {
  console.log(`
Wogi Flow - Team Observability Dashboard

Start a local web dashboard for viewing task progress and history.

Usage:
  flow team dashboard              Start dashboard (port ${DEFAULT_PORT})
  flow team dashboard --port 8080  Custom port
  flow team dashboard --open       Auto-open in browser

Options:
  --port <number>   Port to listen on (default: ${DEFAULT_PORT})
  --open            Open dashboard in default browser
  --help, -h        Show this help
`);
}

async function main() {
  const { flags } = parseFlags(process.argv.slice(2));

  if (flags.help || flags.h) {
    showHelp();
    process.exit(0);
  }

  const port = parseInt(flags.port) || DEFAULT_PORT;

  startServer(port);

  // Auto-open browser if requested
  if (flags.open) {
    const url = `http://localhost:${port}`;
    try {
      const { exec } = require('child_process');
      const cmd = process.platform === 'darwin' ? 'open' :
                  process.platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${cmd} ${url}`);
    } catch (e) {
      info(`Open ${url} in your browser`);
    }
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  startServer,
  loadTaskStatus,
  loadRunHistory,
  parseRequestLog,
  getProjectStats,
  getGitInfo
};

if (require.main === module) {
  main().catch(err => {
    error(err.message);
    process.exit(1);
  });
}
