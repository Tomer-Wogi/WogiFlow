#!/usr/bin/env node

/**
 * Wogi Flow - Figma Analyzer MCP Server
 *
 * Standalone MCP server that provides component analysis tools.
 * Can be used with any MCP client (Claude Desktop, Cursor, VS Code, etc.)
 *
 * Supports both:
 * - stdio mode (standard MCP protocol for Claude Desktop)
 * - HTTP mode (for testing and web clients)
 *
 * Tools provided:
 * - wogi_figma_analyze: Analyze a Figma screen and match components
 * - wogi_figma_registry: Get the codebase component registry
 * - wogi_figma_match: Match a single component against registry
 * - wogi_figma_generate: Generate code from confirmed decisions
 *
 * Usage:
 *   node flow-figma-mcp-server.js          # stdio mode (for MCP clients)
 *   node flow-figma-mcp-server.js --http   # HTTP mode (port 3847)
 *   node flow-figma-mcp-server.js --http 8080  # HTTP on custom port
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { ComponentScanner } = require('./flow-figma-index');
const { FigmaExtractor } = require('./flow-figma-extract');
const { SimilarityMatcher, MATCH_CONFIG } = require('./flow-figma-match');
const { CodeGenerator } = require('./flow-figma-generate');
const { getProjectRoot } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const REGISTRY_PATH = path.join(WORKFLOW_DIR, 'state', 'component-registry.json');

// ============================================================
// Tool Definitions
// ============================================================

const TOOLS = [
  {
    name: 'wogi_figma_analyze',
    description: 'Analyze a Figma screen/component and match against your codebase. Returns components with match suggestions (use existing, add variant, or create new).',
    inputSchema: {
      type: 'object',
      properties: {
        figma_data: {
          type: 'object',
          description: 'The Figma MCP response data (from get_code, get_metadata, or node data)'
        },
        threshold: {
          type: 'number',
          description: 'Minimum match score (0-100) to consider as a match. Default: 60',
          default: 60
        }
      },
      required: ['figma_data']
    }
  },
  {
    name: 'wogi_figma_registry',
    description: 'Get or scan the component registry from the codebase. Shows all existing components that can be reused.',
    inputSchema: {
      type: 'object',
      properties: {
        scan: {
          type: 'boolean',
          description: 'If true, rescan the codebase before returning registry. Default: false',
          default: false
        },
        filter: {
          type: 'string',
          description: 'Filter components by type: "atom", "molecule", or "organism"'
        }
      }
    }
  },
  {
    name: 'wogi_figma_match',
    description: 'Match a single extracted Figma component against the registry.',
    inputSchema: {
      type: 'object',
      properties: {
        component: {
          type: 'object',
          description: 'The extracted Figma component (from wogi_figma_analyze)'
        }
      },
      required: ['component']
    }
  },
  {
    name: 'wogi_figma_generate',
    description: 'Generate code prompts and imports from confirmed component decisions.',
    inputSchema: {
      type: 'object',
      properties: {
        decisions: {
          type: 'array',
          description: 'Array of component decisions with action (use, add-variant, create-new) and details'
        }
      },
      required: ['decisions']
    }
  }
];

// ============================================================
// MCP Handler
// ============================================================

class FigmaAnalyzerMCP {
  constructor() {
    this.tools = TOOLS;
  }

  async handleToolCall(toolName, args) {
    switch (toolName) {
      case 'wogi_figma_analyze':
        return this.analyzeScreen(args.figma_data, args.threshold || 60);

      case 'wogi_figma_registry':
        return this.getRegistry(args.scan, args.filter);

      case 'wogi_figma_match':
        return this.matchComponent(args.component);

      case 'wogi_figma_generate':
        return this.generateCode(args.decisions);

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  async analyzeScreen(figmaData, threshold) {
    // Extract components from Figma data
    const extractor = new FigmaExtractor();
    const extracted = extractor.parse(figmaData);

    // Load registry
    const registry = this.loadRegistry();
    if (!registry) {
      return {
        error: 'Component registry not found. Call wogi_figma_registry with scan=true first.',
        suggestion: 'Run: wogi_figma_registry({ scan: true })'
      };
    }

    // Match components
    const matcher = new SimilarityMatcher(registry);
    const results = matcher.matchAll(extracted.components);

    // Format for readable output
    return {
      summary: results.summary,
      thresholds: MATCH_CONFIG.thresholds,
      components: results.matches.map(m => ({
        name: m.figmaComponent.name,
        type: m.figmaComponent.type,
        figmaType: m.figmaComponent.figmaType,
        bestMatch: m.bestMatch ? {
          name: m.bestMatch.registryComponent.name,
          path: m.bestMatch.registryComponent.path,
          score: m.bestMatch.score,
          breakdown: m.bestMatch.breakdown,
          differences: m.bestMatch.differences?.slice(0, 3) // Limit differences
        } : null,
        recommendation: m.suggestion
      })),
      tokens: extracted.tokens
    };
  }

  async getRegistry(scan = false, filter = null) {
    if (scan) {
      const scanner = new ComponentScanner();
      await scanner.scan();
    }

    const registry = this.loadRegistry();
    if (!registry) {
      return {
        error: 'Registry not found. Set scan=true to scan the codebase.',
        suggestion: 'Run: wogi_figma_registry({ scan: true })'
      };
    }

    let components = registry.components;

    // Apply filter if specified
    if (filter && ['atom', 'molecule', 'organism'].includes(filter)) {
      components = components.filter(c => c.type === filter);
    }

    return {
      framework: registry.framework,
      scannedAt: registry.scannedAt,
      componentCount: components.length,
      components: components.map(c => ({
        name: c.name,
        path: c.path,
        type: c.type,
        variants: c.variants,
        props: c.props?.map(p => ({ name: p.name, type: p.type }))
      })),
      tokenCount: {
        colors: Object.keys(registry.tokens?.colors || {}).length,
        spacing: Object.keys(registry.tokens?.spacing || {}).length,
        typography: Object.keys(registry.tokens?.typography || {}).length
      }
    };
  }

  async matchComponent(component) {
    const registry = this.loadRegistry();
    if (!registry) {
      return { error: 'Registry not found' };
    }

    const matcher = new SimilarityMatcher(registry);
    const result = matcher.matchComponent(component);

    return {
      figmaComponent: result.figmaComponent,
      matches: result.matches.slice(0, 3).map(m => ({
        name: m.registryComponent.name,
        path: m.registryComponent.path,
        score: m.score,
        suggestion: m.suggestion
      })),
      recommendation: result.suggestion
    };
  }

  async generateCode(decisions) {
    const generator = new CodeGenerator({ decisions });
    const output = generator.generate();

    return {
      framework: output.framework,
      imports: output.imports.map(i => ({
        component: i.componentName,
        import: i.importStatement,
        usage: i.usage
      })),
      newComponents: output.newComponents.map(c => ({
        name: c.componentName,
        path: c.suggestedPath,
        prompt: c.prompt
      })),
      variants: output.variants.map(v => ({
        component: v.componentName,
        variant: v.variantName,
        prompt: v.prompt
      }))
    };
  }

  loadRegistry() {
    if (fs.existsSync(REGISTRY_PATH)) {
      try {
        return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ============================================================
// stdio Mode (Standard MCP Protocol)
// ============================================================

class StdioServer {
  constructor(handler) {
    this.handler = handler;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });
  }

  start() {
    this.rl.on('line', async (line) => {
      if (!line.trim()) return;

      try {
        const request = JSON.parse(line);
        const response = await this.handleRequest(request);
        console.log(JSON.stringify(response));
      } catch (err) {
        console.log(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32700, message: 'Parse error', data: err.message },
          id: null
        }));
      }
    });

    // Send capabilities on start
    console.error('Wogi Flow Figma Analyzer MCP Server (stdio mode)');
  }

  async handleRequest(request) {
    const { method, params, id } = request;

    try {
      let result;

      switch (method) {
        case 'initialize':
          result = {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: 'wogi-figma-analyzer',
              version: '1.0.0'
            }
          };
          break;

        case 'tools/list':
          result = { tools: this.handler.tools };
          break;

        case 'tools/call':
          const toolResult = await this.handler.handleToolCall(
            params.name,
            params.arguments || {}
          );
          result = {
            content: [{
              type: 'text',
              text: JSON.stringify(toolResult, null, 2)
            }]
          };
          break;

        case 'ping':
          result = {};
          break;

        default:
          throw new Error(`Unknown method: ${method}`);
      }

      return { jsonrpc: '2.0', result, id };

    } catch (err) {
      return {
        jsonrpc: '2.0',
        error: { code: -32603, message: err.message },
        id
      };
    }
  }
}

// ============================================================
// HTTP Mode (for testing)
// ============================================================

class HttpServer {
  constructor(handler, port = 3847) {
    this.handler = handler;
    this.port = port;
  }

  start() {
    const server = http.createServer(async (req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      // Health check
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', tools: this.handler.tools.length }));
        return;
      }

      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end('Method not allowed');
        return;
      }

      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const request = JSON.parse(body);
          let response;

          if (request.method === 'tools/list') {
            response = { tools: this.handler.tools };
          } else if (request.method === 'tools/call') {
            const result = await this.handler.handleToolCall(
              request.params.name,
              request.params.arguments || {}
            );
            response = {
              content: [{
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }]
            };
          } else {
            response = { error: 'Unknown method' };
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));

        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    });

    server.listen(this.port, () => {
      console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║           Wogi Flow - Figma Analyzer MCP Server (HTTP)            ║
╚═══════════════════════════════════════════════════════════════════╝

Server running at http://localhost:${this.port}

Endpoints:
  POST /           MCP protocol
  GET  /health     Health check

Available tools:
  • wogi_figma_analyze   - Analyze Figma screen
  • wogi_figma_registry  - Get component registry
  • wogi_figma_match     - Match single component
  • wogi_figma_generate  - Generate code from decisions

Test with:
  curl -X POST http://localhost:${this.port} \\
    -H "Content-Type: application/json" \\
    -d '{"method":"tools/list"}'
`);
    });
  }
}

// ============================================================
// CLI
// ============================================================

function main() {
  const args = process.argv.slice(2);
  const handler = new FigmaAnalyzerMCP();

  if (args.includes('--http')) {
    const portIndex = args.indexOf('--http') + 1;
    const port = parseInt(args[portIndex]) || 3847;
    const server = new HttpServer(handler, port);
    server.start();
  } else if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Wogi Flow - Figma Analyzer MCP Server

Usage:
  node flow-figma-mcp-server.js          # stdio mode (for MCP clients)
  node flow-figma-mcp-server.js --http   # HTTP mode (port 3847)
  node flow-figma-mcp-server.js --http 8080  # HTTP on custom port

Add to Claude Desktop config (~/Library/Application Support/Claude/claude_desktop_config.json):
{
  "mcpServers": {
    "wogi-figma": {
      "command": "node",
      "args": ["${path.resolve(__dirname, 'flow-figma-mcp-server.js')}"]
    }
  }
}

Add to Cursor MCP config:
{
  "mcpServers": {
    "wogi-figma": {
      "command": "node",
      "args": ["${path.resolve(__dirname, 'flow-figma-mcp-server.js')}"]
    }
  }
}
    `);
  } else {
    // Default: stdio mode
    const server = new StdioServer(handler);
    server.start();
  }
}

module.exports = { FigmaAnalyzerMCP, StdioServer, HttpServer };

if (require.main === module) {
  main();
}
