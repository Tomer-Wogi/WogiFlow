#!/usr/bin/env node

/**
 * Wogi Flow - Verification Profile
 *
 * Probes a project and builds a comprehensive verification profile.
 * Auto-detects test infrastructure, frameworks, Docker availability,
 * databases, CI configuration, and more.
 *
 * The profile is saved to .workflow/state/verification-profile.json
 * and consumed by test scripts (flow-test-api.js, flow-test-ui.js,
 * flow-test-integrity.js) to replace hardcoded defaults.
 *
 * Usage (CLI):
 *   node flow-verification-profile.js probe       # Run full project probe
 *   node flow-verification-profile.js show        # Display current profile
 *   node flow-verification-profile.js strategy <taskType>  # Get verification strategy
 *
 * Usage (library):
 *   const { probeProject, loadProfile, getVerificationStrategy, hasCapability } = require('./flow-verification-profile');
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getProjectRoot, PATHS, ensureDir, safeJsonParse } = require('./flow-utils');
const { getConfig } = require('./flow-config-loader');

// ============================================================
// Constants
// ============================================================

/** Path to the saved verification profile */
const PROFILE_PATH = path.join(PATHS.state, 'verification-profile.json');

/** Docker detection timeout (ms) */
const DOCKER_TIMEOUT_MS = 3000;

/** Known test runner config files */
const TEST_RUNNER_CONFIGS = {
  vitest: ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mts', 'vitest.config.mjs'],
  jest: ['jest.config.ts', 'jest.config.js', 'jest.config.mjs', 'jest.config.cjs', 'jest.config.json'],
  mocha: ['.mocharc.yml', '.mocharc.yaml', '.mocharc.js', '.mocharc.json', '.mocharc.cjs'],
  ava: ['ava.config.js', 'ava.config.cjs', 'ava.config.mjs']
};

/** Known E2E framework config files */
const E2E_CONFIGS = {
  playwright: ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'],
  cypress: ['cypress.config.ts', 'cypress.config.js', 'cypress.config.cjs', 'cypress.config.mjs']
};

/** OpenAPI/Swagger file patterns and locations */
const OPENAPI_NAMES = ['openapi.yaml', 'openapi.yml', 'openapi.json', 'swagger.yaml', 'swagger.yml', 'swagger.json'];
const OPENAPI_DIRS = ['', 'docs', 'api', 'spec', 'specs', 'docs/api'];

/** Docker compose file names */
const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

/** Database images to detect in compose files */
const DB_IMAGE_PATTERNS = {
  postgresql: [/postgres/i],
  mysql: [/mysql/i, /mariadb/i],
  mongodb: [/mongo/i],
  redis: [/redis/i],
  sqlite: [/sqlite/i]
};

/** ORM config files */
const ORM_CONFIGS = [
  { file: 'prisma/schema.prisma', orm: 'prisma' },
  { file: 'ormconfig.js', orm: 'typeorm' },
  { file: 'ormconfig.ts', orm: 'typeorm' },
  { file: 'ormconfig.json', orm: 'typeorm' },
  { file: 'knexfile.js', orm: 'knex' },
  { file: 'knexfile.ts', orm: 'knex' }
];

/** Fixture directories to search */
const FIXTURE_DIRS = [
  'test/fixtures', 'tests/fixtures', '__fixtures__',
  'test/data', 'tests/data', 'seeds', 'prisma/seed.ts', 'prisma/seed.js'
];

/** CI platform config files */
const CI_CONFIGS = [
  { glob: '.github/workflows', platform: 'github-actions' },
  { file: '.gitlab-ci.yml', platform: 'gitlab-ci' },
  { file: 'Jenkinsfile', platform: 'jenkins' },
  { file: '.circleci/config.yml', platform: 'circleci' },
  { file: 'bitbucket-pipelines.yml', platform: 'bitbucket' }
];

/** Package manager lock files */
const LOCK_FILES = {
  npm: 'package-lock.json',
  yarn: 'yarn.lock',
  pnpm: 'pnpm-lock.yaml',
  bun: 'bun.lockb'
};

/** Well-known dev server port defaults */
const FRAMEWORK_PORTS = {
  'next': 3000,
  'nuxt': 3000,
  'express': 3000,
  'fastify': 3000,
  'nest': 3000,
  'vite': 5173,
  'webpack-dev-server': 8080,
  'react-scripts': 3000,
  'angular': 4200
};

// ============================================================
// Utility Helpers
// ============================================================

/**
 * Check if a file exists relative to project root.
 * @param {string} relativePath
 * @returns {boolean}
 */
function existsInProject(relativePath) {
  try {
    return fs.existsSync(path.join(PATHS.root, relativePath));
  } catch (err) {
    return false;
  }
}

/**
 * Read package.json safely.
 * @returns {object|null}
 */
function readPackageJson() {
  const pkgPath = path.join(PATHS.root, 'package.json');
  return safeJsonParse(pkgPath, null);
}

/**
 * Read a file from the project root safely.
 * @param {string} relativePath
 * @returns {string|null}
 */
function readProjectFile(relativePath) {
  try {
    return fs.readFileSync(path.join(PATHS.root, relativePath), 'utf-8');
  } catch (err) {
    return null;
  }
}

// ============================================================
// Detection: Test Runner
// ============================================================

/**
 * Detect the project's unit/integration test runner.
 * @param {object|null} pkg - package.json contents
 * @returns {object} testRunner profile section
 */
function detectTestRunner(pkg) {
  const result = {
    detected: false,
    framework: null,
    configFile: null,
    command: null,
    detectedAt: null
  };

  if (!pkg) return result;

  // Check config files first (most reliable)
  for (const [framework, configs] of Object.entries(TEST_RUNNER_CONFIGS)) {
    for (const configFile of configs) {
      if (existsInProject(configFile)) {
        result.detected = true;
        result.framework = framework;
        result.configFile = configFile;
        result.command = `npx ${framework} run`;
        result.detectedAt = new Date().toISOString();
        return result;
      }
    }
  }

  // Check devDependencies
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  for (const framework of Object.keys(TEST_RUNNER_CONFIGS)) {
    if (deps[framework]) {
      result.detected = true;
      result.framework = framework;
      result.command = `npx ${framework} run`;
      result.detectedAt = new Date().toISOString();
      return result;
    }
  }

  // Check package.json scripts.test
  if (pkg.scripts && pkg.scripts.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
    result.detected = true;
    result.command = 'npm test';
    result.detectedAt = new Date().toISOString();

    // Infer framework from test script
    const testScript = pkg.scripts.test;
    if (testScript.includes('vitest')) result.framework = 'vitest';
    else if (testScript.includes('jest')) result.framework = 'jest';
    else if (testScript.includes('mocha')) result.framework = 'mocha';
    else if (testScript.includes('ava')) result.framework = 'ava';
    else result.framework = 'unknown';
  }

  return result;
}

// ============================================================
// Detection: E2E Framework
// ============================================================

/**
 * Detect E2E testing framework.
 * @param {object|null} pkg - package.json contents
 * @returns {object} e2e profile section
 */
function detectE2E(pkg) {
  const result = {
    detected: false,
    framework: null,
    configFile: null,
    testDir: null
  };

  // Check config files
  for (const [framework, configs] of Object.entries(E2E_CONFIGS)) {
    for (const configFile of configs) {
      if (existsInProject(configFile)) {
        result.detected = true;
        result.framework = framework;
        result.configFile = configFile;

        // Check common test directories
        if (framework === 'cypress' && existsInProject('cypress')) {
          result.testDir = 'cypress';
        } else if (framework === 'playwright') {
          if (existsInProject('e2e')) result.testDir = 'e2e';
          else if (existsInProject('tests')) result.testDir = 'tests';
        }

        return result;
      }
    }
  }

  // Check devDependencies
  if (pkg) {
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (deps['@playwright/test'] || deps['playwright']) {
      result.detected = true;
      result.framework = 'playwright';
    } else if (deps['cypress']) {
      result.detected = true;
      result.framework = 'cypress';
      if (existsInProject('cypress')) result.testDir = 'cypress';
    }
  }

  return result;
}

// ============================================================
// Detection: OpenAPI / Swagger
// ============================================================

/**
 * Detect OpenAPI or Swagger specification file.
 * @returns {object} api profile section (partial — spec-related fields)
 */
function detectOpenAPI() {
  for (const dir of OPENAPI_DIRS) {
    for (const name of OPENAPI_NAMES) {
      const relativePath = dir ? `${dir}/${name}` : name;
      if (existsInProject(relativePath)) {
        const ext = path.extname(name).toLowerCase();
        const format = ext === '.json' ? 'json' : 'yaml';
        return {
          openApiSpec: relativePath,
          openApiFormat: format
        };
      }
    }
  }
  return {
    openApiSpec: null,
    openApiFormat: null
  };
}

// ============================================================
// Detection: API (base URL, start command)
// ============================================================

/**
 * Detect API server configuration.
 * @param {object|null} pkg - package.json contents
 * @returns {object} api profile section
 */
function detectAPI(pkg) {
  const openApi = detectOpenAPI();

  const result = {
    detected: false,
    openApiSpec: openApi.openApiSpec,
    openApiFormat: openApi.openApiFormat,
    baseUrl: null,
    startCommand: null,
    healthEndpoint: '/health'
  };

  if (!pkg || !pkg.scripts) {
    if (openApi.openApiSpec) {
      result.detected = true;
      result.baseUrl = 'http://localhost:3000';
    }
    return result;
  }

  // Detect start command and infer port
  const scriptPriority = ['dev', 'start', 'serve'];
  let detectedPort = null;

  for (const scriptName of scriptPriority) {
    const script = pkg.scripts[scriptName];
    if (!script) continue;

    result.startCommand = `npm run ${scriptName}`;
    result.detected = true;

    // Detect framework from script to infer port
    for (const [fw, port] of Object.entries(FRAMEWORK_PORTS)) {
      if (script.includes(fw)) {
        detectedPort = port;
        break;
      }
    }

    break; // Use first found
  }

  // Check .env for PORT variable
  if (!detectedPort) {
    const envContent = readProjectFile('.env');
    if (envContent) {
      const portMatch = envContent.match(/^PORT\s*=\s*(\d+)/m);
      if (portMatch) {
        detectedPort = parseInt(portMatch[1], 10);
      }
    }
  }

  // Check .env.local for PORT variable
  if (!detectedPort) {
    const envLocalContent = readProjectFile('.env.local');
    if (envLocalContent) {
      const portMatch = envLocalContent.match(/^PORT\s*=\s*(\d+)/m);
      if (portMatch) {
        detectedPort = parseInt(portMatch[1], 10);
      }
    }
  }

  result.baseUrl = `http://localhost:${detectedPort || 3000}`;

  if (openApi.openApiSpec) {
    result.detected = true;
  }

  return result;
}

// ============================================================
// Detection: Docker
// ============================================================

/**
 * Detect Docker availability and compose configuration.
 * @returns {object} docker profile section
 */
function detectDocker() {
  const result = {
    available: false,
    composeFile: null,
    databases: [],
    testcontainersAvailable: false
  };

  // Check Docker availability with short timeout
  try {
    const dockerResult = spawnSync('docker', ['info'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: DOCKER_TIMEOUT_MS
    });
    result.available = dockerResult.status === 0;
  } catch (err) {
    result.available = false;
  }

  // Check for compose files
  for (const composeFile of COMPOSE_FILES) {
    if (existsInProject(composeFile)) {
      result.composeFile = composeFile;

      // Parse compose file for database services
      const content = readProjectFile(composeFile);
      if (content) {
        for (const [dbType, patterns] of Object.entries(DB_IMAGE_PATTERNS)) {
          for (const pattern of patterns) {
            if (pattern.test(content)) {
              if (!result.databases.includes(dbType)) {
                result.databases.push(dbType);
              }
            }
          }
        }
      }

      break; // Use first found compose file
    }
  }

  // Check for testcontainers
  const pkg = readPackageJson();
  if (pkg) {
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (deps['testcontainers'] || deps['@testcontainers/postgresql'] || deps['@testcontainers/mysql']) {
      result.testcontainersAvailable = true;
    }
  }

  return result;
}

// ============================================================
// Detection: Database
// ============================================================

/**
 * Detect database configuration.
 * @param {object} dockerProfile - Docker profile section
 * @param {object|null} pkg - package.json contents
 * @returns {object} database profile section
 */
function detectDatabase(dockerProfile, pkg) {
  const result = {
    detected: false,
    type: null,
    source: null,
    migrationCommand: null,
    seedCommand: null
  };

  // Check docker-compose databases first
  if (dockerProfile.databases.length > 0) {
    result.detected = true;
    result.type = dockerProfile.databases[0]; // Primary DB
    result.source = dockerProfile.composeFile;
  }

  // Check for ORM configs
  for (const ormConfig of ORM_CONFIGS) {
    if (existsInProject(ormConfig.file)) {
      result.detected = true;
      if (!result.source) result.source = ormConfig.file;

      // Infer DB type from ORM if not already detected
      if (!result.type && ormConfig.orm === 'prisma') {
        const schemaContent = readProjectFile(ormConfig.file);
        if (schemaContent) {
          if (/provider\s*=\s*"postgresql"/i.test(schemaContent)) result.type = 'postgresql';
          else if (/provider\s*=\s*"mysql"/i.test(schemaContent)) result.type = 'mysql';
          else if (/provider\s*=\s*"sqlite"/i.test(schemaContent)) result.type = 'sqlite';
          else if (/provider\s*=\s*"mongodb"/i.test(schemaContent)) result.type = 'mongodb';
        }
      }

      break;
    }
  }

  // Check .env for DATABASE_URL
  if (!result.detected) {
    const envContent = readProjectFile('.env');
    if (envContent && /DATABASE_URL/i.test(envContent)) {
      result.detected = true;
      result.source = '.env';

      const urlMatch = envContent.match(/DATABASE_URL\s*=\s*["']?(postgres|mysql|mongodb|sqlite)/i);
      if (urlMatch) {
        const proto = urlMatch[1].toLowerCase();
        if (proto === 'postgres') result.type = 'postgresql';
        else result.type = proto;
      }
    }
  }

  // Check package.json for ORM packages
  if (!result.detected && pkg) {
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const ormPackages = ['prisma', '@prisma/client', 'typeorm', 'sequelize', 'knex', 'mongoose', 'drizzle-orm'];
    for (const ormPkg of ormPackages) {
      if (deps[ormPkg]) {
        result.detected = true;
        result.source = 'package.json';
        if (ormPkg === 'mongoose') result.type = 'mongodb';
        break;
      }
    }
  }

  // Detect migration/seed commands
  if (pkg && pkg.scripts) {
    if (pkg.scripts['db:migrate'] || pkg.scripts['migrate']) {
      result.migrationCommand = pkg.scripts['db:migrate'] ? 'npm run db:migrate' : 'npm run migrate';
    }
    if (pkg.scripts['db:seed'] || pkg.scripts['seed']) {
      result.seedCommand = pkg.scripts['db:seed'] ? 'npm run db:seed' : 'npm run seed';
    }
  }

  return result;
}

// ============================================================
// Detection: Fixtures
// ============================================================

/**
 * Detect test fixture directories and files.
 * @returns {object} fixtures profile section
 */
function detectFixtures() {
  const result = {
    detected: false,
    directory: null,
    files: []
  };

  for (const fixtureDir of FIXTURE_DIRS) {
    const fullPath = path.join(PATHS.root, fixtureDir);

    // Check if it's a file (e.g., prisma/seed.ts)
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isFile()) {
        result.detected = true;
        result.files.push(fixtureDir);
        continue;
      }

      if (stat.isDirectory()) {
        result.detected = true;
        if (!result.directory) result.directory = fixtureDir;

        // List fixture files (first 20)
        try {
          const entries = fs.readdirSync(fullPath).slice(0, 20);
          result.files.push(...entries.map(e => `${fixtureDir}/${e}`));
        } catch (err) {
          // Skip unreadable directories
        }
      }
    } catch (err) {
      // Path doesn't exist — continue
    }
  }

  return result;
}

// ============================================================
// Detection: CI
// ============================================================

/**
 * Detect CI/CD platform and configuration.
 * @returns {object} ci profile section
 */
function detectCI() {
  const result = {
    detected: false,
    platform: null,
    configFile: null,
    testCommand: null
  };

  for (const ci of CI_CONFIGS) {
    if (ci.glob) {
      // Directory-based detection (e.g., .github/workflows)
      const dirPath = path.join(PATHS.root, ci.glob);
      try {
        const stat = fs.statSync(dirPath);
        if (stat.isDirectory()) {
          result.detected = true;
          result.platform = ci.platform;

          // Find first workflow file
          try {
            const entries = fs.readdirSync(dirPath);
            const ymlFiles = entries.filter(e => /\.ya?ml$/i.test(e));
            if (ymlFiles.length > 0) {
              result.configFile = `${ci.glob}/${ymlFiles[0]}`;

              // Try to extract test command from workflow
              const workflowContent = readProjectFile(result.configFile);
              if (workflowContent) {
                const testMatch = workflowContent.match(/run:\s*(?:npm|yarn|pnpm)\s+(?:run\s+)?test/i);
                if (testMatch) {
                  result.testCommand = testMatch[0].replace(/^run:\s*/, '');
                }
              }
            }
          } catch (err) {
            // Skip
          }
          return result;
        }
      } catch (err) {
        // Not found
      }
    } else if (ci.file) {
      if (existsInProject(ci.file)) {
        result.detected = true;
        result.platform = ci.platform;
        result.configFile = ci.file;
        return result;
      }
    }
  }

  return result;
}

// ============================================================
// Detection: Package Manager
// ============================================================

/**
 * Detect package manager.
 * Delegates to the canonical detectPackageManager() from flow-script-resolver
 * and enriches with lockFile info for the verification profile.
 * @returns {object} packageManager profile section
 */
function detectPackageManager() {
  const { detectPackageManager: detectPM } = require('./flow-script-resolver');
  const manager = detectPM();
  const lockFile = LOCK_FILES[manager] || null;
  return {
    detected: manager,
    lockFile: existsInProject(lockFile) ? lockFile : null
  };
}

// ============================================================
// Detection: Language
// ============================================================

/**
 * Detect primary language.
 * @returns {object} language profile section
 */
function detectLanguage() {
  if (existsInProject('tsconfig.json')) {
    return {
      primary: 'typescript',
      configFile: 'tsconfig.json'
    };
  }

  if (existsInProject('jsconfig.json')) {
    return {
      primary: 'javascript',
      configFile: 'jsconfig.json'
    };
  }

  return {
    primary: 'javascript',
    configFile: null
  };
}

// ============================================================
// Verification Strategy Builder
// ============================================================

/**
 * Build the verification strategy based on detected capabilities.
 * @param {object} profile - Partial profile with detections
 * @returns {object} verificationStrategy section
 */
function buildVerificationStrategy(profile) {
  const config = getConfig();
  const testingConfig = config.testing || {};

  // Tier 0: Static Analysis (always available)
  const tier0Tools = [];
  if (profile.language.primary === 'typescript') tier0Tools.push('typecheck');
  tier0Tools.push('lint');

  const tiers = {
    '0': {
      name: 'Static Analysis',
      always: true,
      tools: tier0Tools
    },
    '1': {
      name: 'Existing Tests',
      available: profile.testRunner.detected,
      command: profile.testRunner.detected ? profile.testRunner.command : null,
      tools: profile.testRunner.detected ? [profile.testRunner.framework || 'test-runner'] : []
    },
    '2': {
      name: 'Contract Testing',
      available: !!profile.api.openApiSpec,
      specFile: profile.api.openApiSpec,
      tools: profile.api.openApiSpec ? ['schemathesis'] : []
    },
    '3': {
      name: 'Container-Based',
      available: profile.docker.available && !!profile.docker.composeFile,
      reason: !profile.docker.available ? 'Docker not detected' :
              !profile.docker.composeFile ? 'No docker-compose file found' : null,
      tools: profile.docker.available && profile.docker.composeFile ? ['docker-compose', 'testcontainers'] : []
    },
    '4': {
      name: 'AI-Generated',
      always: true,
      tools: ['flow-test-generate']
    }
  };

  // Per-task-type strategy
  const perTaskType = {
    feature: [0, 1, 4],
    bugfix: [0, 1],
    refactor: [0, 1],
    api: [0, 1, 2],
    default: [0, 1]
  };

  // If E2E is available, add tier for it
  if (profile.e2e.detected) {
    perTaskType.feature.push(1); // E2E is part of tier 1
  }

  // If contract testing is available, add it for relevant types
  if (profile.api.openApiSpec) {
    if (!perTaskType.feature.includes(2)) perTaskType.feature.push(2);
  }

  return { tiers, perTaskType };
}

// ============================================================
// Core Functions
// ============================================================

/**
 * Run full project probe and generate verification profile.
 * Returns the profile object AND saves to .workflow/state/verification-profile.json.
 *
 * @param {string} [projectRoot] - Project root (defaults to detected root)
 * @returns {Promise<object>} The complete verification profile
 */
async function probeProject(projectRoot) {
  const root = projectRoot || PATHS.root;
  const pkg = readPackageJson();

  // Run all detections
  const testRunner = detectTestRunner(pkg);
  const e2e = detectE2E(pkg);
  const api = detectAPI(pkg);
  const docker = detectDocker();
  const database = detectDatabase(docker, pkg);
  const fixtures = detectFixtures();
  const ci = detectCI();
  const packageManager = detectPackageManager();
  const language = detectLanguage();

  // Build partial profile for strategy computation
  const partialProfile = {
    testRunner, e2e, api, docker, database, fixtures, ci, packageManager, language
  };

  const verificationStrategy = buildVerificationStrategy(partialProfile);

  const profile = {
    version: 1,
    lastProbed: new Date().toISOString(),
    projectRoot: root,
    testRunner,
    e2e,
    api,
    docker,
    database,
    fixtures,
    ci,
    packageManager,
    language,
    verificationStrategy
  };

  // Save to disk
  try {
    ensureDir(PATHS.state);
    fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2), 'utf-8');
  } catch (err) {
    // Non-fatal — profile is still returned
    if (process.env.DEBUG) {
      console.error(`[DEBUG] Failed to save verification profile: ${err.message}`);
    }
  }

  return profile;
}

/**
 * Load existing profile from disk. Returns null if not found.
 *
 * @returns {object|null} The verification profile or null
 */
function loadProfile() {
  return safeJsonParse(PROFILE_PATH, null);
}

/**
 * Get the recommended verification tier for a given task type.
 * Returns { tiers: [0,1,2...], strategy: string, tools: string[] }
 *
 * @param {object} profile - Verification profile
 * @param {string} taskType - Task type (feature, bugfix, refactor, api, default)
 * @returns {object} { tiers: number[], strategy: string, tools: string[] }
 */
function getVerificationStrategy(profile, taskType) {
  if (!profile || !profile.verificationStrategy) {
    return { tiers: [0], strategy: 'minimal', tools: ['lint'] };
  }

  const strategy = profile.verificationStrategy;
  const tierIndices = strategy.perTaskType[taskType] || strategy.perTaskType.default || [0];

  const tools = [];
  for (const tierIndex of tierIndices) {
    const tier = strategy.tiers[String(tierIndex)];
    if (tier && (tier.always || tier.available)) {
      tools.push(...(tier.tools || []));
    }
  }

  const strategyName = tierIndices.length >= 3 ? 'comprehensive' :
                       tierIndices.length >= 2 ? 'standard' : 'minimal';

  return {
    tiers: tierIndices,
    strategy: strategyName,
    tools: [...new Set(tools)]
  };
}

/**
 * Check if a specific capability is available.
 * e.g., hasCapability(profile, 'docker'), hasCapability(profile, 'openapi')
 *
 * @param {object} profile - Verification profile
 * @param {string} capability - Capability to check
 * @returns {boolean}
 */
function hasCapability(profile, capability) {
  if (!profile) return false;

  switch (capability) {
    case 'docker':
      return profile.docker && profile.docker.available;
    case 'openapi':
    case 'swagger':
      return profile.api && !!profile.api.openApiSpec;
    case 'e2e':
      return profile.e2e && profile.e2e.detected;
    case 'tests':
    case 'test-runner':
      return profile.testRunner && profile.testRunner.detected;
    case 'database':
    case 'db':
      return profile.database && profile.database.detected;
    case 'ci':
      return profile.ci && profile.ci.detected;
    case 'fixtures':
      return profile.fixtures && profile.fixtures.detected;
    case 'typescript':
      return profile.language && profile.language.primary === 'typescript';
    case 'containers':
    case 'testcontainers':
      return profile.docker && profile.docker.testcontainersAvailable;
    default:
      return false;
  }
}

// ============================================================
// CLI
// ============================================================

if (require.main === module) {
  (async () => {
  const args = process.argv.slice(2);
  const command = args[0] || 'probe';

  if (command === 'probe') {
    console.log('Probing project for verification capabilities...');
    try {
      const profile = await probeProject();
      console.log('');
      console.log(`Profile saved to: ${PROFILE_PATH}`);
      console.log('');
      console.log('Detected capabilities:');
      console.log(`  Test runner: ${profile.testRunner.detected ? `${profile.testRunner.framework} (${profile.testRunner.command})` : 'not detected'}`);
      console.log(`  E2E: ${profile.e2e.detected ? profile.e2e.framework : 'not detected'}`);
      console.log(`  API: ${profile.api.detected ? `${profile.api.baseUrl}` : 'not detected'}`);
      console.log(`  OpenAPI: ${profile.api.openApiSpec || 'not detected'}`);
      console.log(`  Docker: ${profile.docker.available ? 'available' : 'not available'}`);
      console.log(`  Database: ${profile.database.detected ? `${profile.database.type} (${profile.database.source})` : 'not detected'}`);
      console.log(`  Fixtures: ${profile.fixtures.detected ? (profile.fixtures.directory || profile.fixtures.files[0]) : 'not detected'}`);
      console.log(`  CI: ${profile.ci.detected ? profile.ci.platform : 'not detected'}`);
      console.log(`  Package manager: ${profile.packageManager.detected}`);
      console.log(`  Language: ${profile.language.primary}`);
    } catch (err) {
      console.error(`Probe failed: ${err.message}`);
      process.exit(1);
    }
  } else if (command === 'show') {
    const profile = loadProfile();
    if (!profile) {
      console.log('No verification profile found. Run: node flow-verification-profile.js probe');
      process.exit(1);
    }
    console.log(JSON.stringify(profile, null, 2));
  } else if (command === 'strategy') {
    const taskType = args[1] || 'default';
    const profile = loadProfile();
    if (!profile) {
      console.log('No verification profile found. Run: node flow-verification-profile.js probe');
      process.exit(1);
    }
    const strat = getVerificationStrategy(profile, taskType);
    console.log(`Verification strategy for "${taskType}":`);
    console.log(`  Strategy: ${strat.strategy}`);
    console.log(`  Tiers: ${strat.tiers.join(', ')}`);
    console.log(`  Tools: ${strat.tools.join(', ') || '(none)'}`);
  } else {
    console.log('Usage: flow-verification-profile.js [probe|show|strategy <taskType>]');
    console.log('');
    console.log('  probe              Run full project probe and save profile');
    console.log('  show               Display current verification profile');
    console.log('  strategy <type>    Show verification strategy for task type');
    process.exit(1);
  }
  })();
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  probeProject,
  loadProfile,
  getVerificationStrategy,
  hasCapability,
  // Internal helpers (exported for testing/composition)
  detectTestRunner,
  detectE2E,
  detectOpenAPI,
  detectAPI,
  detectDocker,
  detectDatabase,
  detectFixtures,
  detectCI,
  detectPackageManager,
  detectLanguage,
  buildVerificationStrategy,
  PROFILE_PATH
};
