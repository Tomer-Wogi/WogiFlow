#!/usr/bin/env node

/**
 * Wogi Flow - Orchestrator LLM Clients
 *
 * LLM client implementations for the hybrid mode orchestrator.
 * Supports both local LLMs (Ollama, LM Studio) and cloud providers.
 *
 * Extracted from flow-orchestrate.js for modularity.
 */

const http = require('http');
const https = require('https');

const {
  createExecutorFromConfig,
  MODEL_CAPABILITIES
} = require('./flow-providers');

// ============================================================
// Logging Helper
// ============================================================

const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

function log(color, ...args) {
  console.log(colors[color] + args.join(' ') + colors.reset);
}

// ============================================================
// Model Defaults
// ============================================================

// Model-specific context window defaults for popular models
const MODEL_DEFAULTS = {
  'qwen/qwen3-coder-30b': { contextWindow: 32768 },
  'qwen/qwen3-coder': { contextWindow: 32768 },
  'qwen3-coder': { contextWindow: 32768 },
  'nvidia/nemotron-3-nano': { contextWindow: 8192 },
  'nemotron': { contextWindow: 8192 },
  'meta/llama-3.3-70b': { contextWindow: 131072 },
  'llama-3.3': { contextWindow: 131072 },
  'llama-3.1': { contextWindow: 131072 },
  'deepseek-coder': { contextWindow: 16384 },
  'codellama': { contextWindow: 16384 },
  'mistral': { contextWindow: 32768 },
  'mixtral': { contextWindow: 32768 },
};

/**
 * Gets default settings for a model by name
 * @param {string} modelName - The model name from config
 * @returns {Object} - Default settings including contextWindow
 */
function getModelDefaults(modelName) {
  if (!modelName) return { contextWindow: 4096 };

  const lowerName = modelName.toLowerCase();

  // Try exact match first
  if (MODEL_DEFAULTS[modelName]) {
    return MODEL_DEFAULTS[modelName];
  }

  // Try partial match
  for (const [key, defaults] of Object.entries(MODEL_DEFAULTS)) {
    if (lowerName.includes(key.toLowerCase())) {
      return defaults;
    }
  }

  return { contextWindow: 4096 }; // Conservative fallback
}

// ============================================================
// Local LLM Client
// ============================================================

class LocalLLM {
  constructor(config) {
    this.config = config;
    this.contextWindow = config.contextWindow || null; // Will be auto-detected or use defaults
    this.modelInfoFetched = false;
  }

  /**
   * Fetches model info including context window from the provider.
   * Called once on first generate() call.
   *
   * Priority order:
   * 1. Config override (hybrid.settings.contextWindow)
   * 2. Auto-detection from provider API
   * 3. Model-specific defaults
   * 4. Conservative fallback (4096)
   */
  async fetchModelInfo() {
    if (this.modelInfoFetched) return;
    this.modelInfoFetched = true;

    // Priority 1: Config override
    if (this.config.contextWindow) {
      this.contextWindow = this.config.contextWindow;
      log('dim', `   📊 Using configured context window: ${this.contextWindow.toLocaleString()} tokens`);
      return;
    }

    // Get model defaults for fallback
    const modelDefaults = getModelDefaults(this.config.model);

    try {
      // Priority 2: Auto-detection from provider
      if (this.config.provider === 'ollama') {
        const info = await this.ollamaShowModel();
        if (info.contextLength) {
          this.contextWindow = info.contextLength;
          log('dim', `   📊 Model context window (detected): ${this.contextWindow.toLocaleString()} tokens`);
          return;
        }
      } else {
        // LM Studio / OpenAI-compatible
        const info = await this.lmStudioGetModelInfo();
        if (info.contextLength) {
          this.contextWindow = info.contextLength;
          log('dim', `   📊 Model context window (detected): ${this.contextWindow.toLocaleString()} tokens`);
          return;
        }
      }

      // Priority 3: Model-specific defaults
      this.contextWindow = modelDefaults.contextWindow;
      log('dim', `   📊 Using model default context window: ${this.contextWindow.toLocaleString()} tokens`);
    } catch (err) {
      log('dim', `   ⚠️ Could not fetch model info: ${err.message}`);
      // Priority 3/4: Model-specific defaults or conservative fallback
      this.contextWindow = modelDefaults.contextWindow;
      log('dim', `   📊 Using model default context window: ${this.contextWindow.toLocaleString()} tokens`);
    }
  }

  /**
   * Ollama: GET /api/show to get model parameters
   */
  async ollamaShowModel() {
    return new Promise((resolve, reject) => {
      const url = new URL('/api/show', this.config.endpoint);
      const postData = JSON.stringify({ name: this.config.model });

      const req = http.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 10000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            // Ollama returns model_info with context_length or parameters.num_ctx
            const contextLength =
              parsed.model_info?.['context_length'] ||
              parsed.model_info?.context_length ||
              parsed.parameters?.num_ctx ||
              parsed.details?.parameter_size && 4096; // fallback
            resolve({ contextLength: contextLength || 4096 });
          } catch (err) {
            reject(new Error('Invalid response from Ollama /api/show'));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout fetching model info'));
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * LM Studio: GET /v1/models to get model info
   */
  async lmStudioGetModelInfo() {
    return new Promise((resolve, reject) => {
      const url = new URL('/v1/models', this.config.endpoint);
      const client = url.protocol === 'https:' ? https : http;

      const req = client.request(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            // Find our model in the list
            const model = parsed.data?.find(m =>
              m.id === this.config.model ||
              m.id?.includes(this.config.model)
            );
            // LM Studio may include context_length in model object
            const contextLength = model?.context_length || model?.max_tokens || 4096;
            resolve({ contextLength });
          } catch (err) {
            reject(new Error('Invalid response from /v1/models'));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout fetching model info'));
      });

      req.end();
    });
  }

  async generate(prompt) {
    // Fetch model info on first call
    await this.fetchModelInfo();

    if (this.config.provider === 'ollama') {
      return this.ollamaGenerate(prompt);
    } else {
      return this.openaiCompatibleGenerate(prompt);
    }
  }

  async ollamaGenerate(prompt) {
    return new Promise((resolve, reject) => {
      const url = new URL('/api/generate', this.config.endpoint);
      const postData = JSON.stringify({
        model: this.config.model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: this.config.temperature,
          num_predict: this.config.maxTokens
        }
      });

      const req = http.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: this.config.timeout
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.response || '');
          } catch (err) {
            reject(new Error('Invalid response from Ollama'));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.write(postData);
      req.end();
    });
  }

  async openaiCompatibleGenerate(prompt) {
    return new Promise((resolve, reject) => {
      const url = new URL('/v1/chat/completions', this.config.endpoint);
      const postData = JSON.stringify({
        model: this.config.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens
      });

      const client = url.protocol === 'https:' ? https : http;

      const req = client.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: this.config.timeout
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.choices?.[0]?.message?.content || '');
          } catch (err) {
            reject(new Error('Invalid response from LLM'));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.write(postData);
      req.end();
    });
  }
}

// ============================================================
// Cloud Executor Client
// ============================================================

/**
 * CloudExecutor wraps cloud providers from flow-providers.js
 * and exposes the same interface as LocalLLM (generate, contextWindow)
 * for seamless integration with the Orchestrator.
 */
class CloudExecutor {
  constructor(config) {
    this.config = config;
    this.provider = createExecutorFromConfig({ executor: config });
    this.contextWindow = null;
    this.modelInfoFetched = false;

    if (!this.provider) {
      throw new Error(`Failed to create cloud executor for provider: ${config.provider}`);
    }

    log('cyan', `   ☁️  Cloud executor: ${config.provider} / ${config.model}`);
  }

  /**
   * Fetches model info including context window from MODEL_CAPABILITIES.
   * Called once on first generate() call.
   */
  async fetchModelInfo() {
    if (this.modelInfoFetched) return;
    this.modelInfoFetched = true;

    // Priority 1: Config override
    if (this.config.contextWindow) {
      this.contextWindow = this.config.contextWindow;
      log('dim', `   📊 Using configured context window: ${this.contextWindow.toLocaleString()} tokens`);
      return;
    }

    // Priority 2: Look up in MODEL_CAPABILITIES
    const modelName = this.config.model || '';
    const lowerModel = modelName.toLowerCase();

    // Try exact match first
    if (MODEL_CAPABILITIES[modelName]) {
      this.contextWindow = MODEL_CAPABILITIES[modelName].contextWindow;
      log('dim', `   📊 Model context window: ${this.contextWindow.toLocaleString()} tokens`);
      return;
    }

    // Try partial match
    for (const [key, caps] of Object.entries(MODEL_CAPABILITIES)) {
      if (lowerModel.includes(key.toLowerCase()) || key.toLowerCase().includes(lowerModel)) {
        this.contextWindow = caps.contextWindow;
        log('dim', `   📊 Model context window (matched ${key}): ${this.contextWindow.toLocaleString()} tokens`);
        return;
      }
    }

    // Priority 3: Provider-specific defaults
    const providerDefaults = {
      'openai': 128000,    // GPT-4o-mini
      'anthropic': 200000, // Claude Haiku
      'google': 1000000    // Gemini Flash
    };

    this.contextWindow = providerDefaults[this.config.provider] || 128000;
    log('dim', `   📊 Using provider default context window: ${this.contextWindow.toLocaleString()} tokens`);
  }

  /**
   * Generate a response from the cloud LLM.
   * Matches the LocalLLM interface.
   */
  async generate(prompt) {
    // Fetch model info on first call
    await this.fetchModelInfo();

    try {
      const response = await this.provider.complete(prompt, {
        model: this.config.model,
        temperature: this.config.temperature,
        maxTokens: this.config.maxTokens
      });
      return response;
    } catch (err) {
      // Enhance error message with cloud-specific context
      const enhancedError = new Error(
        `Cloud executor error (${this.config.provider}/${this.config.model}): ${err.message}`
      );
      enhancedError.originalError = err;
      throw enhancedError;
    }
  }
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Factory function to create the appropriate executor based on config.
 * Returns either LocalLLM or CloudExecutor.
 */
function createExecutor(config) {
  const executorType = config.executorType || 'local';

  if (executorType === 'cloud') {
    // Validate cloud config
    const cloudProviders = ['openai', 'anthropic', 'google'];
    if (!cloudProviders.includes(config.provider)) {
      throw new Error(
        `Invalid cloud provider: ${config.provider}. ` +
        `Supported: ${cloudProviders.join(', ')}`
      );
    }

    return new CloudExecutor(config);
  }

  // Default to local LLM (ollama, lm-studio)
  return new LocalLLM(config);
}

module.exports = {
  LocalLLM,
  CloudExecutor,
  createExecutor,
  getModelDefaults,
  MODEL_DEFAULTS
};
