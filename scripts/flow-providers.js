#!/usr/bin/env node

/**
 * Wogi Flow - Model Provider Abstraction
 *
 * Unified interface for local and cloud LLM providers:
 * - Ollama (local)
 * - LM Studio (local)
 * - Anthropic (cloud)
 * - OpenAI (cloud)
 *
 * Usage as module:
 *   const { createProvider, listProviders } = require('./flow-providers');
 *   const provider = createProvider({ type: 'anthropic', apiKey: '...' });
 *   const response = await provider.complete(prompt, options);
 *
 * Usage as CLI:
 *   flow providers list                 # List available providers
 *   flow providers test <type>          # Test a provider
 *   flow providers configure <type>     # Configure a provider
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { getProjectRoot, colors: c } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const CONFIG_PATH = path.join(WORKFLOW_DIR, 'config.json');

/**
 * Provider types
 */
const PROVIDER_TYPES = {
  OLLAMA: 'ollama',
  LM_STUDIO: 'lm-studio',
  ANTHROPIC: 'anthropic',
  OPENAI: 'openai',
  GOOGLE: 'google'
};

/**
 * Model capability heuristics
 * Used as fallback when API doesn't provide capability info
 */
const MODEL_CAPABILITIES = {
  // High-quality code models
  'qwen': { codeQuality: 'high', instructionFollowing: 'high', contextWindow: 32768 },
  'qwen3': { codeQuality: 'excellent', instructionFollowing: 'excellent', contextWindow: 131072 },
  'codellama': { codeQuality: 'high', instructionFollowing: 'medium', contextWindow: 16384 },
  'deepseek': { codeQuality: 'excellent', instructionFollowing: 'high', contextWindow: 32768 },
  'deepseek-coder': { codeQuality: 'excellent', instructionFollowing: 'high', contextWindow: 16384 },
  'nemotron': { codeQuality: 'high', instructionFollowing: 'excellent', contextWindow: 32768 },
  'starcoder': { codeQuality: 'high', instructionFollowing: 'medium', contextWindow: 8192 },

  // General purpose models
  'llama3': { codeQuality: 'medium', instructionFollowing: 'high', contextWindow: 8192 },
  'llama3.1': { codeQuality: 'high', instructionFollowing: 'high', contextWindow: 131072 },
  'llama3.2': { codeQuality: 'medium', instructionFollowing: 'high', contextWindow: 131072 },
  'mistral': { codeQuality: 'medium', instructionFollowing: 'high', contextWindow: 32768 },
  'mixtral': { codeQuality: 'high', instructionFollowing: 'high', contextWindow: 32768 },
  'phi': { codeQuality: 'medium', instructionFollowing: 'medium', contextWindow: 4096 },
  'phi3': { codeQuality: 'high', instructionFollowing: 'high', contextWindow: 128000 },
  'gemma': { codeQuality: 'medium', instructionFollowing: 'high', contextWindow: 8192 },
  'gemma2': { codeQuality: 'high', instructionFollowing: 'high', contextWindow: 8192 },

  // Cloud models - Full capability
  'claude-opus-4-6': { codeQuality: 'excellent', instructionFollowing: 'excellent', contextWindow: 200000, costTier: 'premium' },
  'claude-opus-4-5': { codeQuality: 'excellent', instructionFollowing: 'excellent', contextWindow: 200000, costTier: 'premium' },
  'claude-sonnet-4-6': { codeQuality: 'excellent', instructionFollowing: 'excellent', contextWindow: 200000, costTier: 'standard' },
  'claude-sonnet-4-5': { codeQuality: 'excellent', instructionFollowing: 'excellent', contextWindow: 200000, costTier: 'standard' },
  'claude': { codeQuality: 'excellent', instructionFollowing: 'excellent', contextWindow: 200000 },
  'gpt-4': { codeQuality: 'excellent', instructionFollowing: 'excellent', contextWindow: 128000 },
  'gpt-3.5': { codeQuality: 'medium', instructionFollowing: 'high', contextWindow: 16385 },

  // Cloud models - Executor tier (cheaper/faster)
  'gpt-4o-mini': { codeQuality: 'high', instructionFollowing: 'high', contextWindow: 128000, costTier: 'cheap' },
  'claude-3-haiku': { codeQuality: 'high', instructionFollowing: 'high', contextWindow: 200000, costTier: 'cheap' },
  'claude-3-5-haiku': { codeQuality: 'high', instructionFollowing: 'excellent', contextWindow: 200000, costTier: 'cheap' },
  'gemini-flash': { codeQuality: 'high', instructionFollowing: 'high', contextWindow: 1000000, costTier: 'cheap' },
  'gemini-2.0-flash': { codeQuality: 'high', instructionFollowing: 'high', contextWindow: 1000000, costTier: 'cheap' },
  'gemini-1.5-flash': { codeQuality: 'high', instructionFollowing: 'high', contextWindow: 1000000, costTier: 'cheap' },
};

/**
 * Detect model capabilities from model name
 */
function detectModelCapabilities(modelName) {
  if (!modelName) return null;

  const nameLower = modelName.toLowerCase();

  // Try exact matches first
  for (const [pattern, caps] of Object.entries(MODEL_CAPABILITIES)) {
    if (nameLower.includes(pattern)) {
      return {
        ...caps,
        source: 'heuristic',
        matchedPattern: pattern
      };
    }
  }

  // Default fallback for unknown models
  return {
    codeQuality: 'unknown',
    instructionFollowing: 'unknown',
    contextWindow: 4096,
    source: 'default'
  };
}

/**
 * Get recommended model for a task type
 */
function getRecommendedModel(availableModels, taskType = 'code') {
  if (!availableModels || availableModels.length === 0) return null;

  const withCaps = availableModels.map(m => ({
    ...m,
    capabilities: detectModelCapabilities(m.id || m.name)
  }));

  // Score models based on task
  const scored = withCaps.map(m => {
    let score = 0;
    const caps = m.capabilities;

    if (taskType === 'code') {
      if (caps.codeQuality === 'excellent') score += 10;
      else if (caps.codeQuality === 'high') score += 7;
      else if (caps.codeQuality === 'medium') score += 4;
    }

    if (caps.instructionFollowing === 'excellent') score += 5;
    else if (caps.instructionFollowing === 'high') score += 3;

    // Prefer larger context windows for complex tasks
    if (caps.contextWindow >= 32768) score += 3;
    else if (caps.contextWindow >= 16384) score += 2;

    return { ...m, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored[0] || null;
}

/**
 * Default provider configurations
 */
const DEFAULT_CONFIGS = {
  ollama: {
    endpoint: 'http://localhost:11434',
    model: 'llama3.2',
    temperature: 0.7,
    maxTokens: 4096,
    timeout: 120000
  },
  'lm-studio': {
    endpoint: 'http://localhost:1234/v1',
    model: 'local-model',
    temperature: 0.7,
    maxTokens: 4096,
    timeout: 120000
  },
  anthropic: {
    endpoint: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-20250514',
    temperature: 0.7,
    maxTokens: 4096,
    timeout: 60000
  },
  openai: {
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    temperature: 0.7,
    maxTokens: 4096,
    timeout: 60000
  },
  google: {
    endpoint: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.0-flash-exp',
    temperature: 0.7,
    maxTokens: 4096,
    timeout: 60000
  }
};

/**
 * Base provider class
 */
class BaseProvider {
  constructor(config) {
    this.config = config;
    this.name = 'base';
  }

  async complete(prompt, options = {}) {
    throw new Error('Not implemented');
  }

  async test() {
    try {
      const response = await this.complete('Say "OK" if you can hear me.', {
        maxTokens: 10
      });
      return { success: true, response };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async listModels() {
    return [];
  }
}

/**
 * Ollama provider
 */
class OllamaProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.name = 'ollama';
  }

  async complete(prompt, options = {}) {
    const endpoint = this.config.endpoint || DEFAULT_CONFIGS.ollama.endpoint;
    const url = new URL('/api/generate', endpoint);

    const body = {
      model: options.model || this.config.model || DEFAULT_CONFIGS.ollama.model,
      prompt,
      stream: false,
      options: {
        temperature: options.temperature || this.config.temperature || 0.7,
        num_predict: options.maxTokens || this.config.maxTokens || 4096
      }
    };

    const response = await this._request(url, body);
    return {
      content: response.response,
      model: response.model,
      usage: {
        promptTokens: response.prompt_eval_count,
        completionTokens: response.eval_count,
        totalTokens: (response.prompt_eval_count || 0) + (response.eval_count || 0)
      }
    };
  }

  async listModels() {
    const endpoint = this.config.endpoint || DEFAULT_CONFIGS.ollama.endpoint;
    const url = new URL('/api/tags', endpoint);

    try {
      const response = await this._request(url, null, 'GET');
      return (response.models || []).map(m => ({
        id: m.name,
        name: m.name,
        size: m.size,
        capabilities: detectModelCapabilities(m.name)
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get detailed model info from Ollama API
   */
  async getModelInfo(modelName) {
    const endpoint = this.config.endpoint || DEFAULT_CONFIGS.ollama.endpoint;
    const url = new URL('/api/show', endpoint);

    try {
      const response = await this._request(url, { name: modelName });

      // Extract capabilities from model metadata if available
      const modelfile = response.modelfile || '';
      const parameters = response.parameters || '';

      // Parse context length from modelfile or parameters
      let contextWindow = 4096;
      const ctxMatch = modelfile.match(/num_ctx\s+(\d+)/i) ||
                       parameters.match(/num_ctx\s+(\d+)/i);
      if (ctxMatch) {
        contextWindow = parseInt(ctxMatch[1], 10);
      }

      // Get heuristic capabilities and override with API data
      const heuristicCaps = detectModelCapabilities(modelName);

      return {
        name: modelName,
        modelfile: modelfile.slice(0, 500), // Truncate for display
        parameters,
        capabilities: {
          ...heuristicCaps,
          contextWindow: Math.max(contextWindow, heuristicCaps.contextWindow),
          source: 'api+heuristic'
        }
      };
    } catch {
      // Fall back to heuristic only
      return {
        name: modelName,
        capabilities: detectModelCapabilities(modelName)
      };
    }
  }

  _request(url, body, method = 'POST') {
    return new Promise((resolve, reject) => {
      const options = {
        method,
        hostname: url.hostname,
        port: url.port || 11434,
        path: url.pathname,
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: this.config.timeout || 120000
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Invalid response: ${data.slice(0, 100)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => reject(new Error('Request timeout')));

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }
}

/**
 * LM Studio provider (OpenAI-compatible)
 */
class LMStudioProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.name = 'lm-studio';
  }

  async complete(prompt, options = {}) {
    const endpoint = this.config.endpoint || DEFAULT_CONFIGS['lm-studio'].endpoint;
    const url = new URL('/chat/completions', endpoint);

    const body = {
      model: options.model || this.config.model || 'local-model',
      messages: [{ role: 'user', content: prompt }],
      temperature: options.temperature || this.config.temperature || 0.7,
      max_tokens: options.maxTokens || this.config.maxTokens || 4096
    };

    const response = await this._request(url, body);
    return {
      content: response.choices?.[0]?.message?.content || '',
      model: response.model,
      usage: {
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens
      }
    };
  }

  _request(url, body) {
    return new Promise((resolve, reject) => {
      const options = {
        method: 'POST',
        hostname: url.hostname,
        port: url.port || 1234,
        path: url.pathname,
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: this.config.timeout || 120000
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Invalid response: ${data.slice(0, 100)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => reject(new Error('Request timeout')));
      req.write(JSON.stringify(body));
      req.end();
    });
  }

  async listModels() {
    const endpoint = this.config.endpoint || DEFAULT_CONFIGS['lm-studio'].endpoint;
    return new Promise((resolve) => {
      const url = new URL('/v1/models', endpoint);
      const req = http.request({
        method: 'GET',
        hostname: url.hostname,
        port: url.port || 1234,
        path: url.pathname,
        timeout: 5000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve((parsed.data || []).map(m => ({ id: m.id, name: m.id })));
          } catch {
            resolve([]);
          }
        });
      });
      req.on('error', () => resolve([]));
      req.on('timeout', () => resolve([]));
      req.end();
    });
  }
}

/**
 * Anthropic provider
 */
class AnthropicProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.name = 'anthropic';
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
  }

  async complete(prompt, options = {}) {
    if (!this.apiKey) {
      throw new Error('Anthropic API key not configured. Set ANTHROPIC_API_KEY or provide apiKey in config.');
    }

    const endpoint = this.config.endpoint || DEFAULT_CONFIGS.anthropic.endpoint;
    const url = new URL('/messages', endpoint);

    const body = {
      model: options.model || this.config.model || DEFAULT_CONFIGS.anthropic.model,
      max_tokens: options.maxTokens || this.config.maxTokens || 4096,
      messages: [{ role: 'user', content: prompt }]
    };

    if (options.system || this.config.system) {
      body.system = options.system || this.config.system;
    }

    const response = await this._request(url, body);

    if (response.error) {
      throw new Error(response.error.message);
    }

    return {
      content: response.content?.[0]?.text || '',
      model: response.model,
      stopReason: response.stop_reason,
      usage: {
        promptTokens: response.usage?.input_tokens,
        completionTokens: response.usage?.output_tokens,
        totalTokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
      }
    };
  }

  _request(url, body) {
    return new Promise((resolve, reject) => {
      const options = {
        method: 'POST',
        hostname: url.hostname,
        path: url.pathname,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01'
        },
        timeout: this.config.timeout || 60000
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Invalid response: ${data.slice(0, 100)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => reject(new Error('Request timeout')));
      req.write(JSON.stringify(body));
      req.end();
    });
  }
}

/**
 * OpenAI provider
 */
class OpenAIProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.name = 'openai';
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY;
  }

  async complete(prompt, options = {}) {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY or provide apiKey in config.');
    }

    const endpoint = this.config.endpoint || DEFAULT_CONFIGS.openai.endpoint;
    const url = new URL('/chat/completions', endpoint);

    const messages = [{ role: 'user', content: prompt }];

    if (options.system || this.config.system) {
      messages.unshift({ role: 'system', content: options.system || this.config.system });
    }

    const body = {
      model: options.model || this.config.model || DEFAULT_CONFIGS.openai.model,
      messages,
      temperature: options.temperature || this.config.temperature || 0.7,
      max_tokens: options.maxTokens || this.config.maxTokens || 4096
    };

    const response = await this._request(url, body);

    if (response.error) {
      throw new Error(response.error.message);
    }

    return {
      content: response.choices?.[0]?.message?.content || '',
      model: response.model,
      stopReason: response.choices?.[0]?.finish_reason,
      usage: {
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens
      }
    };
  }

  async listModels() {
    if (!this.apiKey) return [];

    const endpoint = this.config.endpoint || DEFAULT_CONFIGS.openai.endpoint;
    const url = new URL('/models', endpoint);

    try {
      const response = await this._request(url, null, 'GET');
      return (response.data || [])
        .filter(m => m.id.includes('gpt'))
        .map(m => ({
          id: m.id,
          name: m.id,
          owned_by: m.owned_by
        }));
    } catch {
      return [];
    }
  }

  _request(url, body, method = 'POST') {
    return new Promise((resolve, reject) => {
      const options = {
        method,
        hostname: url.hostname,
        path: url.pathname,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        timeout: this.config.timeout || 60000
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Invalid response: ${data.slice(0, 100)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => reject(new Error('Request timeout')));

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }
}

/**
 * Google (Gemini) provider
 */
class GoogleProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.name = 'google';
    this.apiKey = config.apiKey || process.env.GOOGLE_API_KEY;
  }

  async complete(prompt, options = {}) {
    if (!this.apiKey) {
      throw new Error('Google API key not configured. Set GOOGLE_API_KEY or provide apiKey in config.');
    }

    const model = options.model || this.config.model || DEFAULT_CONFIGS.google.model;
    const endpoint = this.config.endpoint || DEFAULT_CONFIGS.google.endpoint;
    const url = new URL(`/models/${model}:generateContent`, endpoint);
    // API key passed via header for security (not URL to avoid logging exposure)

    const body = {
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: options.temperature || this.config.temperature || 0.7,
        maxOutputTokens: options.maxTokens || this.config.maxTokens || 4096
      }
    };

    // Add system instruction if provided
    if (options.system || this.config.system) {
      body.systemInstruction = {
        parts: [{ text: options.system || this.config.system }]
      };
    }

    const response = await this._request(url, body, 'POST', { 'x-goog-api-key': this.apiKey });

    if (response.error) {
      throw new Error(response.error.message);
    }

    const content = response.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return {
      content,
      model,
      stopReason: response.candidates?.[0]?.finishReason,
      usage: {
        promptTokens: response.usageMetadata?.promptTokenCount,
        completionTokens: response.usageMetadata?.candidatesTokenCount,
        totalTokens: response.usageMetadata?.totalTokenCount
      }
    };
  }

  async listModels() {
    if (!this.apiKey) return [];

    const endpoint = this.config.endpoint || DEFAULT_CONFIGS.google.endpoint;
    const url = new URL('/models', endpoint);

    try {
      const response = await this._request(url, null, 'GET', { 'x-goog-api-key': this.apiKey });
      return (response.models || [])
        .filter(m => m.name.includes('gemini'))
        .map(m => ({
          id: m.name.replace('models/', ''),
          name: m.displayName || m.name,
          description: m.description
        }));
    } catch {
      return [];
    }
  }

  _request(url, body, method = 'POST', additionalHeaders = {}) {
    return new Promise((resolve, reject) => {
      const options = {
        method,
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: {
          'Content-Type': 'application/json',
          ...additionalHeaders
        },
        timeout: this.config.timeout || 60000
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Invalid response: ${data.slice(0, 100)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => reject(new Error('Request timeout')));

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }
}

/**
 * Create a provider instance
 */
function createProvider(config) {
  const type = config.type || config.provider;

  switch (type) {
    case PROVIDER_TYPES.OLLAMA:
      return new OllamaProvider(config);
    case PROVIDER_TYPES.LM_STUDIO:
      return new LMStudioProvider(config);
    case PROVIDER_TYPES.ANTHROPIC:
      return new AnthropicProvider(config);
    case PROVIDER_TYPES.OPENAI:
      return new OpenAIProvider(config);
    case PROVIDER_TYPES.GOOGLE:
      return new GoogleProvider(config);
    default:
      throw new Error(`Unknown provider type: ${type}`);
  }
}

/**
 * Create executor provider from hybrid config
 * Supports both legacy config (provider/model) and new executor config
 */
function createExecutorFromConfig(hybridConfig) {
  // New executor config structure
  if (hybridConfig.executor && hybridConfig.executor.provider) {
    const executor = hybridConfig.executor;
    return createProvider({
      type: executor.provider,
      endpoint: executor.providerEndpoint,
      model: executor.model,
      apiKey: executor.apiKey,
      ...hybridConfig.settings
    });
  }

  // Legacy config structure (backward compatible)
  if (hybridConfig.provider) {
    return createProvider({
      type: hybridConfig.provider,
      endpoint: hybridConfig.providerEndpoint,
      model: hybridConfig.model,
      apiKey: hybridConfig.apiKey,
      ...hybridConfig.settings
    });
  }

  return null;
}

/**
 * Get executor configuration from hybrid config
 * Normalizes legacy and new config formats
 */
function getExecutorConfig(hybridConfig) {
  // New executor config
  if (hybridConfig.executor && hybridConfig.executor.provider) {
    return {
      type: hybridConfig.executor.type || 'local',
      provider: hybridConfig.executor.provider,
      providerEndpoint: hybridConfig.executor.providerEndpoint,
      model: hybridConfig.executor.model,
      apiKey: hybridConfig.executor.apiKey
    };
  }

  // Legacy config
  if (hybridConfig.provider) {
    const isLocal = ['ollama', 'lm-studio'].includes(hybridConfig.provider);
    return {
      type: isLocal ? 'local' : 'cloud',
      provider: hybridConfig.provider,
      providerEndpoint: hybridConfig.providerEndpoint,
      model: hybridConfig.model,
      apiKey: hybridConfig.apiKey
    };
  }

  return null;
}

/**
 * List all available providers
 */
function listProviders() {
  return [
    {
      type: PROVIDER_TYPES.OLLAMA,
      name: 'Ollama',
      local: true,
      requiresKey: false,
      defaultEndpoint: DEFAULT_CONFIGS.ollama.endpoint,
      executorModels: ['qwen3-coder', 'deepseek-coder', 'codellama', 'nemotron']
    },
    {
      type: PROVIDER_TYPES.LM_STUDIO,
      name: 'LM Studio',
      local: true,
      requiresKey: false,
      defaultEndpoint: DEFAULT_CONFIGS['lm-studio'].endpoint,
      executorModels: ['loaded model']
    },
    {
      type: PROVIDER_TYPES.ANTHROPIC,
      name: 'Anthropic',
      local: false,
      requiresKey: true,
      envVar: 'ANTHROPIC_API_KEY',
      defaultEndpoint: DEFAULT_CONFIGS.anthropic.endpoint,
      executorModels: ['claude-3-5-haiku-latest', 'claude-3-haiku-20240307']
    },
    {
      type: PROVIDER_TYPES.OPENAI,
      name: 'OpenAI',
      local: false,
      requiresKey: true,
      envVar: 'OPENAI_API_KEY',
      defaultEndpoint: DEFAULT_CONFIGS.openai.endpoint,
      executorModels: ['gpt-4o-mini', 'gpt-4o']
    },
    {
      type: PROVIDER_TYPES.GOOGLE,
      name: 'Google (Gemini)',
      local: false,
      requiresKey: true,
      envVar: 'GOOGLE_API_KEY',
      defaultEndpoint: DEFAULT_CONFIGS.google.endpoint,
      executorModels: ['gemini-2.0-flash-exp', 'gemini-1.5-flash']
    }
  ];
}

/**
 * Detect available providers
 */
async function detectProviders() {
  const available = [];

  // Check Ollama (local)
  try {
    const ollama = new OllamaProvider({});
    const models = await ollama.listModels();
    if (models.length > 0) {
      available.push({
        type: PROVIDER_TYPES.OLLAMA,
        name: 'Ollama',
        local: true,
        cost: 'free',
        models: models.slice(0, 5)
      });
    }
  } catch {
    // Not available
  }

  // Check LM Studio (local)
  try {
    const lmStudio = new LMStudioProvider({});
    const models = await lmStudio.listModels();
    if (models.length > 0) {
      available.push({
        type: PROVIDER_TYPES.LM_STUDIO,
        name: 'LM Studio',
        local: true,
        cost: 'free',
        models: models
      });
    }
  } catch {
    // Not available
  }

  // Check Anthropic (cloud - if key present)
  if (process.env.ANTHROPIC_API_KEY) {
    available.push({
      type: PROVIDER_TYPES.ANTHROPIC,
      name: 'Anthropic',
      local: false,
      cost: 'paid',
      models: [
        { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
        { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku (Best for executor)', recommended: true },
        { id: 'claude-sonnet-4-6-20250819', name: 'Claude Sonnet 4.6' },
        { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
        { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' }
      ]
    });
  }

  // Check OpenAI (cloud - if key present)
  if (process.env.OPENAI_API_KEY) {
    available.push({
      type: PROVIDER_TYPES.OPENAI,
      name: 'OpenAI',
      local: false,
      cost: 'paid',
      models: [
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Best for executor)', recommended: true },
        { id: 'gpt-4o', name: 'GPT-4o' }
      ]
    });
  }

  // Check Google (cloud - if key present)
  if (process.env.GOOGLE_API_KEY) {
    available.push({
      type: PROVIDER_TYPES.GOOGLE,
      name: 'Google (Gemini)',
      local: false,
      cost: 'paid',
      models: [
        { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash (Best for executor)', recommended: true },
        { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' }
      ]
    });
  }

  return available;
}

/**
 * Load provider from config
 */
function loadProviderFromConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return null;
  }

  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    const hybridConfig = config.hybrid || {};

    if (!hybridConfig.enabled || !hybridConfig.provider) {
      return null;
    }

    return createProvider({
      type: hybridConfig.provider,
      endpoint: hybridConfig.providerEndpoint,
      model: hybridConfig.model,
      apiKey: hybridConfig.apiKey,
      ...hybridConfig.settings
    });
  } catch {
    return null;
  }
}

// ============================================================
// Token Budgeting with Auto-Detection
// ============================================================

/**
 * Auto-detect model context limit from provider API
 * No manual config needed - queries Ollama/LM Studio directly
 *
 * @param {string} providerType - 'ollama' or 'lm-studio'
 * @param {string} endpoint - Provider endpoint URL
 * @param {string} modelName - Model name to check
 * @returns {Promise<number>} Context window size in tokens
 */
async function getModelContextLimit(providerType, endpoint, modelName) {
  try {
    if (providerType === PROVIDER_TYPES.OLLAMA || providerType === 'ollama') {
      // Ollama /api/show returns model metadata including num_ctx
      const provider = new OllamaProvider({ endpoint });
      const info = await provider.getModelInfo(modelName);

      if (info?.capabilities?.contextWindow) {
        return info.capabilities.contextWindow;
      }
      return 4096; // Ollama default
    }

    if (providerType === PROVIDER_TYPES.LM_STUDIO || providerType === 'lm-studio' || providerType === 'lmstudio') {
      // LM Studio /v1/models returns context_length in model metadata
      const url = new URL('/v1/models', endpoint);

      return new Promise((resolve) => {
        const req = http.get(url.toString(), { timeout: 5000 }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              // LM Studio returns context_length in model data
              const model = parsed.data?.find(m => m.id === modelName) || parsed.data?.[0];
              if (model?.context_length) {
                resolve(model.context_length);
              } else {
                // Default for LM Studio
                resolve(8192);
              }
            } catch {
              resolve(8192);
            }
          });
        });

        req.on('error', () => resolve(8192));
        req.on('timeout', () => {
          req.destroy();
          resolve(8192);
        });
      });
    }

    // Cloud providers - use known limits from capabilities
    const caps = detectModelCapabilities(modelName);
    return caps?.contextWindow || 8192;

  } catch (err) {
    if (process.env.DEBUG) {
      console.warn(`Could not detect context limit: ${err.message}`);
    }
    return 8192; // Safe fallback
  }
}

/**
 * Estimate token count from text
 * Uses conservative 4 chars per token estimate for English/code
 *
 * @param {string} text - Text to estimate
 * @returns {number} Estimated token count
 */
function estimateTokens(text) {
  if (!text) return 0;
  // 4 chars per token is conservative estimate
  // Actual tokenizers vary but this is a reasonable approximation
  return Math.ceil(text.length / 4);
}

/**
 * Create a token budgeting helper for a model
 *
 * @param {number} contextLimit - Total context window
 * @param {number} reserveForResponse - Tokens to reserve for response (default: 20%)
 * @returns {Object} Budget helper functions
 */
function createTokenBudget(contextLimit, reserveForResponse = null) {
  // Reserve 20% for response by default, minimum 1000 tokens
  const responseReserve = reserveForResponse || Math.max(1000, Math.floor(contextLimit * 0.2));
  const promptBudget = contextLimit - responseReserve;

  return {
    contextLimit,
    responseReserve,
    promptBudget,

    /**
     * Check if prompt fits within budget
     */
    fitsWithin(text) {
      return estimateTokens(text) <= promptBudget;
    },

    /**
     * Get remaining budget after some text
     */
    remaining(text) {
      return promptBudget - estimateTokens(text);
    },

    /**
     * Truncate text to fit budget with optional ellipsis
     */
    truncateToFit(text, targetTokens = promptBudget) {
      const currentTokens = estimateTokens(text);
      if (currentTokens <= targetTokens) return text;

      // Truncate to approximate target (4 chars per token)
      const targetChars = targetTokens * 4;
      return text.substring(0, targetChars - 50) + '\n\n... (truncated to fit context window)';
    },

    /**
     * Get usage summary
     */
    summarize(text) {
      const used = estimateTokens(text);
      const percent = Math.round((used / promptBudget) * 100);
      return {
        used,
        budget: promptBudget,
        remaining: promptBudget - used,
        percent,
        overBudget: used > promptBudget,
        contextLimit
      };
    }
  };
}

/**
 * Initialize token budgeting for a hybrid session
 * Auto-detects context limit from provider
 *
 * @param {Object} config - Hybrid config from config.json
 * @returns {Promise<Object>} Token budget helper
 */
async function initializeTokenBudget(config) {
  const {
    provider,
    providerEndpoint,
    model,
    maxContextTokens // Optional manual override
  } = config;

  // Use manual override if provided
  if (maxContextTokens && maxContextTokens > 0) {
    console.log(`📊 Using configured context window: ${maxContextTokens.toLocaleString()} tokens`);
    return createTokenBudget(maxContextTokens);
  }

  // Auto-detect from provider
  const contextLimit = await getModelContextLimit(provider, providerEndpoint, model);
  console.log(`📊 Detected context window: ${contextLimit.toLocaleString()} tokens`);

  return createTokenBudget(contextLimit);
}

// Module exports
module.exports = {
  PROVIDER_TYPES,
  DEFAULT_CONFIGS,
  MODEL_CAPABILITIES,
  BaseProvider,
  OllamaProvider,
  LMStudioProvider,
  AnthropicProvider,
  OpenAIProvider,
  GoogleProvider,
  createProvider,
  createExecutorFromConfig,
  getExecutorConfig,
  listProviders,
  detectProviders,
  loadProviderFromConfig,
  detectModelCapabilities,
  getRecommendedModel,

  // Token budgeting
  getModelContextLimit,
  estimateTokens,
  createTokenBudget,
  initializeTokenBudget
};

/**
 * Format capability level with color
 */
function formatCapability(level) {
  switch (level) {
    case 'excellent': return `${c.green}excellent${c.reset}`;
    case 'high': return `${c.green}high${c.reset}`;
    case 'medium': return `${c.yellow}medium${c.reset}`;
    case 'unknown': return `${c.dim}unknown${c.reset}`;
    default: return level;
  }
}

// CLI Handler
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  async function main() {
    switch (command) {
      case 'list': {
        const providers = listProviders();
        console.log(`\n${c.cyan}${c.bold}Available Providers${c.reset}\n`);

        for (const p of providers) {
          const icon = p.local ? '🏠' : '☁️';
          const keyStatus = p.requiresKey
            ? (process.env[p.envVar] ? `${c.green}✓ API key set${c.reset}` : `${c.yellow}⚠ Requires ${p.envVar}${c.reset}`)
            : `${c.green}✓ No key required${c.reset}`;

          console.log(`${icon} ${c.bold}${p.name}${c.reset} (${p.type})`);
          console.log(`   ${keyStatus}`);
          console.log(`   Endpoint: ${p.defaultEndpoint}`);
          console.log('');
        }
        break;
      }

      case 'detect': {
        console.log(`\n${c.cyan}Detecting available providers...${c.reset}\n`);
        const available = await detectProviders();

        if (available.length === 0) {
          console.log(`${c.yellow}No providers detected.${c.reset}`);
          console.log(`${c.dim}Make sure Ollama/LM Studio is running, or set API keys.${c.reset}`);
        } else {
          for (const p of available) {
            console.log(`${c.green}✅ ${p.name}${c.reset}`);
            if (p.models && p.models.length > 0) {
              console.log(`   Models: ${p.models.map(m => m.id).join(', ')}`);
            }
          }
        }
        break;
      }

      case 'test': {
        const providerType = args[1];
        if (!providerType) {
          console.error(`${c.red}Error: Provider type required${c.reset}`);
          console.log(`${c.dim}Usage: flow providers test <ollama|lm-studio|anthropic|openai>${c.reset}`);
          process.exit(1);
        }

        console.log(`${c.cyan}Testing ${providerType}...${c.reset}`);

        try {
          const provider = createProvider({ type: providerType });
          const result = await provider.test();

          if (result.success) {
            console.log(`${c.green}✅ ${providerType} is working${c.reset}`);
            console.log(`   Response: ${result.response.content.slice(0, 50)}...`);
          } else {
            console.log(`${c.red}❌ ${providerType} test failed${c.reset}`);
            console.log(`   Error: ${result.error}`);
          }
        } catch (err) {
          console.log(`${c.red}❌ ${providerType} test failed${c.reset}`);
          console.log(`   Error: ${err.message}`);
        }
        break;
      }

      case 'capabilities': {
        const modelName = args[1];

        if (modelName) {
          // Show capabilities for specific model
          const caps = detectModelCapabilities(modelName);
          console.log(`\n${c.cyan}${c.bold}Model Capabilities: ${modelName}${c.reset}\n`);
          console.log(`  Code Quality:        ${formatCapability(caps.codeQuality)}`);
          console.log(`  Instruction Following: ${formatCapability(caps.instructionFollowing)}`);
          console.log(`  Context Window:      ${caps.contextWindow.toLocaleString()} tokens`);
          console.log(`  Detection Source:    ${caps.source}`);
          if (caps.matchedPattern) {
            console.log(`  Matched Pattern:     ${caps.matchedPattern}`);
          }
        } else {
          // List all known capabilities
          console.log(`\n${c.cyan}${c.bold}Known Model Capabilities${c.reset}\n`);
          console.log(`${c.dim}Pattern            Code Quality   Instructions   Context${c.reset}`);
          console.log(`${c.dim}${'─'.repeat(60)}${c.reset}`);

          for (const [pattern, caps] of Object.entries(MODEL_CAPABILITIES)) {
            const cq = caps.codeQuality.padEnd(12);
            const inf = caps.instructionFollowing.padEnd(12);
            const ctx = caps.contextWindow.toLocaleString().padStart(10);
            console.log(`  ${pattern.padEnd(16)} ${cq} ${inf} ${ctx}`);
          }

          console.log('');
          console.log(`${c.dim}Use "flow providers capabilities <model-name>" to check a specific model${c.reset}`);
        }
        break;
      }

      case 'recommend': {
        console.log(`\n${c.cyan}Finding best model for code tasks...${c.reset}\n`);

        const available = await detectProviders();

        if (available.length === 0) {
          console.log(`${c.yellow}No providers detected.${c.reset}`);
          process.exit(1);
        }

        for (const provider of available) {
          if (provider.models && provider.models.length > 0) {
            const recommended = getRecommendedModel(provider.models, 'code');
            if (recommended) {
              console.log(`${c.green}${provider.name}:${c.reset} ${recommended.id || recommended.name}`);
              const caps = recommended.capabilities;
              console.log(`   Code: ${caps.codeQuality} | Instructions: ${caps.instructionFollowing}`);
              console.log(`   Context: ${caps.contextWindow.toLocaleString()} tokens | Score: ${recommended.score}`);
              console.log('');
            }
          }
        }
        break;
      }

      default: {
        console.log(`
${c.cyan}Wogi Flow - Model Providers${c.reset}

${c.bold}Usage:${c.reset}
  flow providers list                  List all available providers
  flow providers detect                Detect running local providers
  flow providers test <type>           Test a provider connection
  flow providers capabilities          List known model capabilities
  flow providers capabilities <model>  Show capabilities for a model
  flow providers recommend             Find best model for code tasks

${c.bold}Supported Providers:${c.reset}
  ollama        Local Ollama instance
  lm-studio     Local LM Studio instance
  anthropic     Anthropic API (requires ANTHROPIC_API_KEY)
  openai        OpenAI API (requires OPENAI_API_KEY)

${c.bold}Model Capabilities:${c.reset}
  The system detects model capabilities using:
  1. API queries (when available, e.g., Ollama /api/show)
  2. Heuristics based on model name patterns

  Capabilities tracked:
  - Code Quality: How well the model generates code
  - Instruction Following: How well it follows prompts
  - Context Window: Maximum tokens supported

${c.bold}Configuration:${c.reset}
  Set in .workflow/config.json under "hybrid":
  {
    "hybrid": {
      "enabled": true,
      "provider": "anthropic",
      "model": "claude-sonnet-4-20250514",
      "apiKey": "sk-..." // or use environment variable
    }
  }
        `);
      }
    }
  }

  main().catch(err => {
    console.error(`${c.red}Error: ${err.message}${c.reset}`);
    process.exit(1);
  });
}
