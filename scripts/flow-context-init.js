#!/usr/bin/env node

/**
 * Wogi Flow - Project Context Initializer
 *
 * Creates and manages project context files:
 * - stack.md - Technology stack (auto-detected + human verified)
 * - constraints.md - Immutable rules (human controlled)
 * - conventions.md - Coding patterns (AI can propose updates)
 *
 * Usage:
 *   flow context-init              # Initialize context files
 *   flow context-init --rescan     # Rescan and update stack.md
 *   flow context show              # Show all context
 *   flow context stack             # Show stack.md
 *   flow context constraints       # Show constraints.md
 *   flow context conventions       # Show conventions.md
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot, colors: c } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const CONTEXT_DIR = path.join(WORKFLOW_DIR, 'context');
const TEMPLATES_DIR = path.join(__dirname, '..', 'templates', 'context');

/**
 * Detect technology stack from project files
 */
function detectStack() {
  const stack = {
    language: null,
    languageVersion: null,
    runtime: null,
    packageManager: null,
    frameworks: {
      frontend: null,
      backend: null,
      fullStack: null
    },
    testing: null,
    linting: null,
    formatting: null,
    typeChecking: null,
    bundler: null,
    database: null,
    orm: null,
    dependencies: {}
  };

  // Check package.json for Node.js projects
  const packageJsonPath = path.join(PROJECT_ROOT, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      stack.runtime = 'Node.js';

      // Detect language
      if (deps.typescript) {
        stack.language = 'TypeScript';
        stack.languageVersion = deps.typescript.replace(/[\^~]/g, '');
        stack.typeChecking = 'TypeScript';
      } else {
        stack.language = 'JavaScript';
      }

      // Detect frameworks
      if (deps.next) {
        stack.frameworks.fullStack = `Next.js ${deps.next.replace(/[\^~]/g, '')}`;
      } else if (deps.nuxt) {
        stack.frameworks.fullStack = `Nuxt ${deps.nuxt.replace(/[\^~]/g, '')}`;
      } else if (deps['@sveltejs/kit']) {
        stack.frameworks.fullStack = 'SvelteKit';
      }

      if (deps.react) {
        stack.frameworks.frontend = `React ${deps.react.replace(/[\^~]/g, '')}`;
      } else if (deps.vue) {
        stack.frameworks.frontend = `Vue ${deps.vue.replace(/[\^~]/g, '')}`;
      } else if (deps.svelte) {
        stack.frameworks.frontend = `Svelte ${deps.svelte.replace(/[\^~]/g, '')}`;
      } else if (deps['@angular/core']) {
        stack.frameworks.frontend = `Angular ${deps['@angular/core'].replace(/[\^~]/g, '')}`;
      }

      if (deps.express) {
        stack.frameworks.backend = `Express ${deps.express.replace(/[\^~]/g, '')}`;
      } else if (deps.fastify) {
        stack.frameworks.backend = `Fastify ${deps.fastify.replace(/[\^~]/g, '')}`;
      } else if (deps['@nestjs/core']) {
        stack.frameworks.backend = 'NestJS';
      } else if (deps.hono) {
        stack.frameworks.backend = `Hono ${deps.hono.replace(/[\^~]/g, '')}`;
      }

      // Detect testing
      if (deps.vitest) {
        stack.testing = 'Vitest';
      } else if (deps.jest) {
        stack.testing = 'Jest';
      } else if (deps.mocha) {
        stack.testing = 'Mocha';
      } else if (deps['@playwright/test']) {
        stack.testing = 'Playwright';
      }

      // Detect linting
      if (deps['@biomejs/biome'] || deps.biome) {
        stack.linting = 'Biome';
        stack.formatting = 'Biome';
      } else if (deps.eslint) {
        stack.linting = 'ESLint';
      }

      // Detect formatting
      if (!stack.formatting && deps.prettier) {
        stack.formatting = 'Prettier';
      }

      // Detect bundler
      if (deps.vite) {
        stack.bundler = 'Vite';
      } else if (deps.webpack) {
        stack.bundler = 'Webpack';
      } else if (deps.esbuild) {
        stack.bundler = 'esbuild';
      } else if (deps.rollup) {
        stack.bundler = 'Rollup';
      } else if (deps.parcel) {
        stack.bundler = 'Parcel';
      }

      // Detect database/ORM
      if (deps.prisma || deps['@prisma/client']) {
        stack.orm = 'Prisma';
      } else if (deps.drizzle || deps['drizzle-orm']) {
        stack.orm = 'Drizzle';
      } else if (deps.typeorm) {
        stack.orm = 'TypeORM';
      } else if (deps.sequelize) {
        stack.orm = 'Sequelize';
      } else if (deps.mongoose) {
        stack.orm = 'Mongoose';
        stack.database = 'MongoDB';
      }

      if (deps.pg || deps.postgres) {
        stack.database = 'PostgreSQL';
      } else if (deps.mysql2 || deps.mysql) {
        stack.database = 'MySQL';
      } else if (deps['better-sqlite3'] || deps.sqlite3) {
        stack.database = 'SQLite';
      }

      // Store key dependencies
      const keyDeps = ['react', 'vue', 'svelte', 'next', 'express', 'fastify',
        'prisma', 'typescript', 'vite', 'tailwindcss', 'zod', 'trpc'];
      for (const dep of keyDeps) {
        if (deps[dep]) {
          stack.dependencies[dep] = deps[dep].replace(/[\^~]/g, '');
        }
      }
    } catch (err) {
      console.error(`${c.yellow}Warning: Could not parse package.json${c.reset}`);
    }
  }

  // Detect package manager
  if (fs.existsSync(path.join(PROJECT_ROOT, 'pnpm-lock.yaml'))) {
    stack.packageManager = 'pnpm';
  } else if (fs.existsSync(path.join(PROJECT_ROOT, 'yarn.lock'))) {
    stack.packageManager = 'yarn';
  } else if (fs.existsSync(path.join(PROJECT_ROOT, 'bun.lockb'))) {
    stack.packageManager = 'bun';
    stack.runtime = 'Bun';
  } else if (fs.existsSync(path.join(PROJECT_ROOT, 'package-lock.json'))) {
    stack.packageManager = 'npm';
  }

  // Check for Python projects
  const requirementsPath = path.join(PROJECT_ROOT, 'requirements.txt');
  const pyprojectPath = path.join(PROJECT_ROOT, 'pyproject.toml');
  if (fs.existsSync(requirementsPath) || fs.existsSync(pyprojectPath)) {
    stack.language = 'Python';
    stack.runtime = 'Python';

    if (fs.existsSync(path.join(PROJECT_ROOT, 'poetry.lock'))) {
      stack.packageManager = 'Poetry';
    } else if (fs.existsSync(path.join(PROJECT_ROOT, 'Pipfile.lock'))) {
      stack.packageManager = 'Pipenv';
    } else {
      stack.packageManager = 'pip';
    }

    // Try to detect Python frameworks
    const requirements = fs.existsSync(requirementsPath)
      ? fs.readFileSync(requirementsPath, 'utf-8')
      : '';

    if (requirements.includes('fastapi') || requirements.includes('FastAPI')) {
      stack.frameworks.backend = 'FastAPI';
    } else if (requirements.includes('django') || requirements.includes('Django')) {
      stack.frameworks.backend = 'Django';
    } else if (requirements.includes('flask') || requirements.includes('Flask')) {
      stack.frameworks.backend = 'Flask';
    }

    if (requirements.includes('pytest')) {
      stack.testing = 'pytest';
    }
  }

  // Check for Rust projects
  const cargoPath = path.join(PROJECT_ROOT, 'Cargo.toml');
  if (fs.existsSync(cargoPath)) {
    stack.language = 'Rust';
    stack.runtime = 'Rust';
    stack.packageManager = 'Cargo';
  }

  // Check for Go projects
  const goModPath = path.join(PROJECT_ROOT, 'go.mod');
  if (fs.existsSync(goModPath)) {
    stack.language = 'Go';
    stack.runtime = 'Go';
    stack.packageManager = 'Go Modules';
  }

  return stack;
}

/**
 * Generate stack.md content from detected stack
 */
function generateStackContent(stack) {
  const timestamp = new Date().toISOString().slice(0, 10);

  let content = `# Technology Stack

Auto-detected on ${timestamp}. Please verify and update as needed.

---

## Runtime
- **Language**: ${stack.language || 'Not detected'}${stack.languageVersion ? ` ${stack.languageVersion}` : ''}
- **Runtime**: ${stack.runtime || 'Not detected'}
- **Package Manager**: ${stack.packageManager || 'Not detected'}

## Frameworks
- **Frontend**: ${stack.frameworks.frontend || 'None'}
- **Backend**: ${stack.frameworks.backend || 'None'}
- **Full-Stack**: ${stack.frameworks.fullStack || 'None'}

## Build & Tooling
- **Bundler**: ${stack.bundler || 'Not detected'}
- **Testing**: ${stack.testing || 'Not detected'}
- **Linting**: ${stack.linting || 'Not detected'}
- **Formatting**: ${stack.formatting || 'Not detected'}
- **Type Checking**: ${stack.typeChecking || 'None'}

## Infrastructure
- **Database**: ${stack.database || 'Not detected'}
- **ORM/ODM**: ${stack.orm || 'Not detected'}

`;

  // Add key dependencies
  const depEntries = Object.entries(stack.dependencies);
  if (depEntries.length > 0) {
    content += `## Key Dependencies

| Dependency | Version |
|------------|---------|
`;
    for (const [name, version] of depEntries) {
      content += `| ${name} | ${version} |\n`;
    }
    content += '\n';
  }

  content += `---

*Last updated: ${timestamp}*
*Updated by: auto-detect*
`;

  return content;
}

/**
 * Initialize context files
 */
function initContext(options = {}) {
  // Create context directory
  if (!fs.existsSync(CONTEXT_DIR)) {
    fs.mkdirSync(CONTEXT_DIR, { recursive: true });
  }

  const results = {
    stack: false,
    constraints: false,
    conventions: false
  };

  // Generate stack.md
  const stackPath = path.join(CONTEXT_DIR, 'stack.md');
  if (!fs.existsSync(stackPath) || options.rescan) {
    const stack = detectStack();
    const content = generateStackContent(stack);
    fs.writeFileSync(stackPath, content);
    results.stack = true;
    console.log(`${c.green}✅ ${options.rescan ? 'Updated' : 'Created'} stack.md${c.reset}`);
  } else {
    console.log(`${c.dim}   stack.md already exists (use --rescan to update)${c.reset}`);
  }

  // Copy constraints.md template
  const constraintsPath = path.join(CONTEXT_DIR, 'constraints.md');
  if (!fs.existsSync(constraintsPath)) {
    const templatePath = path.join(TEMPLATES_DIR, 'constraints.md');
    if (fs.existsSync(templatePath)) {
      let content = fs.readFileSync(templatePath, 'utf-8');
      content = content.replace(/\{\{date\}\}/g, new Date().toISOString().slice(0, 10));
      fs.writeFileSync(constraintsPath, content);
      results.constraints = true;
      console.log(`${c.green}✅ Created constraints.md${c.reset}`);
    }
  } else {
    console.log(`${c.dim}   constraints.md already exists${c.reset}`);
  }

  // Copy conventions.md template
  const conventionsPath = path.join(CONTEXT_DIR, 'conventions.md');
  if (!fs.existsSync(conventionsPath)) {
    const templatePath = path.join(TEMPLATES_DIR, 'conventions.md');
    if (fs.existsSync(templatePath)) {
      fs.copyFileSync(templatePath, conventionsPath);
      results.conventions = true;
      console.log(`${c.green}✅ Created conventions.md${c.reset}`);
    }
  } else {
    console.log(`${c.dim}   conventions.md already exists${c.reset}`);
  }

  return results;
}

/**
 * Show context file contents
 */
function showContext(file = null) {
  const files = file
    ? [file]
    : ['stack.md', 'constraints.md', 'conventions.md'];

  for (const f of files) {
    const filePath = path.join(CONTEXT_DIR, f.endsWith('.md') ? f : `${f}.md`);
    if (fs.existsSync(filePath)) {
      console.log(`\n${c.cyan}${c.bold}=== ${f} ===${c.reset}\n`);
      console.log(fs.readFileSync(filePath, 'utf-8'));
    } else {
      console.log(`${c.yellow}File not found: ${f}${c.reset}`);
      console.log(`${c.dim}Run "flow context-init" to create context files${c.reset}`);
    }
  }
}

/**
 * Load all context for LLM prompts
 */
function loadProjectContext() {
  const context = {};
  const files = ['stack.md', 'constraints.md', 'conventions.md'];

  for (const file of files) {
    const filePath = path.join(CONTEXT_DIR, file);
    if (fs.existsSync(filePath)) {
      const key = file.replace('.md', '');
      context[key] = fs.readFileSync(filePath, 'utf-8');
    }
  }

  return context;
}

/**
 * Get context summary for prompts
 */
function getContextSummary() {
  const context = loadProjectContext();
  let summary = '';

  if (context.stack) {
    summary += '## Technology Stack\n' + context.stack + '\n\n';
  }

  if (context.constraints) {
    summary += '## Project Constraints (MUST FOLLOW)\n' + context.constraints + '\n\n';
  }

  if (context.conventions) {
    summary += '## Coding Conventions\n' + context.conventions + '\n\n';
  }

  return summary;
}

// Module exports
module.exports = {
  detectStack,
  initContext,
  showContext,
  loadProjectContext,
  getContextSummary
};

// CLI Handler
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'init':
    case undefined: {
      const rescan = args.includes('--rescan');
      console.log(`${c.cyan}${c.bold}Initializing Project Context${c.reset}\n`);
      initContext({ rescan });
      console.log(`\n${c.dim}Context files created in .workflow/context/${c.reset}`);
      break;
    }

    case 'show': {
      const file = args[1];
      showContext(file);
      break;
    }

    case 'stack':
    case 'constraints':
    case 'conventions': {
      showContext(command);
      break;
    }

    case 'detect': {
      const stack = detectStack();
      console.log(JSON.stringify(stack, null, 2));
      break;
    }

    case '--help':
    case '-h': {
      console.log(`
${c.cyan}Wogi Flow - Project Context Manager${c.reset}

${c.bold}Usage:${c.reset}
  flow context-init              Initialize context files
  flow context-init --rescan     Rescan and update stack.md
  flow context show [file]       Show context file(s)
  flow context stack             Show stack.md
  flow context constraints       Show constraints.md
  flow context conventions       Show conventions.md
  flow context detect            Detect stack (JSON output)

${c.bold}Files:${c.reset}
  stack.md        Technology stack (auto-detected)
  constraints.md  Immutable rules (human-controlled)
  conventions.md  Coding patterns (AI can propose updates)
      `);
      break;
    }

    default:
      console.log(`${c.red}Unknown command: ${command}${c.reset}`);
      console.log(`${c.dim}Run "flow context-init --help" for usage${c.reset}`);
      process.exit(1);
  }
}
