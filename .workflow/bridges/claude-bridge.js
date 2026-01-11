/**
 * Claude Code Bridge
 *
 * Generates .claude/ folder structure and CLAUDE.md from .workflow/ configuration.
 *
 * Sync targets:
 * - .workflow/skills/ → .claude/skills/
 * - .workflow/rules/ → .claude/rules/
 * - .workflow/config.json + templates → CLAUDE.md
 */

const fs = require('fs');
const path = require('path');
const BaseBridge = require('./base-bridge');

class ClaudeBridge extends BaseBridge {
  constructor(options = {}) {
    super('claude-code', options);

    this.cliFolder = '.claude';
    this.rulesFile = 'CLAUDE.md';
    this.skillsPath = '.claude/skills';
    this.rulesPath = '.claude/rules';
  }

  getCliFolder() {
    return this.cliFolder;
  }

  getRulesFileName() {
    return this.rulesFile;
  }

  getSkillsPath() {
    return this.skillsPath;
  }

  getRulesPath() {
    return this.rulesPath;
  }

  /**
   * Generate CLAUDE.md content from config
   * @param {Object} config - The workflow config
   * @returns {string} Generated CLAUDE.md content
   */
  generateRulesContent(config) {
    const projectName = config.projectName || 'Project';

    // Check if custom template exists
    const templatePath = path.join(this.projectDir, this.workflowDir, 'templates', 'claude-md.hbs');
    if (fs.existsSync(templatePath)) {
      return this.generateFromTemplate(templatePath, config);
    }

    // Default template - comprehensive CLAUDE.md
    return this.generateDefaultClaudeMd(config);
  }

  /**
   * Generate CLAUDE.md from Handlebars template
   */
  generateFromTemplate(templatePath, config) {
    const template = fs.readFileSync(templatePath, 'utf-8');

    // Simple template variable replacement (not full Handlebars)
    let content = template;

    // Replace {{variable}} patterns
    content = content.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return config[key] || match;
    });

    // Replace {{config.path.to.value}} patterns
    content = content.replace(/\{\{config\.([^}]+)\}\}/g, (match, path) => {
      const value = this.getNestedValue(config, path);
      return value !== undefined ? String(value) : match;
    });

    return content;
  }

  /**
   * Generate default CLAUDE.md when no template exists
   */
  generateDefaultClaudeMd(config) {
    const projectName = config.projectName || 'Project';
    const skills = config.skills?.installed || [];

    const sections = [];

    // Header
    sections.push(`# Project Instructions

You are an AI development assistant using the Wogi Flow methodology v1.9. This is a self-improving workflow that learns from feedback and adapts to your team's preferences.

---`);

    // Task Gating Section (if strict mode enabled)
    if (config.enforcement?.strictMode) {
      sections.push(`
## Task Gating (MANDATORY)

**STOP. Before doing ANY implementation work, follow these steps:**

1. **Is this an implementation request?** (Adding, fixing, creating code)
   - If NO → Proceed normally
   - If YES → Continue to step 2

2. **Does a task already exist?**
   - Check \`.workflow/state/ready.json\`
   - If YES → Use \`/wogi-start TASK-XXX\`
   - If NO → Continue to step 3

3. **Assess task size:**
   - **Small** (< 3 files): Create task inline
   - **Medium/Large** (3+ files): Create story first with \`/wogi-story\`

---`);
    }

    // Quick Start
    sections.push(`
## Quick Start

\`\`\`bash
cat .workflow/config.json      # Read config
cat .workflow/state/ready.json # Check tasks
cat .workflow/state/decisions.md # Project rules
\`\`\`

---`);

    // Essential Commands
    sections.push(`
## Essential Commands

| Command | Purpose |
|---------|---------|
| \`/wogi-ready\` | Show available tasks |
| \`/wogi-start TASK-X\` | Start task (self-completing loop) |
| \`/wogi-story "title"\` | Create story with acceptance criteria |
| \`/wogi-status\` | Project overview |
| \`/wogi-health\` | Check workflow health |

---`);

    // Auto-Validation
    sections.push(`
## Auto-Validation (CRITICAL)

After editing ANY TypeScript/JavaScript file:
\`\`\`bash
npx tsc --noEmit 2>&1 | head -20
npx eslint [file] --fix
\`\`\`

**Do NOT edit another file until current file passes validation.**

---`);

    // Skills Section
    if (skills.length > 0) {
      sections.push(`
## Installed Skills

${skills.map(s => `- ${s}`).join('\n')}

Check \`.claude/skills/[name]/skill.md\` for skill-specific guidance.

---`);
    }

    // File Locations
    sections.push(`
## File Locations

| What | Where |
|------|-------|
| Config | \`.workflow/config.json\` |
| Tasks | \`.workflow/state/ready.json\` |
| Logs | \`.workflow/state/request-log.md\` |
| Components | \`.workflow/state/app-map.md\` |
| Rules | \`.workflow/state/decisions.md\` |
| Progress | \`.workflow/state/progress.md\` |

---`);

    // Component Reuse
    sections.push(`
## Component Reuse

**Before creating ANY component:**
1. Check \`app-map.md\`
2. Search codebase for existing
3. Priority: Use existing → Add variant → Extend → Create new (last resort)

---`);

    // Commit Behavior
    sections.push(`
## Commit Behavior

Check \`config.json → commits\` before committing:
- Features require user approval (default)
- Small fixes (≤${config.commits?.smallFixThreshold || 3} files) can auto-commit
- Always show git diff before committing features/refactors

---`);

    // Context Management
    sections.push(`
## Context Management

Use \`/wogi-compact\` when:
- After completing 2-3 tasks
- After 15-20 messages
- Before starting large tasks

---`);

    // Footer
    sections.push(`
## Generated by CLI Bridge

This file was generated by the Wogi Flow CLI bridge.
Edit \`.workflow/templates/claude-md.hbs\` to customize.
Run \`flow bridge sync\` to regenerate.

Last synced: ${new Date().toISOString()}
`);

    return sections.join('\n');
  }

  /**
   * CLI-specific setup for Claude Code
   */
  async setupCliSpecific(config) {
    // Ensure .claude directory structure
    const clauePath = path.join(this.projectDir, this.cliFolder);

    // Create standard directories
    const dirs = ['commands', 'docs', 'rules', 'skills'];
    for (const dir of dirs) {
      const dirPath = path.join(clauePath, dir);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        this.log(`Created ${this.cliFolder}/${dir}/`);
      }
    }

    // Copy commands from .workflow/commands if they exist
    const workflowCommands = path.join(this.projectDir, this.workflowDir, 'commands');
    const claudeCommands = path.join(clauePath, 'commands');

    if (fs.existsSync(workflowCommands)) {
      const commands = fs.readdirSync(workflowCommands).filter(f => f.endsWith('.md'));
      for (const cmd of commands) {
        fs.copyFileSync(
          path.join(workflowCommands, cmd),
          path.join(claudeCommands, cmd)
        );
        this.log(`Synced command: ${cmd}`);
      }
    }

    // Ensure hot-reload compatibility: skills in .claude/skills
    // This is already handled by syncSkills() in base class
  }

  /**
   * Get nested value from object using dot notation
   */
  getNestedValue(obj, path) {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
  }

  /**
   * Generate settings.local.json with wildcard permissions
   * Claude Code 2.1.0+ supports wildcards like Bash(npm *)
   */
  generateSettings(config) {
    const projectDir = this.projectDir;

    // Base wildcard permissions - covers most common use cases
    const wildcardPermissions = [
      // Package managers
      'Bash(npm *)',
      'Bash(npx *)',
      'Bash(yarn *)',
      'Bash(pnpm *)',
      'Bash(pip *)',
      'Bash(python *)',
      'Bash(python3 *)',

      // Git operations
      'Bash(git status)',
      'Bash(git status *)',
      'Bash(git diff *)',
      'Bash(git log *)',
      'Bash(git branch *)',
      'Bash(git checkout *)',
      'Bash(git add *)',
      'Bash(git commit *)',
      'Bash(git push *)',
      'Bash(git pull *)',
      'Bash(git fetch *)',
      'Bash(git reset *)',
      'Bash(git restore *)',
      'Bash(git show *)',
      'Bash(git rm *)',
      'Bash(git ls-files *)',
      'Bash(git check-ignore *)',

      // GitHub CLI
      'Bash(gh pr *)',
      'Bash(gh issue *)',
      'Bash(gh api *)',

      // Flow scripts
      `Bash(${path.join(projectDir, 'scripts/flow')} *)`,
      'Bash(./scripts/flow *)',
      'Bash(./scripts/flow)',

      // Common utilities
      'Bash(ls *)',
      'Bash(tree *)',
      'Bash(cat *)',
      'Bash(head *)',
      'Bash(tail *)',
      'Bash(wc *)',
      'Bash(grep *)',
      'Bash(find *)',
      'Bash(chmod *)',
      'Bash(node *)',
      'Bash(bash *)',
      'Bash(open *)',
      'Bash(test *)',

      // AWS/Cloud
      'Bash(aws *)',
      'Bash(terraform *)',

      // Database
      'Bash(sqlite3 *)',

      // Web fetch domains
      'WebFetch(domain:github.com)',
      'WebFetch(domain:api.github.com)',
      'WebFetch(domain:raw.githubusercontent.com)',

      // Web search
      'WebSearch',

      // Skills
      'Skill(wogi-*)',
    ];

    // Additional domains from config
    const additionalDomains = config.permissions?.allowedDomains || [];
    for (const domain of additionalDomains) {
      wildcardPermissions.push(`WebFetch(domain:${domain})`);
    }

    return {
      permissions: {
        allow: wildcardPermissions,
      },
      respectGitignore: true,
      _wogiFlowManaged: true,
      _wogiFlowVersion: '2.0.0',
      _generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Sync settings.local.json with wildcard permissions
   * Preserves hooks and other custom settings
   */
  syncSettings(config) {
    const settingsPath = path.join(this.projectDir, this.cliFolder, 'settings.local.json');

    let existingSettings = {};
    if (fs.existsSync(settingsPath)) {
      try {
        existingSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      } catch (e) {
        this.log(`Warning: Could not parse existing settings.local.json`);
      }
    }

    const newSettings = this.generateSettings(config);

    // Merge: keep existing hooks, use new permissions
    const mergedSettings = {
      permissions: newSettings.permissions,
      respectGitignore: newSettings.respectGitignore,
      hooks: existingSettings.hooks || {},
      _wogiFlowManaged: newSettings._wogiFlowManaged,
      _wogiFlowVersion: newSettings._wogiFlowVersion,
      _generatedAt: newSettings._generatedAt,
    };

    fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2));
    this.log(`Synced settings.local.json with wildcard permissions (${newSettings.permissions.allow.length} rules)`);

    return mergedSettings;
  }
}

module.exports = ClaudeBridge;
