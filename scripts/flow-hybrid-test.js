#!/usr/bin/env node

/**
 * Wogi Flow - Hybrid Mode Integration Tests
 *
 * Tests the hybrid mode components work together.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { getProjectRoot } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();
const TESTS = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  TESTS.push({ name, fn });
}

async function run() {
  console.log('\n🧪 Running Hybrid Mode Integration Tests\n');
  console.log('═'.repeat(60) + '\n');

  for (const t of TESTS) {
    try {
      await t.fn();
      console.log(`✅ ${t.name}`);
      passed++;
    } catch (err) {
      console.log(`❌ ${t.name}`);
      console.log(`   Error: ${err.message}`);
      failed++;
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  process.exit(failed > 0 ? 1 : 0);
}

// Tests

test('Config file exists', () => {
  const configPath = path.join(PROJECT_ROOT, '.workflow', 'config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('config.json not found');
  }
});

test('Config has hybrid section', () => {
  const configPath = path.join(PROJECT_ROOT, '.workflow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  if (!config.hybrid) {
    throw new Error('hybrid section missing from config');
  }
});

test('Detection script exists and runs', () => {
  const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'flow-hybrid-detect.js');
  if (!fs.existsSync(scriptPath)) {
    throw new Error('flow-hybrid-detect.js not found');
  }
  // Use spawnSync with array arguments to handle paths with spaces
  const result = spawnSync('node', [scriptPath, 'providers'], {
    encoding: 'utf-8',
    stdio: 'pipe'
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || 'Detection script failed');
  }
});

test('Orchestrator script exists', () => {
  const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'flow-orchestrate.js');
  if (!fs.existsSync(scriptPath)) {
    throw new Error('flow-orchestrate.js not found');
  }
});

test('Templates directory exists', () => {
  const templatesDir = path.join(PROJECT_ROOT, 'templates', 'hybrid');
  if (!fs.existsSync(templatesDir)) {
    throw new Error('templates/hybrid directory not found');
  }
});

test('Base template exists', () => {
  const basePath = path.join(PROJECT_ROOT, 'templates', 'hybrid', '_base.md');
  if (!fs.existsSync(basePath)) {
    throw new Error('_base.md template not found');
  }
});

test('Component template exists', () => {
  const templatePath = path.join(PROJECT_ROOT, 'templates', 'hybrid', 'create-component.md');
  if (!fs.existsSync(templatePath)) {
    throw new Error('create-component.md template not found');
  }
});

test('State directory exists', () => {
  const stateDir = path.join(PROJECT_ROOT, '.workflow', 'state');
  if (!fs.existsSync(stateDir)) {
    throw new Error('.workflow/state directory not found');
  }
});

test('Progress module exists', () => {
  const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'flow-progress.js');
  if (!fs.existsSync(scriptPath)) {
    throw new Error('flow-progress.js not found');
  }
});

test('Templates module exists', () => {
  const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'flow-templates.js');
  if (!fs.existsSync(scriptPath)) {
    throw new Error('flow-templates.js not found');
  }
});

test('Interactive setup exists', () => {
  const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'flow-hybrid-interactive.js');
  if (!fs.existsSync(scriptPath)) {
    throw new Error('flow-hybrid-interactive.js not found');
  }
});

test('Slash command files exist', () => {
  const commands = [
    'wogi-hybrid.md',
    'wogi-hybrid-off.md',
    'wogi-hybrid-status.md'
  ];

  for (const cmd of commands) {
    const cmdPath = path.join(PROJECT_ROOT, '.claude', 'commands', cmd);
    if (!fs.existsSync(cmdPath)) {
      throw new Error(`${cmd} not found`);
    }
  }
});

// Run tests
run();
