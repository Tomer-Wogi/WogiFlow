#!/usr/bin/env node

/**
 * Wogi Flow - Template Generator
 *
 * Analyzes project code and generates customized templates for hybrid mode.
 * Run during onboarding or manually to refresh templates.
 *
 * Usage:
 *   flow-templates generate    # Generate all templates
 *   flow-templates analyze     # Analyze project patterns only
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();
const TEMPLATES_DIR = path.join(PROJECT_ROOT, 'templates', 'hybrid');
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');

// ============================================================
// Project Analyzer
// ============================================================

class ProjectAnalyzer {
  constructor() {
    this.patterns = {
      framework: null,
      stateManagement: null,
      styling: null,
      testing: null,
      components: [],
      hooks: [],
      services: [],
      utilities: []
    };
  }

  analyze() {
    console.log('🔍 Analyzing project...\n');

    this.detectFramework();
    this.detectStateManagement();
    this.detectStyling();
    this.detectTesting();
    this.findExamples();
    this.extractNamingConventions();
    this.extractImportPatterns();

    return this.patterns;
  }

  detectFramework() {
    const packageJson = this.loadPackageJson();
    if (!packageJson) return;

    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

    if (deps['next']) {
      this.patterns.framework = 'Next.js';
      this.patterns.frameworkVersion = deps['next'];
    } else if (deps['@remix-run/react']) {
      this.patterns.framework = 'Remix';
    } else if (deps['gatsby']) {
      this.patterns.framework = 'Gatsby';
    } else if (deps['vue']) {
      this.patterns.framework = 'Vue';
    } else if (deps['@angular/core']) {
      this.patterns.framework = 'Angular';
    } else if (deps['react']) {
      this.patterns.framework = 'React';
      this.patterns.frameworkVersion = deps['react'];
    }

    console.log(`  Framework: ${this.patterns.framework || 'Unknown'}`);
  }

  detectStateManagement() {
    const packageJson = this.loadPackageJson();
    if (!packageJson) return;

    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

    if (deps['zustand']) {
      this.patterns.stateManagement = 'Zustand';
    } else if (deps['@reduxjs/toolkit'] || deps['redux']) {
      this.patterns.stateManagement = 'Redux';
    } else if (deps['mobx']) {
      this.patterns.stateManagement = 'MobX';
    } else if (deps['recoil']) {
      this.patterns.stateManagement = 'Recoil';
    } else if (deps['jotai']) {
      this.patterns.stateManagement = 'Jotai';
    }

    console.log(`  State Management: ${this.patterns.stateManagement || 'None detected'}`);
  }

  detectStyling() {
    const packageJson = this.loadPackageJson();
    if (!packageJson) return;

    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

    const stylingOptions = [];

    if (deps['tailwindcss']) stylingOptions.push('Tailwind CSS');
    if (deps['styled-components']) stylingOptions.push('Styled Components');
    if (deps['@emotion/react']) stylingOptions.push('Emotion');
    if (deps['sass'] || deps['node-sass']) stylingOptions.push('SASS');
    if (deps['@mui/material']) stylingOptions.push('Material UI');
    if (deps['@chakra-ui/react']) stylingOptions.push('Chakra UI');
    if (deps['class-variance-authority']) stylingOptions.push('CVA');

    this.patterns.styling = stylingOptions.length > 0 ? stylingOptions : ['CSS Modules'];
    console.log(`  Styling: ${this.patterns.styling.join(', ')}`);
  }

  detectTesting() {
    const packageJson = this.loadPackageJson();
    if (!packageJson) return;

    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

    if (deps['vitest']) {
      this.patterns.testing = 'Vitest';
    } else if (deps['jest']) {
      this.patterns.testing = 'Jest';
    } else if (deps['@testing-library/react']) {
      this.patterns.testing = 'React Testing Library';
    }

    console.log(`  Testing: ${this.patterns.testing || 'None detected'}`);
  }

  findExamples() {
    console.log('\n  Finding code examples...');

    const componentDirs = ['src/components', 'components', 'app/components'];
    for (const dir of componentDirs) {
      if (fs.existsSync(path.join(PROJECT_ROOT, dir))) {
        this.patterns.components = this.findFilesWithExports(dir, /\.(tsx|jsx)$/);
        console.log(`    Components: ${this.patterns.components.length} found`);
        break;
      }
    }

    const hookDirs = ['src/hooks', 'hooks', 'app/hooks'];
    for (const dir of hookDirs) {
      if (fs.existsSync(path.join(PROJECT_ROOT, dir))) {
        this.patterns.hooks = this.findFilesWithExports(dir, /^use.*\.(ts|tsx)$/);
        console.log(`    Hooks: ${this.patterns.hooks.length} found`);
        break;
      }
    }

    const serviceDirs = ['src/services', 'services', 'src/api', 'api', 'src/lib'];
    for (const dir of serviceDirs) {
      if (fs.existsSync(path.join(PROJECT_ROOT, dir))) {
        this.patterns.services = this.findFilesWithExports(dir, /\.(ts|js)$/);
        console.log(`    Services: ${this.patterns.services.length} found`);
        break;
      }
    }

    const utilDirs = ['src/utils', 'utils', 'src/lib/utils', 'lib/utils'];
    for (const dir of utilDirs) {
      if (fs.existsSync(path.join(PROJECT_ROOT, dir))) {
        this.patterns.utilities = this.findFilesWithExports(dir, /\.(ts|js)$/);
        console.log(`    Utilities: ${this.patterns.utilities.length} found`);
        break;
      }
    }
  }

  findFilesWithExports(dir, pattern) {
    const results = [];
    const fullDir = path.join(PROJECT_ROOT, dir);

    if (!fs.existsSync(fullDir)) return results;

    const walkDir = (currentDir) => {
      const files = fs.readdirSync(currentDir);

      for (const file of files) {
        const filePath = path.join(currentDir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory() && !file.startsWith('_') && file !== 'node_modules') {
          walkDir(filePath);
        } else if (stat.isFile() && pattern.test(file)) {
          const content = fs.readFileSync(filePath, 'utf-8');
          const relativePath = path.relative(PROJECT_ROOT, filePath);

          const exports = this.extractExports(content);
          if (exports.length > 0) {
            results.push({
              path: relativePath,
              name: path.basename(file, path.extname(file)),
              exports,
              content: content.slice(0, 3000)
            });
          }
        }
      }
    };

    walkDir(fullDir);
    return results.slice(0, 5);
  }

  extractExports(content) {
    const exports = [];

    const namedExportRegex = /export\s+(?:const|function|class|interface|type)\s+(\w+)/g;
    let match;
    while ((match = namedExportRegex.exec(content)) !== null) {
      exports.push(match[1]);
    }

    if (/export\s+default/.test(content)) {
      exports.push('default');
    }

    return exports;
  }

  extractNamingConventions() {
    this.patterns.naming = {
      components: 'PascalCase',
      hooks: 'camelCase with use prefix',
      services: 'camelCase',
      utilities: 'camelCase',
      types: 'PascalCase',
      files: {
        components: 'PascalCase.tsx',
        hooks: 'useXxx.ts',
        services: 'xxxService.ts'
      }
    };
  }

  extractImportPatterns() {
    const tsconfigPath = path.join(PROJECT_ROOT, 'tsconfig.json');
    if (fs.existsSync(tsconfigPath)) {
      try {
        const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'));
        const paths = tsconfig.compilerOptions?.paths || {};

        this.patterns.importAliases = Object.keys(paths).map(alias => ({
          alias: alias.replace('/*', ''),
          path: paths[alias][0]?.replace('/*', '') || ''
        }));

        console.log(`\n  Import aliases: ${this.patterns.importAliases.map(a => a.alias).join(', ') || 'None'}`);
      } catch (err) {
        // Ignore tsconfig parse errors
      }
    }
  }

  loadPackageJson() {
    const pkgPath = path.join(PROJECT_ROOT, 'package.json');
    if (fs.existsSync(pkgPath)) {
      return JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    }
    return null;
  }
}

// ============================================================
// Template Generator
// ============================================================

class TemplateGenerator {
  constructor(patterns) {
    this.patterns = patterns;
  }

  generateAll() {
    console.log('\n📝 Generating templates...\n');

    if (!fs.existsSync(TEMPLATES_DIR)) {
      fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
    }

    this.generateBase();
    this.generatePatterns();
    this.generateComponentTemplate();
    this.generateHookTemplate();
    this.generateServiceTemplate();
    this.generateUtilityTemplate();
    this.generatePageTemplate();
    this.generateTypeTemplate();
    this.generateModifyFileTemplate();
    this.generateTestTemplate();
    this.generateFixBugTemplate();

    console.log('\n✅ Templates generated successfully!\n');
  }

  generateBase() {
    const template = `# Universal Rules

You are generating code for a ${this.patterns.framework || 'JavaScript'} project.

## Critical Rules

1. Output ONLY code. No explanations, no markdown code blocks, no preamble.
2. Use TypeScript with proper types.
3. Follow the existing patterns shown in _patterns.md
4. Include all necessary imports at the top.
5. Add brief JSDoc comments for exported functions/components.
6. Do NOT create files that weren't requested.
7. Match the project's naming conventions exactly.

## Project Stack

- Framework: ${this.patterns.framework || 'React'}
- State Management: ${this.patterns.stateManagement || 'React hooks'}
- Styling: ${this.patterns.styling?.join(', ') || 'CSS'}
- Testing: ${this.patterns.testing || 'None configured'}

## Import Aliases

${this.patterns.importAliases?.map(a => `- \`${a.alias}\` → \`${a.path}\``).join('\n') || 'No aliases configured'}

## Validation

After you output code, it will be automatically validated:
- TypeScript compilation check
- ESLint check

If validation fails, you'll receive the error and must fix it.
`;

    fs.writeFileSync(path.join(TEMPLATES_DIR, '_base.md'), template);
    console.log('  ✓ _base.md');
  }

  generatePatterns() {
    let template = `# Project Patterns

These patterns are extracted from the actual codebase. Follow them exactly.

`;

    const componentExample = this.patterns.components?.[0];
    if (componentExample) {
      template += `## Component Pattern

Based on: \`${componentExample.path}\`

\`\`\`typescript
${componentExample.content}
\`\`\`

`;
    }

    const hookExample = this.patterns.hooks?.[0];
    if (hookExample) {
      template += `## Hook Pattern

Based on: \`${hookExample.path}\`

\`\`\`typescript
${hookExample.content}
\`\`\`

`;
    }

    const serviceExample = this.patterns.services?.[0];
    if (serviceExample) {
      template += `## Service Pattern

Based on: \`${serviceExample.path}\`

\`\`\`typescript
${serviceExample.content}
\`\`\`

`;
    }

    template += `## Naming Conventions

- Components: PascalCase (e.g., \`UserProfile.tsx\`)
- Hooks: camelCase with \`use\` prefix (e.g., \`useAuth.ts\`)
- Services: camelCase with \`Service\` suffix (e.g., \`authService.ts\`)
- Utilities: camelCase (e.g., \`formatDate.ts\`)
- Types/Interfaces: PascalCase (e.g., \`UserProfile\`, \`AuthResponse\`)

## Import Order

1. React/framework imports
2. Third-party libraries
3. Aliased imports (@/ or ~/)
4. Relative imports
5. Type imports (with \`type\` keyword)

## File Structure

\`\`\`
src/
├── components/     # UI components
├── hooks/          # Custom React hooks
├── services/       # API and business logic
├── lib/            # Utilities and helpers
├── types/          # TypeScript type definitions
└── app/ or pages/  # Routes/pages
\`\`\`
`;

    fs.writeFileSync(path.join(TEMPLATES_DIR, '_patterns.md'), template);
    console.log('  ✓ _patterns.md');
  }

  generateComponentTemplate() {
    const template = `{{include _base.md}}

# Task: Create React Component

{{include _patterns.md}}

## Component Specification

**Name:** {{name}}
**File Path:** {{path}}

**Props:**
{{props}}

**Description:**
{{description}}

**Must Use These Existing Components/Hooks:**
{{uses}}

**Expected Behavior:**
{{behavior}}

## Requirements

1. Create a functional component with proper TypeScript types
2. Define a Props interface named \`{{name}}Props\`
3. Export as named export: \`export function {{name}}\`
4. Use the existing components and hooks listed above
5. Follow the component pattern from _patterns.md exactly
6. Add JSDoc comment describing the component

## Output

Output the complete file content starting with imports. No markdown code blocks.
`;

    fs.writeFileSync(path.join(TEMPLATES_DIR, 'create-component.md'), template);
    console.log('  ✓ create-component.md');
  }

  generateHookTemplate() {
    const template = `{{include _base.md}}

# Task: Create React Hook

{{include _patterns.md}}

## Hook Specification

**Name:** {{name}}
**File Path:** {{path}}

**Return Values:**
{{returns}}

**Description:**
{{description}}

**Dependencies/Uses:**
{{uses}}

## Requirements

1. Name must start with "use"
2. Return an object with named properties (not array)
3. Handle loading and error states if applicable
4. Define return type interface
5. Follow the hook pattern from _patterns.md exactly
6. Add JSDoc comment describing the hook

## Output

Output the complete file content starting with imports. No markdown code blocks.
`;

    fs.writeFileSync(path.join(TEMPLATES_DIR, 'create-hook.md'), template);
    console.log('  ✓ create-hook.md');
  }

  generateServiceTemplate() {
    const template = `{{include _base.md}}

# Task: Create Service

{{include _patterns.md}}

## Service Specification

**Name:** {{name}}
**File Path:** {{path}}

**Methods:**
{{methods}}

**Description:**
{{description}}

**Types to Define:**
{{types}}

## Requirements

1. Export as a singleton object or class
2. Define all TypeScript types for parameters and returns
3. Handle errors appropriately
4. Follow the service pattern from _patterns.md exactly
5. Add JSDoc comments for each method

## Output

Output the complete file content starting with imports. No markdown code blocks.
`;

    fs.writeFileSync(path.join(TEMPLATES_DIR, 'create-service.md'), template);
    console.log('  ✓ create-service.md');
  }

  generateUtilityTemplate() {
    const template = `{{include _base.md}}

# Task: Create Utility Function(s)

{{include _patterns.md}}

## Utility Specification

**File Path:** {{path}}

**Functions:**
{{functions}}

**Description:**
{{description}}

## Requirements

1. Pure functions with no side effects where possible
2. Full TypeScript types for parameters and returns
3. Handle edge cases
4. Add JSDoc comments with examples
5. Export each function as named export

## Output

Output the complete file content starting with imports. No markdown code blocks.
`;

    fs.writeFileSync(path.join(TEMPLATES_DIR, 'create-utility.md'), template);
    console.log('  ✓ create-utility.md');
  }

  generatePageTemplate() {
    const framework = this.patterns.framework || 'React';

    let template = `{{include _base.md}}

# Task: Create Page Component

{{include _patterns.md}}

## Page Specification

**Name:** {{name}}
**File Path:** {{path}}

**Description:**
{{description}}

**Required Components:**
{{components}}

**Data Requirements:**
{{data}}

`;

    if (framework === 'Next.js') {
      template += `## Next.js Requirements

- Use App Router conventions if path is in \`app/\` directory
- Use Pages Router conventions if path is in \`pages/\` directory
- Export metadata if needed
- Handle loading and error states

`;
    }

    template += `## Output

Output the complete file content starting with imports. No markdown code blocks.
`;

    fs.writeFileSync(path.join(TEMPLATES_DIR, 'create-page.md'), template);
    console.log('  ✓ create-page.md');
  }

  generateTypeTemplate() {
    const template = `{{include _base.md}}

# Task: Create TypeScript Types

## Type Specification

**File Path:** {{path}}

**Types to Create:**
{{types}}

**Description:**
{{description}}

## Requirements

1. Use \`interface\` for object shapes that might be extended
2. Use \`type\` for unions, intersections, or simple aliases
3. Export all types
4. Add JSDoc comments explaining each type
5. Use descriptive property names

## Output

Output the complete file content. No markdown code blocks.
`;

    fs.writeFileSync(path.join(TEMPLATES_DIR, 'create-type.md'), template);
    console.log('  ✓ create-type.md');
  }

  generateModifyFileTemplate() {
    const template = `{{include _base.md}}

# Task: Modify Existing File

## File to Modify

**Path:** {{path}}

## Current File Content

\`\`\`
{{currentContent}}
\`\`\`

## Required Changes

{{modifications}}

## Requirements

1. Make ONLY the specified changes
2. Preserve all existing code and formatting
3. Maintain proper imports (add new ones if needed)
4. Keep the file's existing style

## Output

Output the COMPLETE modified file with all changes applied.
Do NOT output a diff or partial content.
Output the entire file content, starting with imports.
No markdown code blocks.
`;

    fs.writeFileSync(path.join(TEMPLATES_DIR, 'modify-file.md'), template);
    console.log('  ✓ modify-file.md');
  }

  generateTestTemplate() {
    const testing = this.patterns.testing || 'Jest';

    const template = `{{include _base.md}}

# Task: Create Test File

## Test Specification

**File Path:** {{path}}
**Testing:** {{testTarget}}
**Test Framework:** ${testing}

**Test Cases:**
{{testCases}}

## Requirements

1. Import the module being tested
2. Group tests with \`describe\` blocks
3. Use clear test names that describe expected behavior
4. Include happy path and edge cases
5. Mock external dependencies

## Output

Output the complete test file. No markdown code blocks.
`;

    fs.writeFileSync(path.join(TEMPLATES_DIR, 'create-test.md'), template);
    console.log('  ✓ create-test.md');
  }

  generateFixBugTemplate() {
    const template = `{{include _base.md}}

# Task: Fix Bug

## Bug Details

**File:** {{path}}
**Bug Description:** {{bugDescription}}
**Expected Behavior:** {{expectedBehavior}}
**Actual Behavior:** {{actualBehavior}}

## Current File Content

\`\`\`
{{currentContent}}
\`\`\`

## Error Message (if any)

{{errorMessage}}

## Requirements

1. Identify the root cause
2. Fix ONLY what's necessary
3. Don't refactor unrelated code
4. Ensure the fix doesn't break other functionality
5. Add a comment explaining the fix if it's not obvious

## Output

Output the COMPLETE fixed file.
No markdown code blocks.
`;

    fs.writeFileSync(path.join(TEMPLATES_DIR, 'fix-bug.md'), template);
    console.log('  ✓ fix-bug.md');
  }
}

// ============================================================
// Main CLI
// ============================================================

async function main() {
  const [,, command] = process.argv;

  switch (command) {
    case 'generate': {
      const analyzer = new ProjectAnalyzer();
      const patterns = analyzer.analyze();

      const generator = new TemplateGenerator(patterns);
      generator.generateAll();

      const stateDir = path.join(WORKFLOW_DIR, 'state');
      if (!fs.existsSync(stateDir)) {
        fs.mkdirSync(stateDir, { recursive: true });
      }
      const patternsPath = path.join(stateDir, 'project-patterns.json');
      fs.writeFileSync(patternsPath, JSON.stringify(patterns, null, 2));
      console.log(`Patterns saved to: ${patternsPath}`);
      break;
    }

    case 'analyze': {
      const analyzer = new ProjectAnalyzer();
      const patterns = analyzer.analyze();
      console.log('\nPatterns:', JSON.stringify(patterns, null, 2));
      break;
    }

    default:
      console.log(`
Wogi Flow Template Generator

Commands:
  generate    Analyze project and generate templates
  analyze     Analyze project patterns only

Usage:
  ./scripts/flow-templates.js generate
      `);
  }
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
