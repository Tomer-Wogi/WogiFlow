/**
 * Gemini CLI Bridge
 *
 * Generates .gemini/ folder structure and GEMINI.md from .workflow/ configuration.
 *
 * Sync targets:
 * - .workflow/commands/ → .gemini/commands/ (MD → TOML conversion)
 * - .workflow/config.json + templates → GEMINI.md
 * - Generates settings.json with hooks configuration
 *
 * Supports both Gemini CLI (terminal) and Antigravity IDE.
 */

const fs = require('fs');
const path = require('path');
const BaseBridge = require('./base-bridge');

/**
 * Hook timeout constants (in milliseconds)
 */
const HOOK_TIMEOUTS = {
  SESSION_START: 10000,
  BEFORE_AGENT: 5000,
  BEFORE_TOOL: 5000,
  AFTER_TOOL: 60000,
  SESSION_END: 10000
};

class GeminiBridge extends BaseBridge {
  constructor(options = {}) {
    super('gemini-cli', options);

    this.cliFolder = '.gemini';
    this.rulesFile = 'GEMINI.md';
    this.skillsPath = '.gemini/skills';
    this.rulesPath = '.gemini/rules';
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
   * Generate GEMINI.md content from config
   * @param {Object} config - The workflow config
   * @returns {string} Generated GEMINI.md content
   */
  generateRulesContent(config) {
    // Check if custom template exists
    const templatePath = path.join(this.projectDir, this.workflowDir, 'templates', 'gemini-md.hbs');
    if (fs.existsSync(templatePath)) {
      return this.generateFromTemplate(templatePath, config);
    }

    // Default template - comprehensive GEMINI.md
    return this.generateDefaultGeminiMd(config);
  }

  /**
   * Generate GEMINI.md from Handlebars-like template
   * Supports: {{variable}}, {{config.path}}, {{#if}}, {{#each}}, {{/if}}, {{/each}}
   */
  generateFromTemplate(templatePath, config) {
    let template;
    try {
      template = fs.readFileSync(templatePath, 'utf-8');
    } catch (err) {
      this.log(`Warning: Could not read template ${templatePath}: ${err.message}`);
      return this.generateDefaultGeminiMd(config);
    }
    let content = template;

    // Process {{#if config.path.to.value}}...{{/if}} blocks
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

  /**
   * Process {{#if condition}}...{{/if}} blocks
   */
  processConditionals(content, config) {
    const ifRegex = /\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g;

    let lastContent;
    do {
      lastContent = content;
      content = content.replace(ifRegex, (match, condition, body) => {
        let value;
        if (condition.startsWith('config.')) {
          value = this.getNestedValue(config, condition.replace('config.', ''));
        } else if (condition === 'skills') {
          value = config.skills?.installed?.length > 0;
        } else {
          value = this.getNestedValue(config, condition);
        }
        return value ? body : '';
      });
    } while (content !== lastContent);

    return content;
  }

  /**
   * Process {{#each array}}...{{/each}} blocks
   */
  processEachBlocks(content, config) {
    const eachRegex = /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g;

    return content.replace(eachRegex, (match, arrayName, body) => {
      let array;
      if (arrayName === 'skills') {
        array = config.skills?.installed || [];
      } else {
        array = config[arrayName] || [];
      }

      if (!Array.isArray(array) || array.length === 0) {
        return '';
      }

      return array.map(item => body.replace(/\{\{this\}\}/g, String(item))).join('');
    });
  }

  /**
   * Generate default GEMINI.md when no template exists
   */
  generateDefaultGeminiMd(config) {
    const skills = config.skills?.installed || [];

    const sections = [];

    // Header - note the difference in paths for Gemini CLI
    sections.push(`# Project Instructions

You are an AI development assistant using the WogiFlow methodology v1.0. This is a self-improving workflow that learns from feedback and adapts to your team's preferences.

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

    // Quick Start - adapted for Gemini CLI
    sections.push(`
## Quick Start

\`\`\`bash
# Read workflow state at session start
cat .workflow/config.json      # Read config
cat .workflow/state/ready.json # Check tasks
cat .workflow/state/decisions.md # Project rules
\`\`\`

---`);

    // Essential Commands - using shell command syntax for Gemini
    sections.push(`
## Essential Commands

| Command | Purpose |
|---------|---------|
| \`/wogi-ready\` | Show available tasks |
| \`/wogi-start TASK-X\` | Start task (self-completing loop) |
| \`/wogi-story "title"\` | Create story with acceptance criteria |
| \`/wogi-status\` | Project overview |
| \`/wogi-health\` | Check workflow health |

These commands execute: \`./scripts/flow [command]\`

---`);

    // Natural Language Command Detection
    sections.push(`
## Natural Language Command Detection

**When you recognize these phrases, execute the corresponding flow command:**

| Phrase Pattern | Execute |
|----------------|---------|
| "show tasks", "what's ready", "available tasks" | \`./scripts/flow ready\` |
| "project status", "show status", "where are we" | \`./scripts/flow status\` |
| "check health", "workflow health" | \`./scripts/flow health\` |
| "wrap up", "end session" | \`./scripts/flow session-end\` |

---`);

    // Universal Entry Point
    sections.push(`
## CRITICAL: Universal Entry Point

**ALL implementation requests MUST go through \`/wogi-start\`:**

\`\`\`
User: "add a logout button"
You: Run ./scripts/flow start "add a logout button"
\`\`\`

**Do NOT:**
- Jump straight to editing files for implementation requests
- Bypass the workflow for "quick" changes

**ALWAYS:**
- Route implementation requests through /wogi-start
- Let it classify and decide the appropriate action
- Follow its routing decision

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

Check \`.gemini/skills/[name]/skill.md\` for skill-specific guidance.

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

    // Footer
    sections.push(`
## Generated by CLI Bridge

This file was generated by the Wogi Flow CLI bridge for Gemini CLI.
Edit \`.workflow/templates/gemini-md.hbs\` to customize.
Run \`./scripts/flow bridge sync\` to regenerate.

Last synced: ${new Date().toISOString()}
`);

    return sections.join('\n');
  }

  /**
   * Generate settings.json for Gemini CLI with hooks configuration
   * @param {Object} config - The workflow config
   * @returns {Object} Settings object
   */
  generateSettings(config) {
    const projectDir = this.projectDir;
    const scriptsDir = path.join(projectDir, 'scripts', 'hooks', 'entry', 'gemini-cli');

    // Build hooks configuration
    const hooks = {};

    // SessionStart hook - inject context
    hooks.SessionStart = [{
      hooks: [{
        name: 'wogi-session-start',
        type: 'command',
        command: `node "${path.join(scriptsDir, 'session-start.js')}"`,
        timeout: HOOK_TIMEOUTS.SESSION_START
      }]
    }];

    // BeforeAgent hook - implementation gate (equiv. UserPromptSubmit)
    if (config.enforcement?.strictMode || config.hooks?.implementationGate?.enabled !== false) {
      hooks.BeforeAgent = [{
        hooks: [{
          name: 'wogi-implementation-gate',
          type: 'command',
          command: `node "${path.join(scriptsDir, 'before-agent.js')}"`,
          timeout: HOOK_TIMEOUTS.BEFORE_AGENT
        }]
      }];
    }

    // BeforeTool hook - task gating, component check
    hooks.BeforeTool = [{
      matcher: 'write_file|replace|edit_file',
      hooks: [{
        name: 'wogi-tool-gate',
        type: 'command',
        command: `node "${path.join(scriptsDir, 'before-tool.js')}"`,
        timeout: HOOK_TIMEOUTS.BEFORE_TOOL
      }]
    }];

    // AfterTool hook - validation
    if (config.hooks?.validation?.enabled !== false) {
      hooks.AfterTool = [{
        matcher: 'write_file|replace|edit_file',
        hooks: [{
          name: 'wogi-validation',
          type: 'command',
          command: `node "${path.join(scriptsDir, 'after-tool.js')}"`,
          timeout: HOOK_TIMEOUTS.AFTER_TOOL
        }]
      }];
    }

    // SessionEnd hook - cleanup
    hooks.SessionEnd = [{
      hooks: [{
        name: 'wogi-session-end',
        type: 'command',
        command: `node "${path.join(scriptsDir, 'session-end.js')}"`,
        timeout: HOOK_TIMEOUTS.SESSION_END
      }]
    }];

    // Build tools configuration
    const tools = {
      allowed: [
        'shell_execute',
        'read_file',
        'write_file',
        'edit_file',
        'replace',
        'list_directory',
        'search_files'
      ],
      sandbox: false
    };

    // Context files
    const context = {
      fileName: ['GEMINI.md', 'AGENTS.md']
    };

    return {
      hooksConfig: { enabled: true },
      hooks,
      tools,
      context,
      _wogiFlowManaged: true,
      _wogiFlowVersion: '2.0.0',
      _generatedAt: new Date().toISOString()
    };
  }

  /**
   * Sync settings.json to .gemini/settings.json
   * @param {Object} config - The workflow config
   */
  syncSettings(config) {
    const settingsPath = path.join(this.projectDir, this.cliFolder, 'settings.json');

    let existingSettings = {};
    try {
      const content = fs.readFileSync(settingsPath, 'utf-8');
      // SECURITY: Check for prototype pollution before parsing
      if (content.includes('__proto__') || content.includes('"constructor"')) {
        this.log('Warning: settings.json contains suspicious keys, using defaults');
      } else {
        existingSettings = JSON.parse(content);
        // Validate result is a plain object
        if (!existingSettings || typeof existingSettings !== 'object' || Array.isArray(existingSettings)) {
          existingSettings = {};
        }
      }
    } catch (err) {
      // File may not exist or be invalid - continue with empty settings
      if (err.code !== 'ENOENT') {
        this.log(`Warning: Could not parse existing settings.json: ${err.message}`);
      }
    }

    const newSettings = this.generateSettings(config);

    // Merge: keep existing mcpServers, use new hooks
    const mergedSettings = {
      ...newSettings,
      mcpServers: existingSettings.mcpServers || {},
    };

    fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2));
    this.log(`Synced settings.json with hooks configuration`);

    return mergedSettings;
  }

  /**
   * Convert a single Markdown command file to TOML format
   * @param {string} mdContent - Markdown content
   * @param {string} cmdName - Original command name
   * @returns {string} TOML formatted content
   */
  convertMdToToml(mdContent, cmdName) {
    const lines = mdContent.split('\n');

    // Extract title from first heading line
    let title = cmdName.replace('.md', '').replace(/-/g, ' ');
    for (const line of lines) {
      if (line.startsWith('# ')) {
        title = line.replace(/^#\s*/, '').trim();
        break;
      }
    }

    // Truncate title if too long
    if (title.length > 100) {
      title = title.substring(0, 97) + '...';
    }

    // Escape content for TOML multi-line string
    // TOML multi-line strings use """ and don't need much escaping
    // But we need to escape any """ sequences within the content
    // IMPORTANT: Escape backslashes FIRST, then triple quotes
    const escaped = mdContent
      .replace(/\\/g, '\\\\')      // Escape backslashes first
      .replace(/"""/g, '""\\\"');  // Then escape triple quotes

    return `# Auto-generated from ${cmdName}
# Run \`./scripts/flow bridge sync\` to regenerate

description = "${title.replace(/"/g, '\\"')}"
prompt = """
${escaped}
"""
`;
  }

  /**
   * Sync commands from .workflow/commands/ to .gemini/commands/ as TOML
   * @param {Object} config - The workflow config
   */
  syncCommands(config) {
    const workflowCommands = path.join(this.projectDir, this.workflowDir, 'commands');
    const geminiCommands = path.join(this.projectDir, this.cliFolder, 'commands', 'wogi');

    if (!fs.existsSync(workflowCommands)) {
      this.log('No commands to sync (no .workflow/commands/ directory)');
      return;
    }

    // Ensure target directory exists
    if (!fs.existsSync(geminiCommands)) {
      fs.mkdirSync(geminiCommands, { recursive: true });
    }

    const commands = fs.readdirSync(workflowCommands).filter(f => f.endsWith('.md'));
    let syncedCount = 0;

    for (const cmd of commands) {
      try {
        const mdContent = fs.readFileSync(path.join(workflowCommands, cmd), 'utf-8');
        const tomlContent = this.convertMdToToml(mdContent, cmd);

        // Convert filename: wogi-status.md → status.toml
        const tomlName = cmd.replace('wogi-', '').replace('.md', '.toml');
        const tomlPath = path.join(geminiCommands, tomlName);

        fs.writeFileSync(tomlPath, tomlContent);
        syncedCount++;
        this.log(`Converted command: ${cmd} → wogi/${tomlName}`);
      } catch (err) {
        this.log(`Warning: Failed to convert ${cmd}: ${err.message}`);
      }
    }

    this.log(`Synced ${syncedCount} commands to .gemini/commands/wogi/`);
  }

  /**
   * Create hook entry point scripts for Gemini CLI
   * @param {Object} config - The workflow config
   */
  async createHookEntryPoints(config) {
    const entryDir = path.join(this.projectDir, 'scripts', 'hooks', 'entry', 'gemini-cli');

    // Check if entry points exist - if not, we'll create them during first sync
    if (!fs.existsSync(entryDir)) {
      fs.mkdirSync(entryDir, { recursive: true });
      this.log(`Created hook entry directory: scripts/hooks/entry/gemini-cli/`);

      // We won't auto-create the hook files here - they should be manually created
      // or this method should be enhanced to generate them from templates
      this.log(`Note: Hook entry point scripts need to be created in ${entryDir}`);
    }
  }

  /**
   * CLI-specific setup for Gemini CLI
   * @param {Object} config - The workflow config
   */
  async setupCliSpecific(config) {
    // Ensure .gemini directory structure
    const geminiPath = path.join(this.projectDir, this.cliFolder);

    // Create standard directories
    const dirs = ['commands', 'commands/wogi', 'rules', 'skills'];
    for (const dir of dirs) {
      const dirPath = path.join(geminiPath, dir);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        this.log(`Created ${this.cliFolder}/${dir}/`);
      }
    }

    // Sync settings.json with hooks
    this.syncSettings(config);

    // Sync commands (MD → TOML conversion)
    this.syncCommands(config);

    // Create hook entry point directory
    await this.createHookEntryPoints(config);
  }

  /**
   * Get nested value from object using dot notation
   */
  getNestedValue(obj, path) {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
  }
}

module.exports = GeminiBridge;
