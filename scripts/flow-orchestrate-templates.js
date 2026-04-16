#!/usr/bin/env node
/**
 * Template Engine - Extracted from flow-orchestrate.js
 *
 * Loads, caches, and renders markdown templates for LLM prompts.
 * Supports variable substitution, conditionals, includes,
 * and instruction richness context injection.
 */

const fs = require('node:fs');
const path = require('node:path');
const { colors, getConfig, PATHS } = require('./flow-utils');
const {
  getVerbosityGuidance,
  loadPatterns,
  loadRelevantTypes,
  loadRelatedCode
} = require('./flow-instruction-richness');

function log(color, ...args) {
  console.log(colors[color] + args.join(' ') + colors.reset);
}

class TemplateEngine {
  constructor(templatesDir) {
    this.templatesDir = templatesDir;
    this.cache = new Map();
    this.richness = null; // Instruction richness settings
    this.projectRoot = PATHS.root;
    this.projectContext = this.loadProjectContext();
  }

  /**
   * Load project context from config for template rendering
   */
  loadProjectContext() {
    try {
      const config = getConfig();
      const ctx = config.hybrid?.projectContext || {};

      // Format availableComponents for template display
      let formattedComponents = '';
      if (ctx.availableComponents && Object.keys(ctx.availableComponents).length > 0) {
        formattedComponents = '```typescript\n';
        for (const [name, info] of Object.entries(ctx.availableComponents)) {
          const exports = Array.isArray(info.exports) ? info.exports.join(', ') : info.exports || name;
          const importPath = info.importPath || `@/components/${name}`;
          formattedComponents += `// ${name}\nimport { ${exports} } from '${importPath}'\n`;
        }
        formattedComponents += '```';
      }

      // Format typeLocations for template display
      let formattedTypeLocations = '';
      if (ctx.typeLocations && Object.keys(ctx.typeLocations).length > 0) {
        formattedTypeLocations = '| Context | Import Path |\n|---------|-------------|\n';
        for (const [context, importPath] of Object.entries(ctx.typeLocations)) {
          formattedTypeLocations += `| ${context} | \`${importPath}\` |\n`;
        }
      }

      // Format warnings
      let formattedWarnings = '';
      if (ctx.projectWarnings && ctx.projectWarnings.length > 0) {
        formattedWarnings = ctx.projectWarnings.map(w => `- ⚠️ ${w}`).join('\n');
      }

      // Format custom rules
      let formattedRules = '';
      if (ctx.customRules && ctx.customRules.length > 0) {
        formattedRules = ctx.customRules.map(r => `- ${r}`).join('\n');
      }

      // Format doNotImport
      let formattedDoNotImport = '';
      if (ctx.doNotImport && ctx.doNotImport.length > 0) {
        formattedDoNotImport = ctx.doNotImport.map(i => `\`${i}\``).join(', ');
      }

      return {
        uiFramework: ctx.uiFramework,
        stylingApproach: ctx.stylingApproach,
        availableComponents: formattedComponents,
        typeLocations: formattedTypeLocations,
        projectWarnings: formattedWarnings,
        customRules: formattedRules,
        doNotImport: formattedDoNotImport,
        // Keep raw values too for programmatic use
        _raw: ctx
      };
    } catch (_err) {
      return {};
    }
  }

  /**
   * Set instruction richness level for context-aware rendering
   */
  setRichness(richnessConfig) {
    this.richness = richnessConfig;
  }

  loadTemplate(name) {
    if (this.cache.has(name)) {
      return this.cache.get(name);
    }

    const templatePath = path.join(this.templatesDir, `${name}.md`);
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template not found: ${name}`);
    }

    let template = fs.readFileSync(templatePath, 'utf-8');

    // Include base template
    const basePath = path.join(this.templatesDir, '_base.md');
    if (fs.existsSync(basePath)) {
      const base = fs.readFileSync(basePath, 'utf-8');
      template = template.replace('{{include _base.md}}', base);
    }

    // Include patterns
    const patternsPath = path.join(this.templatesDir, '_patterns.md');
    if (fs.existsSync(patternsPath)) {
      const patterns = fs.readFileSync(patternsPath, 'utf-8');
      template = template.replace('{{include _patterns.md}}', patterns);
    }

    this.cache.set(name, template);
    return template;
  }

  /**
   * Loads additional context based on richness settings
   */
  loadRichnessContext(params) {
    if (!this.richness) return {};

    const context = {};
    const filePath = params.path;

    // Load patterns from decisions.md
    if (this.richness.includePatterns) {
      const patterns = loadPatterns(this.projectRoot);
      if (patterns) {
        context.decisionsPatterns = patterns;
      }
    }

    // Load relevant type definitions
    if (this.richness.includeTypeDefinitions && filePath) {
      const types = loadRelevantTypes(this.projectRoot, filePath);
      if (types) {
        context.relevantTypes = types;
      }
    }

    // Load related code snippets
    if (this.richness.includeRelatedCode && filePath) {
      const related = loadRelatedCode(this.projectRoot, filePath, params.type);
      if (related) {
        context.relatedCodeExamples = related;
      }
    }

    // Add verbosity guidance
    context.verbosityGuidance = getVerbosityGuidance(this.richness.templateVerbosity);
    context.richnessLevel = this.richness.level;
    context.templateVerbosity = this.richness.templateVerbosity;

    return context;
  }

  render(templateName, params) {
    let template = this.loadTemplate(templateName);

    // Load richness-based context and merge with params
    const richnessContext = this.loadRichnessContext(params);

    // Merge: params override projectContext, richnessContext adds more
    const augmentedParams = { ...this.projectContext, ...params, ...richnessContext };

    // Simple variable substitution
    const substitute = (str, obj, prefix = '') => {
      for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;

        if (value === null || value === undefined) {
          str = str.replace(new RegExp(`{{${fullKey}}}`, 'g'), '');
        } else if (typeof value === 'object' && !Array.isArray(value)) {
          str = substitute(str, value, fullKey);
        } else if (Array.isArray(value)) {
          const arrayStr = value.map(v => {
            if (typeof v === 'object') {
              return JSON.stringify(v, null, 2);
            }
            return `- ${v}`;
          }).join('\n');
          str = str.replace(new RegExp(`{{${fullKey}}}`, 'g'), arrayStr);
        } else {
          str = str.replace(new RegExp(`{{${fullKey}}}`, 'g'), String(value));
        }
      }
      return str;
    };

    let result = substitute(template, augmentedParams);

    // Process conditionals: {{#if var}}content{{/if}}
    // Supports nested object access: {{#if obj.prop}}
    result = result.replace(/\{\{#if\s+([\w.]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, varPath, content) => {
      // Support dot notation for nested access
      const value = varPath.split('.').reduce((obj, key) => obj?.[key], augmentedParams);
      return value ? content : '';
    });

    // Clean up any remaining unprocessed conditionals (variables not in params)
    result = result.replace(/\{\{#if\s+[\w.]+\}\}[\s\S]*?\{\{\/if\}\}/g, '');

    // Add richness-specific sections if available
    if (this.richness && (this.richness.includePatterns || this.richness.includeTypeDefinitions || this.richness.includeRelatedCode)) {
      let additionalContext = '\n\n## Additional Context (Based on Task Complexity)\n\n';
      let hasContent = false;

      if (richnessContext.decisionsPatterns) {
        additionalContext += '### Project Patterns\n' + richnessContext.decisionsPatterns + '\n\n';
        hasContent = true;
      }

      if (richnessContext.relevantTypes) {
        additionalContext += '### Relevant Type Definitions\n```typescript\n' + richnessContext.relevantTypes + '\n```\n\n';
        hasContent = true;
      }

      if (richnessContext.relatedCodeExamples) {
        additionalContext += '### Related Code Examples\n' + richnessContext.relatedCodeExamples + '\n\n';
        hasContent = true;
      }

      if (hasContent) {
        result += additionalContext;
      }
    }

    return result;
  }
}

module.exports = { TemplateEngine };
