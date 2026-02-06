#!/usr/bin/env node

/**
 * Wogi Flow - Unified Model Configuration
 *
 * Centralized model and API key management for all WogiFlow features:
 * - Hybrid mode (local LLM execution)
 * - Peer review (multi-model code review)
 * - Model routing (task-based model selection)
 *
 * Config structure in .workflow/config.json:
 * {
 *   "models": {
 *     "providers": {
 *       "openai": { "apiKeyEnv": "OPENAI_API_KEY", "enabled": true, "models": ["gpt-4o"] },
 *       "google": { "apiKeyEnv": "GOOGLE_API_KEY", "enabled": true, "models": ["gemini-2.0-flash"] },
 *       ...
 *     },
 *     "defaults": {
 *       "hybrid": "local:qwen2.5-coder",
 *       "peerReview": ["openai:gpt-4o", "google:gemini-2.0-flash"]
 *     }
 *   }
 * }
 *
 * Usage:
 *   const modelConfig = require('./flow-model-config');
 *   const models = modelConfig.getEnabledModels();
 *   await modelConfig.addProvider('openai', { apiKey: 'sk-...' });
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot, safeJsonParse, colors: c } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const CONFIG_PATH = path.join(WORKFLOW_DIR, 'config.json');
const ENV_PATH = path.join(PROJECT_ROOT, '.env');
const SESSION_STATE_PATH = path.join(WORKFLOW_DIR, 'state', 'session-state.json');

/**
 * Known provider configurations
 */
const KNOWN_PROVIDERS = {
  openai: {
    displayName: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    endpoint: 'https://api.openai.com/v1',
    testEndpoint: '/models',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-mini', 'o1-preview'],
    defaultModel: 'gpt-4o'
  },
  google: {
    displayName: 'Google (Gemini)',
    envKey: 'GOOGLE_API_KEY',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta',
    testEndpoint: '/models',
    models: ['gemini-2.0-flash-exp', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro'],
    defaultModel: 'gemini-2.0-flash-exp'
  },
  anthropic: {
    displayName: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    endpoint: 'https://api.anthropic.com/v1',
    testEndpoint: '/messages',
    models: ['claude-opus-4-6', 'claude-sonnet-4-5-20250929', 'claude-3-5-haiku-20241022', 'claude-opus-4-5-20251101'],
    defaultModel: 'claude-sonnet-4-20250514'
  },
  local: {
    displayName: 'Local LLM',
    envKey: null, // No API key needed
    endpoint: 'http://localhost:11434',
    testEndpoint: '/api/tags',
    models: [], // Detected at runtime
    defaultModel: null,
    subProviders: ['ollama', 'lmstudio']
  }
};

/**
 * Check for dangerous keys that could cause prototype pollution
 * @param {Object} obj - Object to check
 * @returns {boolean} True if dangerous keys found
 */
function hasDangerousKeys(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const dangerous = ['__proto__', 'constructor', 'prototype'];
  for (const key of Object.keys(obj)) {
    if (dangerous.includes(key)) return true;
    if (typeof obj[key] === 'object' && hasDangerousKeys(obj[key])) return true;
  }
  return false;
}

/**
 * Read config file
 * @returns {Object} Config object
 */
function readConfig() {
  return safeJsonParse(CONFIG_PATH, {});
}

/**
 * Write config file
 * @param {Object} config - Config to write
 */
function writeConfig(config) {
  fs.mkdirSync(WORKFLOW_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

/**
 * Get the models configuration section
 * @returns {Object} Models config or empty structure
 */
function getModelsConfig() {
  const config = readConfig();
  return config.models || { providers: {}, defaults: {} };
}

/**
 * Update models configuration
 * @param {Object} modelsConfig - New models config
 */
function updateModelsConfig(modelsConfig) {
  const config = readConfig();
  config.models = modelsConfig;
  writeConfig(config);
}

/**
 * Get all configured providers
 * @returns {Array<{name: string, displayName: string, enabled: boolean, models: string[], apiKeySet: boolean}>}
 */
function getConfiguredProviders() {
  const modelsConfig = getModelsConfig();
  const providers = [];

  for (const [name, providerConfig] of Object.entries(modelsConfig.providers || {})) {
    const knownProvider = KNOWN_PROVIDERS[name] || {};
    const apiKeyEnv = providerConfig.apiKeyEnv || knownProvider.envKey;
    const apiKeySet = apiKeyEnv ? !!process.env[apiKeyEnv] : true;

    providers.push({
      name,
      displayName: knownProvider.displayName || name,
      enabled: providerConfig.enabled !== false,
      models: providerConfig.models || [],
      apiKeyEnv,
      apiKeySet,
      endpoint: providerConfig.endpoint || knownProvider.endpoint
    });
  }

  return providers;
}

/**
 * Get all enabled models in provider:model format
 * @returns {string[]} Array of "provider:model" strings
 */
function getEnabledModels() {
  const providers = getConfiguredProviders();
  const models = [];

  for (const provider of providers) {
    if (provider.enabled && provider.apiKeySet) {
      for (const model of provider.models) {
        models.push(`${provider.name}:${model}`);
      }
    }
  }

  return models;
}

/**
 * Add or update a provider configuration
 * @param {string} providerName - Provider name (openai, google, anthropic, local)
 * @param {Object} options - Provider options
 * @param {string} [options.apiKey] - API key (will be stored in .env)
 * @param {string[]} [options.models] - Models to enable
 * @param {string} [options.endpoint] - Custom endpoint
 * @param {boolean} [options.enabled] - Enable/disable provider
 */
function addProvider(providerName, options = {}) {
  // Validate provider name against known providers to prevent injection
  const validProviders = Object.keys(KNOWN_PROVIDERS);
  if (!validProviders.includes(providerName)) {
    throw new Error(`Unknown provider: ${providerName}. Allowed: ${validProviders.join(', ')}`);
  }

  const modelsConfig = getModelsConfig();
  const knownProvider = KNOWN_PROVIDERS[providerName];

  if (!modelsConfig.providers) {
    modelsConfig.providers = {};
  }

  // Merge with existing config
  const existingConfig = modelsConfig.providers[providerName] || {};
  const newConfig = {
    ...existingConfig,
    enabled: options.enabled !== undefined ? options.enabled : true,
    models: options.models || existingConfig.models || (knownProvider?.models?.slice(0, 2) || []),
    apiKeyEnv: knownProvider?.envKey || existingConfig.apiKeyEnv
  };

  if (options.endpoint) {
    newConfig.endpoint = options.endpoint;
  }

  // Store API key in .env if provided
  if (options.apiKey && knownProvider?.envKey) {
    updateEnvFile(knownProvider.envKey, options.apiKey);
  }

  modelsConfig.providers[providerName] = newConfig;
  updateModelsConfig(modelsConfig);

  return newConfig;
}

/**
 * Remove/disable a provider
 * @param {string} providerName - Provider name
 */
function removeProvider(providerName) {
  const modelsConfig = getModelsConfig();

  if (modelsConfig.providers && modelsConfig.providers[providerName]) {
    modelsConfig.providers[providerName].enabled = false;
    updateModelsConfig(modelsConfig);
  }
}

/**
 * Validate environment variable name format
 * @param {string} name - Variable name to validate
 * @returns {boolean} True if valid
 */
function isValidEnvVarName(name) {
  // Must start with letter or underscore, contain only alphanumeric and underscore
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

/**
 * Escape value for .env file (quote if needed)
 * @param {string} value - Value to escape
 * @returns {string} Escaped value
 */
function escapeEnvValue(value) {
  if (!value) return '';
  // If value contains special chars, newlines, or spaces, quote it
  if (/[\s"'`$\\#\n\r]/.test(value)) {
    // Escape backslashes and double quotes, then wrap in double quotes
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}

/**
 * Update .env file with API key
 * @param {string} keyName - Environment variable name
 * @param {string} keyValue - API key value
 */
function updateEnvFile(keyName, keyValue) {
  // Validate env variable name to prevent injection
  if (!isValidEnvVarName(keyName)) {
    throw new Error(`Invalid environment variable name: ${keyName}`);
  }

  let envContent = '';

  try {
    envContent = fs.readFileSync(ENV_PATH, 'utf-8');
  } catch (err) {
    if (process.env.DEBUG) {
      console.log(`[model-config] .env doesn't exist, will create`);
    }
  }

  // Parse existing env vars
  const lines = envContent.split('\n');
  const envVars = {};
  const comments = [];

  for (const line of lines) {
    if (line.startsWith('#') || line.trim() === '') {
      comments.push(line);
    } else {
      const [key, ...valueParts] = line.split('=');
      if (key && isValidEnvVarName(key.trim())) {
        // Store raw value (may be quoted)
        envVars[key.trim()] = valueParts.join('=').trim();
      }
    }
  }

  // Update or add the key with proper escaping
  envVars[keyName] = escapeEnvValue(keyValue);

  // Rebuild .env content
  let newContent = '';

  // Add header comment if new file
  if (!envContent) {
    newContent = '# WogiFlow API Keys\n# Generated by /wogi-models-setup\n\n';
  } else if (comments.length > 0) {
    newContent = comments.join('\n') + '\n';
  }

  // Add env vars
  for (const [key, value] of Object.entries(envVars)) {
    newContent += `${key}=${value}\n`;
  }

  fs.writeFileSync(ENV_PATH, newContent, { mode: 0o600 });

  // Also set in current process (use raw value, not escaped)
  process.env[keyName] = keyValue;
}

/**
 * Test connection to a provider
 * @param {string} providerName - Provider name
 * @returns {Promise<{success: boolean, message: string, models?: string[]}>}
 */
async function testProviderConnection(providerName) {
  const modelsConfig = getModelsConfig();
  const providerConfig = modelsConfig.providers?.[providerName] || {};
  const knownProvider = KNOWN_PROVIDERS[providerName];

  if (!knownProvider) {
    return { success: false, message: `Unknown provider: ${providerName}` };
  }

  const endpoint = providerConfig.endpoint || knownProvider.endpoint;
  const apiKeyEnv = providerConfig.apiKeyEnv || knownProvider.envKey;
  const apiKey = apiKeyEnv ? process.env[apiKeyEnv] : null;

  // Local provider detection
  if (providerName === 'local') {
    return testLocalProvider(endpoint);
  }

  // Cloud provider test
  if (!apiKey) {
    return { success: false, message: `API key not set (${apiKeyEnv})` };
  }

  try {
    const result = await testCloudProvider(providerName, endpoint, apiKey);
    return result;
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/**
 * Test local LLM provider (Ollama/LM Studio)
 */
async function testLocalProvider(endpoint) {
  const https = require('https');
  const http = require('http');

  return new Promise((resolve) => {
    const url = new URL('/api/tags', endpoint);
    const client = url.protocol === 'https:' ? https : http;

    const req = client.request(url, { method: 'GET', timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const models = parsed.models?.map(m => m.name) || [];
          resolve({
            success: true,
            message: `Connected to Ollama. Found ${models.length} models.`,
            models
          });
        } catch (err) {
          resolve({ success: false, message: 'Invalid response from local LLM' });
        }
      });
    });

    req.on('error', () => {
      // Try LM Studio endpoint
      testLMStudio(endpoint).then(resolve);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, message: 'Connection timeout' });
    });

    req.end();
  });
}

/**
 * Test LM Studio provider
 */
async function testLMStudio(baseEndpoint) {
  const http = require('http');

  return new Promise((resolve) => {
    // LM Studio uses OpenAI-compatible endpoint
    const endpoint = baseEndpoint.replace(':11434', ':1234');
    const url = new URL('/v1/models', endpoint);

    const req = http.request(url, { method: 'GET', timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const models = parsed.data?.map(m => m.id) || [];
          resolve({
            success: true,
            message: `Connected to LM Studio. Found ${models.length} models.`,
            models,
            provider: 'lmstudio'
          });
        } catch (err) {
          resolve({ success: false, message: 'No local LLM detected' });
        }
      });
    });

    req.on('error', () => {
      resolve({ success: false, message: 'No local LLM detected at localhost:11434 or :1234' });
    });

    req.end();
  });
}

/**
 * Test cloud provider connection
 */
async function testCloudProvider(providerName, endpoint, apiKey) {
  const https = require('https');

  return new Promise((resolve, reject) => {
    let url, headers;

    switch (providerName) {
      case 'openai':
        url = new URL('/v1/models', endpoint);
        headers = { 'Authorization': `Bearer ${apiKey}` };
        break;
      case 'google':
        url = new URL('/v1beta/models', endpoint);
        headers = { 'x-goog-api-key': apiKey };
        break;
      case 'anthropic':
        // Anthropic doesn't have a models list endpoint, just test with a simple check
        resolve({ success: true, message: 'API key format valid (Anthropic)' });
        return;
      default:
        reject(new Error(`Unknown cloud provider: ${providerName}`));
        return;
    }

    const req = https.request(url, { method: 'GET', headers, timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);

            // Check for prototype pollution in API response
            if (hasDangerousKeys(parsed)) {
              resolve({ success: false, message: 'Invalid API response (security check failed)' });
              return;
            }

            let models = [];

            if (providerName === 'openai') {
              models = parsed.data?.map(m => m.id).filter(id =>
                id.startsWith('gpt-4') || id.startsWith('o1')
              ).slice(0, 10) || [];
            } else if (providerName === 'google') {
              models = parsed.models?.map(m => m.name.replace('models/', '')) || [];
            }

            resolve({
              success: true,
              message: `Connected to ${providerName}. Found ${models.length} models.`,
              models
            });
          } catch (err) {
            resolve({ success: true, message: `Connected to ${providerName}` });
          }
        } else if (res.statusCode === 401) {
          resolve({ success: false, message: 'Invalid API key' });
        } else {
          resolve({ success: false, message: `API error: ${res.statusCode}` });
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Connection timeout'));
    });

    req.end();
  });
}

/**
 * Migrate old config formats to new unified structure
 * - hybrid.executor → models.providers
 * - peerReview.apiKeys → models.providers
 */
function migrateOldConfig() {
  const config = readConfig();
  let migrated = false;

  // Initialize models section if needed
  if (!config.models) {
    config.models = { providers: {}, defaults: {} };
  }
  if (!config.models.providers) {
    config.models.providers = {};
  }

  // Migrate hybrid.executor config
  if (config.hybrid?.executor) {
    const executor = config.hybrid.executor;
    const provider = executor.provider;

    if (provider && !config.models.providers[provider]) {
      config.models.providers[provider] = {
        enabled: true,
        apiKeyEnv: executor.apiKeyEnv || KNOWN_PROVIDERS[provider]?.envKey,
        models: executor.model ? [executor.model] : [],
        endpoint: executor.providerEndpoint
      };

      // Set as hybrid default
      if (executor.model) {
        config.models.defaults = config.models.defaults || {};
        config.models.defaults.hybrid = `${provider}:${executor.model}`;
      }

      migrated = true;
      console.log(`${c.cyan}[model-config]${c.reset} Migrated hybrid.executor to models.providers.${provider}`);
    }
  }

  // Migrate peerReview.apiKeys config
  if (config.peerReview?.apiKeys) {
    for (const [provider, keyRef] of Object.entries(config.peerReview.apiKeys)) {
      if (!config.models.providers[provider]) {
        // Extract env var name from ${VAR_NAME} format
        const envKey = keyRef.replace(/^\$\{|\}$/g, '');

        config.models.providers[provider] = {
          enabled: true,
          apiKeyEnv: envKey,
          models: KNOWN_PROVIDERS[provider]?.models?.slice(0, 2) || []
        };

        migrated = true;
        console.log(`${c.cyan}[model-config]${c.reset} Migrated peerReview.apiKeys.${provider} to models.providers`);
      }
    }

    // Migrate peer review model defaults
    if (config.peerReview.models && !config.models.defaults?.peerReview) {
      config.models.defaults = config.models.defaults || {};
      config.models.defaults.peerReview = config.peerReview.models;
      migrated = true;
    }
  }

  if (migrated) {
    writeConfig(config);
    console.log(`${c.green}[model-config]${c.reset} Migration complete. Config saved.`);
  }

  return migrated;
}

/**
 * Get default models for a feature
 * @param {string} feature - 'hybrid' or 'peerReview'
 * @returns {string|string[]} Default model(s)
 */
function getDefaultModels(feature) {
  const modelsConfig = getModelsConfig();
  return modelsConfig.defaults?.[feature] || null;
}

/**
 * Set default models for a feature
 * @param {string} feature - 'hybrid' or 'peerReview'
 * @param {string|string[]} models - Model(s) to set as default
 */
function setDefaultModels(feature, models) {
  const modelsConfig = getModelsConfig();
  if (!modelsConfig.defaults) {
    modelsConfig.defaults = {};
  }
  modelsConfig.defaults[feature] = models;
  updateModelsConfig(modelsConfig);
}

/**
 * Check if Claude should be included in peer reviews
 * When enabled, Claude performs its own review alongside external models
 * @returns {boolean} True if Claude should participate in peer review
 */
function shouldIncludeClaude() {
  const modelsConfig = getModelsConfig();
  return modelsConfig.defaults?.includeClaude === true;
}

/**
 * Set whether Claude should be included in peer reviews
 * @param {boolean} include - Whether to include Claude
 */
function setIncludeClaude(include) {
  const modelsConfig = getModelsConfig();
  if (!modelsConfig.defaults) {
    modelsConfig.defaults = {};
  }
  modelsConfig.defaults.includeClaude = include;
  updateModelsConfig(modelsConfig);
}

/**
 * Check if any models are configured
 * @returns {boolean}
 */
function hasConfiguredModels() {
  const providers = getConfiguredProviders();
  return providers.some(p => p.enabled && p.apiKeySet && p.models.length > 0);
}

// ============================================================
// Session State (for model selection persistence within session)
// ============================================================

/**
 * Read session state file
 * @returns {Object} Session state object
 */
function readSessionState() {
  return safeJsonParse(SESSION_STATE_PATH, {});
}

/**
 * Write session state file
 * @param {Object} state - State to write
 */
function writeSessionState(state) {
  try {
    const stateDir = path.dirname(SESSION_STATE_PATH);
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(SESSION_STATE_PATH, JSON.stringify(state, null, 2), { mode: 0o600 });
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[model-config] Failed to write session state: ${err.message}`);
    }
    // Don't throw - session state is non-critical
  }
}

/**
 * Get models selected for current session
 * @param {string} feature - 'peerReview' or 'hybrid'
 * @returns {string|string[]|null} Selected models or null if not set
 */
function getSessionModels(feature) {
  const state = readSessionState();
  return state.selectedModels?.[feature] || null;
}

/**
 * Set models for current session
 * @param {string} feature - 'peerReview' or 'hybrid'
 * @param {string|string[]} models - Model(s) to set
 */
function setSessionModels(feature, models) {
  const state = readSessionState();
  if (!state.selectedModels) {
    state.selectedModels = {};
  }
  state.selectedModels[feature] = models;
  writeSessionState(state);
}

/**
 * Clear all session model selections
 * Called by /wogi-session-end
 */
function clearSessionModels() {
  const state = readSessionState();
  if (state.selectedModels) {
    delete state.selectedModels;
    writeSessionState(state);
  }
}

/**
 * Check if models are selected for a feature in current session
 * @param {string} feature - 'peerReview' or 'hybrid'
 * @returns {boolean}
 */
function hasSessionModels(feature) {
  const state = readSessionState();
  const models = state.selectedModels?.[feature];
  return Array.isArray(models) ? models.length > 0 : !!models;
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'list':
      const providers = getConfiguredProviders();
      console.log('\nConfigured Providers:');
      for (const p of providers) {
        const status = p.enabled && p.apiKeySet ? c.green + '✓' + c.reset : c.red + '✗' + c.reset;
        console.log(`  ${status} ${p.displayName}: ${p.models.join(', ') || '(no models)'}`);
      }
      console.log('\nEnabled Models:');
      const models = getEnabledModels();
      for (const m of models) {
        console.log(`  - ${m}`);
      }
      break;

    case 'migrate':
      migrateOldConfig();
      break;

    case 'test':
      const providerName = args[1];
      if (!providerName) {
        console.error('Usage: flow-model-config test <provider>');
        process.exit(1);
      }
      testProviderConnection(providerName).then(result => {
        if (result.success) {
          console.log(`${c.green}✓${c.reset} ${result.message}`);
          if (result.models) {
            console.log('  Models:', result.models.slice(0, 5).join(', '));
          }
        } else {
          console.log(`${c.red}✗${c.reset} ${result.message}`);
        }
      });
      break;

    default:
      console.log(`
Wogi Flow - Model Configuration

Commands:
  list              List configured providers and models
  migrate           Migrate old config format to new unified format
  test <provider>   Test connection to a provider

Examples:
  node flow-model-config.js list
  node flow-model-config.js test openai
  node flow-model-config.js migrate
`);
  }
}

module.exports = {
  // Core functions
  getModelsConfig,
  updateModelsConfig,
  getConfiguredProviders,
  getEnabledModels,
  hasConfiguredModels,

  // Provider management
  addProvider,
  removeProvider,
  testProviderConnection,

  // Defaults
  getDefaultModels,
  setDefaultModels,

  // Claude inclusion for peer review
  shouldIncludeClaude,
  setIncludeClaude,

  // Session state (model selection persistence)
  getSessionModels,
  setSessionModels,
  clearSessionModels,
  hasSessionModels,

  // Migration
  migrateOldConfig,

  // Constants
  KNOWN_PROVIDERS,

  // Utility
  updateEnvFile
};
