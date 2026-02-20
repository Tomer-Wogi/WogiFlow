#!/usr/bin/env node

/**
 * Wogi Flow - Model Caller Abstraction
 *
 * Unified interface for calling different AI models.
 * Supports multiple providers: API keys, MCP, and manual mode.
 *
 * Usage:
 *   const { callModel } = require('./flow-model-caller');
 *   const response = await callModel('openai:gpt-4o', prompt);
 */

const path = require('path');
const {
  PATHS,
  getConfig,
  getConfigValue,
  color,
  warn,
  error
} = require('./flow-utils');

// ============================================================
// Provider Configuration
// ============================================================

const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    apiBase: 'https://api.openai.com/v1',
    envKey: 'OPENAI_API_KEY',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    defaultModel: 'gpt-4o-mini'
  },
  anthropic: {
    name: 'Anthropic',
    apiBase: 'https://api.anthropic.com/v1',
    envKey: 'ANTHROPIC_API_KEY',
    models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-sonnet-4-5-20250929', 'claude-3-5-haiku-latest', 'claude-3-opus-latest'],
    defaultModel: 'claude-3-5-haiku-latest'
  },
  google: {
    name: 'Google',
    apiBase: 'https://generativelanguage.googleapis.com/v1',
    envKey: 'GOOGLE_API_KEY',
    models: ['gemini-2.0-flash-exp', 'gemini-1.5-flash', 'gemini-1.5-pro'],
    defaultModel: 'gemini-2.0-flash-exp'
  }
};

// ============================================================
// Model Parsing
// ============================================================

/**
 * Parse model string into provider and model name
 * @param {string} modelString - Model string like "openai:gpt-4o" or just "gpt-4o"
 * @returns {{ provider: string, model: string }}
 */
function parseModelString(modelString) {
  if (modelString.includes(':')) {
    const [provider, model] = modelString.split(':');
    return { provider, model };
  }

  // Try to detect provider from model name
  for (const [providerName, providerConfig] of Object.entries(PROVIDERS)) {
    if (providerConfig.models.some(m => modelString.includes(m) || m.includes(modelString))) {
      return { provider: providerName, model: modelString };
    }
  }

  // Default to OpenAI
  return { provider: 'openai', model: modelString };
}

// ============================================================
// API Callers
// ============================================================

/**
 * Call OpenAI API
 */
async function callOpenAI(model, prompt, apiKey, options = {}) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: options.temperature || 0.7,
      max_tokens: options.maxTokens || 4096
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || '';
}

/**
 * Call Anthropic API
 */
async function callAnthropic(model, prompt, apiKey, options = {}) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: options.maxTokens || 4096,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  return data.content[0]?.text || '';
}

/**
 * Call Google Gemini API
 */
async function callGoogle(model, prompt, apiKey, options = {}) {
  const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: options.temperature || 0.7,
        maxOutputTokens: options.maxTokens || 4096
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Google API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ============================================================
// Main Interface
// ============================================================

/**
 * Call a model with the given prompt
 *
 * @param {string} modelString - Model identifier like "openai:gpt-4o"
 * @param {string} prompt - The prompt to send
 * @param {Object} options - Additional options
 * @param {string} options.provider - Override provider detection
 * @param {number} options.temperature - Temperature (0-1)
 * @param {number} options.maxTokens - Max output tokens
 * @returns {Promise<{ success: boolean, response: string, model: string, provider: string, error?: string }>}
 */
async function callModel(modelString, prompt, options = {}) {
  const config = getConfig();
  const peerReviewConfig = config.peerReview || {};

  const { provider, model } = parseModelString(modelString);
  const providerConfig = PROVIDERS[provider];

  if (!providerConfig) {
    return {
      success: false,
      response: '',
      model,
      provider,
      error: `Unknown provider: ${provider}`
    };
  }

  // Get API key from config or environment
  let apiKey = peerReviewConfig.apiKeys?.[provider];

  // Resolve environment variable references
  if (apiKey && apiKey.startsWith('${') && apiKey.endsWith('}')) {
    const envVar = apiKey.slice(2, -1);
    apiKey = process.env[envVar];
  }

  // Fall back to environment variable
  if (!apiKey) {
    apiKey = process.env[providerConfig.envKey];
  }

  if (!apiKey) {
    return {
      success: false,
      response: '',
      model,
      provider,
      error: `No API key found for ${provider}. Set ${providerConfig.envKey} or configure in peerReview.apiKeys`
    };
  }

  try {
    let response;

    switch (provider) {
      case 'openai':
        response = await callOpenAI(model, prompt, apiKey, options);
        break;
      case 'anthropic':
        response = await callAnthropic(model, prompt, apiKey, options);
        break;
      case 'google':
        response = await callGoogle(model, prompt, apiKey, options);
        break;
      default:
        return {
          success: false,
          response: '',
          model,
          provider,
          error: `Unsupported provider: ${provider}`
        };
    }

    return {
      success: true,
      response,
      model,
      provider
    };
  } catch (err) {
    return {
      success: false,
      response: '',
      model,
      provider,
      error: err.message
    };
  }
}

/**
 * Get list of configured models for peer review
 * Checks unified config first, falls back to legacy peerReview config
 */
function getConfiguredModels() {
  const config = getConfig();

  // Check unified models config first (new format)
  if (config.models?.providers) {
    const models = [];
    for (const [provider, providerConfig] of Object.entries(config.models.providers)) {
      if (providerConfig.enabled !== false && providerConfig.models?.length > 0) {
        // Check if API key is available (or local provider)
        const apiKeyEnv = providerConfig.apiKeyEnv;
        const hasApiKey = !apiKeyEnv || process.env[apiKeyEnv];

        if (hasApiKey || provider === 'local') {
          for (const model of providerConfig.models) {
            models.push(`${provider}:${model}`);
          }
        }
      }
    }

    if (models.length > 0) {
      return models;
    }
  }

  // Fall back to legacy peerReview config
  const peerReviewConfig = config.peerReview || {};

  if (peerReviewConfig.models && Array.isArray(peerReviewConfig.models)) {
    return peerReviewConfig.models;
  }

  return ['openai:gpt-4o-mini'];
}

/**
 * Check if model calling is available
 * Checks unified config first, falls back to legacy peerReview config
 */
function isModelCallingAvailable() {
  const config = getConfig();
  const peerReviewConfig = config.peerReview || {};

  // Check provider mode
  if (peerReviewConfig.provider === 'manual') {
    return { available: false, reason: 'Manual mode configured' };
  }

  // Check unified config first
  if (config.models?.providers) {
    for (const [provider, providerConfig] of Object.entries(config.models.providers)) {
      if (providerConfig.enabled !== false) {
        // Local providers don't need API keys
        if (provider === 'local') {
          return { available: true };
        }

        // Cloud providers need API keys
        const apiKeyEnv = providerConfig.apiKeyEnv;
        if (apiKeyEnv && process.env[apiKeyEnv]) {
          return { available: true };
        }
      }
    }
  }

  // Fall back to legacy peerReview config
  const models = getConfiguredModels();

  for (const modelStr of models) {
    const { provider } = parseModelString(modelStr);
    const providerConfig = PROVIDERS[provider];

    if (providerConfig) {
      const apiKey = peerReviewConfig.apiKeys?.[provider] || process.env[providerConfig.envKey];
      if (apiKey) {
        return { available: true };
      }
    }
  }

  return {
    available: false,
    reason: 'No models configured. Run /wogi-models-setup to configure external models.'
  };
}

/**
 * Format manual mode prompt for copy-paste
 */
function formatManualPrompt(prompt, context) {
  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Copy this prompt to another AI model:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${prompt}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📥 Then paste the response below when asked.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
}

module.exports = {
  callModel,
  parseModelString,
  getConfiguredModels,
  isModelCallingAvailable,
  formatManualPrompt,
  PROVIDERS
};
