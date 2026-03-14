#!/usr/bin/env node

/**
 * Wogi Flow - Code Generator from Figma Decisions
 *
 * Takes confirmed decisions and generates:
 * - Import statements for existing components
 * - Variant additions for existing components
 * - Prompts for Claude to generate new components
 * - Composition code showing how everything fits together
 *
 * The generator creates prompts that Claude can use to generate
 * framework-specific code based on the project's tech stack.
 *
 * Usage:
 *   flow figma generate <decisions.json>   # Generate from decisions
 *   flow figma generate                    # Use saved decisions
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  detectFramework } = require('./flow-figma-index');
const { getProjectRoot,
  getConfig,
  addRequestLogEntry,
  addAppMapComponent,
  readJson
} = require('./flow-utils')
const { error, info } = require('./flow-output');;

const PROJECT_ROOT = getProjectRoot();
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const DECISIONS_PATH = path.join(WORKFLOW_DIR, 'state', 'figma-decisions.json');
const REGISTRY_PATH = path.join(WORKFLOW_DIR, 'state', 'component-registry.json');

// ============================================================
// Framework-Specific Templates
// ============================================================

const FRAMEWORK_TEMPLATES = {
  react: {
    component: `import React from 'react';

interface {{name}}Props {
  className?: string;
  children?: React.ReactNode;
{{props}}
}

/**
 * {{name}} component
 * Generated from Figma design
 * Type: {{type}}
 */
export function {{name}}({ className, children{{propNames}} }: {{name}}Props) {
  return (
    <div className={className}>
      {children}
    </div>
  );
}

export default {{name}};`,

    variant: `// Add to {{componentName}}'s variant type:
// variant?: '{{variantName}}' | ... existing variants ...

// Add to component's styling/classes:
// {{variantName}}: {
{{cssProperties}}
// }`,

    imports: `import { {{componentName}} } from '@/components/{{path}}';`,

    prompt: `Create a React component called {{name}} with these properties:

**Figma Properties:**
{{cssProperties}}

**Structure:**
- Type: {{type}}
- Has children: {{hasChildren}}
{{textContent}}

**Requirements:**
1. Use TypeScript with proper interfaces
2. Use the project's styling approach (detected or configured)
3. Make it responsive
4. Add proper accessibility attributes
5. Export both named and default exports`
  },

  vue: {
    component: `<script setup lang="ts">
interface Props {
  class?: string;
{{props}}
}

defineProps<Props>();
</script>

<template>
  <div :class="props.class">
    <slot />
  </div>
</template>

<style scoped>
/* Add component styles here */
</style>`,

    variant: `<!-- Add to {{componentName}}'s props:
  variant?: '{{variantName}}' | ... existing variants ...
-->

<!-- Add conditional classes:
  :class="{ '{{variantName}}': variant === '{{variantName}}' }"
-->`,

    imports: `import {{componentName}} from '@/components/{{path}}';`,

    prompt: `Create a Vue 3 component called {{name}} with these properties:

**Figma Properties:**
{{cssProperties}}

**Structure:**
- Type: {{type}}
- Has children: {{hasChildren}} (use <slot> if true)
{{textContent}}

**Requirements:**
1. Use Composition API with <script setup>
2. Use TypeScript
3. Use the project's styling approach (scoped styles, CSS modules, or utility classes)
4. Make it responsive
5. Add proper accessibility`
  },

  svelte: {
    component: `<script lang="ts">
  export let class: string = '';
{{props}}
</script>

<div class={class}>
  <slot />
</div>

<style>
  /* Add component styles here */
</style>`,

    variant: `<!-- Add to {{componentName}}:
  export let variant: '{{variantName}}' | ... = 'default';
-->

<!-- Add conditional classes:
  class:{{variantName}}={variant === '{{variantName}}'}
-->`,

    imports: `import {{componentName}} from '$lib/components/{{path}}';`,

    prompt: `Create a Svelte component called {{name}} with these properties:

**Figma Properties:**
{{cssProperties}}

**Structure:**
- Type: {{type}}
- Has children: {{hasChildren}} (use <slot> if true)
{{textContent}}

**Requirements:**
1. Use TypeScript
2. Use the project's detected styling approach
3. Make it responsive
4. Export props properly`
  },

  angular: {
    component: `import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-{{kebabName}}',
  template: \`
    <div [class]="className">
      <ng-content></ng-content>
    </div>
  \`,
  styles: []
})
export class {{name}}Component {
  @Input() className: string = '';
{{props}}
}`,

    variant: `// Add to {{componentName}}Component:
// @Input() variant: '{{variantName}}' | ... = 'default';

// Add to template:
// [ngClass]="{'{{variantName}}': variant === '{{variantName}}'}"`,

    imports: `import { {{componentName}}Component } from './{{path}}';`,

    prompt: `Create an Angular component called {{name}} with these properties:

**Figma Properties:**
{{cssProperties}}

**Structure:**
- Type: {{type}}
- Has children: {{hasChildren}} (use <ng-content> if true)
{{textContent}}

**Requirements:**
1. Use standalone component (Angular 15+)
2. Use TypeScript
3. Use the project's detected styling approach
4. Make it responsive
5. Add proper accessibility`
  }
};

// ============================================================
// Code Generator
// ============================================================

class CodeGenerator {
  constructor(decisions, options = {}) {
    this.decisions = Array.isArray(decisions) ? decisions : decisions.decisions || [];
    this.framework = options.framework || detectFramework(PROJECT_ROOT);
    this.templates = FRAMEWORK_TEMPLATES[this.framework] || FRAMEWORK_TEMPLATES.react;
    this.registry = this.loadRegistry();

    this.output = {
      framework: this.framework,
      imports: [],
      variants: [],
      newComponents: [],
      prompts: [],
      composition: null
    };
  }

  loadRegistry() {
    return readJson(REGISTRY_PATH, { components: [] });
  }

  generate() {
    for (const decision of this.decisions) {
      switch (decision.action) {
        case 'use':
        case 'use-with-adjustments':
          this.addImport(decision);
          break;
        case 'add-variant':
          this.addVariant(decision);
          this.addImport(decision); // Also import the component
          break;
        case 'create-new':
          this.createComponent(decision);
          break;
      }
    }

    // Generate composition code
    this.generateComposition();

    return this.output;
  }

  addImport(decision) {
    const comp = decision.existingComponent;
    if (!comp) return;

    const importPath = comp.path.replace(/\.(tsx?|jsx?|vue|svelte)$/, '');

    this.output.imports.push({
      componentName: comp.name,
      path: importPath,
      importStatement: this.templates.imports
        .replace(/\{\{componentName\}\}/g, comp.name)
        .replace(/\{\{path\}\}/g, importPath),
      usage: this.generateUsage(decision),
      adjustments: decision.action === 'use-with-adjustments' ? decision.differences : null
    });
  }

  addVariant(decision) {
    const comp = decision.existingComponent;
    if (!comp) return;

    const figma = decision.figmaComponent;

    this.output.variants.push({
      componentName: comp.name,
      path: comp.path,
      variantName: decision.variantName,
      figmaProperties: figma.css,
      instructions: this.templates.variant
        .replace(/\{\{componentName\}\}/g, comp.name)
        .replace(/\{\{variantName\}\}/g, decision.variantName)
        .replace(/\{\{cssProperties\}\}/g, this.formatCSSProperties(figma.css)),
      prompt: this.generateVariantPrompt(decision)
    });
  }

  createComponent(decision) {
    const figma = decision.figmaComponent;
    const componentName = decision.componentName || this.suggestName(figma.name);
    const kebabName = componentName.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

    // Generate the prompt for Claude
    const prompt = this.templates.prompt
      .replace(/\{\{name\}\}/g, componentName)
      .replace(/\{\{kebabName\}\}/g, kebabName)
      .replace(/\{\{type\}\}/g, figma.type)
      .replace(/\{\{hasChildren\}\}/g, figma.structure?.hasChildren ? 'true' : 'false')
      .replace(/\{\{textContent\}\}/g, figma.textContent ? `- Text content: "${figma.textContent}"` : '')
      .replace(/\{\{cssProperties\}\}/g, this.formatCSSPropertiesForPrompt(figma.css));

    this.output.newComponents.push({
      componentName: componentName,
      suggestedPath: this.suggestPath(componentName, figma.type),
      type: figma.type,
      figmaProperties: figma.css,
      template: this.generateTemplate(componentName, figma),
      prompt: prompt
    });

    this.output.prompts.push({
      componentName: componentName,
      type: 'create',
      prompt: prompt
    });
  }

  generateUsage(decision) {
    const comp = decision.existingComponent;
    if (!comp) return '';

    const figma = decision.figmaComponent;
    const props = [];

    // Add variant if exists
    if (comp.variants?.length > 0) {
      const matchingVariant = this.findMatchingVariant(comp, figma);
      if (matchingVariant) {
        props.push(`${matchingVariant.name}="${matchingVariant.value}"`);
      }
    }

    // Framework-specific usage
    switch (this.framework) {
      case 'vue':
        return `<${comp.name}${props.length ? ' ' + props.join(' ') : ''} />`;
      case 'svelte':
        return `<${comp.name}${props.length ? ' ' + props.join(' ') : ''} />`;
      case 'angular':
        const selector = `app-${comp.name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`;
        return `<${selector}${props.length ? ' ' + props.join(' ') : ''}></${selector}>`;
      default:
        return `<${comp.name}${props.length ? ' ' + props.join(' ') : ''} />`;
    }
  }

  findMatchingVariant(comp, figma) {
    for (const variant of comp.variants || []) {
      const figmaName = figma.name.toLowerCase();
      for (const option of variant.options) {
        if (figmaName.includes(option.toLowerCase())) {
          return { name: variant.name, value: option };
        }
      }
    }
    return null;
  }

  generateVariantPrompt(decision) {
    const comp = decision.existingComponent;
    const figma = decision.figmaComponent;

    return `Add a new variant "${decision.variantName}" to the ${comp.name} component.

**Current component location:** ${comp.path}

**New variant properties from Figma:**
${this.formatCSSPropertiesForPrompt(figma.css)}

**Instructions:**
1. Add "${decision.variantName}" to the variant type/prop
2. Add the corresponding styles for this variant
3. Ensure existing variants still work
4. Update any variant-related documentation/types`;
  }

  generateTemplate(name, figma) {
    const props = this.generatePropsFromFigma(figma);
    const propNames = props.length > 0 ? ', ' + props.map(p => p.name).join(', ') : '';

    return this.templates.component
      .replace(/\{\{name\}\}/g, name)
      .replace(/\{\{kebabName\}\}/g, name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase())
      .replace(/\{\{type\}\}/g, figma.type)
      .replace(/\{\{props\}\}/g, props.map(p => `  ${p.name}?: ${p.type};`).join('\n'))
      .replace(/\{\{propNames\}\}/g, propNames);
  }

  generatePropsFromFigma(figma) {
    const props = [];

    // Check for variant-like patterns in the name
    const variantMatch = figma.name.match(/\b(primary|secondary|tertiary|success|error|warning|info)\b/i);
    if (variantMatch) {
      props.push({ name: 'variant', type: `'${variantMatch[1].toLowerCase()}'` });
    }

    const sizeMatch = figma.name.match(/\b(sm|md|lg|xl|small|medium|large)\b/i);
    if (sizeMatch) {
      props.push({ name: 'size', type: `'${sizeMatch[1].toLowerCase()}'` });
    }

    // Check if it has text content
    if (figma.structure?.hasText || figma.textContent) {
      props.push({ name: 'label', type: 'string' });
    }

    // Check if it has an icon
    if (figma.structure?.hasIcon) {
      props.push({ name: 'icon', type: 'React.ReactNode' }); // Framework-agnostic
    }

    return props;
  }

  formatCSSProperties(css) {
    if (!css) return '// No CSS properties';

    const lines = [];

    Object.entries(css).forEach(([category, props]) => {
      if (Array.isArray(props) && props.length > 0) {
        lines.push(`  // ${category}:`);
        props.forEach(prop => {
          const value = typeof prop.value === 'object'
            ? prop.shorthand || JSON.stringify(prop.value)
            : prop.value;
          lines.push(`  // ${prop.property}: ${value}`);
        });
      }
    });

    return lines.join('\n');
  }

  formatCSSPropertiesForPrompt(css) {
    if (!css) return 'No CSS properties extracted';

    const lines = [];

    Object.entries(css).forEach(([category, props]) => {
      if (Array.isArray(props) && props.length > 0) {
        lines.push(`${category.charAt(0).toUpperCase() + category.slice(1)}:`);
        props.forEach(prop => {
          const value = typeof prop.value === 'object'
            ? prop.shorthand || JSON.stringify(prop.value)
            : prop.value;
          lines.push(`  - ${prop.property}: ${value}`);
        });
      }
    });

    return lines.join('\n');
  }

  suggestPath(name, type) {
    const kebabName = name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
    // Detect source root from config or filesystem
    const config = getConfig ? getConfig() : {};
    const compDirs = config.registries?.components?.directories;
    const srcRoot = (compDirs && compDirs[0]) ? compDirs[0].split('/')[0] : this._detectSourceRoot();

    switch (this.framework) {
      case 'vue':
        return `${srcRoot}/components/${type}s/${name}.vue`;
      case 'svelte':
        return `${srcRoot}/lib/components/${type}s/${name}.svelte`;
      case 'angular':
        return `${srcRoot}/app/components/${type}s/${kebabName}/${kebabName}.component.ts`;
      default:
        return `${srcRoot}/components/${type}s/${name}.tsx`;
    }
  }

  _detectSourceRoot() {
    for (const dir of ['src', 'app', 'lib']) {
      if (fs.existsSync(path.join(PROJECT_ROOT, dir))) return dir;
    }
    return '.';
  }

  suggestName(figmaName) {
    return (figmaName || 'Component')
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .split(/\s+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }

  generateComposition() {
    const imports = this.output.imports.map(i => i.importStatement).join('\n');
    const usages = this.output.imports.map(i => `  ${i.usage}`).join('\n');
    const newUsages = this.output.newComponents.map(c => `  <${c.componentName} />`).join('\n');

    const allUsages = [usages, newUsages].filter(Boolean).join('\n');

    // Framework-specific composition
    let composition;
    switch (this.framework) {
      case 'vue':
        composition = `<script setup>
${imports}
</script>

<template>
  <div class="composed-view">
${allUsages}
  </div>
</template>`;
        break;

      case 'svelte':
        composition = `<script>
${imports}
</script>

<div class="composed-view">
${allUsages}
</div>`;
        break;

      case 'angular':
        composition = `// Ensure components are imported in the module/standalone

@Component({
  template: \`
    <div class="composed-view">
${allUsages}
    </div>
  \`
})`;
        break;

      default:
        composition = `${imports}

export function ComposedView() {
  return (
    <div className="composed-view">
${allUsages}
    </div>
  );
}`;
    }

    this.output.composition = {
      imports: imports,
      usages: allUsages,
      fullExample: composition
    };
  }
}

// ============================================================
// CLI
// ============================================================

async function main() {
  const [,, input] = process.argv;

  // Load decisions
  let decisionsPath = input || DECISIONS_PATH;

  if (!fs.existsSync(decisionsPath)) {
    error(`Decisions file not found: ${decisionsPath}`);
    console.error(`   Run "flow figma confirm" first to create decisions.`);
    process.exit(1);
  }

  const { safeJsonParse } = require('./flow-utils');
  const decisions = safeJsonParse(decisionsPath, null);
  if (!decisions) {
    console.error('Error: Could not parse figma decisions file.');
    process.exit(1);
  }
  const generator = new CodeGenerator(decisions);
  const output = generator.generate();

  // Print summary
  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                    FIGMA CODE GENERATOR                           ║
╚═══════════════════════════════════════════════════════════════════╝

Framework: ${output.framework}
`);

  if (output.imports.length > 0) {
    info(`� Components to Import (${output.imports.length}):`);
    output.imports.forEach(i => {
      console.log(`   • ${i.componentName} → ${i.usage}`);
    });
    console.log('');
  }

  if (output.variants.length > 0) {
    console.log(`➕ Variants to Add (${output.variants.length}):`);
    output.variants.forEach(v => {
      console.log(`   • ${v.componentName} + "${v.variantName}"`);
    });
    console.log('');
  }

  if (output.newComponents.length > 0) {
    info(`� New Components to Create (${output.newComponents.length}):`);
    output.newComponents.forEach(c => {
      console.log(`   • ${c.componentName} → ${c.suggestedPath}`);
    });
    console.log('');
  }

  // Save output
  const outputPath = path.join(WORKFLOW_DIR, 'state', 'figma-output.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  info(`� Full output saved to: ${path.relative(PROJECT_ROOT, outputPath)}`);

  // Print prompts for new components
  if (output.prompts.length > 0) {
    console.log(`
${'─'.repeat(70)}
PROMPTS FOR CLAUDE (copy these to generate components):
${'─'.repeat(70)}
`);
    output.prompts.forEach((p, i) => {
      console.log(`\n=== ${i + 1}. ${p.componentName} ===\n`);
      console.log(p.prompt);
    });
  }

  // Log to request-log
  const summary = [];
  if (output.imports.length > 0) summary.push(`${output.imports.length} imports`);
  if (output.variants.length > 0) summary.push(`${output.variants.length} variants`);
  if (output.newComponents.length > 0) summary.push(`${output.newComponents.length} new components`);

  if (summary.length > 0) {
    const componentNames = [
      ...output.imports.map(i => i.componentName),
      ...output.variants.map(v => v.componentName),
      ...output.newComponents.map(c => c.componentName)
    ];

    addRequestLogEntry({
      type: 'new',
      tags: ['#figma', ...componentNames.slice(0, 3).map(n => `#component:${n}`)],
      request: 'Figma design analysis and code generation',
      result: `Generated: ${summary.join(', ')}`,
      files: [path.relative(PROJECT_ROOT, outputPath)]
    });

    console.log('\n📝 Logged to request-log.md');
  }

  // Add new components to app-map
  if (output.newComponents.length > 0) {
    let addedCount = 0;
    for (const comp of output.newComponents) {
      const added = addAppMapComponent({
        name: comp.componentName,
        type: 'component',
        path: comp.suggestedPath,
        variants: [],
        description: `Generated from Figma (${output.framework})`
      });
      if (added) addedCount++;
    }
    if (addedCount > 0) {
      info(`� Added ${addedCount} component(s) to app-map.md`);
    }
  }
}

module.exports = { CodeGenerator, FRAMEWORK_TEMPLATES };

if (require.main === module) {
  main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
