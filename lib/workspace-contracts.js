#!/usr/bin/env node

/**
 * Wogi Workspace — Integration Detection & Contract Management
 *
 * Story 2 (wf-b4f1fec0): Cross-references api-maps across repos, detects
 * orphans and type drift, auto-generates contracts, and tracks versions.
 *
 * Supports: OpenAPI, GraphQL, TypeScript type definitions, JSON Schema
 */

const fs = require('node:fs');
const path = require('node:path');
const { safeReadJson } = require('./utils');
const crypto = require('node:crypto');

// ============================================================
// Integration Map Generator (Criterion 1)
// ============================================================

/**
 * Build a full integration map from workspace manifest
 * Cross-references all provider endpoints with all consumer endpoints.
 *
 * @param {Object} manifest — workspace-manifest.json content
 * @returns {Object} integrationMap with matches, orphans, stats
 */
function buildIntegrationMap(manifest) {
  const map = {
    generatedAt: new Date().toISOString(),
    matched: [],
    orphanedConsumers: [],
    orphanedProviders: [],
    stats: { totalProvided: 0, totalConsumed: 0, matchRate: 0 }
  };

  if (!manifest?.members || typeof manifest.members !== 'object') {
    return map;
  }

  const providers = new Map(); // normalized endpoint → { raw, members[] }
  const consumers = new Map();

  for (const [name, member] of Object.entries(manifest.members)) {
    for (const ep of (member.provides || [])) {
      const norm = normalizeForMatching(ep);
      if (!providers.has(norm)) providers.set(norm, { raw: ep, members: [] });
      providers.get(norm).members.push(name);
    }
    for (const ep of (member.consumes || [])) {
      const norm = normalizeForMatching(ep);
      if (!consumers.has(norm)) consumers.set(norm, { raw: ep, members: [] });
      consumers.get(norm).members.push(name);
    }
  }

  map.stats.totalProvided = providers.size;
  map.stats.totalConsumed = consumers.size;

  // Match consumers to providers
  const matchedProviderKeys = new Set();

  for (const [normConsumer, consumerInfo] of consumers) {
    let bestMatch = null;
    let bestScore = 0;

    for (const [normProvider, providerInfo] of providers) {
      const score = matchScore(normConsumer, normProvider);
      if (score > bestScore && score >= 0.7) {
        bestScore = score;
        bestMatch = { norm: normProvider, info: providerInfo };
      }
    }

    if (bestMatch) {
      map.matched.push({
        endpoint: bestMatch.info.raw,
        normalizedEndpoint: bestMatch.norm,
        providers: bestMatch.info.members,
        consumers: consumerInfo.members,
        matchScore: bestScore
      });
      matchedProviderKeys.add(bestMatch.norm);
    } else {
      map.orphanedConsumers.push({
        endpoint: consumerInfo.raw,
        normalizedEndpoint: normConsumer,
        consumers: consumerInfo.members
      });
    }
  }

  // Find unmatched providers
  for (const [normProvider, providerInfo] of providers) {
    if (!matchedProviderKeys.has(normProvider)) {
      map.orphanedProviders.push({
        endpoint: providerInfo.raw,
        normalizedEndpoint: normProvider,
        providers: providerInfo.members
      });
    }
  }

  map.stats.matchRate = consumers.size > 0
    ? Math.round((map.matched.length / consumers.size) * 100)
    : 100;

  return map;
}

/**
 * Normalize an endpoint for fuzzy matching
 * "GET /api/v1/users/:id" → "GET /users/:param"
 */
function normalizeForMatching(ep) {
  const parts = ep.trim().split(/\s+/);
  const method = (parts[0] || 'GET').toUpperCase();
  let urlPath = parts.slice(1).join(' ');

  // Strip protocol + host
  urlPath = urlPath.replace(/^https?:\/\/[^/]+/, '');
  // Strip query params
  urlPath = urlPath.replace(/\?.*$/, '');
  // Normalize path params: :id, {id}, /123 → :param
  urlPath = urlPath.replace(/\/:\w+/g, '/:param');
  urlPath = urlPath.replace(/\/\{[^}]+\}/g, '/:param');
  urlPath = urlPath.replace(/\/\d+/g, '/:param');
  // Strip /api/v1, /api/v2, etc.
  urlPath = urlPath.replace(/\/api\/v\d+/, '/api');
  // Ensure leading slash
  if (!urlPath.startsWith('/')) urlPath = '/' + urlPath;
  // Remove trailing slash
  urlPath = urlPath.replace(/\/$/, '');

  return `${method} ${urlPath}`;
}

/**
 * Score how well two normalized endpoints match (0-1)
 */
function matchScore(norm1, norm2) {
  if (norm1 === norm2) return 1.0;

  const [method1, path1] = splitMethodPath(norm1);
  const [method2, path2] = splitMethodPath(norm2);

  // Method must match
  if (method1 !== method2) return 0;

  // Exact path match
  if (path1 === path2) return 1.0;

  // Segment-by-segment comparison
  const segs1 = path1.split('/').filter(Boolean);
  const segs2 = path2.split('/').filter(Boolean);

  if (segs1.length !== segs2.length) return 0.3;

  let matchedSegments = 0;
  for (let i = 0; i < segs1.length; i++) {
    if (segs1[i] === segs2[i]) matchedSegments++;
    else if (segs1[i] === ':param' || segs2[i] === ':param') matchedSegments += 0.8;
  }

  return matchedSegments / segs1.length;
}

function splitMethodPath(ep) {
  const parts = ep.split(' ');
  return [parts[0], parts.slice(1).join(' ')];
}

// ============================================================
// Orphan Detection (Criterion 2) — included in buildIntegrationMap
// ============================================================

// ============================================================
// Type Drift Detection (Criterion 3)
// ============================================================

/**
 * Detect type drift between repos — same entity name, different fields
 * @param {Object} manifest — workspace-manifest.json
 * @param {Object} memberMetadata — { memberName: metadata } from readMemberMetadata
 * @returns {Array} drift entries
 */
function detectTypeDrift(manifest, memberMetadata) {
  const drifts = [];
  const typesByName = new Map(); // typeName → [{ member, fields, file }]

  for (const [memberName, metadata] of Object.entries(memberMetadata)) {
    const schemaIndex = metadata.schemaIndex;
    if (!schemaIndex || !schemaIndex.models) continue;

    for (const model of schemaIndex.models) {
      const name = (model.name || '').toLowerCase();
      if (!name) continue;

      if (!typesByName.has(name)) typesByName.set(name, []);
      typesByName.get(name).push({
        member: memberName,
        name: model.name,
        fields: model.fields || model.columns || [],
        fieldCount: model.fieldCount ?? (model.fields || model.columns || []).length,
        file: model.file || model.source || 'unknown'
      });
    }
  }

  // Find types that appear in 2+ repos with different field counts
  for (const [typeName, entries] of typesByName) {
    if (entries.length < 2) continue;

    const fieldCounts = new Set(entries.map(e => e.fieldCount));
    if (fieldCounts.size > 1) {
      drifts.push({
        type: typeName,
        entries: entries.map(e => ({
          member: e.member,
          name: e.name,
          fieldCount: e.fieldCount,
          file: e.file
        })),
        severity: fieldCounts.size > 2 ? 'high' : 'medium'
      });
    }
  }

  return drifts;
}

// ============================================================
// Contract Auto-Generation (Criterion 4)
// ============================================================

/**
 * Auto-generate an OpenAPI contract from a provider's api-index
 * @param {string} memberName — provider repo name
 * @param {Object} apiIndex — api-index.json content
 * @param {Object} schemaIndex — schema-index.json content (optional)
 * @returns {Object} OpenAPI 3.0 spec
 */
function generateOpenApiContract(memberName, apiIndex, schemaIndex) {
  const spec = {
    openapi: '3.0.3',
    info: {
      title: `${memberName} API`,
      version: '1.0.0',
      description: `Auto-generated contract from ${memberName} api-map`
    },
    paths: {},
    components: {
      schemas: {}
    }
  };

  // Build paths from endpoints
  for (const ep of (apiIndex.endpoints || [])) {
    const routePath = (ep.route || ep.path || ep.endpoint || '').replace(/:(\w+)/g, '{$1}');
    const method = (ep.method || 'get').toLowerCase();

    if (!routePath) continue;
    if (!spec.paths[routePath]) spec.paths[routePath] = {};

    spec.paths[routePath][method] = {
      summary: ep.description || ep.handler || `${method.toUpperCase()} ${routePath}`,
      operationId: ep.handler || `${method}${routePath.replace(/[/{}-]/g, '_')}`,
      parameters: extractPathParams(routePath),
      responses: {
        '200': { description: 'Success' },
        '400': { description: 'Bad request' },
        '404': { description: 'Not found' },
        '500': { description: 'Server error' }
      }
    };

    // Add request body for POST/PUT/PATCH
    if (['post', 'put', 'patch'].includes(method)) {
      spec.paths[routePath][method].requestBody = {
        content: {
          'application/json': {
            schema: { type: 'object' }
          }
        }
      };
    }
  }

  // Build component schemas from models
  if (schemaIndex && schemaIndex.models) {
    for (const model of schemaIndex.models) {
      if (!model.name) continue;
      const schema = {
        type: 'object',
        properties: {}
      };

      const fields = model.fields || model.columns || [];
      for (const field of fields) {
        const fieldName = typeof field === 'string' ? field : (field.name || field.column);
        if (fieldName) {
          schema.properties[fieldName] = {
            type: typeof field === 'object' ? mapFieldType(field.type) : 'string'
          };
        }
      }

      spec.components.schemas[model.name] = schema;
    }
  }

  return spec;
}

/**
 * Extract path parameters from an OpenAPI path template
 */
function extractPathParams(routePath) {
  const params = [];
  const matches = routePath.matchAll(/\{(\w+)\}/g);
  for (const match of matches) {
    params.push({
      name: match[1],
      in: 'path',
      required: true,
      schema: { type: 'string' }
    });
  }
  return params;
}

/**
 * Map a database/language field type to OpenAPI type
 */
function mapFieldType(fieldType) {
  if (!fieldType) return 'string';
  const t = fieldType.toLowerCase();
  if (t.includes('int') || t.includes('number') || t.includes('float') || t.includes('decimal')) return 'number';
  if (t.includes('bool')) return 'boolean';
  if (t.includes('date') || t.includes('time')) return 'string';
  if (t.includes('json') || t.includes('object')) return 'object';
  if (t.includes('array') || t.includes('list')) return 'array';
  return 'string';
}

/**
 * Generate a TypeScript type definitions file from schemas
 * @param {Object} schemaIndex
 * @returns {string} TypeScript content
 */
function generateTypeScriptContract(schemaIndex) {
  const lines = ['// Auto-generated shared type definitions', '// Do not edit — regenerate with `flow workspace sync`', ''];

  if (!schemaIndex || !schemaIndex.models) return lines.join('\n');

  for (const model of schemaIndex.models) {
    if (!model.name) continue;
    lines.push(`export interface ${model.name} {`);

    const fields = model.fields || model.columns || [];
    for (const field of fields) {
      const name = typeof field === 'string' ? field : (field.name || field.column);
      const type = typeof field === 'object' ? mapToTsType(field.type) : 'string';
      const optional = typeof field === 'object' && field.nullable ? '?' : '';
      if (name) lines.push(`  ${name}${optional}: ${type};`);
    }

    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}

function mapToTsType(fieldType) {
  if (!fieldType) return 'string';
  const t = fieldType.toLowerCase();
  if (t.includes('int') || t.includes('float') || t.includes('decimal') || t.includes('number')) return 'number';
  if (t.includes('bool')) return 'boolean';
  if (t.includes('date') || t.includes('time')) return 'string';
  if (t.includes('json') || t.includes('object')) return 'Record<string, unknown>';
  if (t.includes('array') || t.includes('list')) return 'unknown[]';
  return 'string';
}

// ============================================================
// Contract Versioning (Criterion 5)
// ============================================================

/**
 * Compute a checksum for a contract file
 * @param {string} content
 * @returns {string} SHA-256 hash (first 12 chars)
 */
function contractChecksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
}

/**
 * Track contract versions
 * @param {string} workspaceRoot
 * @param {string} contractName — e.g., "api-v1"
 * @param {string} content — contract content
 * @param {string} changedBy — which repo triggered the change
 * @param {string} reason — why the contract changed
 * @returns {{ isNew: boolean, changed: boolean, version: Object }}
 */
function trackContractVersion(workspaceRoot, contractName, content, changedBy, reason) {
  const versionsPath = path.join(workspaceRoot, '.workspace', 'state', 'contract-versions.json');

  let versions = { contracts: {} };
  try {
    if (fs.existsSync(versionsPath)) {
      versions = safeReadJson(versionsPath);
    }
  } catch (_err) {
    versions = { contracts: {} };
  }

  const checksum = contractChecksum(content);
  const existing = versions.contracts[contractName];

  if (!existing) {
    // New contract
    versions.contracts[contractName] = {
      currentChecksum: checksum,
      history: [{
        checksum,
        changedBy,
        reason: reason || 'Initial generation',
        timestamp: new Date().toISOString()
      }]
    };
    fs.writeFileSync(versionsPath, JSON.stringify(versions, null, 2));
    return { isNew: true, changed: false, version: versions.contracts[contractName] };
  }

  if (existing.currentChecksum === checksum) {
    return { isNew: false, changed: false, version: existing };
  }

  // Contract changed
  existing.currentChecksum = checksum;
  if (!existing.history) existing.history = [];
  existing.history.unshift({
    checksum,
    changedBy,
    reason: reason || 'Updated',
    timestamp: new Date().toISOString()
  });

  // Keep last 50 versions
  if (existing.history.length > 50) {
    existing.history = existing.history.slice(0, 50);
  }

  fs.writeFileSync(versionsPath, JSON.stringify(versions, null, 2));
  return { isNew: false, changed: true, version: existing };
}

/**
 * Generate a contract changelog markdown
 * @param {string} workspaceRoot
 * @returns {string} changelog markdown
 */
function generateContractChangelog(workspaceRoot) {
  const versionsPath = path.join(workspaceRoot, '.workspace', 'state', 'contract-versions.json');
  if (!fs.existsSync(versionsPath)) return '# Contract Changelog\n\nNo contracts tracked yet.\n';

  let versions;
  try {
    versions = safeReadJson(versionsPath);
  } catch (_err) {
    return '# Contract Changelog\n\nError reading contract versions file.\n';
  }
  const lines = ['# Contract Changelog\n'];

  for (const [name, contract] of Object.entries(versions.contracts || {})) {
    lines.push(`## ${name}\n`);
    lines.push(`Current checksum: \`${contract.currentChecksum}\`\n`);

    for (const entry of (contract.history || []).slice(0, 20)) {
      lines.push(`- **${entry.timestamp}** by \`${entry.changedBy}\`: ${entry.reason} (\`${entry.checksum}\`)`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================
// Multi-Format Support (Criterion 6)
// ============================================================

/**
 * Detect contract format from file extension or content
 * @param {string} filePath
 * @returns {'openapi'|'graphql'|'typescript'|'jsonschema'|'unknown'}
 */
function detectContractFormat(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.yaml' || ext === '.yml') {
    // Could be OpenAPI or other YAML
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (content.includes('openapi:') || content.includes('swagger:')) return 'openapi';
    } catch (_err) {
      // Non-critical
    }
    return 'openapi'; // Default YAML = OpenAPI
  }

  if (ext === '.graphql' || ext === '.gql') return 'graphql';
  if (ext === '.ts' || ext === '.d.ts') return 'typescript';
  if (ext === '.json') {
    try {
      const content = safeReadJson(filePath);
      if (content.openapi || content.swagger) return 'openapi';
      if (content.$schema?.includes('json-schema')) return 'jsonschema';
      if (content.type || content.properties) return 'jsonschema';
    } catch (_err) {
      // Non-critical
    }
    return 'jsonschema';
  }

  return 'unknown';
}

/**
 * Write a contract in the specified format
 * @param {string} workspaceRoot
 * @param {string} contractName
 * @param {string} format — 'openapi'|'typescript'|'jsonschema'
 * @param {Object|string} content
 * @param {string} changedBy
 * @param {string} reason
 */
function writeContract(workspaceRoot, contractName, format, content, changedBy, reason) {
  if (contractName.includes('/') || contractName.includes('\\') || contractName.includes('..')) {
    throw new Error('Invalid contract name');
  }
  const contractsDir = path.join(workspaceRoot, '.workspace', 'contracts');
  fs.mkdirSync(contractsDir, { recursive: true });

  let filePath;
  let serialized;

  switch (format) {
    case 'openapi':
      filePath = path.join(contractsDir, `${contractName}.json`);
      serialized = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
      break;
    case 'typescript':
      filePath = path.join(contractsDir, `${contractName}.d.ts`);
      if (typeof content !== 'string') throw new Error('TypeScript contract content must be a pre-generated string. Use generateTypeScriptContract() first.');
      serialized = content;
      break;
    case 'jsonschema':
      filePath = path.join(contractsDir, `${contractName}.schema.json`);
      serialized = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
      break;
    default:
      filePath = path.join(contractsDir, `${contractName}.json`);
      serialized = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  }

  fs.writeFileSync(filePath, serialized);

  // Track version
  return trackContractVersion(workspaceRoot, contractName, serialized, changedBy, reason);
}

// ============================================================
// Schema/Type Sync Enforcement
// ============================================================

/**
 * Auto-generate shared TypeScript interfaces from all providers' schemas.
 * Writes to .workspace/contracts/shared-types.d.ts so consumers can import.
 *
 * @param {string} workspaceRoot
 * @param {Object} manifest — workspace manifest
 * @returns {{ typesGenerated: number, filePath: string }}
 */
function generateSharedTypes(workspaceRoot, manifest) {
  const contractsDir = path.join(workspaceRoot, '.workspace', 'contracts');
  fs.mkdirSync(contractsDir, { recursive: true });

  const lines = [
    '/**',
    ' * Auto-generated shared types from workspace providers.',
    ` * Generated: ${new Date().toISOString()}`,
    ' * DO NOT EDIT — regenerated by `flow workspace sync`',
    ' */',
    ''
  ];

  let typesGenerated = 0;
  const seenTypes = new Map(); // Track types across repos to detect conflicts

  // Strict identifier validation to prevent code injection via manifest data
  const VALID_TS_IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
  const VALID_REPO_NAME = /^[a-zA-Z0-9_-]+$/;

  for (const [name, member] of Object.entries(manifest.members || {})) {
    if (member.role !== 'provider' && member.role !== 'both' && member.role !== 'library') continue;

    const schemas = member.schemas || [];
    if (schemas.length === 0) continue;

    const safeName = VALID_REPO_NAME.test(name) ? name : 'unknown';
    const safeRole = VALID_REPO_NAME.test(member.role) ? member.role : 'unknown';
    lines.push(`// ── From ${safeName} (${safeRole}) ${'─'.repeat(Math.max(1, 50 - safeName.length))}`);
    lines.push('');

    for (const schema of schemas) {
      const typeName = schema.name || schema;
      const fields = schema.fields || [];

      // Validate type name is a safe TypeScript identifier
      if (!VALID_TS_IDENTIFIER.test(typeName)) {
        lines.push(`// SKIPPED: Invalid type name "${String(typeName).replace(/[^a-zA-Z0-9_$ ]/g, '')}"`);
        continue;
      }

      // Track for conflict detection
      if (seenTypes.has(typeName)) {
        const prevDef = VALID_REPO_NAME.test(seenTypes.get(typeName)) ? seenTypes.get(typeName) : 'unknown';
        lines.push(`// WARNING: Type "${typeName}" also defined by ${prevDef}`);
      }
      seenTypes.set(typeName, name);

      lines.push(`export interface ${typeName} {`);
      for (const field of fields) {
        const fieldName = field.name || field;
        // Validate field name is a safe identifier
        if (!VALID_TS_IDENTIFIER.test(fieldName)) continue;
        const fieldType = mapToTsType(field.type || 'string');
        const optional = field.nullable || field.optional ? '?' : '';
        lines.push(`  ${fieldName}${optional}: ${fieldType};`);
      }
      lines.push('}');
      lines.push('');
      typesGenerated++;
    }
  }

  if (typesGenerated === 0) {
    lines.push('// No provider schemas found in workspace manifest.');
    lines.push('// Run `flow workspace sync` after adding provider repos.');
  }

  const filePath = path.join(contractsDir, 'shared-types.d.ts');
  fs.writeFileSync(filePath, lines.join('\n'));

  // Track version
  const content = lines.join('\n');
  try {
    trackContractVersion(workspaceRoot, 'shared-types', content, 'workspace-sync', 'Auto-generated from provider schemas');
  } catch (_err) {
    // Non-critical
  }

  return { typesGenerated, filePath };
}

/**
 * Verify that consumer repos reference shared types correctly.
 * Checks if consumers have local type definitions that duplicate shared types.
 *
 * @param {string} workspaceRoot
 * @param {Object} manifest
 * @returns {Array<{ consumer: string, type: string, issue: string }>}
 */
function checkTypeSyncCompliance(workspaceRoot, manifest) {
  const issues = [];
  const sharedTypesPath = path.join(workspaceRoot, '.workspace', 'contracts', 'shared-types.d.ts');

  if (!fs.existsSync(sharedTypesPath)) return issues;

  // Extract type names from shared types
  const sharedContent = fs.readFileSync(sharedTypesPath, 'utf-8');
  const typeNames = [];
  const typeRegex = /export interface (\w+)/g;
  let match;
  while ((match = typeRegex.exec(sharedContent)) !== null) {
    typeNames.push(match[1]);
  }

  if (typeNames.length === 0) return issues;

  // Check each consumer's schema-map for duplicates
  const configPath = path.join(workspaceRoot, 'wogi-workspace.json');
  try {
    const config = safeReadJson(configPath);

    for (const [name, _memberConfig] of Object.entries(config.members || {})) {
      const member = manifest.members?.[name];
      if (!member || member.role === 'provider') continue; // Only check consumers

      const memberSchemas = (member.schemas || []).map(s => s.name || s);
      for (const typeName of typeNames) {
        if (memberSchemas.includes(typeName)) {
          issues.push({
            consumer: name,
            type: typeName,
            issue: `Consumer "${name}" defines "${typeName}" locally — should import from .workspace/contracts/shared-types.d.ts`
          });
        }
      }
    }
  } catch (_err) {
    // Non-critical
  }

  return issues;
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Integration map
  buildIntegrationMap,
  normalizeForMatching,
  matchScore,

  // Type drift
  detectTypeDrift,

  // Contract generation
  generateOpenApiContract,
  generateTypeScriptContract,

  // Contract versioning
  contractChecksum,
  trackContractVersion,
  generateContractChangelog,

  // Multi-format
  detectContractFormat,
  writeContract,

  // Schema/type sync
  generateSharedTypes,
  checkTypeSyncCompliance
};
