#!/usr/bin/env node

/**
 * Wogi Flow - External Context Protocol
 *
 * Manage external links and artifacts:
 * - links.yaml for referencing external resources
 * - Fetch and cache external context
 * - Support for Notion, Figma, GitHub, and custom URLs
 *
 * Usage as module:
 *   const { loadLinks, fetchLink, getLinkedContext } = require('./flow-links');
 *   const links = loadLinks();
 *   const content = await fetchLink('design');
 *
 * Usage as CLI:
 *   flow links list                    # List all links
 *   flow links add <name> <url>        # Add a link
 *   flow links fetch <name>            # Fetch and cache link
 *   flow links show <name>             # Show cached content
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const dns = require('dns');
const { getProjectRoot, colors: c } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const LINKS_PATH = path.join(WORKFLOW_DIR, 'links.yaml');
const LINKS_JSON_PATH = path.join(WORKFLOW_DIR, 'links.json');
const CACHE_DIR = path.join(WORKFLOW_DIR, 'cache', 'links');

/**
 * Link types
 */
const LINK_TYPES = {
  NOTION: 'notion',
  FIGMA: 'figma',
  GITHUB: 'github',
  JIRA: 'jira',
  LINEAR: 'linear',
  URL: 'url',
  FILE: 'file'
};

/**
 * Simple YAML parser (for links.yaml)
 */
function parseYaml(content) {
  const result = {};
  let currentSection = null;
  let currentItem = null;

  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Top-level key (no indent)
    if (!line.startsWith(' ') && !line.startsWith('\t') && trimmed.includes(':')) {
      const [key, ...valueParts] = trimmed.split(':');
      const value = valueParts.join(':').trim();

      if (!value) {
        // Section header
        currentSection = key;
        result[currentSection] = {};
        currentItem = null;
      } else {
        // Simple key-value
        result[key] = value;
      }
    }
    // Nested item
    else if (currentSection && trimmed.includes(':')) {
      const indent = line.match(/^(\s*)/)[1].length;
      const [key, ...valueParts] = trimmed.split(':');
      const value = valueParts.join(':').trim();

      if (indent <= 2) {
        // New item in section
        currentItem = key;
        result[currentSection][currentItem] = value || {};
      } else if (currentItem && typeof result[currentSection][currentItem] === 'object') {
        // Property of current item
        result[currentSection][currentItem][key] = value;
      }
    }
  }

  return result;
}

/**
 * Generate YAML from object
 */
function toYaml(obj, indent = 0) {
  let result = '';
  const spaces = '  '.repeat(indent);

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result += `${spaces}${key}:\n`;
      result += toYaml(value, indent + 1);
    } else if (Array.isArray(value)) {
      result += `${spaces}${key}:\n`;
      for (const item of value) {
        result += `${spaces}  - ${item}\n`;
      }
    } else {
      result += `${spaces}${key}: ${value}\n`;
    }
  }

  return result;
}

/**
 * Load links from YAML or JSON
 */
function loadLinks() {
  // Try YAML first
  if (fs.existsSync(LINKS_PATH)) {
    try {
      const content = fs.readFileSync(LINKS_PATH, 'utf-8');
      return parseYaml(content);
    } catch {
      // Fall through to JSON
    }
  }

  // Try JSON
  if (fs.existsSync(LINKS_JSON_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(LINKS_JSON_PATH, 'utf-8'));
    } catch {
      return {};
    }
  }

  return {};
}

/**
 * Save links to YAML
 */
function saveLinks(links) {
  const yaml = `# Wogi Flow - External Links
# Reference external resources (docs, designs, issues)
# Run: flow links fetch <name> to cache content

${toYaml(links)}`;

  fs.writeFileSync(LINKS_PATH, yaml);
}

/**
 * Detect link type from URL
 */
function detectLinkType(url) {
  if (url.includes('notion.so') || url.includes('notion.site')) {
    return LINK_TYPES.NOTION;
  }
  if (url.includes('figma.com')) {
    return LINK_TYPES.FIGMA;
  }
  if (url.includes('github.com')) {
    return LINK_TYPES.GITHUB;
  }
  if (url.includes('atlassian.net') || url.includes('jira.')) {
    return LINK_TYPES.JIRA;
  }
  if (url.includes('linear.app')) {
    return LINK_TYPES.LINEAR;
  }
  if (url.startsWith('file://') || url.startsWith('/') || url.startsWith('./')) {
    return LINK_TYPES.FILE;
  }
  return LINK_TYPES.URL;
}

/**
 * Check if an IP address is private/internal (SSRF protection)
 */
function isPrivateIP(ip) {
  // Handle IPv4
  const parts = ip.split('.').map(Number);
  if (parts.length === 4) {
    return (
      ip === '127.0.0.1' ||
      ip.startsWith('127.') ||
      parts[0] === 10 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      parts[0] === 0 ||
      ip === '255.255.255.255'
    );
  }
  // Handle IPv6 loopback and link-local
  return ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd');
}

/**
 * Validate URL for SSRF (resolve hostname and check IP)
 */
async function validateUrlForSSRF(urlString, options = {}) {
  const url = new URL(urlString);

  // Block non-HTTP(S) protocols
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`SSRF Protection: Only HTTP(S) protocols allowed, got ${url.protocol}`);
  }

  // Require HTTPS unless explicitly allowed
  if (url.protocol !== 'https:' && !options.allowHttp) {
    throw new Error('SSRF Protection: Only HTTPS URLs allowed. Use allowHttp option to override.');
  }

  // Block localhost and common internal hostnames
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error(`SSRF Protection: Internal hostnames not allowed: ${hostname}`);
  }

  // Resolve hostname and check IP addresses
  try {
    const addresses = await dns.promises.resolve4(hostname).catch(() => []);
    const addresses6 = await dns.promises.resolve6(hostname).catch(() => []);
    const allAddresses = [...addresses, ...addresses6];

    if (allAddresses.length === 0) {
      // Could not resolve - might be internal DNS, allow with caution
      return;
    }

    for (const ip of allAddresses) {
      if (isPrivateIP(ip)) {
        throw new Error(`SSRF Protection: URL resolves to private IP address: ${ip}`);
      }
    }
  } catch (err) {
    if (err.message.startsWith('SSRF')) throw err;
    // DNS resolution failed - proceed with caution (might be valid external host)
  }
}

/**
 * Fetch content from URL (with SSRF protection)
 */
async function fetchUrl(url, options = {}) {
  // Validate URL for SSRF before making request
  await validateUrlForSSRF(url, options);

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;

    const reqOptions = {
      method: 'GET',
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      headers: {
        'User-Agent': 'Wogi-Flow/1.0',
        ...options.headers
      },
      timeout: options.timeout || 30000
    };

    const req = protocol.request(reqOptions, (res) => {
      // Handle redirects (with SSRF check)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Validate redirect target for SSRF
        validateUrlForSSRF(res.headers.location, options)
          .then(() => fetchUrl(res.headers.location, options))
          .then(resolve)
          .catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.on('timeout', () => reject(new Error('Request timeout')));
    req.end();
  });
}

/**
 * Extract text content from HTML
 */
function extractTextFromHtml(html) {
  // Remove script and style tags
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode common entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');

  // Clean up whitespace
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

/**
 * Fetch and process a link
 */
async function fetchLink(name, links = null) {
  links = links || loadLinks();

  // Find the link
  let linkData = null;
  let section = null;

  for (const [sec, items] of Object.entries(links)) {
    if (typeof items === 'object' && items[name]) {
      linkData = items[name];
      section = sec;
      break;
    }
  }

  if (!linkData) {
    throw new Error(`Link not found: ${name}`);
  }

  const url = typeof linkData === 'string' ? linkData : linkData.url;
  if (!url) {
    throw new Error(`No URL for link: ${name}`);
  }

  const type = detectLinkType(url);
  let content = null;

  // Fetch based on type
  switch (type) {
    case LINK_TYPES.FILE: {
      const filePath = url.startsWith('file://') ? url.slice(7) : url;
      const absPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(PROJECT_ROOT, filePath);

      if (fs.existsSync(absPath)) {
        content = fs.readFileSync(absPath, 'utf-8');
      } else {
        throw new Error(`File not found: ${absPath}`);
      }
      break;
    }

    case LINK_TYPES.GITHUB: {
      // Convert GitHub URL to raw content URL
      let rawUrl = url;
      if (url.includes('github.com') && url.includes('/blob/')) {
        rawUrl = url
          .replace('github.com', 'raw.githubusercontent.com')
          .replace('/blob/', '/');
      }
      const html = await fetchUrl(rawUrl);
      content = html.includes('<html') ? extractTextFromHtml(html) : html;
      break;
    }

    default: {
      const html = await fetchUrl(url);
      content = extractTextFromHtml(html);
    }
  }

  // Cache the content
  if (content) {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }

    const cacheFile = path.join(CACHE_DIR, `${name}.txt`);
    const metadata = {
      name,
      url,
      type,
      section,
      fetchedAt: new Date().toISOString(),
      contentLength: content.length
    };

    fs.writeFileSync(cacheFile, content);
    fs.writeFileSync(
      path.join(CACHE_DIR, `${name}.meta.json`),
      JSON.stringify(metadata, null, 2)
    );
  }

  return {
    name,
    url,
    type,
    content,
    contentLength: content?.length || 0
  };
}

/**
 * Get cached content for a link
 */
function getCachedContent(name) {
  const cacheFile = path.join(CACHE_DIR, `${name}.txt`);
  const metaFile = path.join(CACHE_DIR, `${name}.meta.json`);

  if (!fs.existsSync(cacheFile)) {
    return null;
  }

  const content = fs.readFileSync(cacheFile, 'utf-8');
  let metadata = {};

  if (fs.existsSync(metaFile)) {
    try {
      metadata = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
    } catch {
      // Ignore
    }
  }

  return {
    content,
    ...metadata
  };
}

/**
 * Add a new link
 */
function addLink(name, url, section = 'links') {
  const links = loadLinks();

  if (!links[section]) {
    links[section] = {};
  }

  links[section][name] = url;
  saveLinks(links);

  return links;
}

/**
 * Remove a link
 */
function removeLink(name) {
  const links = loadLinks();

  for (const section of Object.keys(links)) {
    if (typeof links[section] === 'object' && links[section][name]) {
      delete links[section][name];
      break;
    }
  }

  saveLinks(links);

  // Remove cache
  const cacheFile = path.join(CACHE_DIR, `${name}.txt`);
  const metaFile = path.join(CACHE_DIR, `${name}.meta.json`);

  if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);
  if (fs.existsSync(metaFile)) fs.unlinkSync(metaFile);

  return links;
}

/**
 * Get all linked context for LLM prompts
 */
function getLinkedContext(linkNames = null) {
  const links = loadLinks();
  let context = '';

  const processLink = (name) => {
    const cached = getCachedContent(name);
    if (cached) {
      context += `\n## ${name}\n`;
      context += `Source: ${cached.url || 'unknown'}\n`;
      context += `Fetched: ${cached.fetchedAt || 'unknown'}\n\n`;
      context += cached.content.slice(0, 5000); // Limit content
      if (cached.content.length > 5000) {
        context += '\n[... truncated ...]';
      }
      context += '\n\n';
    }
  };

  if (linkNames) {
    for (const name of linkNames) {
      processLink(name);
    }
  } else {
    // Get all cached links
    if (fs.existsSync(CACHE_DIR)) {
      const files = fs.readdirSync(CACHE_DIR)
        .filter(f => f.endsWith('.txt'))
        .map(f => f.replace('.txt', ''));

      for (const name of files) {
        processLink(name);
      }
    }
  }

  return context;
}

/**
 * List all links with status
 */
function listLinks() {
  const links = loadLinks();
  const result = [];

  for (const [section, items] of Object.entries(links)) {
    if (typeof items !== 'object') continue;

    for (const [name, data] of Object.entries(items)) {
      const url = typeof data === 'string' ? data : data.url;
      const type = detectLinkType(url);
      const cached = getCachedContent(name);

      result.push({
        name,
        section,
        url,
        type,
        cached: !!cached,
        cachedAt: cached?.fetchedAt
      });
    }
  }

  return result;
}

/**
 * Initialize links file with template
 */
function initLinks() {
  if (fs.existsSync(LINKS_PATH)) {
    return false;
  }

  const template = {
    docs: {
      prd: './docs/PRD.md',
      api: 'https://api.example.com/docs'
    },
    design: {
      figma: 'https://figma.com/file/...'
    },
    issues: {
      backlog: 'https://linear.app/...'
    }
  };

  saveLinks(template);
  return true;
}

// Module exports
module.exports = {
  LINK_TYPES,
  loadLinks,
  saveLinks,
  addLink,
  removeLink,
  fetchLink,
  getCachedContent,
  getLinkedContext,
  listLinks,
  initLinks,
  detectLinkType
};

// CLI Handler
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  async function main() {
    switch (command) {
      case 'list': {
        const links = listLinks();

        if (links.length === 0) {
          console.log(`${c.dim}No links configured.${c.reset}`);
          console.log(`${c.dim}Run "flow links init" to create template.${c.reset}`);
          return;
        }

        console.log(`\n${c.cyan}${c.bold}External Links${c.reset}\n`);

        // Group by section
        const sections = {};
        for (const link of links) {
          if (!sections[link.section]) {
            sections[link.section] = [];
          }
          sections[link.section].push(link);
        }

        for (const [section, items] of Object.entries(sections)) {
          console.log(`${c.bold}${section}${c.reset}`);
          for (const link of items) {
            const status = link.cached
              ? `${c.green}✓ cached${c.reset}`
              : `${c.dim}not cached${c.reset}`;
            console.log(`  ${link.name}: ${c.dim}${link.url.slice(0, 50)}...${c.reset} [${status}]`);
          }
          console.log('');
        }
        break;
      }

      case 'add': {
        const name = args[1];
        const url = args[2];
        const section = args[3] || 'links';

        if (!name || !url) {
          console.error(`${c.red}Error: Name and URL required${c.reset}`);
          console.log(`${c.dim}Usage: flow links add <name> <url> [section]${c.reset}`);
          process.exit(1);
        }

        addLink(name, url, section);
        console.log(`${c.green}✅ Added link: ${name}${c.reset}`);
        break;
      }

      case 'remove': {
        const name = args[1];
        if (!name) {
          console.error(`${c.red}Error: Link name required${c.reset}`);
          process.exit(1);
        }

        removeLink(name);
        console.log(`${c.green}✅ Removed link: ${name}${c.reset}`);
        break;
      }

      case 'fetch': {
        const name = args[1];
        if (!name) {
          console.error(`${c.red}Error: Link name required${c.reset}`);
          process.exit(1);
        }

        console.log(`${c.cyan}Fetching ${name}...${c.reset}`);
        try {
          const result = await fetchLink(name);
          console.log(`${c.green}✅ Fetched and cached: ${result.contentLength} chars${c.reset}`);
        } catch (err) {
          console.error(`${c.red}Error: ${err.message}${c.reset}`);
          process.exit(1);
        }
        break;
      }

      case 'show': {
        const name = args[1];
        if (!name) {
          console.error(`${c.red}Error: Link name required${c.reset}`);
          process.exit(1);
        }

        const cached = getCachedContent(name);
        if (!cached) {
          console.error(`${c.yellow}Not cached. Run: flow links fetch ${name}${c.reset}`);
          process.exit(1);
        }

        console.log(`\n${c.cyan}${c.bold}${name}${c.reset}`);
        console.log(`${c.dim}URL: ${cached.url}${c.reset}`);
        console.log(`${c.dim}Fetched: ${cached.fetchedAt}${c.reset}`);
        console.log(`${c.dim}Length: ${cached.contentLength} chars${c.reset}`);
        console.log(`${'─'.repeat(60)}`);
        console.log(cached.content.slice(0, 2000));
        if (cached.content.length > 2000) {
          console.log(`\n${c.dim}... (${cached.content.length - 2000} more chars)${c.reset}`);
        }
        break;
      }

      case 'init': {
        const created = initLinks();
        if (created) {
          console.log(`${c.green}✅ Created links.yaml template${c.reset}`);
        } else {
          console.log(`${c.yellow}links.yaml already exists${c.reset}`);
        }
        break;
      }

      case 'context': {
        const linkNames = args.slice(1);
        const context = getLinkedContext(linkNames.length > 0 ? linkNames : null);

        if (!context) {
          console.log(`${c.dim}No cached content. Run "flow links fetch <name>" first.${c.reset}`);
        } else {
          console.log(context);
        }
        break;
      }

      default: {
        console.log(`
${c.cyan}Wogi Flow - External Context Protocol${c.reset}

${c.bold}Usage:${c.reset}
  flow links list                    List all configured links
  flow links add <name> <url>        Add a new link
  flow links remove <name>           Remove a link
  flow links fetch <name>            Fetch and cache link content
  flow links show <name>             Show cached content
  flow links context [names...]      Get linked context for prompts
  flow links init                    Create template links.yaml

${c.bold}Supported Sources:${c.reset}
  - Notion pages
  - Figma files
  - GitHub files/repos
  - Jira/Linear issues
  - Any URL (HTML extracted)
  - Local files

${c.bold}Configuration:${c.reset}
  Edit .workflow/links.yaml:

  docs:
    prd: ./docs/PRD.md
    api: https://api.example.com/docs
  design:
    figma: https://figma.com/file/...
        `);
      }
    }
  }

  main().catch(err => {
    console.error(`${c.red}Error: ${err.message}${c.reset}`);
    process.exit(1);
  });
}
