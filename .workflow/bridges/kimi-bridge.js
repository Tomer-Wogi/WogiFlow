#!/usr/bin/env node

/**
 * Wogi Flow - Kimi CLI Bridge
 *
 * Generates AGENTS.md and syncs skills from WogiFlow configuration.
 * Provides soft parity with Claude Code/Gemini CLI - same rules, same memory,
 * but enforcement is advisory (Kimi CLI lacks pre-operation hooks).
 *
 * Kimi CLI by MoonshotAI uses:
 * - AGENTS.md for project instructions
 * - .agents/skills/ for custom skills
 * - MCP (Model Context Protocol) for tool integration
 * - ACP (Agent Client Protocol) for IDE integration
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
// Kimi Bridge Class
// ============================================================

class KimiBridge extends BaseBridge {
  constructor(options = {}) {
    super('kimi', options);
  }

  // ==================== Abstract Method Implementations ====================

  getCliFolder() {
    return '.agents';
  }

  getRulesFileName() {
    return 'AGENTS.md';
  }

  getSkillsPath() {
    return path.join('.agents', 'skills');
  }

  getRulesPath() {
    return path.join('.agents', 'rules');
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
   * Generate AGENTS.md content
   */
  generateRulesContent(config) {
    const context = this.buildContext(config);

    // Try to use Handlebars template with proper error handling
    if (Handlebars) {
      // Register partials before compiling
      this.registerPartials();

      try {
        // Try kimi-specific template first, fall back to generic agents-md.hbs
        let templatePath = this.getBestTemplatePath('kimi-agents-md.hbs');
        if (!templatePath) {
          templatePath = this.getBestTemplatePath('agents-md.hbs');
        }
        if (templatePath) {
          let templateSource;
          try {
            templateSource = fs.readFileSync(templatePath, 'utf-8');
          } catch (err) {
            this.log(`Failed to read template: ${err.message}`);
            return this.generateAgentsMdFallback(context);
          }
          const template = Handlebars.compile(templateSource);
          return template(context);
        }
      } catch (err) {
        // Template failed - fall through to inline generation
        this.log(`Template generation failed, using fallback: ${err.message}`);
      }
    }

    // Fallback to inline generation
    return this.generateAgentsMdFallback(context);
  }

  /**
   * Kimi-specific setup: sync skills
   */
  async setupCliSpecific(config) {
    // Convert Claude skills to Kimi format
    this.convertAndSyncSkills();

    // Note: Kimi CLI doesn't have a central config file like Codex's config.toml
    // MCP configuration is done via --mcp-config-file flag at runtime
    this.log('Kimi CLI setup complete (soft parity - no hooks available)');
  }

  // ==================== Kimi-Specific Methods ====================

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
      commits: config.commits || {}
    };
  }

  /**
   * Fallback AGENTS.md generation (no Handlebars)
   */
  generateAgentsMdFallback(context) {
    const lines = [];

    lines.push('# WogiFlow Project Instructions');
    lines.push('');
    lines.push(`> Generated by WogiFlow Kimi Bridge - ${context.timestamp}`);
    lines.push('> For use with Kimi CLI (MoonshotAI)');
    lines.push('');
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
      lines.push('## Task Gating (MANDATORY)');
      lines.push('');
      lines.push('**STOP. Before ANY implementation:**');
      lines.push('1. Check `.workflow/state/ready.json` for existing tasks');
      lines.push('2. If no task exists, create one with `/wogi-story`');
      lines.push('3. Start with `/wogi-start TASK-XXX`');
      lines.push('');
    }

    // Research Protocol
    if (context.research?.enabled) {
      lines.push('## Research Protocol');
      lines.push('');
      lines.push('For capability/feasibility/existence questions:');
      lines.push('1. Search local files thoroughly');
      lines.push('2. Web search for current documentation');
      lines.push('3. List assumptions and verify each');
      lines.push('4. Cite sources for all claims');
      lines.push('5. State confidence level (HIGH/MEDIUM/LOW)');
      lines.push('');
      lines.push('**FORBIDDEN:** Claiming "X doesn\'t exist" without exhaustive search.');
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
    lines.push('3. Priority: Use existing → Add variant → Extend → Create new');
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
    lines.push('');

    lines.push('---');
    lines.push('');
    lines.push('*Note: Enforcement is advisory. Kimi CLI lacks pre-operation hooks.*');
    lines.push('*WogiFlow rules are provided as context but cannot block operations.*');

    return lines.join('\n');
  }

  /**
   * Convert Claude skills to Kimi format
   */
  convertAndSyncSkills() {
    const claudeSkillsDir = path.join(this.projectDir, '.claude', 'skills');
    const kimiSkillsDir = path.join(this.projectDir, this.getSkillsPath());

    if (!fs.existsSync(claudeSkillsDir)) {
      this.log('No Claude skills to convert');
      return;
    }

    // Ensure Kimi skills directory exists with explicit permissions
    if (!fs.existsSync(kimiSkillsDir)) {
      try {
        fs.mkdirSync(kimiSkillsDir, { recursive: true, mode: 0o755 });
      } catch (err) {
        if (err.code !== 'EEXIST') {
          this.log(`Failed to create skills directory: ${err.message}`);
          return;
        }
      }
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
        // SECURITY: Validate skillName to prevent path traversal
        const safeSkillName = path.basename(skillName);
        if (safeSkillName !== skillName) {
          this.log(`Skipping suspicious skill name: ${skillName}`);
          skipped++;
          continue;
        }

        // Additional validation: only alphanumeric, dash, underscore
        if (!/^[a-zA-Z0-9_-]+$/.test(safeSkillName)) {
          this.log(`Skipping skill with invalid characters: ${skillName}`);
          skipped++;
          continue;
        }

        // SECURITY: Verify resolved paths stay within expected directories
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
            this.log(`Failed to read skill ${safeSkillName}: ${err.message}`);
            skipped++;
            continue;
          }

          const kimiContent = this.convertSkillToKimi(safeSkillName, content);

          // Create Kimi skill directory with explicit permissions
          const kimiSkillDir = path.join(kimiSkillsDir, safeSkillName);
          if (!fs.existsSync(kimiSkillDir)) {
            try {
              fs.mkdirSync(kimiSkillDir, { recursive: true, mode: 0o755 });
            } catch (err) {
              if (err.code !== 'EEXIST') {
                this.log(`Failed to create skill dir ${safeSkillName}: ${err.message}`);
                skipped++;
                continue;
              }
            }
          }

          // Write SKILL.md (Kimi format)
          fs.writeFileSync(path.join(kimiSkillDir, 'SKILL.md'), kimiContent);
          this.log(`Converted skill: ${safeSkillName}`);
          converted++;
        }
      } catch (err) {
        // Log error but continue with other skills
        this.log(`Failed to convert skill ${skillName}: ${err.message}`);
        skipped++;
      }
    }

    if (converted > 0 || skipped > 0) {
      this.log(`Skill sync complete: ${converted} converted, ${skipped} skipped`);
    }
  }

  /**
   * Convert a Claude skill.md to Kimi SKILL.md format
   */
  convertSkillToKimi(skillName, claudeContent) {
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

    // Generate Kimi SKILL.md format (similar to Codex)
    lines.push('---');
    lines.push(`name: ${skillName}`);
    lines.push(`description: ${description}`);
    lines.push('metadata:');
    lines.push(`  short-description: ${description.slice(0, 50)}`);
    lines.push(`  source: wogi-flow`);
    lines.push('---');
    lines.push('');
    lines.push(body);

    return lines.join('\n');
  }
}

// ============================================================
// Module Exports
// ============================================================

module.exports = KimiBridge;

// CLI interface if run directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  const bridge = new KimiBridge({ verbose: true });

  switch (command) {
    case 'sync':
      bridge.sync().then(results => {
        console.log('');
        console.log('Kimi Bridge Sync Results:');
        console.log(`  Success: ${results.success}`);
        console.log(`  Duration: ${results.duration}ms`);
        console.log(`  Synced: ${results.synced.join(', ')}`);
        if (results.errors.length > 0) {
          console.log(`  Errors: ${results.errors.map(e => e.error).join(', ')}`);
        }
      });
      break;

    case 'status':
      const agentsMdExists = fs.existsSync(path.join(process.cwd(), 'AGENTS.md'));
      const skillsExists = fs.existsSync(path.join(process.cwd(), '.agents', 'skills'));

      console.log('Kimi Bridge Status:');
      console.log(`  AGENTS.md: ${agentsMdExists ? '✓ exists' : '✗ missing'}`);
      console.log(`  .agents/skills/: ${skillsExists ? '✓ exists' : '✗ missing'}`);
      break;

    default:
      console.log('WogiFlow Kimi Bridge');
      console.log('');
      console.log('Commands:');
      console.log('  sync     Sync WogiFlow config to Kimi format');
      console.log('  status   Check current Kimi configuration');
      console.log('');
      console.log('Usage:');
      console.log('  node .workflow/bridges/kimi-bridge.js sync');
  }
}
