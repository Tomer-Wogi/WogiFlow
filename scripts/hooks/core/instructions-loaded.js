/**
 * Wogi Flow - InstructionsLoaded Core Hook
 *
 * Fires when CLAUDE.md or .claude/rules/*.md files are loaded into context.
 *
 * Responsibilities:
 * 1. Lightweight package-check — detect new dependencies since last scan, suggest /wogi-rescan
 * 2. Rule conflict detection — find logical contradictions between loaded rules
 * 3. Auto-onboard detection — detect missing .workflow/state/, ask user if setup should run
 *
 * This hook is non-blocking (never rejects).
 */

const fs = require('fs');
const path = require('path');

const { safeJsonParse } = require('../../flow-utils');

/**
 * Check if new packages have been added since last scan.
 * Compares current package.json dependencies against last-known state.
 *
 * @param {string} projectRoot - Project root directory
 * @returns {{ changed: boolean, newPackages: string[], message: string|null }}
 */
function checkPackageChanges(projectRoot) {
  try {
    const pkgPath = path.join(projectRoot, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      return { changed: false, newPackages: [], message: null };
    }

    const pkg = safeJsonParse(pkgPath, {});
    const currentDeps = Object.keys(pkg.dependencies || {}).concat(Object.keys(pkg.devDependencies || {}));

    // Read last-known deps from knowledge-sync state
    const syncPath = path.join(projectRoot, '.workflow', 'state', 'knowledge-sync.json');
    if (!fs.existsSync(syncPath)) {
      return { changed: false, newPackages: [], message: null };
    }

    const syncState = safeJsonParse(syncPath, {});
    const knownDeps = syncState.knownDependencies || [];

    if (knownDeps.length === 0) {
      return { changed: false, newPackages: [], message: null };
    }

    const knownSet = new Set(knownDeps);
    const newPackages = currentDeps.filter(dep => !knownSet.has(dep));

    if (newPackages.length === 0) {
      return { changed: false, newPackages: [], message: null };
    }

    return {
      changed: true,
      newPackages,
      message: `New dependencies detected since last scan: ${newPackages.slice(0, 5).join(', ')}${newPackages.length > 5 ? ` (+${newPackages.length - 5} more)` : ''}. Consider running \`/wogi-rescan\` to update rules and skills.`
    };
  } catch {
    return { changed: false, newPackages: [], message: null };
  }
}

/**
 * Check if .workflow/state/ is missing or empty — suggests onboarding.
 *
 * @param {string} projectRoot - Project root directory
 * @returns {{ missing: boolean, message: string|null }}
 */
function checkWorkflowState(projectRoot) {
  try {
    const statePath = path.join(projectRoot, '.workflow', 'state');
    if (!fs.existsSync(statePath)) {
      return {
        missing: true,
        message: 'It looks like WogiFlow state is missing. Should I run setup?'
      };
    }

    // Check for essential files
    const essentialFiles = ['ready.json', 'decisions.md'];
    const missingEssentials = essentialFiles.filter(
      f => !fs.existsSync(path.join(statePath, f))
    );

    if (missingEssentials.length === essentialFiles.length) {
      return {
        missing: true,
        message: 'It looks like WogiFlow state is missing. Should I run setup?'
      };
    }

    return { missing: false, message: null };
  } catch {
    return { missing: false, message: null };
  }
}

/**
 * Detect potential rule conflicts between loaded rules files and decisions.md.
 * Checks for opposing directives on the same scope.
 *
 * @param {string} projectRoot - Project root directory
 * @returns {{ conflicts: Array, message: string|null }}
 */
function detectRuleConflicts(projectRoot) {
  try {
    const rulesDir = path.join(projectRoot, '.claude', 'rules');
    const decisionsPath = path.join(projectRoot, '.workflow', 'state', 'decisions.md');

    if (!fs.existsSync(rulesDir) || !fs.existsSync(decisionsPath)) {
      return { conflicts: [], message: null };
    }

    // Collect all rule directives from .claude/rules/ files
    const ruleDirectives = [];
    collectRuleDirectives(rulesDir, ruleDirectives);

    // Collect directives from decisions.md
    try {
      const decisionsContent = fs.readFileSync(decisionsPath, 'utf-8');
      extractDirectives(decisionsContent, 'decisions.md', ruleDirectives);
    } catch {
      // Skip if unreadable
    }

    // Find conflicts: opposing directives on the same topic
    const conflicts = findConflicts(ruleDirectives);

    if (conflicts.length === 0) {
      return { conflicts: [], message: null };
    }

    // Check if conflicts were previously resolved (user chose to keep both)
    const feedbackPath = path.join(projectRoot, '.workflow', 'state', 'feedback-patterns.md');
    const resolvedConflicts = getResolvedConflicts(feedbackPath);

    const unresolvedConflicts = conflicts.filter(c => {
      const key = `${c.directive1.topic}|${c.directive2.topic}`;
      return !resolvedConflicts.has(key);
    });

    if (unresolvedConflicts.length === 0) {
      return { conflicts: [], message: null };
    }

    const conflictMessages = unresolvedConflicts.map(c =>
      `- "${c.directive1.text}" (${c.directive1.source}) vs "${c.directive2.text}" (${c.directive2.source})`
    );

    return {
      conflicts: unresolvedConflicts,
      message: `Potential rule conflicts detected:\n${conflictMessages.join('\n')}\n\nThese rules may contradict each other. Check decisions.md for prior resolutions, or use \`/wogi-decide\` to resolve.`
    };
  } catch {
    return { conflicts: [], message: null };
  }
}

/**
 * Recursively collect rule directives from .claude/rules/ markdown files
 */
function collectRuleDirectives(dir, directives) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectRuleDirectives(fullPath, directives);
      } else if (entry.name.endsWith('.md') && entry.name !== 'README.md') {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const relativePath = path.relative(process.cwd(), fullPath);
          extractDirectives(content, relativePath, directives);
        } catch {
          // Skip unreadable files
        }
      }
    }
  } catch {
    // Skip unreadable directories
  }
}

/**
 * Extract naming/convention directives from markdown content.
 * Looks for patterns like "use X", "always X", "never X", "prefer X over Y".
 */
function extractDirectives(content, source, directives) {
  const lines = content.split('\n');
  const directivePatterns = [
    /\b(?:always|must|shall)\s+use\s+(.+)/i,
    /\b(?:never|must not|shall not)\s+use\s+(.+)/i,
    /\bprefer\s+(.+?)\s+over\s+(.+)/i,
    /\buse\s+(\w+[-_]?case)\b/i,
    /\bformat:\s*["']?(\w+)["']?/i,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    for (const pattern of directivePatterns) {
      const match = line.match(pattern);
      if (match) {
        // Find the nearest heading for topic context
        let topic = 'general';
        for (let j = i; j >= 0; j--) {
          const headingMatch = lines[j].match(/^#{1,4}\s+(.+)/);
          if (headingMatch) {
            topic = headingMatch[1].trim().toLowerCase();
            break;
          }
        }

        directives.push({
          text: line.slice(0, 100),
          topic,
          source,
          lineNum: i + 1,
          type: line.match(/\bnever\b/i) ? 'prohibition' : 'requirement'
        });
        break; // One directive per line
      }
    }
  }
}

/**
 * Find conflicts: directives on the same topic with opposing requirements.
 * Only flags directives at the same specificity level (not general vs specific).
 */
function findConflicts(directives) {
  const conflicts = [];
  const byTopic = new Map();

  for (const d of directives) {
    const key = d.topic;
    if (!byTopic.has(key)) byTopic.set(key, []);
    byTopic.get(key).push(d);
  }

  for (const [, topicDirectives] of byTopic) {
    // Check for requirement vs prohibition on same topic
    const requirements = topicDirectives.filter(d => d.type === 'requirement');
    const prohibitions = topicDirectives.filter(d => d.type === 'prohibition');

    for (const req of requirements) {
      for (const pro of prohibitions) {
        // Only flag if from different sources (same file = intentional)
        if (req.source !== pro.source) {
          conflicts.push({ directive1: req, directive2: pro });
        }
      }
    }
  }

  return conflicts;
}

/**
 * Load previously resolved conflicts from feedback-patterns.md
 */
function getResolvedConflicts(feedbackPath) {
  const resolved = new Set();
  try {
    if (!fs.existsSync(feedbackPath)) return resolved;
    const content = fs.readFileSync(feedbackPath, 'utf-8');
    // Look for "Rule conflict resolved: X|Y" markers
    const matches = content.matchAll(/Rule conflict resolved:\s*(.+)/g);
    for (const match of matches) {
      resolved.add(match[1].trim());
    }
  } catch {
    // Ignore
  }
  return resolved;
}

/**
 * Main handler for InstructionsLoaded event
 *
 * @param {Object} options
 * @param {string} options.projectRoot - Project root directory
 * @param {Object} options.config - WogiFlow config
 * @returns {Object} { enabled, message, warnings }
 */
function handleInstructionsLoaded(options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const warnings = [];

  // 1. Check for missing workflow state (auto-onboard)
  const stateCheck = checkWorkflowState(projectRoot);
  if (stateCheck.missing) {
    return {
      enabled: true,
      message: stateCheck.message,
      warnings
    };
  }

  // 2. Lightweight package check
  const pkgCheck = checkPackageChanges(projectRoot);
  if (pkgCheck.changed && pkgCheck.message) {
    warnings.push(pkgCheck.message);
  }

  // 3. Rule conflict detection
  const conflictCheck = detectRuleConflicts(projectRoot);
  if (conflictCheck.message) {
    warnings.push(conflictCheck.message);
  }

  return {
    enabled: true,
    message: null,
    warnings
  };
}

module.exports = {
  handleInstructionsLoaded,
  checkPackageChanges,
  checkWorkflowState,
  detectRuleConflicts,
  // Exported for testing
  extractDirectives,
  findConflicts,
  getResolvedConflicts
};
