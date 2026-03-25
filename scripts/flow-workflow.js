#!/usr/bin/env node

/**
 * Wogi Flow - Declarative Workflow Engine
 *
 * Conditional routing and bounded loops for automation:
 * - YAML-based workflow definitions
 * - Conditional step execution
 * - Bounded loop iterations
 * - Step dependencies
 *
 * Usage as module:
 *   const { Workflow, loadWorkflow, runWorkflow } = require('./flow-workflow');
 *   const workflow = loadWorkflow('deploy');
 *   await runWorkflow(workflow, context);
 *
 * Usage as CLI:
 *   flow workflow list                    # List workflows
 *   flow workflow run <name>              # Run a workflow
 *   flow workflow create <name>           # Create workflow template
 *   flow workflow validate <name>         # Validate workflow
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { getProjectRoot, colors: c, readJson, PATHS } = require('./flow-utils');
const { success: printSuccess, error: printError } = require('./flow-output');
const { detectPackageManager } = require('./flow-script-resolver');

const WORKFLOWS_DIR = path.join(PATHS.workflow, 'workflows');

/**
 * Validate that a path is within the project root (prevent path traversal)
 */
function validatePathWithinProject(targetPath, baseRoot = PATHS.root) {
  const resolvedPath = path.resolve(baseRoot, targetPath);
  const resolvedRoot = path.resolve(baseRoot);

  if (!resolvedPath.startsWith(resolvedRoot + path.sep) && resolvedPath !== resolvedRoot) {
    throw new Error(`Path traversal detected: ${targetPath} escapes project root`);
  }

  return resolvedPath;
}

/**
 * Step types
 */
const STEP_TYPES = {
  COMMAND: 'command',
  SCRIPT: 'script',
  GATE: 'gate',
  LOOP: 'loop',
  PARALLEL: 'parallel',
  CONDITIONAL: 'conditional'
};

/**
 * Detect project type (language, package manager)
 * Returns { language, packageManager } with defaults to Node.js/npm
 */
function detectProjectType(projectRoot = PATHS.root) {
  // Validate projectRoot to prevent path traversal
  const safeRoot = projectRoot === PATHS.root
    ? PATHS.root
    : validatePathWithinProject(projectRoot, PATHS.root);

  // Check for Go
  if (fs.existsSync(path.join(safeRoot, 'go.mod'))) {
    return { language: 'go', packageManager: 'go' };
  }

  // Check for Rust
  if (fs.existsSync(path.join(safeRoot, 'Cargo.toml'))) {
    return { language: 'rust', packageManager: 'cargo' };
  }

  // Check for Python
  if (fs.existsSync(path.join(safeRoot, 'pyproject.toml')) ||
      fs.existsSync(path.join(safeRoot, 'requirements.txt'))) {
    const pm = fs.existsSync(path.join(safeRoot, 'poetry.lock')) ? 'poetry'
             : fs.existsSync(path.join(safeRoot, 'Pipfile.lock')) ? 'pipenv'
             : 'pip';
    return { language: 'python', packageManager: pm };
  }

  // Default to Node.js - use canonical PM detection from flow-script-resolver
  return { language: 'node', packageManager: detectPackageManager(safeRoot) };
}

/**
 * Get quality gate command for an action (lint, test, build)
 * Adapts to detected package manager and language
 */
function getQualityCommand(action, projectRoot = PATHS.root) {
  const { language, packageManager } = detectProjectType(projectRoot);

  const commands = {
    node: {
      npm:  { lint: 'npm run lint', test: 'npm test', build: 'npm run build', fix: 'npm run fix' },
      yarn: { lint: 'yarn lint', test: 'yarn test', build: 'yarn build', fix: 'yarn fix' },
      pnpm: { lint: 'pnpm lint', test: 'pnpm test', build: 'pnpm build', fix: 'pnpm fix' },
      bun:  { lint: 'bun run lint', test: 'bun test', build: 'bun run build', fix: 'bun run fix' }
    },
    python: {
      pip:    { lint: 'ruff check .', test: 'pytest', build: 'python -m build', fix: 'ruff check . --fix' },
      poetry: { lint: 'poetry run ruff check .', test: 'poetry run pytest', build: 'poetry build', fix: 'poetry run ruff check . --fix' },
      pipenv: { lint: 'pipenv run ruff check .', test: 'pipenv run pytest', build: 'pipenv run python -m build', fix: 'pipenv run ruff check . --fix' }
    },
    go: {
      go: { lint: 'golangci-lint run', test: 'go test ./...', build: 'go build ./...', fix: 'gofmt -w .' }
    },
    rust: {
      cargo: { lint: 'cargo clippy', test: 'cargo test', build: 'cargo build', fix: 'cargo fix --allow-dirty' }
    }
  };

  const langCommands = commands[language] || commands.node;
  const pmCommands = langCommands[packageManager] || langCommands.npm || Object.values(langCommands)[0];

  return pmCommands[action] || pmCommands.lint;
}

/**
 * Simple YAML parser for workflow files
 */
function parseYaml(content) {
  const lines = content.split('\n');
  const result = {};
  const stack = [{ obj: result, indent: -1 }];
  let currentArray = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.search(/\S/);

    // Pop stack for lower indents
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].obj;

    // Array item
    if (trimmed.startsWith('- ')) {
      const value = trimmed.slice(2).trim();

      if (currentArray && Array.isArray(parent[currentArray])) {
        if (value.includes(':')) {
          // Object in array
          const [key, ...valueParts] = value.split(':');
          const obj = { [key]: valueParts.join(':').trim() };
          parent[currentArray].push(obj);
          stack.push({ obj: obj, indent: indent, key: currentArray });
        } else {
          parent[currentArray].push(value);
        }
      }
      continue;
    }

    // Key-value
    if (trimmed.includes(':')) {
      const colonIdx = trimmed.indexOf(':');
      const key = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();

      if (!value) {
        // Check if next line starts with - (array)
        const nextLine = lines[i + 1];
        const nextTrimmed = nextLine?.trim();

        if (nextTrimmed?.startsWith('- ')) {
          parent[key] = [];
          currentArray = key;
        } else {
          parent[key] = {};
          stack.push({ obj: parent[key], indent: indent, key: key });
        }
      } else {
        // Simple value
        parent[key] = value === 'true' ? true :
                      value === 'false' ? false :
                      /^\d+$/.test(value) ? parseInt(value) :
                      value;
        currentArray = null;
      }
    }
  }

  return result;
}

/**
 * Generate YAML from object
 */
function toYaml(obj, indent = 0) {
  let result = '';
  const spaces = '  '.repeat(indent);

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;

    if (Array.isArray(value)) {
      result += `${spaces}${key}:\n`;
      for (const item of value) {
        if (typeof item === 'object') {
          result += `${spaces}  - ${Object.entries(item)[0][0]}: ${Object.entries(item)[0][1]}\n`;
          for (const [k, v] of Object.entries(item).slice(1)) {
            result += `${spaces}    ${k}: ${v}\n`;
          }
        } else {
          result += `${spaces}  - ${item}\n`;
        }
      }
    } else if (typeof value === 'object') {
      result += `${spaces}${key}:\n`;
      result += toYaml(value, indent + 1);
    } else {
      result += `${spaces}${key}: ${value}\n`;
    }
  }

  return result;
}

/**
 * Dangerous command patterns that indicate injection attempts
 * SECURITY: These patterns are blocked to prevent command injection
 */
const DANGEROUS_PATTERNS = [
  /;\s*rm\s+-rf/i,           // ; rm -rf
  /;\s*dd\s+if=/i,           // ; dd if=
  /;\s*mkfs/i,               // ; mkfs
  /;\s*wget.*\|.*sh/i,       // wget | sh
  /;\s*curl.*\|.*sh/i,       // curl | sh
  /`[^`]*`/,                 // Backtick command substitution
  /\$\([^)]*\)/,             // $() command substitution
  />\s*\/dev\/(sd|hd|nvme)/i, // Write to disk devices
  /;\s*:(){ :|:& };:/,       // Fork bomb
  /\|\s*base64\s+-d\s*\|/i,  // Encoded payload execution
];

/**
 * Warning patterns - potentially dangerous but may be legitimate
 */
const WARNING_PATTERNS = [
  /;\s*sudo/i,               // sudo in chained command
  /\|\s*sh\s*$/i,            // Pipe to shell
  /\|\s*bash\s*$/i,          // Pipe to bash
  /eval\s+/i,                // eval usage
];

/**
 * Validate command for injection patterns
 * @param {string} command - Command to validate
 * @returns {{ safe: boolean, blocked: boolean, reason?: string }}
 */
function validateCommand(command) {
  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return {
        safe: false,
        blocked: true,
        reason: `Dangerous command pattern detected: ${pattern.toString()}`
      };
    }
  }

  // Check for warning patterns
  for (const pattern of WARNING_PATTERNS) {
    if (pattern.test(command)) {
      return {
        safe: false,
        blocked: false,
        reason: `Potentially dangerous pattern: ${pattern.toString()}`
      };
    }
  }

  return { safe: true, blocked: false };
}

/**
 * Execute a shell command with security validation
 *
 * SECURITY: Commands are validated for injection patterns before execution.
 * Dangerous patterns are blocked, warning patterns are logged.
 */
function executeCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    // Security validation
    const validation = validateCommand(command);

    if (validation.blocked) {
      reject(new Error(`SECURITY: Command blocked - ${validation.reason}`));
      return;
    }

    if (!validation.safe && process.env.DEBUG) {
      console.warn(`${c.yellow}Warning: ${validation.reason}${c.reset}`);
    }

    const startTime = Date.now();

    const proc = spawn('sh', ['-c', command], {
      cwd: options.cwd || PATHS.root,
      env: { ...process.env, ...options.env },
      timeout: options.timeout || 60000
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      if (options.stream) process.stdout.write(data);
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      if (options.stream) process.stderr.write(data);
    });

    proc.on('close', (code) => {
      resolve({
        exitCode: code,
        stdout,
        stderr,
        duration: Date.now() - startTime
      });
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Safe condition evaluator - NO arbitrary code execution
 * Only supports: ==, !=, >, <, >=, <=, &&, ||, !, true, false, strings, numbers
 * Variables: $var or ${var}
 *
 * SECURITY: Uses whitelist parsing instead of eval/Function to prevent code injection
 */
function evaluateCondition(condition, context) {
  // Replace variables first
  let expr = condition.replace(/\$\{?(\w+)\}?/g, (match, name) => {
    const value = context[name];
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'boolean') return value.toString();
    if (typeof value === 'number') return value.toString();
    return 'undefined';
  });

  // Use safe parser instead of eval
  return safeEvaluate(expr);
}

/**
 * Parse a literal value safely - only allows primitives
 */
function parseValue(str) {
  str = str.trim();

  // Boolean
  if (str === 'true') return true;
  if (str === 'false') return false;
  if (str === 'undefined' || str === 'null') return undefined;

  // Number
  if (/^-?\d+(\.\d+)?$/.test(str)) return parseFloat(str);

  // String (quoted)
  if ((str.startsWith('"') && str.endsWith('"')) ||
      (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1);
  }

  // Unquoted string (identifier-like)
  return str;
}

/**
 * Safe expression evaluator - whitelist approach only
 * Only allows: comparisons, logical operators, literals
 *
 * SECURITY: No eval, no Function, no dynamic code execution
 */
function safeEvaluate(expr) {
  expr = expr.trim();

  // Handle parentheses recursively
  while (expr.includes('(')) {
    expr = expr.replace(/\(([^()]+)\)/g, (_, inner) => {
      return safeEvaluate(inner) ? 'true' : 'false';
    });
  }

  // Handle logical OR (lowest precedence)
  if (expr.includes('||')) {
    const parts = splitOnOperator(expr, '||');
    return parts.some(part => safeEvaluate(part.trim()));
  }

  // Handle logical AND
  if (expr.includes('&&')) {
    const parts = splitOnOperator(expr, '&&');
    return parts.every(part => safeEvaluate(part.trim()));
  }

  // Handle NOT
  if (expr.startsWith('!')) {
    return !safeEvaluate(expr.slice(1).trim());
  }

  // Handle comparisons (order matters - check longer operators first)
  const compMatch = expr.match(/^(.+?)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/);
  if (compMatch) {
    const left = parseValue(compMatch[1].trim());
    const op = compMatch[2];
    const right = parseValue(compMatch[3].trim());

    switch (op) {
      case '==':
      case '===':
        return left === right;
      case '!=':
      case '!==':
        return left !== right;
      case '>':
        return left > right;
      case '>=':
        return left >= right;
      case '<':
        return left < right;
      case '<=':
        return left <= right;
      default:
        return false;
    }
  }

  // Handle simple boolean/truthy value
  const val = parseValue(expr);
  return val === true || val === 'true' || (typeof val === 'number' && val !== 0);
}

/**
 * Split expression on operator, respecting quoted strings
 */
function splitOnOperator(expr, op) {
  const parts = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < expr.length; i++) {
    const char = expr[i];

    if ((char === '"' || char === "'") && (i === 0 || expr[i-1] !== '\\')) {
      if (!inQuote) {
        inQuote = true;
        quoteChar = char;
      } else if (char === quoteChar) {
        inQuote = false;
      }
    }

    if (!inQuote && expr.slice(i, i + op.length) === op) {
      parts.push(current);
      current = '';
      i += op.length - 1;
    } else {
      current += char;
    }
  }

  parts.push(current);
  return parts;
}

/**
 * Workflow execution context
 */
class WorkflowContext {
  constructor(initialVars = {}) {
    this.variables = { ...initialVars };
    this.stepResults = {};
    this.iteration = 0;
    this.maxIterations = 100;
  }

  get(key) {
    return this.variables[key];
  }

  set(key, value) {
    this.variables[key] = value;
  }

  setResult(stepId, result) {
    this.stepResults[stepId] = result;
    this.variables[`${stepId}_exitCode`] = result.exitCode;
    this.variables[`${stepId}_success`] = result.exitCode === 0;
  }

  getResult(stepId) {
    return this.stepResults[stepId];
  }
}

/**
 * Workflow class
 */
class Workflow {
  constructor(definition) {
    this.name = definition.name || 'unnamed';
    this.description = definition.description || '';
    this.steps = definition.steps || [];
    this.variables = definition.variables || {};
    this.onError = definition.onError || 'abort';
    this.maxIterations = definition.maxIterations || 100;
  }

  async run(context = null) {
    context = context || new WorkflowContext(this.variables);
    context.maxIterations = this.maxIterations;

    const results = {
      name: this.name,
      success: true,
      steps: [],
      startTime: new Date().toISOString(),
      endTime: null
    };

    for (const step of this.steps) {
      try {
        const stepResult = await this.runStep(step, context);
        results.steps.push(stepResult);

        if (!stepResult.success && this.onError === 'abort') {
          results.success = false;
          break;
        }
      } catch (err) {
        results.steps.push({
          id: step.id || step.name,
          success: false,
          error: err.message
        });
        results.success = false;

        if (this.onError === 'abort') break;
      }
    }

    results.endTime = new Date().toISOString();
    return results;
  }

  async runStep(step, context) {
    const stepId = step.id || step.name;
    const stepResult = {
      id: stepId,
      type: step.type || STEP_TYPES.COMMAND,
      success: true,
      skipped: false,
      duration: 0
    };

    // Check condition
    if (step.when) {
      const shouldRun = evaluateCondition(step.when, context.variables);
      if (!shouldRun) {
        stepResult.skipped = true;
        stepResult.skipReason = 'Condition not met';
        return stepResult;
      }
    }

    const startTime = Date.now();

    switch (step.type) {
      case STEP_TYPES.COMMAND:
      case undefined: {
        const result = await executeCommand(step.run || step.command, {
          timeout: step.timeout,
          stream: step.stream
        });
        stepResult.exitCode = result.exitCode;
        stepResult.success = result.exitCode === 0;
        stepResult.stdout = result.stdout;
        stepResult.stderr = result.stderr;
        context.setResult(stepId, result);
        break;
      }

      case STEP_TYPES.GATE: {
        const result = await executeCommand(step.check, { timeout: step.timeout });
        stepResult.success = result.exitCode === 0;
        stepResult.exitCode = result.exitCode;

        if (!stepResult.success && step.onFail) {
          console.log(`${c.yellow}Gate failed, running recovery...${c.reset}`);
          await executeCommand(step.onFail);
        }
        break;
      }

      case STEP_TYPES.LOOP: {
        const maxIter = step.maxIterations || context.maxIterations;
        let iterations = 0;

        while (iterations < maxIter) {
          context.iteration = iterations;

          // Check exit condition
          if (step.until && evaluateCondition(step.until, context.variables)) {
            break;
          }

          // Run loop body
          for (const innerStep of step.steps || []) {
            await this.runStep(innerStep, context);
          }

          iterations++;

          // Check continue condition
          if (step.while && !evaluateCondition(step.while, context.variables)) {
            break;
          }
        }

        stepResult.iterations = iterations;
        stepResult.success = iterations < maxIter || step.allowMaxIterations;
        break;
      }

      case STEP_TYPES.PARALLEL: {
        const promises = (step.steps || []).map(s => this.runStep(s, context));
        const results = await Promise.all(promises);
        stepResult.parallelResults = results;
        stepResult.success = results.every(r => r.success);
        break;
      }

      case STEP_TYPES.CONDITIONAL: {
        const branches = step.branches || [];
        let executed = false;

        for (const branch of branches) {
          if (evaluateCondition(branch.when, context.variables)) {
            for (const innerStep of branch.steps || []) {
              await this.runStep(innerStep, context);
            }
            executed = true;
            break;
          }
        }

        if (!executed && step.else) {
          for (const innerStep of step.else || []) {
            await this.runStep(innerStep, context);
          }
        }

        stepResult.success = true;
        break;
      }

      default:
        stepResult.error = `Unknown step type: ${step.type}`;
        stepResult.success = false;
    }

    stepResult.duration = Date.now() - startTime;
    return stepResult;
  }
}

/**
 * Load workflow from file
 */
function loadWorkflow(name) {
  const yamlPath = path.join(WORKFLOWS_DIR, `${name}.yaml`);
  const ymlPath = path.join(WORKFLOWS_DIR, `${name}.yml`);
  const jsonPath = path.join(WORKFLOWS_DIR, `${name}.json`);

  let definition = null;

  if (fs.existsSync(yamlPath)) {
    definition = parseYaml(fs.readFileSync(yamlPath, 'utf-8'));
  } else if (fs.existsSync(ymlPath)) {
    definition = parseYaml(fs.readFileSync(ymlPath, 'utf-8'));
  } else if (fs.existsSync(jsonPath)) {
    definition = readJson(jsonPath, null);
    if (!definition) throw new Error(`Failed to parse workflow JSON: ${name}`);
  } else {
    throw new Error(`Workflow not found: ${name}`);
  }

  return new Workflow(definition);
}

/**
 * List available workflows
 */
function listWorkflows() {
  if (!fs.existsSync(WORKFLOWS_DIR)) {
    return [];
  }

  const files = fs.readdirSync(WORKFLOWS_DIR);
  const workflows = [];

  for (const file of files) {
    if (file.endsWith('.yaml') || file.endsWith('.yml') || file.endsWith('.json')) {
      const name = file.replace(/\.(yaml|yml|json)$/, '');
      try {
        const workflow = loadWorkflow(name);
        workflows.push({
          name,
          description: workflow.description,
          steps: workflow.steps.length
        });
      } catch (_err) {
        workflows.push({ name, error: 'Failed to parse' });
      }
    }
  }

  return workflows;
}

/**
 * Create workflow template
 */
function createWorkflowTemplate(name) {
  if (!fs.existsSync(WORKFLOWS_DIR)) {
    fs.mkdirSync(WORKFLOWS_DIR, { recursive: true });
  }

  // Get language-appropriate commands
  const lintCmd = getQualityCommand('lint');
  const testCmd = getQualityCommand('test');
  const buildCmd = getQualityCommand('build');
  const fixCmd = getQualityCommand('fix');

  const template = {
    name,
    description: 'Workflow description',
    variables: {
      environment: 'development'
    },
    onError: 'abort',
    maxIterations: 10,
    steps: [
      {
        id: 'lint',
        name: 'Run linting',
        run: lintCmd
      },
      {
        id: 'test',
        name: 'Run tests',
        run: testCmd,
        when: '$environment == "development"'
      },
      {
        id: 'build',
        name: 'Build project',
        run: buildCmd
      },
      {
        id: 'retry-loop',
        name: 'Retry on failure',
        type: 'loop',
        maxIterations: 3,
        until: '$build_success == true',
        steps: [
          {
            id: 'fix-attempt',
            run: fixCmd
          }
        ]
      }
    ]
  };

  const yamlContent = `# ${name} Workflow
# Auto-generated template

${toYaml(template)}`;

  const filePath = path.join(WORKFLOWS_DIR, `${name}.yaml`);
  fs.writeFileSync(filePath, yamlContent);

  return filePath;
}

/**
 * Validate workflow
 */
function validateWorkflow(name) {
  const errors = [];
  const warnings = [];

  try {
    const workflow = loadWorkflow(name);

    if (!workflow.name) {
      warnings.push('Missing workflow name');
    }

    if (!workflow.steps || workflow.steps.length === 0) {
      errors.push('Workflow has no steps');
    }

    for (const step of workflow.steps || []) {
      if (!step.id && !step.name) {
        errors.push(`Step missing id/name: ${JSON.stringify(step).slice(0, 50)}`);
      }

      if (step.type === 'loop' && !step.until && !step.while && !step.maxIterations) {
        warnings.push(`Loop step "${step.id || step.name}" has no exit condition`);
      }
    }
  } catch (err) {
    errors.push(`Parse error: ${err.message}`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

// Module exports
module.exports = {
  STEP_TYPES,
  Workflow,
  WorkflowContext,
  loadWorkflow,
  listWorkflows,
  createWorkflowTemplate,
  validateWorkflow,
  executeCommand,
  evaluateCondition,
  // Security utilities
  validateCommand,
  DANGEROUS_PATTERNS,
  WARNING_PATTERNS,
  // Language-agnostic quality commands
  detectProjectType,
  getQualityCommand
};

// CLI Handler
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  async function main() {
    switch (command) {
      case 'list': {
        const workflows = listWorkflows();

        if (workflows.length === 0) {
          console.log(`${c.dim}No workflows found.${c.reset}`);
          console.log(`${c.dim}Create one with: flow workflow create <name>${c.reset}`);
          return;
        }

        console.log(`\n${c.cyan}${c.bold}Available Workflows${c.reset}\n`);

        for (const wf of workflows) {
          if (wf.error) {
            console.log(`${c.red}✗${c.reset} ${wf.name} ${c.dim}(${wf.error})${c.reset}`);
          } else {
            console.log(`${c.green}✓${c.reset} ${c.bold}${wf.name}${c.reset}`);
            if (wf.description) {
              console.log(`  ${c.dim}${wf.description}${c.reset}`);
            }
            console.log(`  ${c.dim}${wf.steps} step(s)${c.reset}`);
          }
        }
        break;
      }

      case 'run': {
        const name = args[1];
        if (!name) {
          console.error(`${c.red}Error: Workflow name required${c.reset}`);
          process.exit(1);
        }

        console.log(`${c.cyan}Running workflow: ${name}${c.reset}\n`);

        try {
          const workflow = loadWorkflow(name);
          const results = await workflow.run();

          console.log('');
          for (const step of results.steps) {
            const icon = step.skipped ? `${c.dim}○` :
                         step.success ? `${c.green}✓` : `${c.red}✗`;
            const status = step.skipped ? 'skipped' :
                          step.success ? 'passed' : 'failed';
            console.log(`${icon}${c.reset} ${step.id} ${c.dim}(${status}, ${step.duration}ms)${c.reset}`);
          }

          console.log('');
          if (results.success) {
            printSuccess('Workflow completed successfully');
          } else {
            printError('Workflow failed');
            process.exit(1);
          }
        } catch (err) {
          console.error(`${c.red}Error: ${err.message}${c.reset}`);
          process.exit(1);
        }
        break;
      }

      case 'create': {
        const name = args[1];
        if (!name) {
          console.error(`${c.red}Error: Workflow name required${c.reset}`);
          process.exit(1);
        }

        const filePath = createWorkflowTemplate(name);
        printSuccess(`Created workflow: ${filePath}`);
        break;
      }

      case 'validate': {
        const name = args[1];
        if (!name) {
          console.error(`${c.red}Error: Workflow name required${c.reset}`);
          process.exit(1);
        }

        const result = validateWorkflow(name);

        if (result.valid) {
          printSuccess(`Workflow "${name}" is valid`);
        } else {
          printError(`Workflow "${name}" has errors:`);
          for (const err of result.errors) {
            console.log(`   ${c.red}• ${err}${c.reset}`);
          }
        }

        if (result.warnings.length > 0) {
          console.log(`\n${c.yellow}Warnings:${c.reset}`);
          for (const warn of result.warnings) {
            console.log(`   ${c.yellow}• ${warn}${c.reset}`);
          }
        }

        process.exit(result.valid ? 0 : 1);
      }

      default: {
        console.log(`
${c.cyan}Wogi Flow - Declarative Workflow Engine${c.reset}

${c.bold}Usage:${c.reset}
  flow workflow list                    List available workflows
  flow workflow run <name>              Run a workflow
  flow workflow create <name>           Create workflow template
  flow workflow validate <name>         Validate workflow syntax

${c.bold}Workflow YAML Format:${c.reset}
  name: my-workflow
  description: Description here
  onError: abort   # abort | continue
  maxIterations: 10

  steps:
    - id: lint
      run: <lint-command>    # Auto-detected: npm/yarn/pnpm/cargo/go/ruff

    - id: conditional-test
      when: \$environment == "dev"
      run: <test-command>    # Auto-detected based on project type

    - id: retry-loop
      type: loop
      maxIterations: 3
      until: \$build_success == true
      steps:
        - run: <build-command>

${c.bold}Language Support:${c.reset}
  Node.js   npm/yarn/pnpm/bun (auto-detected from lock file)
  Python    pip/poetry/pipenv (pytest, ruff)
  Go        go test, golangci-lint
  Rust      cargo test, cargo clippy

${c.bold}Step Types:${c.reset}
  command     Run shell command (default)
  gate        Verification gate with recovery
  loop        Bounded iteration
  parallel    Run steps in parallel
  conditional Branch based on conditions
        `);
      }
    }
  }

  main().catch(err => {
    console.error(`${c.red}Error: ${err.message}${c.reset}`);
    process.exit(1);
  });
}
