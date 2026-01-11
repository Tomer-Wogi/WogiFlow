#!/usr/bin/env node

/**
 * Wogi Flow - Hybrid Mode Interactive Setup
 *
 * Guides user through enabling hybrid mode.
 * Supports both local LLMs (Ollama, LM Studio) and cloud models
 * (GPT-4o-mini, Claude Haiku, Gemini Flash).
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const http = require('http');
const https = require('https');
const { getProjectRoot, colors, getConfig } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const CONFIG_PATH = path.join(WORKFLOW_DIR, 'config.json');

const symbols = {
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
  check: '✓',
  cross: '✗',
  local: '🖥️',
  cloud: '☁️'
};

// Cloud provider configurations
const CLOUD_PROVIDERS = {
  openai: {
    name: 'OpenAI',
    models: ['gpt-4o-mini', 'gpt-4o'],
    defaultModel: 'gpt-4o-mini',
    envKey: 'OPENAI_API_KEY',
    testEndpoint: 'https://api.openai.com/v1/models'
  },
  anthropic: {
    name: 'Anthropic',
    models: ['claude-3-5-haiku-latest', 'claude-3-haiku-20240307'],
    defaultModel: 'claude-3-5-haiku-latest',
    envKey: 'ANTHROPIC_API_KEY',
    testEndpoint: 'https://api.anthropic.com/v1/messages'
  },
  google: {
    name: 'Google',
    models: ['gemini-2.0-flash-exp', 'gemini-1.5-flash'],
    defaultModel: 'gemini-2.0-flash-exp',
    envKey: 'GOOGLE_API_KEY',
    testEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models'
  }
};

async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

class Spinner {
  constructor(text) {
    this.text = text;
    this.frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    this.frameIndex = 0;
    this.interval = null;
  }

  start() {
    this.interval = setInterval(() => {
      const frame = this.frames[this.frameIndex];
      process.stdout.write(`\r${colors.cyan}${frame}${colors.reset} ${this.text}`);
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
    }, 80);
  }

  stop(finalText, success = true) {
    clearInterval(this.interval);
    const symbol = success ? colors.green + symbols.check : colors.red + symbols.cross;
    process.stdout.write(`\r${symbol}${colors.reset} ${finalText || this.text}\n`);
  }
}

async function checkEndpoint(url, timeout = 3000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ success: true, data: JSON.parse(data) });
        } catch (err) {
          resolve({ success: false, error: 'Invalid response' });
        }
      });
    });
    req.on('error', (e) => resolve({ success: false, error: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: 'Timeout' });
    });
  });
}

async function detectProviders() {
  console.log(`\n${symbols.info} Detecting local LLM providers...\n`);

  const spinner = new Spinner('Scanning...');
  spinner.start();

  const providers = [];

  // Check Ollama
  const ollamaResult = await checkEndpoint('http://localhost:11434/api/tags');
  if (ollamaResult.success) {
    providers.push({
      id: 'ollama',
      name: 'Ollama',
      endpoint: 'http://localhost:11434',
      available: true,
      models: ollamaResult.data.models?.map(m => ({ id: m.name, name: m.name })) || []
    });
  } else {
    providers.push({ id: 'ollama', name: 'Ollama', available: false, error: ollamaResult.error });
  }

  // Check LM Studio
  const lmstudioResult = await checkEndpoint('http://localhost:1234/v1/models');
  if (lmstudioResult.success) {
    providers.push({
      id: 'lmstudio',
      name: 'LM Studio',
      endpoint: 'http://localhost:1234',
      available: true,
      models: lmstudioResult.data.data?.map(m => ({ id: m.id, name: m.id })) || []
    });
  } else {
    providers.push({ id: 'lmstudio', name: 'LM Studio', available: false, error: lmstudioResult.error });
  }

  spinner.stop('Detection complete', true);

  return providers;
}

/**
 * Ask user to choose between local LLM or cloud model executor
 */
async function selectExecutorType() {
  console.log(`\n${colors.cyan}Choose your executor type:${colors.reset}\n`);

  console.log(`  ${colors.cyan}[L]${colors.reset} ${symbols.local}  Local LLM (FREE tokens)`);
  console.log(`      • Ollama, LM Studio`);
  console.log(`      • Requires local setup`);
  console.log(`      • Best for: Privacy, unlimited usage\n`);

  console.log(`  ${colors.cyan}[C]${colors.reset} ${symbols.cloud}  Cloud Model (PAID tokens)`);
  console.log(`      • GPT-4o-mini, Claude Haiku, Gemini Flash`);
  console.log(`      • Requires API key`);
  console.log(`      • Best for: No local setup, consistent quality\n`);

  const choice = await prompt(`Select executor type [L/C]: `);

  if (choice.toLowerCase() === 'c') {
    return 'cloud';
  }
  return 'local';
}

/**
 * Detect available cloud providers by checking for API keys
 */
function detectCloudProviders() {
  const available = [];

  for (const [id, config] of Object.entries(CLOUD_PROVIDERS)) {
    const apiKey = process.env[config.envKey];
    available.push({
      id,
      name: config.name,
      models: config.models.map(m => ({ id: m, name: m })),
      defaultModel: config.defaultModel,
      envKey: config.envKey,
      hasApiKey: !!apiKey,
      apiKey: apiKey || null
    });
  }

  return available;
}

/**
 * Select a cloud provider
 */
async function selectCloudProvider() {
  const providers = detectCloudProviders();
  const withKeys = providers.filter(p => p.hasApiKey);

  console.log(`\n${colors.cyan}Available cloud providers:${colors.reset}\n`);

  providers.forEach((p, i) => {
    const status = p.hasApiKey
      ? `${colors.green}${symbols.check} API key found${colors.reset}`
      : `${colors.dim}No API key (${p.envKey})${colors.reset}`;
    console.log(`  ${colors.cyan}[${i + 1}]${colors.reset} ${p.name} - ${status}`);
  });

  if (withKeys.length === 0) {
    console.log(`\n${colors.yellow}${symbols.warning} No API keys detected.${colors.reset}`);
    console.log(`Set one of the following environment variables:\n`);
    providers.forEach(p => {
      console.log(`  ${colors.cyan}${p.envKey}${colors.reset} for ${p.name}`);
    });

    const manualKey = await prompt(`\nWould you like to enter an API key now? [y/N]: `);
    if (manualKey.toLowerCase() !== 'y') {
      return null;
    }

    // Let them choose which provider and enter key
    const providerChoice = await prompt(`Select provider [1-${providers.length}]: `);
    const providerIndex = parseInt(providerChoice) - 1;
    const selectedProvider = providers[providerIndex] || providers[0];

    const apiKey = await prompt(`Enter ${selectedProvider.name} API key: `);
    if (!apiKey) {
      return null;
    }

    selectedProvider.apiKey = apiKey;
    selectedProvider.hasApiKey = true;
    return selectedProvider;
  }

  // If only one has a key, use it
  if (withKeys.length === 1) {
    console.log(`\nUsing ${withKeys[0].name} (only provider with API key)`);
    return withKeys[0];
  }

  // Let user choose
  const choice = await prompt(`\nSelect provider [1-${providers.length}]: `);
  const index = parseInt(choice) - 1;

  if (index >= 0 && index < providers.length) {
    const selected = providers[index];
    if (!selected.hasApiKey) {
      const apiKey = await prompt(`Enter ${selected.name} API key: `);
      if (!apiKey) {
        return null;
      }
      selected.apiKey = apiKey;
      selected.hasApiKey = true;
    }
    return selected;
  }

  return withKeys[0] || null;
}

/**
 * Select a cloud model
 */
async function selectCloudModel(provider) {
  console.log(`\n${colors.cyan}Available ${provider.name} models:${colors.reset}\n`);

  provider.models.forEach((m, i) => {
    const isDefault = m.id === provider.defaultModel ? ` ${colors.dim}(recommended)${colors.reset}` : '';
    console.log(`  ${colors.cyan}[${i + 1}]${colors.reset} ${m.name}${isDefault}`);
  });

  const choice = await prompt(`\nSelect model [1-${provider.models.length}] (default: 1): `);
  const index = parseInt(choice) - 1;

  if (index >= 0 && index < provider.models.length) {
    return provider.models[index];
  }

  return provider.models[0];
}

/**
 * Test cloud provider connection
 */
async function testCloudConnection(provider, model) {
  console.log(`\n${symbols.info} Testing connection to ${provider.name}...`);

  const spinner = new Spinner('Verifying API access...');
  spinner.start();

  try {
    // Simple test - just check we can reach the API
    // Full test would require actual API call
    await new Promise((resolve, reject) => {
      const url = new URL(CLOUD_PROVIDERS[provider.id].testEndpoint);

      // Add API key to URL for Google
      if (provider.id === 'google' && provider.apiKey) {
        url.searchParams.set('key', provider.apiKey);
      }

      const req = https.request(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(provider.id === 'openai' && { 'Authorization': `Bearer ${provider.apiKey}` }),
          ...(provider.id === 'anthropic' && {
            'x-api-key': provider.apiKey,
            'anthropic-version': '2023-06-01'
          })
        },
        timeout: 10000
      }, (res) => {
        // For Anthropic, 401 means key is wrong, 405 means endpoint reached
        if (provider.id === 'anthropic' && (res.statusCode === 405 || res.statusCode === 200)) {
          resolve(true);
        } else if (res.statusCode >= 200 && res.statusCode < 400) {
          resolve(true);
        } else if (res.statusCode === 401 || res.statusCode === 403) {
          reject(new Error('Invalid API key'));
        } else {
          resolve(true); // Optimistic - endpoint reached
        }
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.end();
    });

    spinner.stop('API connection verified!', true);
    return true;
  } catch (err) {
    spinner.stop(`Connection check: ${err.message}`, false);
    // Don't fail completely - API might still work
    return false;
  }
}

async function selectProvider(providers) {
  const available = providers.filter(p => p.available);

  if (available.length === 0) {
    console.log(`\n${colors.red}${symbols.error} No local LLM providers detected!${colors.reset}`);
    console.log(`\nPlease start one of the following:`);
    console.log(`  ${colors.cyan}Ollama:${colors.reset} ollama serve`);
    console.log(`  ${colors.cyan}LM Studio:${colors.reset} Start the app and enable server`);
    console.log(`\nThen run /wogi-hybrid again.`);
    return null;
  }

  console.log(`\n${colors.green}${symbols.success} Found providers:${colors.reset}\n`);

  available.forEach((p, i) => {
    console.log(`  ${colors.cyan}[${i + 1}]${colors.reset} ${p.name} (${p.endpoint})`);
    console.log(`      Models: ${p.models.length}`);
  });

  if (available.length === 1) {
    console.log(`\nUsing ${available[0].name} (only available provider)`);
    return available[0];
  }

  const choice = await prompt(`\nSelect provider [1-${available.length}]: `);
  const index = parseInt(choice) - 1;

  if (index >= 0 && index < available.length) {
    return available[index];
  }

  return available[0];
}

async function selectModel(provider) {
  if (!provider.models || provider.models.length === 0) {
    console.log(`\n${colors.yellow}${symbols.warning} No models found on ${provider.name}${colors.reset}`);
    console.log(`\nPlease load a model first:`);

    if (provider.id === 'ollama') {
      console.log(`  ${colors.cyan}ollama pull nemotron-3-nano${colors.reset}`);
      console.log(`  ${colors.cyan}ollama pull qwen3-coder:30b${colors.reset}`);
    } else {
      console.log(`  Open LM Studio and download a model`);
    }

    return null;
  }

  console.log(`\n${colors.cyan}Available models:${colors.reset}\n`);

  provider.models.forEach((m, i) => {
    console.log(`  ${colors.cyan}[${i + 1}]${colors.reset} ${m.name}`);
  });

  const choice = await prompt(`\nSelect model [1-${provider.models.length}]: `);
  const index = parseInt(choice) - 1;

  if (index >= 0 && index < provider.models.length) {
    return provider.models[index];
  }

  return provider.models[0];
}

async function saveConfig(executorType, provider, model) {
  let config = {};

  if (fs.existsSync(CONFIG_PATH)) {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  }

  // Preserve existing hybrid settings if present
  const existingHybrid = config.hybrid || {};

  config.hybrid = {
    enabled: true,
    // New executor config structure
    executor: {
      type: executorType,
      provider: provider.id,
      providerEndpoint: executorType === 'local' ? provider.endpoint : null,
      model: model.id,
      apiKey: executorType === 'cloud' ? provider.apiKey : null
    },
    // Planner settings
    planner: {
      adaptToExecutor: true,
      useAdapterKnowledge: true
    },
    // Preserve legacy fields for backward compatibility
    provider: provider.id,
    providerEndpoint: executorType === 'local' ? provider.endpoint : null,
    model: model.id,
    settings: {
      temperature: existingHybrid.settings?.temperature ?? 0.7,
      maxTokens: existingHybrid.settings?.maxTokens ?? (executorType === 'cloud' ? 4096 : 16384),
      maxRetries: existingHybrid.settings?.maxRetries ?? 20,
      timeout: existingHybrid.settings?.timeout ?? (executorType === 'cloud' ? 60000 : 120000),
      autoExecute: existingHybrid.settings?.autoExecute ?? false,
      createBranch: existingHybrid.settings?.createBranch ?? false,
      tokenEstimation: existingHybrid.settings?.tokenEstimation ?? {
        enabled: true,
        minTokens: 1000,
        maxTokens: 8000,
        defaultLevel: 'medium',
        logMetrics: true
      }
    },
    templates: {
      directory: existingHybrid.templates?.directory || 'templates/hybrid'
    },
    // Cloud provider reference
    cloudProviders: existingHybrid.cloudProviders || CLOUD_PROVIDERS,
    // Project context
    projectContext: existingHybrid.projectContext || {}
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

  console.log(`\n${colors.green}${symbols.success} Configuration saved!${colors.reset}`);
}

async function testConnection(provider, model) {
  console.log(`\n${symbols.info} Testing connection to ${model.name}...`);

  const spinner = new Spinner('Sending test prompt...');
  spinner.start();

  try {
    await new Promise((resolve, reject) => {
      const isOllama = provider.id === 'ollama';
      const url = new URL(isOllama ? '/api/generate' : '/v1/chat/completions', provider.endpoint);

      const body = isOllama
        ? JSON.stringify({ model: model.id, prompt: 'Say "OK"', stream: false })
        : JSON.stringify({ model: model.id, messages: [{ role: 'user', content: 'Say "OK"' }], max_tokens: 10 });

      const req = http.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.write(body);
      req.end();
    });

    spinner.stop('Connection successful!', true);
    return true;
  } catch (err) {
    spinner.stop(`Connection failed: ${err.message}`, false);
    return false;
  }
}

async function main() {
  console.log(`
${colors.cyan}╔═══════════════════════════════════════════════════════════════╗
║              Wogi Flow - Hybrid Mode Setup                     ║
╚═══════════════════════════════════════════════════════════════╝${colors.reset}
`);

  // Check if workflow dir exists
  if (!fs.existsSync(WORKFLOW_DIR)) {
    console.log(`${colors.red}${symbols.error} Wogi Flow not installed in this project.${colors.reset}`);
    console.log(`Run /wogi-onboard first.`);
    process.exit(1);
  }

  // Step 1: Choose executor type (local or cloud)
  const executorType = await selectExecutorType();

  let provider, model, connected;

  if (executorType === 'cloud') {
    // Cloud executor flow
    provider = await selectCloudProvider();
    if (!provider) {
      console.log(`\n${colors.red}${symbols.error} Cloud provider setup cancelled.${colors.reset}`);
      process.exit(1);
    }

    model = await selectCloudModel(provider);
    connected = await testCloudConnection(provider, model);

    if (!connected) {
      const cont = await prompt('\nContinue anyway? [y/N]: ');
      if (cont.toLowerCase() !== 'y') {
        process.exit(1);
      }
    }
  } else {
    // Local LLM flow (existing behavior)
    const providers = await detectProviders();

    provider = await selectProvider(providers);
    if (!provider) {
      process.exit(1);
    }

    model = await selectModel(provider);
    if (!model) {
      process.exit(1);
    }

    connected = await testConnection(provider, model);
    if (!connected) {
      const cont = await prompt('\nContinue anyway? [y/N]: ');
      if (cont.toLowerCase() !== 'y') {
        process.exit(1);
      }
    }
  }

  // Save config
  await saveConfig(executorType, provider, model);

  // Summary
  const executorIcon = executorType === 'cloud' ? symbols.cloud : symbols.local;
  const executorLabel = executorType === 'cloud' ? 'Cloud' : 'Local';
  const locationInfo = executorType === 'cloud'
    ? `API: ${provider.name}`
    : `Endpoint: ${provider.endpoint}`;

  console.log(`
${colors.green}═══════════════════════════════════════════════════════════════${colors.reset}
${colors.green}              Hybrid Mode Enabled! ${executorIcon}${colors.reset}
${colors.green}═══════════════════════════════════════════════════════════════${colors.reset}

Executor: ${executorLabel} (${provider.name})
Model: ${model.name}
${locationInfo}

${colors.cyan}How it works:${colors.reset}
1. Give me a task as usual
2. I'll create an execution plan
3. You review and approve
4. ${model.name} executes ${executorType === 'cloud' ? 'via API' : 'locally'}
5. I handle any failures

${colors.cyan}Commands:${colors.reset}
  /wogi-hybrid-off     Disable hybrid mode
  /wogi-hybrid-status  Check configuration
  /wogi-hybrid-edit    Modify plan before execution

${executorType === 'cloud'
  ? `${colors.dim}Note: Cloud executor uses PAID API tokens${colors.reset}`
  : `${colors.dim}Estimated token savings: 20-60% (varies with task complexity)${colors.reset}`}
`);
}

main().catch(e => {
  console.error(`${colors.red}Error: ${err.message}${colors.reset}`);
  process.exit(1);
});
