#!/usr/bin/env node

/**
 * Wogi Flow - MCP Tool Documentation Generator
 *
 * Scans MCP servers and generates tool documentation for AI context injection.
 * Part of Crush research improvements (wf-e444ecc5)
 *
 * Usage:
 *   flow mcp-docs scan              - Scan all MCP servers and generate docs
 *   flow mcp-docs list              - List discovered MCP tools
 *   flow mcp-docs show <tool>       - Show details for a specific tool
 *   flow mcp-docs generate          - Generate markdown documentation
 *   flow mcp-docs context [task]    - Get relevant MCP tool context for a task
 */

const fs = require('fs');
const path = require('path');
const {
  getProjectRoot,
  safeJsonParse,
  fileExists,
  color,
  printHeader,
  printSection
} = require('./flow-utils');

// ============================================================
// Configuration
// ============================================================

const PROJECT_ROOT = getProjectRoot();
const MCP_DOCS_PATH = path.join(PROJECT_ROOT, '.workflow', 'state', 'mcp-tools.json');
const DOCS_OUTPUT_PATH = path.join(PROJECT_ROOT, '.claude', 'docs', 'knowledge-base', '05-development-tools', 'mcp-tools-generated.md');

// Known MCP server locations in this project
const MCP_SERVER_PATHS = [
  'mcp-memory-server/index.js',
  'scripts/flow-figma-mcp-server.js'
];

// ============================================================
// Tool Extraction
// ============================================================

/**
 * Extract TOOLS array from a JavaScript file using regex and AST-like parsing
 * @param {string} filePath - Path to the MCP server file
 * @returns {Object[]} Array of tool definitions
 */
function extractToolsFromFile(filePath) {
  const fullPath = path.join(PROJECT_ROOT, filePath);

  if (!fileExists(fullPath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    const tools = [];

    // Pattern 1: TOOLS array definition
    const toolsArrayMatch = content.match(/const\s+TOOLS\s*=\s*\[([\s\S]*?)\];/);
    if (toolsArrayMatch) {
      const toolsContent = toolsArrayMatch[1];
      const extracted = parseToolsArray(toolsContent);
      tools.push(...extracted);
    }

    // Pattern 2: tools property in a TOOL_DEFINITIONS object
    const toolDefsMatch = content.match(/(?:TOOL_DEFINITIONS|tools)\s*[=:]\s*\{([\s\S]*?)\n\s*\}/);
    if (toolDefsMatch) {
      const defsContent = toolDefsMatch[1];
      const extracted = parseToolDefinitions(defsContent);
      tools.push(...extracted);
    }

    // Pattern 3: Individual tool definitions (name, description, inputSchema pattern)
    const individualTools = parseIndividualTools(content);
    for (const tool of individualTools) {
      if (!tools.find(t => t.name === tool.name)) {
        tools.push(tool);
      }
    }

    return tools.map(tool => ({
      ...tool,
      sourceFile: filePath
    }));
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`Error extracting tools from ${filePath}: ${err.message}`);
    }
    return [];
  }
}

/**
 * Parse tools array content using regex
 * @param {string} content - Content between TOOLS = [ ... ]
 * @returns {Object[]} Parsed tools
 */
function parseToolsArray(content) {
  const tools = [];

  // Match each tool object
  const toolPattern = /\{\s*name:\s*['"]([^'"]+)['"],\s*description:\s*['"]([^'"]+)['"][\s\S]*?inputSchema:\s*(\{[\s\S]*?\})\s*\}/g;

  let match;
  while ((match = toolPattern.exec(content)) !== null) {
    const [, name, description, schemaStr] = match;

    const schema = parseSchemaString(schemaStr);

    tools.push({
      name,
      description,
      inputSchema: schema
    });
  }

  return tools;
}

/**
 * Parse a JSON schema string (relaxed JSON format)
 * @param {string} schemaStr - Schema string
 * @returns {Object} Parsed schema or empty object
 */
function parseSchemaString(schemaStr) {
  try {
    // Convert JavaScript object notation to JSON
    let jsonStr = schemaStr
      // Add quotes around unquoted keys
      .replace(/(\w+):/g, '"$1":')
      // Convert single quotes to double quotes (but not in strings)
      .replace(/'/g, '"')
      // Remove trailing commas
      .replace(/,\s*([\}\]])/g, '$1');

    return JSON.parse(jsonStr);
  } catch (_err) {
    // Return a minimal schema on parse failure
    return { type: 'object', properties: {} };
  }
}

/**
 * Parse tool definitions from object pattern
 * @param {string} content - Content of definitions object
 * @returns {Object[]} Parsed tools
 */
function parseToolDefinitions(content) {
  const tools = [];

  // Match tool entries in object format
  const entryPattern = /['"]?(\w+)['"]?\s*:\s*\{\s*description:\s*['"]([^'"]+)['"]/g;

  let match;
  while ((match = entryPattern.exec(content)) !== null) {
    const [, name, description] = match;
    tools.push({
      name,
      description,
      inputSchema: { type: 'object', properties: {} }
    });
  }

  return tools;
}

/**
 * Parse individual tool definitions scattered in code
 * @param {string} content - Full file content
 * @returns {Object[]} Parsed tools
 */
function parseIndividualTools(content) {
  const tools = [];

  // Look for tool-like patterns with name and description
  const patterns = [
    // { name: 'tool', description: 'desc' }
    /\{\s*name:\s*['"](\w+)['"],\s*description:\s*['"]([^'"]+)['"]/g,
    // tool.name = 'name', tool.description = 'desc'
    /(\w+)\.name\s*=\s*['"](\w+)['"][\s\S]{0,100}?\1\.description\s*=\s*['"]([^'"]+)['"]/g
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const name = match[1] || match[2];
      const description = match[2] || match[3];

      if (name && description && !tools.find(t => t.name === name)) {
        tools.push({
          name,
          description,
          inputSchema: { type: 'object', properties: {} }
        });
      }
    }
  }

  return tools;
}

// ============================================================
// Scanning
// ============================================================

/**
 * Scan all known MCP servers and extract tool definitions
 * @returns {Object} Scan results with tools by server
 */
function scanMcpServers() {
  const results = {
    scannedAt: new Date().toISOString(),
    servers: {},
    allTools: [],
    totalTools: 0
  };

  for (const serverPath of MCP_SERVER_PATHS) {
    const tools = extractToolsFromFile(serverPath);

    if (tools.length > 0) {
      const serverName = path.basename(serverPath, '.js')
        .replace(/^flow-/, '')
        .replace(/-mcp-server$/, '')
        .replace(/-/g, '_');

      results.servers[serverName] = {
        path: serverPath,
        tools: tools,
        toolCount: tools.length
      };

      results.allTools.push(...tools);
      results.totalTools += tools.length;
    }
  }

  return results;
}

/**
 * Save scan results to state file
 * @param {Object} results - Scan results
 */
function saveScanResults(results) {
  const dir = path.dirname(MCP_DOCS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(MCP_DOCS_PATH, JSON.stringify(results, null, 2));
}

/**
 * Load cached scan results
 * @returns {Object|null} Cached results or null
 */
function loadScanResults() {
  return safeJsonParse(MCP_DOCS_PATH, null);
}

// ============================================================
// Documentation Generation
// ============================================================

/**
 * Generate markdown documentation for all tools
 * @param {Object} scanResults - Results from scanMcpServers
 * @returns {string} Markdown content
 */
function generateMarkdown(scanResults) {
  const lines = [
    '# MCP Tools Reference (Auto-Generated)',
    '',
    `> Last generated: ${new Date().toISOString()}`,
    '',
    '<!-- PIN: mcp-tools-reference -->',
    '',
    'This document is auto-generated by `flow mcp-docs generate`. Do not edit manually.',
    '',
    '## Summary',
    '',
    `- **Total Tools**: ${scanResults.totalTools}`,
    `- **Servers Scanned**: ${Object.keys(scanResults.servers).length}`,
    ''
  ];

  // Table of contents
  lines.push('## Table of Contents', '');
  for (const [serverName, server] of Object.entries(scanResults.servers)) {
    lines.push(`- [${serverName}](#${serverName.toLowerCase().replace(/_/g, '-')})`);
    for (const tool of server.tools) {
      lines.push(`  - [${tool.name}](#${tool.name.toLowerCase().replace(/_/g, '-')})`);
    }
  }
  lines.push('');

  // Tool documentation by server
  for (const [serverName, server] of Object.entries(scanResults.servers)) {
    lines.push(`## ${serverName}`, '');
    lines.push(`<!-- PIN: mcp-${serverName.toLowerCase().replace(/_/g, '-')} -->`, '');
    lines.push(`**Source**: \`${server.path}\`  `);
    lines.push(`**Tools**: ${server.toolCount}`, '');

    for (const tool of server.tools) {
      lines.push(`### ${tool.name}`, '');
      lines.push(`<!-- PIN: mcp-tool-${tool.name.toLowerCase().replace(/_/g, '-')} -->`, '');
      lines.push(tool.description, '');

      // Input schema
      if (tool.inputSchema && tool.inputSchema.properties) {
        const props = tool.inputSchema.properties;
        const required = tool.inputSchema.required || [];

        if (Object.keys(props).length > 0) {
          lines.push('**Parameters:**', '');
          lines.push('| Parameter | Type | Required | Description |');
          lines.push('|-----------|------|----------|-------------|');

          for (const [propName, propDef] of Object.entries(props)) {
            const isRequired = required.includes(propName) ? '✓' : '';
            const type = propDef.type || 'any';
            const desc = propDef.description || '-';
            lines.push(`| \`${propName}\` | ${type} | ${isRequired} | ${desc} |`);
          }
          lines.push('');
        }
      }

      // Example usage
      lines.push('**Example:**', '');
      lines.push('```javascript');
      lines.push(`// Using ${tool.name}`);
      if (tool.inputSchema && tool.inputSchema.properties) {
        const exampleParams = {};
        for (const [propName, propDef] of Object.entries(tool.inputSchema.properties)) {
          if (propDef.type === 'string') {
            exampleParams[propName] = `"example_${propName}"`;
          } else if (propDef.type === 'number') {
            exampleParams[propName] = propDef.default || 0;
          } else if (propDef.type === 'boolean') {
            exampleParams[propName] = propDef.default ?? false;
          } else if (propDef.type === 'object') {
            exampleParams[propName] = '{ /* ... */ }';
          } else if (propDef.type === 'array') {
            exampleParams[propName] = '[ /* ... */ ]';
          }
        }
        lines.push(`const result = await mcp.call("${tool.name}", ${JSON.stringify(exampleParams, null, 2).replace(/"/g, '')});`);
      } else {
        lines.push(`const result = await mcp.call("${tool.name}", {});`);
      }
      lines.push('```');
      lines.push('');
    }
  }

  // Footer
  lines.push('---', '');
  lines.push('*Generated by WogiFlow MCP Documentation Generator*');

  return lines.join('\n');
}

/**
 * Save generated markdown documentation
 * @param {string} markdown - Markdown content
 */
function saveMarkdownDocs(markdown) {
  const dir = path.dirname(DOCS_OUTPUT_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(DOCS_OUTPUT_PATH, markdown);
}

// ============================================================
// Context Retrieval
// ============================================================

/**
 * Get MCP tool context relevant to a task description
 * @param {string} taskDescription - Task description to match against
 * @returns {Object} Relevant tools and context
 */
function getContextForTask(taskDescription) {
  const scanResults = loadScanResults();

  if (!scanResults) {
    return { tools: [], context: 'No MCP tools scanned yet. Run: flow mcp-docs scan' };
  }

  const lowerDesc = (taskDescription || '').toLowerCase();
  const relevantTools = [];

  // Keywords that suggest MCP tool relevance
  const mcpKeywords = ['mcp', 'memory', 'figma', 'component', 'fact', 'remember', 'recall', 'prd', 'proposal'];

  // Check if task mentions MCP-related concepts
  const mentionsMcp = mcpKeywords.some(kw => lowerDesc.includes(kw));

  if (!mentionsMcp && taskDescription) {
    return { tools: [], context: 'Task does not appear to require MCP tools.' };
  }

  // Find relevant tools based on keyword matching
  for (const tool of scanResults.allTools) {
    const toolText = `${tool.name} ${tool.description}`.toLowerCase();
    const relevanceScore = calculateRelevance(lowerDesc, toolText);

    if (relevanceScore > 0.3 || !taskDescription) {
      relevantTools.push({
        ...tool,
        relevanceScore
      });
    }
  }

  // Sort by relevance
  relevantTools.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Generate context string
  let context = '';
  if (relevantTools.length > 0) {
    context = `## Relevant MCP Tools\n\n`;
    for (const tool of relevantTools.slice(0, 5)) {
      context += `### ${tool.name}\n`;
      context += `${tool.description}\n\n`;
    }
  }

  return { tools: relevantTools, context };
}

/**
 * Calculate relevance score between task and tool
 * @param {string} taskText - Task description
 * @param {string} toolText - Tool name and description
 * @returns {number} Relevance score 0-1
 */
function calculateRelevance(taskText, toolText) {
  if (!taskText || !toolText) return 0;

  const taskWords = new Set(taskText.split(/\s+/).filter(w => w.length > 3));
  const toolWords = new Set(toolText.split(/\s+/).filter(w => w.length > 3));

  let matches = 0;
  for (const word of taskWords) {
    if (toolWords.has(word)) {
      matches++;
    }
  }

  return matches / Math.max(taskWords.size, 1);
}

// ============================================================
// CLI
// ============================================================

function showHelp() {
  printHeader('MCP Tool Documentation');

  console.log(`
Usage:
  flow mcp-docs scan              Scan all MCP servers and generate docs
  flow mcp-docs list              List discovered MCP tools
  flow mcp-docs show <tool>       Show details for a specific tool
  flow mcp-docs generate          Generate markdown documentation
  flow mcp-docs context [task]    Get relevant MCP tool context for a task

Examples:
  flow mcp-docs scan
  flow mcp-docs list
  flow mcp-docs show remember_fact
  flow mcp-docs generate
  flow mcp-docs context "store user preferences"
`);
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help') {
    showHelp();
    return;
  }

  switch (command) {
    case 'scan': {
      printHeader('Scanning MCP Servers');

      const results = scanMcpServers();
      saveScanResults(results);

      console.log(color('green', `✓ Scanned ${Object.keys(results.servers).length} server(s)`));
      console.log(color('green', `✓ Found ${results.totalTools} tool(s)`));
      console.log('');

      for (const [serverName, server] of Object.entries(results.servers)) {
        console.log(`${color('cyan', serverName)}: ${server.toolCount} tools`);
        for (const tool of server.tools) {
          console.log(`  • ${tool.name}`);
        }
      }

      console.log('');
      console.log(color('dim', `Results saved to: ${MCP_DOCS_PATH}`));
      break;
    }

    case 'list': {
      const results = loadScanResults();

      if (!results) {
        console.log(color('yellow', 'No scan results found. Run: flow mcp-docs scan'));
        return;
      }

      printHeader('MCP Tools');
      console.log(`Total: ${results.totalTools} tools from ${Object.keys(results.servers).length} servers`);
      console.log('');

      for (const [serverName, server] of Object.entries(results.servers)) {
        printSection(serverName);
        for (const tool of server.tools) {
          console.log(`  ${color('cyan', tool.name)}`);
          console.log(`    ${color('dim', tool.description.slice(0, 80))}${tool.description.length > 80 ? '...' : ''}`);
        }
        console.log('');
      }
      break;
    }

    case 'show': {
      const toolName = args[1];

      if (!toolName) {
        console.error(color('red', 'Error: Tool name required'));
        console.log('Usage: flow mcp-docs show <tool>');
        process.exit(1);
      }

      const results = loadScanResults();

      if (!results) {
        console.log(color('yellow', 'No scan results found. Run: flow mcp-docs scan'));
        return;
      }

      const tool = results.allTools.find(t => t.name === toolName);

      if (!tool) {
        console.error(color('red', `Tool not found: ${toolName}`));
        console.log('Available tools:');
        for (const t of results.allTools) {
          console.log(`  • ${t.name}`);
        }
        process.exit(1);
      }

      printHeader(tool.name);
      console.log(`${color('bold', 'Description:')} ${tool.description}`);
      console.log(`${color('bold', 'Source:')} ${tool.sourceFile}`);
      console.log('');

      if (tool.inputSchema && tool.inputSchema.properties) {
        console.log(color('bold', 'Parameters:'));
        const required = tool.inputSchema.required || [];

        for (const [propName, propDef] of Object.entries(tool.inputSchema.properties)) {
          const req = required.includes(propName) ? color('red', '*') : '';
          console.log(`  ${color('cyan', propName)}${req} (${propDef.type || 'any'})`);
          if (propDef.description) {
            console.log(`    ${color('dim', propDef.description)}`);
          }
        }
      }
      break;
    }

    case 'generate': {
      let results = loadScanResults();

      if (!results) {
        console.log(color('yellow', 'No scan results found. Scanning now...'));
        results = scanMcpServers();
        saveScanResults(results);
      }

      const markdown = generateMarkdown(results);
      saveMarkdownDocs(markdown);

      console.log(color('green', `✓ Generated documentation with ${results.totalTools} tools`));
      console.log(color('dim', `Output: ${DOCS_OUTPUT_PATH}`));
      break;
    }

    case 'context': {
      const taskDesc = args.slice(1).join(' ');

      const { tools, context } = getContextForTask(taskDesc);

      if (tools.length === 0) {
        console.log(color('dim', context || 'No relevant MCP tools found.'));
        return;
      }

      printHeader('Relevant MCP Tools');
      console.log(`Found ${tools.length} relevant tool(s) for task.`);
      console.log('');

      for (const tool of tools.slice(0, 5)) {
        console.log(`${color('cyan', tool.name)} (relevance: ${(tool.relevanceScore * 100).toFixed(0)}%)`);
        console.log(`  ${color('dim', tool.description)}`);
        console.log('');
      }
      break;
    }

    default:
      console.error(color('red', `Unknown command: ${command}`));
      showHelp();
      process.exit(1);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  scanMcpServers,
  saveScanResults,
  loadScanResults,
  generateMarkdown,
  saveMarkdownDocs,
  getContextForTask,
  extractToolsFromFile
};

// Run CLI if executed directly
if (require.main === module) {
  main();
}
