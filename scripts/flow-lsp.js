#!/usr/bin/env node
/**
 * flow-lsp.js - LSP Client for Wogi Flow
 *
 * Provides Language Server Protocol integration for:
 * - Type information at cursor position
 * - Diagnostics (errors/warnings)
 * - Go to definition
 * - Completions
 *
 * Used by hybrid mode to get accurate type info instead of guessing.
 */

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { getConfig, PROJECT_ROOT, colors, success, warn, error } = require('./flow-utils');

/**
 * Convert a file path to a proper file:// URI
 * Handles Windows paths correctly (file:///C:/path vs file:///home/user)
 */
function pathToFileUri(filePath) {
  // Normalize to forward slashes
  let normalized = filePath.replace(/\\/g, '/');

  // On Windows, paths like C:/foo need an extra slash: file:///C:/foo
  // On Unix, paths like /home/foo just need file:///home/foo
  if (/^[a-zA-Z]:/.test(normalized)) {
    // Windows path with drive letter
    return `file:///${normalized}`;
  }

  // Unix path - already starts with /
  return `file://${normalized}`;
}

// ─────────────────────────────────────────────────────────────
// LSP Client Class
// ─────────────────────────────────────────────────────────────

class LSPClient {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.process = null;
    this.requestId = 0;
    this.pending = new Map();
    this.initialized = false;
    this.buffer = '';
    this.diagnosticsCache = new Map();
  }

  /**
   * Start the LSP server
   */
  async start() {
    const config = getConfig();
    const serverCommand = config.lsp?.server || 'typescript-language-server';

    // Find the language server
    const tsserver = this._findServer(serverCommand);
    if (!tsserver) {
      throw new Error(
        `${serverCommand} not found. Install with:\n` +
        '  npm i -g typescript-language-server typescript\n' +
        'Or for local install:\n' +
        '  npm i -D typescript-language-server typescript'
      );
    }

    // Spawn the server
    this.process = spawn(tsserver, ['--stdio'], {
      cwd: this.projectRoot,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Set up I/O handling
    this._setupIO();

    // Initialize the connection
    await this._initialize();

    return this;
  }

  /**
   * Find the language server executable
   */
  _findServer(serverCommand) {
    // Check common locations
    const locations = [
      serverCommand,
      path.join(this.projectRoot, 'node_modules/.bin', serverCommand),
      path.join(this.projectRoot, 'node_modules/.bin/typescript-language-server'),
      '/usr/local/bin/typescript-language-server'
    ];

    for (const loc of locations) {
      try {
        const result = spawnSync('which', [loc], { encoding: 'utf-8' });
        if (result.status === 0) {
          return result.stdout.trim() || loc;
        }
      } catch (err) {
        // Try next location
      }

      // Also try direct execution check
      try {
        const result = spawnSync(loc, ['--version'], { encoding: 'utf-8', timeout: 5000 });
        if (result.status === 0) {
          return loc;
        }
      } catch (err) {
        // Try next location
      }
    }

    return null;
  }

  /**
   * Set up stdin/stdout handling for LSP protocol
   */
  _setupIO() {
    this.process.stdout.on('data', (data) => {
      this.buffer += data.toString();
      this._parseMessages();
    });

    this.process.stderr.on('data', (data) => {
      // Log stderr but don't crash
      if (process.env.DEBUG_LSP) {
        console.error('[LSP stderr]', data.toString());
      }
    });

    this.process.on('error', (err) => {
      error(`LSP process error: ${err.message}`);
      this.initialized = false;
    });

    this.process.on('exit', (code) => {
      if (code !== 0 && process.env.DEBUG_LSP) {
        console.error(`[LSP] Process exited with code ${code}`);
      }
      this.initialized = false;
    });
  }

  /**
   * Parse LSP messages from buffer
   */
  _parseMessages() {
    while (true) {
      // Look for Content-Length header
      const headerMatch = this.buffer.match(/Content-Length: (\d+)\r\n\r\n/);
      if (!headerMatch) break;

      const contentLength = parseInt(headerMatch[1], 10);
      const headerEnd = headerMatch.index + headerMatch[0].length;

      // Check if we have the full message
      if (this.buffer.length < headerEnd + contentLength) break;

      // Extract the message
      const messageStr = this.buffer.slice(headerEnd, headerEnd + contentLength);
      this.buffer = this.buffer.slice(headerEnd + contentLength);

      try {
        const message = JSON.parse(messageStr);
        this._handleMessage(message);
      } catch (err) {
        if (process.env.DEBUG_LSP) {
          console.error('[LSP] Failed to parse message:', err.message);
        }
      }
    }
  }

  /**
   * Handle incoming LSP message
   */
  _handleMessage(msg) {
    // Response to a request
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject, timeout } = this.pending.get(msg.id);
      clearTimeout(timeout);
      this.pending.delete(msg.id);

      if (msg.error) {
        reject(new Error(msg.error.message || 'LSP error'));
      } else {
        resolve(msg.result);
      }
      return;
    }

    // Notification (e.g., publishDiagnostics)
    if (msg.method === 'textDocument/publishDiagnostics') {
      this._handleDiagnostics(msg.params);
    }
  }

  /**
   * Handle diagnostics notification
   */
  _handleDiagnostics(params) {
    const uri = params.uri;
    const diagnostics = params.diagnostics || [];
    this.diagnosticsCache.set(uri, diagnostics);
  }

  /**
   * Send a request to the LSP server
   */
  _send(method, params) {
    const config = getConfig();
    const timeout = config.lsp?.timeout || 5000;

    return new Promise((resolve, reject) => {
      const id = ++this.requestId;

      // Set up timeout
      const timeoutId = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`LSP request timeout: ${method}`));
        }
      }, timeout);

      this.pending.set(id, { resolve, reject, timeout: timeoutId });

      const message = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params
      });

      const header = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n`;
      this.process.stdin.write(header + message);
    });
  }

  /**
   * Send a notification (no response expected)
   */
  _notify(method, params) {
    const message = JSON.stringify({
      jsonrpc: '2.0',
      method,
      params
    });
    const header = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n`;
    this.process.stdin.write(header + message);
  }

  /**
   * Initialize the LSP connection
   */
  async _initialize() {
    const result = await this._send('initialize', {
      processId: process.pid,
      rootUri: pathToFileUri(this.projectRoot),
      rootPath: this.projectRoot,
      capabilities: {
        textDocument: {
          hover: {
            contentFormat: ['markdown', 'plaintext']
          },
          completion: {
            completionItem: {
              snippetSupport: true,
              documentationFormat: ['markdown', 'plaintext']
            }
          },
          synchronization: {
            didSave: true,
            willSave: false,
            willSaveWaitUntil: false
          },
          publishDiagnostics: {
            relatedInformation: true
          }
        },
        workspace: {
          workspaceFolders: true
        }
      },
      workspaceFolders: [
        { uri: pathToFileUri(this.projectRoot), name: path.basename(this.projectRoot) }
      ]
    });

    // Send initialized notification
    this._notify('initialized', {});

    this.initialized = true;
    this.serverCapabilities = result?.capabilities || {};

    return result;
  }

  /**
   * Open a document (required before querying)
   */
  async openDocument(filePath) {
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(this.projectRoot, filePath);
    const uri = pathToFileUri(absPath);

    if (!fs.existsSync(absPath)) {
      throw new Error(`File not found: ${absPath}`);
    }

    const content = fs.readFileSync(absPath, 'utf-8');
    const languageId = this._getLanguageId(absPath);

    this._notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId,
        version: 1,
        text: content
      }
    });

    // Wait a bit for the server to process
    await new Promise(r => setTimeout(r, 100));

    return uri;
  }

  /**
   * Close a document
   */
  closeDocument(uri) {
    this._notify('textDocument/didClose', {
      textDocument: { uri }
    });
  }

  /**
   * Get language ID from file extension
   */
  _getLanguageId(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const map = {
      '.ts': 'typescript',
      '.tsx': 'typescriptreact',
      '.js': 'javascript',
      '.jsx': 'javascriptreact',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      '.json': 'json'
    };
    return map[ext] || 'typescript';
  }

  // ─────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────

  /**
   * Get hover information at a position
   * @param {string} filePath - Path to file
   * @param {number} line - 0-indexed line number
   * @param {number} character - 0-indexed character position
   */
  async hover(filePath, line, character) {
    const uri = await this.openDocument(filePath);

    try {
      const result = await this._send('textDocument/hover', {
        textDocument: { uri },
        position: { line, character }
      });
      return result;
    } finally {
      this.closeDocument(uri);
    }
  }

  /**
   * Get type at a specific position
   * @returns {string|null} Type signature or null if not available
   */
  async getTypeAtPosition(filePath, line, character) {
    const hover = await this.hover(filePath, line, character);
    if (!hover?.contents) return null;

    // Extract type from hover content
    const content = typeof hover.contents === 'string'
      ? hover.contents
      : hover.contents.value || '';

    // Parse TypeScript type signature from markdown code block
    const codeBlockMatch = content.match(/```(?:typescript|ts)\n([\s\S]*?)\n```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }

    // Try to find type in plain format
    const typeMatch = content.match(/^(\w+):\s*(.+)$/m);
    if (typeMatch) {
      return `${typeMatch[1]}: ${typeMatch[2]}`;
    }

    return content.trim() || null;
  }

  /**
   * Get diagnostics for a file
   * @param {string} filePath - Path to file
   * @returns {Array} Array of diagnostic objects
   */
  async getDiagnostics(filePath) {
    const uri = await this.openDocument(filePath);

    // Wait for diagnostics to be pushed
    await new Promise(r => setTimeout(r, 500));

    const diagnostics = this.diagnosticsCache.get(uri) || [];

    this.closeDocument(uri);

    return diagnostics.map(d => ({
      severity: this._diagnosticSeverity(d.severity),
      message: d.message,
      line: d.range?.start?.line,
      character: d.range?.start?.character,
      source: d.source,
      code: d.code
    }));
  }

  /**
   * Convert diagnostic severity to string
   */
  _diagnosticSeverity(severity) {
    const map = { 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' };
    return map[severity] || 'unknown';
  }

  /**
   * Get completions at a position
   * @param {string} filePath - Path to file
   * @param {number} line - 0-indexed line number
   * @param {number} character - 0-indexed character position
   */
  async getCompletions(filePath, line, character) {
    const uri = await this.openDocument(filePath);

    try {
      const result = await this._send('textDocument/completion', {
        textDocument: { uri },
        position: { line, character }
      });

      const items = Array.isArray(result) ? result : (result?.items || []);

      return items.map(item => ({
        label: item.label,
        kind: this._completionKind(item.kind),
        detail: item.detail,
        documentation: typeof item.documentation === 'string'
          ? item.documentation
          : item.documentation?.value
      }));
    } finally {
      this.closeDocument(uri);
    }
  }

  /**
   * Convert completion kind to string
   */
  _completionKind(kind) {
    const map = {
      1: 'text', 2: 'method', 3: 'function', 4: 'constructor',
      5: 'field', 6: 'variable', 7: 'class', 8: 'interface',
      9: 'module', 10: 'property', 11: 'unit', 12: 'value',
      13: 'enum', 14: 'keyword', 15: 'snippet', 16: 'color',
      17: 'file', 18: 'reference', 19: 'folder', 20: 'enumMember',
      21: 'constant', 22: 'struct', 23: 'event', 24: 'operator',
      25: 'typeParameter'
    };
    return map[kind] || 'unknown';
  }

  /**
   * Go to definition
   * @param {string} filePath - Path to file
   * @param {number} line - 0-indexed line number
   * @param {number} character - 0-indexed character position
   */
  async getDefinition(filePath, line, character) {
    const uri = await this.openDocument(filePath);

    try {
      const result = await this._send('textDocument/definition', {
        textDocument: { uri },
        position: { line, character }
      });

      const locations = Array.isArray(result) ? result : (result ? [result] : []);

      return locations.map(loc => ({
        uri: loc.uri || loc.targetUri,
        path: (loc.uri || loc.targetUri)?.replace('file://', ''),
        range: loc.range || loc.targetRange
      }));
    } finally {
      this.closeDocument(uri);
    }
  }

  /**
   * Get document symbols (functions, classes, etc.)
   * @param {string} filePath - Path to file
   */
  async getDocumentSymbols(filePath) {
    const uri = await this.openDocument(filePath);

    try {
      const result = await this._send('textDocument/documentSymbol', {
        textDocument: { uri }
      });

      return this._flattenSymbols(result || []);
    } finally {
      this.closeDocument(uri);
    }
  }

  /**
   * Flatten hierarchical symbols
   */
  _flattenSymbols(symbols, parent = null) {
    const flat = [];
    for (const sym of symbols) {
      flat.push({
        name: sym.name,
        kind: this._symbolKind(sym.kind),
        parent: parent?.name,
        range: sym.range || sym.location?.range,
        selectionRange: sym.selectionRange
      });
      if (sym.children) {
        flat.push(...this._flattenSymbols(sym.children, sym));
      }
    }
    return flat;
  }

  /**
   * Convert symbol kind to string
   */
  _symbolKind(kind) {
    const map = {
      1: 'file', 2: 'module', 3: 'namespace', 4: 'package',
      5: 'class', 6: 'method', 7: 'property', 8: 'field',
      9: 'constructor', 10: 'enum', 11: 'interface', 12: 'function',
      13: 'variable', 14: 'constant', 15: 'string', 16: 'number',
      17: 'boolean', 18: 'array', 19: 'object', 20: 'key',
      21: 'null', 22: 'enumMember', 23: 'struct', 24: 'event',
      25: 'operator', 26: 'typeParameter'
    };
    return map[kind] || 'unknown';
  }

  /**
   * Stop the LSP server
   */
  async stop() {
    if (!this.process) return;

    try {
      await this._send('shutdown', null);
      this._notify('exit', null);
    } catch (err) {
      // Ignore errors during shutdown
    }

    // Force kill if still running after 1 second
    setTimeout(() => {
      if (this.process && !this.process.killed) {
        this.process.kill('SIGKILL');
      }
    }, 1000);

    this.process = null;
    this.initialized = false;
  }
}

// ─────────────────────────────────────────────────────────────
// Singleton Manager
// ─────────────────────────────────────────────────────────────

let instance = null;

/**
 * Get or create LSP client instance
 * @param {string} projectRoot - Project root directory
 */
async function getLSP(projectRoot = PROJECT_ROOT) {
  const config = getConfig();

  // Return null if LSP is disabled
  if (!config.lsp?.enabled) {
    return null;
  }

  // Reuse existing instance if same project
  if (instance && instance.projectRoot === projectRoot && instance.initialized) {
    return instance;
  }

  // Clean up old instance
  if (instance) {
    await instance.stop();
  }

  // Create new instance
  try {
    instance = new LSPClient(projectRoot);
    await instance.start();
    return instance;
  } catch (err) {
    warn(`LSP initialization failed: ${err.message}`);
    instance = null;
    return null;
  }
}

/**
 * Check if LSP is available and enabled
 */
function isLSPEnabled() {
  const config = getConfig();
  return config.lsp?.enabled === true;
}

/**
 * Stop the LSP server
 */
async function stopLSP() {
  if (instance) {
    await instance.stop();
    instance = null;
  }
}

// ─────────────────────────────────────────────────────────────
// High-Level Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Get types for multiple positions in a file
 * @param {string} filePath - Path to file
 * @param {Array<{line: number, character: number, name?: string}>} positions
 * @returns {Object} Map of name/position to type
 */
async function getTypesForPositions(filePath, positions) {
  const lsp = await getLSP();
  if (!lsp) return {};

  const types = {};
  const uri = await lsp.openDocument(filePath);

  try {
    for (const pos of positions) {
      try {
        const hover = await lsp._send('textDocument/hover', {
          textDocument: { uri },
          position: { line: pos.line, character: pos.character }
        });

        if (hover?.contents) {
          const content = typeof hover.contents === 'string'
            ? hover.contents
            : hover.contents.value || '';

          const key = pos.name || `${pos.line}:${pos.character}`;
          types[key] = extractTypeFromHover(content);
        }
      } catch (err) {
        // Skip individual errors
      }
    }
  } finally {
    lsp.closeDocument(uri);
  }

  return types;
}

/**
 * Extract type signature from hover content
 */
function extractTypeFromHover(content) {
  // Try code block first
  const codeMatch = content.match(/```(?:typescript|ts)\n([\s\S]*?)\n```/);
  if (codeMatch) {
    return codeMatch[1].trim();
  }

  // Try inline code
  const inlineMatch = content.match(/`([^`]+)`/);
  if (inlineMatch) {
    return inlineMatch[1];
  }

  return content.trim();
}

/**
 * Validate a file and get all errors
 * @param {string} filePath - Path to file
 * @returns {Array} Array of errors
 */
async function validateFile(filePath) {
  const lsp = await getLSP();
  if (!lsp) return [];

  return lsp.getDiagnostics(filePath);
}

/**
 * Get function/method signature at cursor
 * @param {string} filePath - Path to file
 * @param {number} line - Line number
 * @param {number} character - Character position
 */
async function getSignatureAtPosition(filePath, line, character) {
  const lsp = await getLSP();
  if (!lsp) return null;

  return lsp.getTypeAtPosition(filePath, line, character);
}

// ─────────────────────────────────────────────────────────────
// CLI Interface
// ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log(`
${colors.bold}Wogi Flow LSP Client${colors.reset}

Usage: flow-lsp.js <command> [options]

Commands:
  hover <file> <line> <char>   Get type info at position
  diagnostics <file>           Get file diagnostics
  symbols <file>               Get document symbols
  definition <file> <l> <c>    Go to definition
  test                         Test LSP connection

Examples:
  flow-lsp.js hover src/index.ts 10 5
  flow-lsp.js diagnostics src/index.ts
  flow-lsp.js test
`);
    return;
  }

  const command = args[0];

  try {
    switch (command) {
      case 'hover': {
        const [, file, line, char] = args;
        if (!file || line === undefined || char === undefined) {
          error('Usage: hover <file> <line> <char>');
          process.exit(1);
        }
        const lsp = await getLSP();
        if (!lsp) {
          error('LSP not enabled. Set lsp.enabled: true in config.json');
          process.exit(1);
        }
        const result = await lsp.hover(file, parseInt(line), parseInt(char));
        console.log(JSON.stringify(result, null, 2));
        await stopLSP();
        break;
      }

      case 'type': {
        const [, file, line, char] = args;
        if (!file || line === undefined || char === undefined) {
          error('Usage: type <file> <line> <char>');
          process.exit(1);
        }
        const lsp = await getLSP();
        if (!lsp) {
          error('LSP not enabled');
          process.exit(1);
        }
        const type = await lsp.getTypeAtPosition(file, parseInt(line), parseInt(char));
        console.log(type || '(no type info)');
        await stopLSP();
        break;
      }

      case 'diagnostics': {
        const [, file] = args;
        if (!file) {
          error('Usage: diagnostics <file>');
          process.exit(1);
        }
        const lsp = await getLSP();
        if (!lsp) {
          error('LSP not enabled');
          process.exit(1);
        }
        const diags = await lsp.getDiagnostics(file);
        console.log(JSON.stringify(diags, null, 2));
        await stopLSP();
        break;
      }

      case 'symbols': {
        const [, file] = args;
        if (!file) {
          error('Usage: symbols <file>');
          process.exit(1);
        }
        const lsp = await getLSP();
        if (!lsp) {
          error('LSP not enabled');
          process.exit(1);
        }
        const symbols = await lsp.getDocumentSymbols(file);
        console.log(JSON.stringify(symbols, null, 2));
        await stopLSP();
        break;
      }

      case 'definition': {
        const [, file, line, char] = args;
        if (!file || line === undefined || char === undefined) {
          error('Usage: definition <file> <line> <char>');
          process.exit(1);
        }
        const lsp = await getLSP();
        if (!lsp) {
          error('LSP not enabled');
          process.exit(1);
        }
        const defs = await lsp.getDefinition(file, parseInt(line), parseInt(char));
        console.log(JSON.stringify(defs, null, 2));
        await stopLSP();
        break;
      }

      case 'test': {
        console.log(`${colors.cyan}Testing LSP connection...${colors.reset}\n`);

        const config = getConfig();
        console.log(`LSP enabled: ${config.lsp?.enabled ? 'yes' : 'no'}`);
        console.log(`Server: ${config.lsp?.server || 'typescript-language-server'}`);
        console.log(`Timeout: ${config.lsp?.timeout || 5000}ms\n`);

        if (!config.lsp?.enabled) {
          warn('LSP is disabled. Enable with: lsp.enabled: true in config.json');
          return;
        }

        try {
          const lsp = await getLSP();
          if (lsp) {
            success('LSP server started successfully');
            console.log(`Server capabilities: ${Object.keys(lsp.serverCapabilities || {}).length} features`);
            await stopLSP();
          }
        } catch (err) {
          error(`LSP test failed: ${err.message}`);
          process.exit(1);
        }
        break;
      }

      default:
        error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (err) {
    error(`Error: ${err.message}`);
    await stopLSP();
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────

module.exports = {
  // Main API
  getLSP,
  stopLSP,
  isLSPEnabled,

  // High-level helpers
  getTypesForPositions,
  validateFile,
  getSignatureAtPosition,

  // Low-level access
  LSPClient
};

if (require.main === module) {
  main().catch(e => {
    error(err.message);
    process.exit(1);
  });
}
