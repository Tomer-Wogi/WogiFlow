#!/usr/bin/env node

/**
 * Wogi Flow - Local LLM Provider Detection
 *
 * Detects Ollama and LM Studio, lists available models.
 * Usage:
 *   flow-hybrid-detect providers     # List available providers
 *   flow-hybrid-detect models        # List models for all providers
 *   flow-hybrid-detect test <url>    # Test a specific endpoint
 */

const http = require('http');
const https = require('https');

const PROVIDERS = {
  ollama: {
    name: 'Ollama',
    defaultEndpoint: 'http://localhost:11434',
    checkPath: '/api/tags',
    modelsPath: '/api/tags',
    parseModels: (data) => data.models?.map(m => ({
      id: m.name,
      name: m.name,
      size: m.size,
      modified: m.modified_at
    })) || []
  },
  lmstudio: {
    name: 'LM Studio',
    defaultEndpoint: 'http://localhost:1234',
    checkPath: '/v1/models',
    modelsPath: '/v1/models',
    parseModels: (data) => data.data?.map(m => ({
      id: m.id,
      name: m.id,
      owned_by: m.owned_by
    })) || []
  }
};

async function fetchJSON(url, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

async function checkProvider(providerId) {
  const provider = PROVIDERS[providerId];
  if (!provider) return null;

  try {
    const url = `${provider.defaultEndpoint}${provider.checkPath}`;
    const data = await fetchJSON(url);
    const models = provider.parseModels(data);

    return {
      id: providerId,
      name: provider.name,
      endpoint: provider.defaultEndpoint,
      available: true,
      models
    };
  } catch (err) {
    return {
      id: providerId,
      name: provider.name,
      endpoint: provider.defaultEndpoint,
      available: false,
      error: err.message
    };
  }
}

async function detectAll() {
  const results = await Promise.all(
    Object.keys(PROVIDERS).map(checkProvider)
  );
  return results;
}

async function testConnection(endpoint, model) {
  const isOllama = endpoint.includes('11434');

  try {
    if (isOllama) {
      const response = await fetchJSON(`${endpoint}/api/tags`, 5000);
      return { success: true, message: 'Connection successful', models: response.models?.length || 0 };
    } else {
      const response = await fetchJSON(`${endpoint}/v1/models`);
      return { success: true, message: 'Connection successful', models: response.data?.length || 0 };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// CLI
async function main() {
  const [,, command, ...args] = process.argv;

  switch (command) {
    case 'providers': {
      const providers = await detectAll();
      console.log(JSON.stringify(providers, null, 2));
      break;
    }

    case 'models': {
      const providers = await detectAll();
      const available = providers.filter(p => p.available);

      if (available.length === 0) {
        console.log(JSON.stringify({ error: 'No providers available' }));
        process.exit(1);
      }

      const allModels = available.flatMap(p =>
        p.models.map(m => ({ ...m, provider: p.id, endpoint: p.endpoint }))
      );
      console.log(JSON.stringify(allModels, null, 2));
      break;
    }

    case 'test': {
      const [endpoint, model] = args;
      if (!endpoint) {
        console.error('Usage: flow-hybrid-detect test <endpoint> [model]');
        process.exit(1);
      }
      const result = await testConnection(endpoint, model);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    default:
      console.log(`
Wogi Flow - Local LLM Detection

Commands:
  providers    List available providers (Ollama, LM Studio)
  models       List all models from available providers
  test <url>   Test connection to endpoint
      `);
  }
}

main().catch(e => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
