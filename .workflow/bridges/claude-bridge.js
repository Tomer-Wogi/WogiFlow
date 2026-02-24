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
    // Use getBestTemplatePath to find the best template (prefers package over outdated project)
    const templatePath = this.getBestTemplatePath('claude-md.hbs');
    if (templatePath) {
      return this.generateFromTemplate(templatePath, config);
    }

    // Default template - comprehensive CLAUDE.md
    return this.generateDefaultClaudeMd(config);
  }

  /**
   * Generate CLAUDE.md from Handlebars-like template
   * Supports: {{variable}}, {{config.path}}, {{#if}}, {{#each}}, {{/if}}, {{/each}}, {{> partial}}
   */
  generateFromTemplate(templatePath, config) {
    let template;
    try {
      template = fs.readFileSync(templatePath, 'utf-8');
    } catch (err) {
      this.log(`Warning: Could not read template ${templatePath}: ${err.message}`);
      return this.generateDefaultClaudeMd(config);
    }
    let content = template;

    // Process {{> partial}} includes first (before other processing)
    content = this.processPartials(content);

    // Process {{#if config.path.to.value}}...{{/if}} blocks
    // Non-greedy match to handle nested conditions
    content = this.processConditionals(content, config);

    // Process {{#each array}}...{{/each}} blocks
    content = this.processEachBlocks(content, config);

    // Replace {{variable}} patterns
    content = content.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return config[key] || match;
    });

    // Replace {{config.path.to.value}} patterns
    content = content.replace(/\{\{config\.([^}]+)\}\}/g, (match, configPath) => {
      const value = this.getNestedValue(config, configPath);
      return value !== undefined ? String(value) : match;
    });

    // Replace {{timestamp}} with current time
    content = content.replace(/\{\{timestamp\}\}/g, new Date().toISOString());

    return content;
  }

  // NOTE: processConditionals() and processEachBlocks() are inherited from BaseBridge
  // Do not override - consolidated per code review to avoid duplication

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

  // NOTE: getNestedValue() is inherited from BaseBridge with security checks
  // Do not override - see security-patterns.md rule #2

  /**
   * Get installed WogiFlow version from settings.json (set by postinstall)
   * @returns {string} Version string or 'unknown'
   */
  _getInstalledVersion() {
    try {
      const settingsPath = path.join(this.projectDir, this.cliFolder, 'settings.json');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      return settings._wogiFlowVersion || 'unknown';
    } catch (err) {
      return 'unknown';
    }
  }

  /**
   * Generate settings.local.json with permissions
   * NOTE: Requires Claude Code 2.1.7+ which fixed wildcard matching of shell operators.
   * See security-patterns.md rule #6 for details.
   */
  generateSettings(config) {
    const projectDir = this.projectDir;

    // Permission rules - balancing security with workflow convenience
    // Wildcards are safe in 2.1.7+ (shell operators rejected)
    const wildcardPermissions = [
      // Package managers - specific safe operations
      'Bash(npm install *)',
      'Bash(npm run *)',
      'Bash(npm test *)',
      'Bash(npm exec *)',
      'Bash(npm ci)',
      'Bash(npm audit *)',
      'Bash(npm outdated *)',
      'Bash(npm ls *)',
      'Bash(npm version *)',
      'Bash(npx *)',
      'Bash(yarn install *)',
      'Bash(yarn add *)',
      'Bash(yarn remove *)',
      'Bash(yarn run *)',
      'Bash(yarn test *)',
      'Bash(yarn build *)',
      'Bash(yarn dev *)',
      'Bash(pnpm install *)',
      'Bash(pnpm add *)',
      'Bash(pnpm remove *)',
      'Bash(pnpm run *)',
      'Bash(pnpm test *)',
      'Bash(pnpm build *)',
      'Bash(pnpm dev *)',
      'Bash(pip install *)',
      'Bash(pip list *)',
      'Bash(python -m *)',
      'Bash(python3 -m *)',

      // Git operations - safe read/write operations
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
      // git reset — only safe unstaging operations
      // NOTE: git reset --hard intentionally excluded — destroys uncommitted work
      'Bash(git reset HEAD *)',
      'Bash(git reset --soft *)',
      // git restore — only safe staged-file operations
      // NOTE: git restore <file> / git restore . intentionally excluded — discards changes
      'Bash(git restore --staged *)',
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

      // Safe read-only utilities
      'Bash(ls *)',
      'Bash(tree *)',
      'Bash(wc *)',
      'Bash(chmod +x *)',  // Only make executable, not arbitrary permissions
      'Bash(node --check *)',
      'Bash(node --version)',
      'Bash(bash -n *)',  // Syntax check only
      'Bash(open *)',
      'Bash(test *)',

      // AWS - Read-only and safe operations
      'Bash(aws s3 ls *)',
      'Bash(aws s3 cp *)',
      'Bash(aws sts get-caller-identity)',
      'Bash(aws sts get-caller-identity *)',
      'Bash(aws configure list)',
      'Bash(aws --version)',

      // Terraform - Safe planning and validation operations
      'Bash(terraform plan *)',
      'Bash(terraform fmt *)',
      'Bash(terraform validate *)',
      'Bash(terraform init *)',
      'Bash(terraform show *)',
      'Bash(terraform output *)',
      'Bash(terraform version)',

      // Database - Project-scoped
      'Bash(sqlite3 *.db *)',
      'Bash(sqlite3 *.sqlite *)',

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

    // Additional custom permissions from config (for advanced users)
    const customPermissions = config.permissions?.custom || [];
    for (const perm of customPermissions) {
      if (!wildcardPermissions.includes(perm)) {
        wildcardPermissions.push(perm);
      }
    }

    const settings = {
      permissions: {
        allow: wildcardPermissions,
      },
      respectGitignore: true,
      _wogiFlowManaged: true,
      _wogiFlowVersion: this._getInstalledVersion(),
      _generatedAt: new Date().toISOString(),
    };

    // Add spinnerVerbs if configured (requires Claude Code 2.1.23+)
    const spinnerVerbs = config.hooks?.claudeCode?.spinnerVerbs;
    if (Array.isArray(spinnerVerbs) && spinnerVerbs.length > 0) {
      settings.spinnerVerbs = spinnerVerbs;
    }

    // Add spinnerTipsEnabled if explicitly set (default is true in Claude Code)
    const spinnerTipsEnabled = config.hooks?.claudeCode?.spinnerTipsEnabled;
    if (spinnerTipsEnabled === false) {
      settings.spinnerTipsEnabled = false;
    }

    return settings;
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
      } catch (err) {
        this.log(`Warning: Could not parse existing settings.local.json`);
      }
    }

    const newSettings = this.generateSettings(config);

    // Merge: keep existing hooks, use new permissions and spinner settings
    const mergedSettings = {
      permissions: newSettings.permissions,
      respectGitignore: newSettings.respectGitignore,
      hooks: existingSettings.hooks || {},
      _wogiFlowManaged: newSettings._wogiFlowManaged,
      _wogiFlowVersion: newSettings._wogiFlowVersion,
      _generatedAt: newSettings._generatedAt,
    };

    // Include spinnerVerbs if configured
    if (newSettings.spinnerVerbs) {
      mergedSettings.spinnerVerbs = newSettings.spinnerVerbs;
    }

    // Include spinnerTipsEnabled if explicitly disabled
    if (newSettings.spinnerTipsEnabled === false) {
      mergedSettings.spinnerTipsEnabled = false;
    }

    fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2));
    this.log(`Synced settings.local.json with wildcard permissions (${newSettings.permissions.allow.length} rules)`);

    return mergedSettings;
  }
}

module.exports = ClaudeBridge;
