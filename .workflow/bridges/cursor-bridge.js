#!/usr/bin/env node

/**
 * Wogi Flow - Cursor IDE Bridge
 *
 * Generates .cursor/rules/wogiflow.mdc and .cursor/hooks.json from WogiFlow configuration.
 *
 * ENFORCEMENT STRATEGY:
 * - HARD: Prompt gating via `beforeSubmitPrompt` (blocks implementation requests)
 * - HARD: Shell gating via `beforeShellExecution` (strict adherence)
 * - SOFT: Rules via `.cursor/rules/*.mdc`
 * - NOTIFY: Post-edit validation via `afterFileEdit` (cannot block)
 *
 * KEY LIMITATION: Cursor has NO beforeFileEdit hook - cannot block file edits after
 * the prompt is accepted. We mitigate this by gating at the prompt level.
 */

const fs = require('fs');
const path = require('path');
const BaseBridge = require('./base-bridge');

// Try to load Handlebars, fall back to inline templates if not available
let Handlebars;
try {
  Handlebars = require('handlebars');
} catch {
  Handlebars = null;
}

// ============================================================
// Cursor Bridge Class
// ============================================================

class CursorBridge extends BaseBridge {
  constructor(options = {}) {
    super('cursor', options);
  }

  // ==================== Abstract Method Implementations ====================

  getCliFolder() {
    return '.cursor';
  }

  getRulesFileName() {
    // Cursor uses .mdc files in .cursor/rules/
    return path.join('.cursor', 'rules', 'wogiflow.mdc');
  }

  getSkillsPath() {
    return path.join('.cursor', 'skills');
  }

  getRulesPath() {
    return path.join('.cursor', 'rules');
  }

  /**
   * Register template partials with Handlebars
   */
  registerPartials() {
    if (!Handlebars) return;

    const partialsDir = path.join(this.projectDir, this.workflowDir, 'templates', 'partials');
    if (!fs.existsSync(partialsDir)) return;

    try {
      const partialFiles = fs.readdirSync(partialsDir).filter(f => f.endsWith('.hbs'));
      for (const file of partialFiles) {
        const partialName = path.basename(file, '.hbs');
        const partialContent = fs.readFileSync(path.join(partialsDir, file), 'utf-8');
        Handlebars.registerPartial(partialName, partialContent);
        this.log(`Registered partial: ${partialName}`);
      }
    } catch (err) {
      this.log(`Warning: Could not register partials: ${err.message}`);
    }
  }

  /**
   * Generate rules content (.mdc format with YAML frontmatter)
   */
  generateRulesContent(config) {
    const context = this.buildContext(config);

    // Try to use Handlebars template
    if (Handlebars) {
      // Register partials before compiling
      this.registerPartials();

      const templatePath = path.join(this.projectDir, this.workflowDir, 'templates', 'cursor-rules.mdc.hbs');
      if (fs.existsSync(templatePath)) {
        try {
          const templateSource = fs.readFileSync(templatePath, 'utf-8');
          const template = Handlebars.compile(templateSource);
          return template(context);
        } catch (err) {
          this.log(`Template generation failed, using fallback: ${err.message}`);
        }
      }
    }

    // Fallback to inline generation (includes partial content directly)
    return this.generateRulesFallback(context);
  }

  /**
   * Cursor-specific setup: generate hooks.json
   */
  async setupCliSpecific(config) {
    // Ensure rules directory exists
    const rulesDir = path.join(this.projectDir, this.getCliFolder(), 'rules');
    if (!fs.existsSync(rulesDir)) {
      fs.mkdirSync(rulesDir, { recursive: true, mode: 0o755 });
    }

    // Generate hooks.json
    const hooksJsonPath = path.join(this.projectDir, this.getCliFolder(), 'hooks.json');
    const hooksJsonContent = this.generateHooksJson(config);
    fs.writeFileSync(hooksJsonPath, hooksJsonContent);
    this.log('Generated .cursor/hooks.json');

    // Convert Claude skills to Cursor format
    this.convertAndSyncSkills();
  }

  /**
   * Override generateRulesFile to write to .cursor/rules/wogiflow.mdc
   */
  generateRulesFile() {
    const config = this.readConfig();
    const content = this.generateRulesContent(config);

    // Ensure rules directory exists
    const rulesDir = path.join(this.projectDir, this.getCliFolder(), 'rules');
    if (!fs.existsSync(rulesDir)) {
      fs.mkdirSync(rulesDir, { recursive: true, mode: 0o755 });
    }

    const rulesFilePath = path.join(this.projectDir, this.getRulesFileName());
    fs.writeFileSync(rulesFilePath, content, 'utf-8');
    this.log(`Generated ${this.getRulesFileName()}`);
  }

  // ==================== Cursor-Specific Methods ====================

  /**
   * Build template context
   */
  buildContext(config) {
    // Load decisions.md for coding rules
    const decisionsPath = path.join(this.projectDir, this.workflowDir, 'state', 'decisions.md');
    let decisions = '';
    try {
      decisions = fs.readFileSync(decisionsPath, 'utf-8');
    } catch (err) {
      // File may not exist or be unreadable - continue with empty decisions
      if (err.code !== 'ENOENT') {
        this.log(`Failed to read decisions.md: ${err.message}`);
      }
    }

    // Get installed skills
    const skills = config.skills?.installed || [];

    return {
      projectName: path.basename(this.projectDir),
      projectRoot: this.projectDir,
      timestamp: new Date().toISOString(),
      config,
      decisions,
      skills,
      enforcement: config.enforcement || {},
      research: config.research || {},
      qualityGates: config.qualityGates || {},
      commits: config.commits || {},
      // Cursor-specific: note the enforcement limitations
      hasPromptGating: true,
      hasFileEditBlocking: false // Cursor limitation
    };
  }

  /**
   * Fallback rules generation (.mdc format)
   */
  generateRulesFallback(context) {
    const lines = [];

    // YAML frontmatter
    lines.push('---');
    lines.push('description: "WogiFlow task management, coding standards, and workflow enforcement"');
    lines.push('alwaysApply: true');
    lines.push('---');
    lines.push('');

    // Main content
    lines.push('# WogiFlow Project Instructions');
    lines.push('');
    lines.push(`> Generated by WogiFlow Cursor Bridge - ${context.timestamp}`);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## Enforcement Notice');
    lines.push('');
    lines.push('This project uses WogiFlow with **prompt-level enforcement** via Cursor hooks.');
    lines.push('');
    lines.push('- `beforeSubmitPrompt` hook **blocks implementation requests** without an active task');
    lines.push('- `beforeShellExecution` hook enforces strict adherence rules');
    lines.push('- `afterFileEdit` hook runs validation (notification only, cannot block)');
    lines.push('');
    lines.push('**Note:** Cursor cannot block file edits after accepting a prompt. Enforcement is at the prompt level.');
    lines.push('');
    lines.push('---');
    lines.push('');

    // Core Principles
    lines.push('## Core Principles');
    lines.push('');
    lines.push('1. **State files are memory** - Read `.workflow/state/` first');
    lines.push('2. **Config drives behavior** - Follow `.workflow/config.json` rules');
    lines.push('3. **Log every change** - Append to `request-log.md`');
    lines.push('4. **Reuse components** - Check `app-map.md` before creating');
    lines.push('5. **Learn from feedback** - Update instructions when corrected');
    lines.push('');

    // Task Gating
    if (context.enforcement?.strictMode) {
      lines.push('## Task Gating (ENFORCED AT PROMPT LEVEL)');
      lines.push('');
      lines.push('**Implementation requests will be BLOCKED without an active task.**');
      lines.push('');
      lines.push('Before ANY implementation work:');
      lines.push('1. Check `.workflow/state/ready.json` for existing tasks');
      lines.push('2. If task exists → Use `/wogi-start TASK-XXX`');
      lines.push('3. If no task → Create with `/wogi-story "title"` first');
      lines.push('');
      lines.push('**This applies to:** Adding features, fixing bugs, refactoring code.');
      lines.push('**Does NOT apply to:** Questions, exploration, reading files.');
      lines.push('');
    }

    // Research Protocol
    if (context.research?.enabled) {
      lines.push('## Research Protocol');
      lines.push('');
      lines.push('For capability/feasibility/existence questions, **BEFORE answering:**');
      lines.push('');
      lines.push('1. **Scope Mapping** - Identify relevant files and sources');
      lines.push('2. **Local Evidence** - Read ALL relevant files (don\'t skim)');
      lines.push('3. **External Verification** - Web search for current docs');
      lines.push('4. **Assumption Check** - List and verify each assumption');
      lines.push('5. **Synthesis** - Answer with citations and confidence level');
      lines.push('');
      lines.push('Use `/wogi-research "question"` to trigger the protocol.');
      lines.push('');
    }

    // Essential Commands
    lines.push('## Essential Commands');
    lines.push('');
    lines.push('| Command | Purpose |');
    lines.push('|---------|---------|');
    lines.push('| `/wogi-ready` | Show available tasks |');
    lines.push('| `/wogi-start TASK-X` | Start task with context |');
    lines.push('| `/wogi-story "title"` | Create story with AC |');
    lines.push('| `/wogi-status` | Project overview |');
    lines.push('| `/wogi-research "q"` | Research before answering |');
    lines.push('');

    // Request Logging
    lines.push('## Request Logging');
    lines.push('');
    lines.push('After EVERY request that changes files:');
    lines.push('');
    lines.push('```markdown');
    lines.push('### R-[XXX] | [YYYY-MM-DD HH:MM]');
    lines.push('**Type**: new | fix | change | refactor');
    lines.push('**Tags**: #screen:[name] #component:[name]');
    lines.push('**Request**: "[what user asked]"');
    lines.push('**Result**: [what was done]');
    lines.push('**Files**: [files changed]');
    lines.push('```');
    lines.push('');

    // Component Reuse
    lines.push('## Component Reuse');
    lines.push('');
    lines.push('**Before creating ANY component:**');
    lines.push('1. Check `app-map.md`');
    lines.push('2. Search codebase for existing');
    lines.push('3. Priority: Use existing → Add variant → Extend → Create new (last resort)');
    lines.push('');

    // Auto-Validation
    lines.push('## Auto-Validation');
    lines.push('');
    lines.push('The `afterFileEdit` hook runs validation after file edits.');
    lines.push('Results are logged but **cannot block** the agent (Cursor limitation).');
    lines.push('');
    lines.push('Manual validation:');
    lines.push('```bash');
    lines.push('npx tsc --noEmit 2>&1 | head -20');
    lines.push('npx eslint [file] --fix');
    lines.push('```');
    lines.push('');

    // File Locations
    lines.push('## File Locations');
    lines.push('');
    lines.push('| What | Where |');
    lines.push('|------|-------|');
    lines.push('| Config | `.workflow/config.json` |');
    lines.push('| Tasks | `.workflow/state/ready.json` |');
    lines.push('| Logs | `.workflow/state/request-log.md` |');
    lines.push('| Components | `.workflow/state/app-map.md` |');
    lines.push('| Rules | `.workflow/state/decisions.md` |');
    lines.push('| Progress | `.workflow/state/progress.md` |');
    lines.push('');

    // Skills
    if (context.skills && context.skills.length > 0) {
      lines.push('## Installed Skills');
      lines.push('');
      for (const skill of context.skills) {
        lines.push(`- ${skill}`);
      }
      lines.push('');
      lines.push('Check `.cursor/skills/[name]/SKILL.md` for skill-specific guidance.');
      lines.push('');
    }

    lines.push('---');
    lines.push('');
    lines.push('*Edit `.workflow/templates/cursor-rules.mdc.hbs` to customize. Run `flow bridge sync cursor` to regenerate.*');

    return lines.join('\n');
  }

  /**
   * Generate .cursor/hooks.json configuration
   */
  generateHooksJson(config) {
    const projectRoot = this.projectDir;
    const entryDir = path.join(projectRoot, 'scripts', 'hooks', 'entry', 'cursor');

    const hooks = {
      version: 1,
      hooks: {}
    };

    // sessionStart - inject context
    hooks.hooks.sessionStart = [{
      command: `node "${path.join(entryDir, 'session-start.js')}"`
    }];

    // beforeSubmitPrompt - PRIMARY ENFORCEMENT (prompt gating)
    if (config.enforcement?.strictMode) {
      hooks.hooks.beforeSubmitPrompt = [{
        command: `node "${path.join(entryDir, 'before-submit-prompt.js')}"`
      }];
    }

    // beforeShellExecution - strict adherence
    hooks.hooks.beforeShellExecution = [{
      command: `node "${path.join(entryDir, 'before-shell.js')}"`
    }];

    // afterFileEdit - validation (cannot block, notification only)
    if (config.qualityGates?.enabled !== false) {
      hooks.hooks.afterFileEdit = [{
        command: `node "${path.join(entryDir, 'after-file-edit.js')}"`
      }];
    }

    // stop - session end logging
    hooks.hooks.stop = [{
      command: `node "${path.join(entryDir, 'stop.js')}"`
    }];

    return JSON.stringify(hooks, null, 2);
  }

  /**
   * Convert Claude skills to Cursor format
   */
  convertAndSyncSkills() {
    const claudeSkillsDir = path.join(this.projectDir, '.claude', 'skills');
    const cursorSkillsDir = path.join(this.projectDir, this.getSkillsPath());

    if (!fs.existsSync(claudeSkillsDir)) {
      this.log('No Claude skills to convert');
      return;
    }

    // Ensure Cursor skills directory exists
    if (!fs.existsSync(cursorSkillsDir)) {
      fs.mkdirSync(cursorSkillsDir, { recursive: true, mode: 0o755 });
    }

    let skillDirs;
    try {
      skillDirs = fs.readdirSync(claudeSkillsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
    } catch (err) {
      this.log(`Failed to read skills directory: ${err.message}`);
      return;
    }

    let converted = 0;
    let skipped = 0;

    for (const skillName of skillDirs) {
      try {
        // SECURITY: Validate skillName
        const safeSkillName = path.basename(skillName);
        if (safeSkillName !== skillName || !/^[a-zA-Z0-9_-]+$/.test(safeSkillName)) {
          this.log(`Skipping invalid skill name: ${skillName}`);
          skipped++;
          continue;
        }

        // SECURITY: Verify path bounds
        const resolvedClaudeDir = path.resolve(claudeSkillsDir);
        const resolvedSkillPath = path.resolve(claudeSkillsDir, safeSkillName);
        if (!resolvedSkillPath.startsWith(resolvedClaudeDir + path.sep)) {
          this.log(`Path traversal attempt blocked: ${skillName}`);
          skipped++;
          continue;
        }

        const claudeSkillMd = path.join(claudeSkillsDir, safeSkillName, 'skill.md');

        if (fs.existsSync(claudeSkillMd)) {
          let content;
          try {
            content = fs.readFileSync(claudeSkillMd, 'utf-8');
          } catch (err) {
            this.log(`Failed to read skill file ${claudeSkillMd}: ${err.message}`);
            skipped++;
            continue;
          }

          const cursorContent = this.convertSkillToCursor(safeSkillName, content);

          // Create Cursor skill directory (use try-catch to handle TOCTOU race)
          const cursorSkillDir = path.join(cursorSkillsDir, safeSkillName);
          try {
            fs.mkdirSync(cursorSkillDir, { recursive: true, mode: 0o755 });
          } catch (err) {
            if (err.code !== 'EEXIST') {
              this.log(`Failed to create skill directory: ${err.message}`);
              skipped++;
              continue;
            }
          }

          // Write SKILL.md (Cursor uses same format as Codex)
          fs.writeFileSync(path.join(cursorSkillDir, 'SKILL.md'), cursorContent);
          this.log(`Converted skill: ${safeSkillName}`);
          converted++;
        }
      } catch (err) {
        this.log(`Failed to convert skill ${skillName}: ${err.message}`);
        skipped++;
      }
    }

    if (converted > 0 || skipped > 0) {
      this.log(`Skill sync complete: ${converted} converted, ${skipped} skipped`);
    }
  }

  /**
   * Escape a value for safe YAML output
   */
  escapeYamlValue(value) {
    if (!value || typeof value !== 'string') return '""';
    // Quote if contains special YAML characters or control characters
    if (/[:\n"'{}[\],&#@!|>*?`\r\t]/.test(value) || value.trim() !== value) {
      return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    }
    return value;
  }

  /**
   * Convert a Claude skill.md to Cursor SKILL.md format
   */
  convertSkillToCursor(skillName, claudeContent) {
    const lines = [];

    // Parse Claude frontmatter if present
    let description = `WogiFlow ${skillName} skill`;
    let body = claudeContent;

    const frontmatterMatch = claudeContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      body = frontmatterMatch[2].trim();

      const descMatch = frontmatter.match(/description:\s*["']?([^"'\n]+)["']?/);
      if (descMatch) {
        description = descMatch[1];
      }
    }

    // Sanitize description for YAML
    const safeDescription = description.replace(/[\r\n]/g, ' ').slice(0, 200);
    const shortDescription = safeDescription.slice(0, 50);

    // Generate Cursor SKILL.md format with proper YAML escaping
    lines.push('---');
    lines.push(`name: ${this.escapeYamlValue(skillName)}`);
    lines.push(`description: ${this.escapeYamlValue(safeDescription)}`);
    lines.push('metadata:');
    lines.push(`  short-description: ${this.escapeYamlValue(shortDescription)}`);
    lines.push(`  source: wogi-flow`);
    lines.push(`  enforcement: prompt-level`);
    lines.push('---');
    lines.push('');
    lines.push(body);

    return lines.join('\n');
  }
}

// ============================================================
// Module Exports
// ============================================================

module.exports = CursorBridge;

// CLI interface if run directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  const bridge = new CursorBridge({ verbose: true });

  switch (command) {
    case 'sync':
      bridge.sync().then(results => {
        console.log('');
        console.log('Cursor Bridge Sync Results:');
        console.log(`  Success: ${results.success}`);
        console.log(`  Duration: ${results.duration}ms`);
        console.log(`  Synced: ${results.synced.join(', ')}`);
        if (results.errors.length > 0) {
          console.log(`  Errors: ${results.errors.map(e => e.error).join(', ')}`);
        }
      });
      break;

    case 'status':
      const rulesExist = fs.existsSync(path.join(process.cwd(), '.cursor', 'rules', 'wogiflow.mdc'));
      const hooksExist = fs.existsSync(path.join(process.cwd(), '.cursor', 'hooks.json'));

      console.log('Cursor Bridge Status:');
      console.log(`  .cursor/rules/wogiflow.mdc: ${rulesExist ? '✓ exists' : '✗ missing'}`);
      console.log(`  .cursor/hooks.json: ${hooksExist ? '✓ exists' : '✗ missing'}`);
      break;

    default:
      console.log('WogiFlow Cursor Bridge');
      console.log('');
      console.log('Commands:');
      console.log('  sync     Sync WogiFlow config to Cursor format');
      console.log('  status   Check current Cursor configuration');
      console.log('');
      console.log('Usage:');
      console.log('  node .workflow/bridges/cursor-bridge.js sync');
  }
}
