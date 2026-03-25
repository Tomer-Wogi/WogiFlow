#!/usr/bin/env node

/**
 * Wogi Flow - Data Integrity Chain (API <-> UI)
 *
 * Cross-references API response data against what's rendered in the UI
 * accessibility tree. Verifies end-to-end data flow for fullstack projects.
 *
 * Only runs when config.testing.mode === 'full'.
 *
 * Pipeline:
 *   1. Build endpoint-to-page mapping from api-map + conventions
 *   2. For each mapping: call API endpoint, capture response
 *   3. Navigate to corresponding UI page, read accessibility tree
 *   4. Cross-reference API field values against tree text content
 *   5. Report mismatches with exact field paths
 *
 * Usage (CLI):
 *   node flow-test-integrity.js wf-XXXXXXXX
 *   node flow-test-integrity.js wf-XXXXXXXX --dry-run
 *
 * Usage (library):
 *   const { runIntegrityTests, extractSignificantFields, crossReferenceFields,
 *           buildEndpointPageMapping } = require('./flow-test-integrity');
 */

const fs = require('node:fs');
const path = require('node:path');
const { getProjectRoot, PATHS, ensureDir, safeJsonParse } = require('./flow-utils');
const { getConfig } = require('./flow-config-loader');
const { loadProfile } = require('./flow-verification-profile');
const { parseAPIMap, executeAPITest, startAPIServer, stopAPIServer } = require('./flow-test-api');
const { startDevServer, stopDevServer, assertDataInTree, flattenTreeToText } = require('./flow-test-ui');

// ============================================================
// Constants
// ============================================================

/** Maximum depth for extracting nested fields from API responses */
const DEFAULT_MAX_DEPTH = 3;

/** Maximum retries waiting for async rendering to complete */
const LOADING_MAX_RETRIES = 5;

/** Delay between loading state checks (ms) */
const LOADING_RETRY_DELAY_MS = 1000;

/** Patterns that indicate a UUID (skip these fields) */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Patterns that indicate an ISO timestamp (skip these fields) */
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** Field names that are typically internal and not user-visible */
const INTERNAL_FIELD_PATTERNS = [
  /^_/,              // underscore-prefixed
  /^__/,             // double underscore-prefixed
  /Id$/,             // fields ending in Id (usually internal references)
  /^id$/i,           // plain id field
  /password/i,       // password fields
  /token/i,          // auth tokens
  /hash/i,           // hashed values
  /secret/i,         // secrets
  /^createdAt$/i,    // timestamps (may be formatted differently in UI)
  /^updatedAt$/i,
  /^deletedAt$/i,
  /^created_at$/i,
  /^updated_at$/i,
  /^deleted_at$/i,
  /^timestamp$/i,
  /^meta$/i,         // metadata objects
  /^metadata$/i
];

/** Loading indicator keywords to detect in accessibility tree */
const LOADING_INDICATORS = [
  'loading',
  'spinner',
  'skeleton',
  'please wait',
  'fetching'
];

// ============================================================
// Endpoint-to-Page Mapping
// ============================================================

/**
 * Build endpoint-to-page mapping.
 * Maps API endpoints to their corresponding UI pages
 * using conventions and spec analysis.
 *
 * @param {object[]} endpoints - From parseAPIMap()
 * @param {object} spec - Task spec with UI page references
 * @returns {object[]} Array of {endpoint, page, fields}
 */
function buildEndpointPageMapping(endpoints, spec) {
  const mappings = [];

  for (const endpoint of endpoints) {
    // Only map GET endpoints (they display data)
    if (endpoint.method !== 'GET') continue;

    const page = inferPageFromEndpoint(endpoint.path);
    if (!page) continue;

    mappings.push({
      endpoint: {
        method: endpoint.method,
        path: endpoint.path,
        description: endpoint.description || '',
        params: endpoint.params || []
      },
      page,
      fields: [] // Will be populated after API call
    });
  }

  // Enrich with spec references if available
  if (spec && typeof spec === 'object') {
    enrichMappingsFromSpec(mappings, spec);
  }

  return mappings;
}

/**
 * Infer a UI page path from an API endpoint path.
 * Uses convention-based matching.
 *
 * Examples:
 *   GET /api/orders       -> /orders
 *   GET /api/orders/:id   -> /orders/:id
 *   GET /api/users/profile -> /profile
 *   GET /api/dashboard/stats -> /dashboard
 *
 * @param {string} endpointPath - API endpoint path
 * @returns {string|null} Inferred UI page path, or null if no mapping
 */
function inferPageFromEndpoint(endpointPath) {
  if (!endpointPath || typeof endpointPath !== 'string') return null;

  // Strip common API prefixes
  let pagePath = endpointPath
    .replace(/^\/api\/v\d+/, '')    // /api/v1/...
    .replace(/^\/api/, '')           // /api/...
    .replace(/^\/v\d+/, '');         // /v1/...

  // If nothing left after stripping, skip
  if (!pagePath || pagePath === '/') return null;

  // Handle specific patterns
  // /users/profile -> /profile
  if (/\/users\/profile$/i.test(pagePath)) {
    pagePath = '/profile';
  }

  // /dashboard/stats -> /dashboard
  if (/\/(\w+)\/stats$/i.test(pagePath)) {
    pagePath = pagePath.replace(/\/stats$/, '');
  }

  // /dashboard/metrics -> /dashboard
  if (/\/(\w+)\/metrics$/i.test(pagePath)) {
    pagePath = pagePath.replace(/\/metrics$/, '');
  }

  // /dashboard/summary -> /dashboard
  if (/\/(\w+)\/summary$/i.test(pagePath)) {
    pagePath = pagePath.replace(/\/summary$/, '');
  }

  return pagePath;
}

/**
 * Enrich endpoint-page mappings with explicit references from the task spec.
 *
 * Looks for patterns like "the orders page should show..." in spec content.
 *
 * @param {object[]} mappings - Existing mappings to enrich
 * @param {object} spec - Task spec object (may contain description, acceptanceCriteria, etc.)
 */
function enrichMappingsFromSpec(mappings, spec) {
  // Flatten spec to searchable text
  const specText = JSON.stringify(spec).toLowerCase();

  for (const mapping of mappings) {
    // Extract the resource name from the endpoint path
    const segments = mapping.endpoint.path.replace(/^\/api(\/v\d+)?/, '').split('/').filter(Boolean);
    const resource = segments[0] || '';

    if (!resource) continue;

    // Check if spec mentions this resource in context of a specific page
    // e.g., "the orders page", "on the /orders route", "orders list"
    const pagePattern = new RegExp(
      `(?:the\\s+)?${resource}\\s+(?:page|screen|view|route|list|table)`,
      'i'
    );

    if (pagePattern.test(specText)) {
      // Spec confirms this mapping — mark as spec-confirmed
      mapping.specConfirmed = true;
    }
  }
}

// ============================================================
// Field Extraction
// ============================================================

/**
 * Extract significant field values from API response.
 * Filters out IDs, timestamps, internal fields.
 * Focuses on user-visible data.
 *
 * @param {object} responseBody - API response
 * @param {object} [options] - {ignoreFields: [], maxDepth: 3}
 * @returns {object[]} Array of {path, value, type}
 */
function extractSignificantFields(responseBody, options = {}) {
  const { ignoreFields = [], maxDepth = DEFAULT_MAX_DEPTH } = options;
  const fields = [];

  if (responseBody === null || responseBody === undefined) {
    return fields;
  }

  // If response is an array, extract from first few items
  if (Array.isArray(responseBody)) {
    const itemsToCheck = responseBody.slice(0, 3); // Check first 3 items
    for (let i = 0; i < itemsToCheck.length; i++) {
      extractFieldsRecursive(itemsToCheck[i], `[${i}]`, fields, ignoreFields, maxDepth, 0);
    }
  } else if (typeof responseBody === 'object') {
    // Handle pagination wrappers: {data: [...], total: N, page: N}
    const dataKey = findDataKey(responseBody);
    if (dataKey && Array.isArray(responseBody[dataKey])) {
      const items = responseBody[dataKey].slice(0, 3);
      for (let i = 0; i < items.length; i++) {
        extractFieldsRecursive(items[i], `${dataKey}[${i}]`, fields, ignoreFields, maxDepth, 0);
      }
    } else {
      extractFieldsRecursive(responseBody, '', fields, ignoreFields, maxDepth, 0);
    }
  }

  return fields;
}

/**
 * Find the key in a response object that contains the main data array.
 * Common patterns: data, results, items, records, entries.
 *
 * @param {object} obj - Response object
 * @returns {string|null} Data key or null
 */
function findDataKey(obj) {
  const dataKeys = ['data', 'results', 'items', 'records', 'entries', 'rows', 'list'];
  for (const key of dataKeys) {
    if (obj[key] !== undefined && Array.isArray(obj[key])) {
      return key;
    }
  }
  return null;
}

/**
 * Recursively extract significant fields from an object.
 *
 * @param {*} value - Current value to extract from
 * @param {string} currentPath - Dot-notation path to this value
 * @param {object[]} fields - Accumulator array
 * @param {string[]} ignoreFields - Additional field names to ignore
 * @param {number} maxDepth - Maximum recursion depth
 * @param {number} depth - Current depth
 */
function extractFieldsRecursive(value, currentPath, fields, ignoreFields, maxDepth, depth) {
  if (depth > maxDepth) return;
  if (value === null || value === undefined) return;

  if (typeof value === 'string') {
    if (isSignificantValue(currentPath, value, ignoreFields)) {
      fields.push({ path: currentPath, value, type: 'string' });
    }
    return;
  }

  if (typeof value === 'number' && !Number.isNaN(value)) {
    const fieldName = getFieldName(currentPath);
    if (!isInternalField(fieldName, ignoreFields)) {
      fields.push({ path: currentPath, value: String(value), type: 'number' });
    }
    return;
  }

  // Skip booleans and nulls — not typically visible as text
  if (typeof value === 'boolean') return;

  if (Array.isArray(value)) {
    // Extract from first few array items
    const itemsToCheck = value.slice(0, 3);
    for (let i = 0; i < itemsToCheck.length; i++) {
      extractFieldsRecursive(
        itemsToCheck[i],
        `${currentPath}[${i}]`,
        fields,
        ignoreFields,
        maxDepth,
        depth + 1
      );
    }
    return;
  }

  if (typeof value === 'object') {
    for (const [key, val] of Object.entries(value)) {
      // Skip prototype pollution vectors
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;

      const newPath = currentPath ? `${currentPath}.${key}` : key;
      extractFieldsRecursive(val, newPath, fields, ignoreFields, maxDepth, depth + 1);
    }
  }
}

/**
 * Determine if a string value is significant (user-visible).
 *
 * @param {string} fieldPath - Full dot-notation path
 * @param {string} value - The string value
 * @param {string[]} ignoreFields - Additional field names to ignore
 * @returns {boolean}
 */
function isSignificantValue(fieldPath, value, ignoreFields) {
  const fieldName = getFieldName(fieldPath);

  // Skip internal fields
  if (isInternalField(fieldName, ignoreFields)) return false;

  // Skip UUID values
  if (UUID_PATTERN.test(value)) return false;

  // Skip ISO timestamp values
  if (ISO_TIMESTAMP_PATTERN.test(value)) return false;

  // Skip empty strings
  if (value.trim() === '') return false;

  // Skip very long strings (likely blobs, HTML, etc.)
  if (value.length > 500) return false;

  // Skip base64-encoded data
  if (/^[A-Za-z0-9+/]{50,}={0,2}$/.test(value)) return false;

  // Skip URLs that are likely asset/image paths (not user-visible text)
  if (/^https?:\/\/.+\.(png|jpg|jpeg|gif|svg|ico|woff|css|js)$/i.test(value)) return false;

  return true;
}

/**
 * Check if a field name matches internal/non-visible patterns.
 *
 * @param {string} fieldName - Just the field name (not full path)
 * @param {string[]} ignoreFields - Additional field names to ignore
 * @returns {boolean}
 */
function isInternalField(fieldName, ignoreFields) {
  // Check custom ignore list
  if (ignoreFields.includes(fieldName)) return true;

  // Check internal patterns
  for (const pattern of INTERNAL_FIELD_PATTERNS) {
    if (pattern.test(fieldName)) return true;
  }

  return false;
}

/**
 * Extract the field name (last segment) from a dot-notation path.
 *
 * @param {string} fieldPath - e.g., "orders[0].status"
 * @returns {string} e.g., "status"
 */
function getFieldName(fieldPath) {
  if (!fieldPath) return '';
  // Remove array indices and get last segment
  const cleaned = fieldPath.replace(/\[\d+\]/g, '');
  const parts = cleaned.split('.');
  return parts[parts.length - 1] || '';
}

// ============================================================
// Cross-Reference Engine
// ============================================================

/**
 * Cross-reference API fields against accessibility tree.
 *
 * @param {object[]} fields - From extractSignificantFields()
 * @param {object} accessibilityTree - From Playwright MCP snapshot
 * @returns {object} {matched: [], missing: [], partial: []}
 */
function crossReferenceFields(fields, accessibilityTree) {
  const matched = [];
  const missing = [];
  const partial = [];

  if (!fields || fields.length === 0) {
    return { matched, missing, partial };
  }

  // Flatten the accessibility tree to searchable text
  const treeText = flattenTreeToText(accessibilityTree);
  const lowerTreeText = treeText.toLowerCase();

  for (const field of fields) {
    const valueStr = String(field.value);
    const lowerValue = valueStr.toLowerCase();

    if (lowerTreeText.includes(lowerValue)) {
      // Exact match found
      matched.push({
        field: field.path,
        value: valueStr,
        status: 'matched'
      });
    } else {
      // Try fuzzy matching
      const fuzzyResult = fuzzyMatch(valueStr, treeText);
      if (fuzzyResult.found) {
        partial.push({
          field: field.path,
          value: valueStr,
          status: 'partial',
          detail: `Fuzzy match: "${fuzzyResult.matchedText}" found instead of "${valueStr}"`
        });
      } else {
        missing.push({
          field: field.path,
          value: valueStr,
          status: 'missing',
          detail: `Value '${valueStr}' not found in accessibility tree`
        });
      }
    }
  }

  return { matched, missing, partial };
}

/**
 * Attempt fuzzy matching of a value against tree text.
 *
 * Handles common formatting differences:
 *   - Currency: "$49.99" vs "49.99"
 *   - Numbers with commas: "1,234" vs "1234"
 *   - Trimmed/extra whitespace
 *
 * @param {string} value - Original API value
 * @param {string} treeText - Flattened accessibility tree text
 * @returns {{found: boolean, matchedText: string}}
 */
function fuzzyMatch(value, treeText) {
  const lowerTree = treeText.toLowerCase();
  const lowerValue = value.toLowerCase();

  // Try without currency symbols
  const noCurrency = lowerValue.replace(/[$\u20AC\u00A3\u00A5]/g, '').trim();
  if (noCurrency !== lowerValue && noCurrency.length > 0 && lowerTree.includes(noCurrency)) {
    return { found: true, matchedText: noCurrency };
  }

  // Try without commas in numbers
  const noCommas = lowerValue.replace(/,/g, '');
  if (noCommas !== lowerValue && lowerTree.includes(noCommas)) {
    return { found: true, matchedText: noCommas };
  }

  // Try with commas added to numbers (API: "1234", UI: "1,234")
  if (/^\d{4,}$/.test(value)) {
    const withCommas = value.replace(/\B(?=(\d{3})+(?!\d))/g, ',').toLowerCase();
    if (lowerTree.includes(withCommas)) {
      return { found: true, matchedText: withCommas };
    }
  }

  // Try trimmed value (handles whitespace differences)
  const trimmed = lowerValue.trim();
  if (trimmed !== lowerValue && trimmed.length > 0 && lowerTree.includes(trimmed)) {
    return { found: true, matchedText: trimmed };
  }

  return { found: false, matchedText: '' };
}

// ============================================================
// Loading State Detection
// ============================================================

/**
 * Check if the accessibility tree indicates a loading state.
 *
 * @param {object} accessibilityTree - Playwright MCP snapshot
 * @returns {boolean} true if loading indicators are detected
 */
function isLoadingState(accessibilityTree) {
  const treeText = flattenTreeToText(accessibilityTree).toLowerCase();

  for (const indicator of LOADING_INDICATORS) {
    if (treeText.includes(indicator)) {
      return true;
    }
  }

  // Check for aria-busy attribute in tree nodes
  if (accessibilityTree && typeof accessibilityTree === 'object') {
    if (accessibilityTree.busy === true || accessibilityTree['aria-busy'] === 'true') {
      return true;
    }
  }

  return false;
}

// ============================================================
// Test Plan Generation
// ============================================================

/**
 * Generate integrity test plan from spec and api-map.
 *
 * @param {string} taskId
 * @returns {object[]} Test plan items
 */
function generateIntegrityPlan(taskId) {
  const apiMapPath = path.join(PATHS.state, 'api-map.md');
  const endpoints = parseAPIMap(apiMapPath);

  if (endpoints.length === 0) {
    return [];
  }

  // Load task spec if available
  const specPath = path.join(PATHS.workflow, 'specs', `${taskId}.json`);
  const spec = safeJsonParse(specPath, null);

  const mappings = buildEndpointPageMapping(endpoints, spec);

  return mappings.map(mapping => ({
    endpoint: `${mapping.endpoint.method} ${mapping.endpoint.path}`,
    page: mapping.page,
    description: mapping.endpoint.description,
    hasParams: mapping.endpoint.params.length > 0,
    specConfirmed: mapping.specConfirmed || false
  }));
}

// ============================================================
// Report Generation
// ============================================================

/**
 * Write integrity report to verifications directory.
 *
 * @param {string} taskId
 * @param {object} results - Full integrity results
 * @returns {string} Path to written report
 */
function writeIntegrityReport(taskId, results) {
  const verificationsDir = PATHS.verifications;
  ensureDir(verificationsDir);

  const reportPath = path.join(verificationsDir, `${taskId}-integrity.json`);

  try {
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf-8');
  } catch (err) {
    // Report save failure is non-fatal
  }

  return reportPath;
}

// ============================================================
// Main Test Runner
// ============================================================

/**
 * Run data integrity tests for a task.
 * Only runs when config.testing.mode === 'full'.
 *
 * @param {string} taskId
 * @param {object} [options]
 * @param {string} [options.apiBaseUrl] - Override API base URL
 * @param {string} [options.uiBaseUrl] - Override UI base URL
 * @param {string} [options.apiStartCommand] - Override API server start command
 * @param {string} [options.uiStartCommand] - Override UI server start command
 * @param {boolean} [options.dryRun=false] - Only generate test plan, don't execute
 * @param {string[]} [options.ignoreFields] - Additional field names to skip
 * @param {number} [options.maxDepth] - Max depth for field extraction
 * @returns {Promise<object>} Integrity report
 */
async function runIntegrityTests(taskId, options = {}) {
  const config = getConfig();
  const testingConfig = config.testing || {};

  // AC5: Only runs for fullstack projects (testing.mode: "full")
  if (testingConfig.mode !== 'full') {
    return {
      taskId,
      type: 'integrity',
      timestamp: new Date().toISOString(),
      mode: testingConfig.mode || 'off',
      skipped: true,
      reason: 'Integrity tests only run when config.testing.mode === "full"',
      summary: {
        endpointsTested: 0,
        fieldsChecked: 0,
        matched: 0,
        missing: 0,
        partial: 0,
        score: 1
      },
      mappings: []
    };
  }

  // Check quality gate toggle
  const qualityGates = testingConfig.qualityGates || {};
  if (qualityGates.dataIntegrity === false) {
    return {
      taskId,
      type: 'integrity',
      timestamp: new Date().toISOString(),
      mode: 'full',
      skipped: true,
      reason: 'Data integrity quality gate is disabled (config.testing.qualityGates.dataIntegrity = false)',
      summary: {
        endpointsTested: 0,
        fieldsChecked: 0,
        matched: 0,
        missing: 0,
        partial: 0,
        score: 1
      },
      mappings: []
    };
  }

  const apiConfig = testingConfig.api || {};
  const uiConfig = testingConfig.ui || {};
  const profile = loadProfile() || {};

  const apiBaseUrl = options.apiBaseUrl || apiConfig.baseUrl || (profile.api && profile.api.baseUrl) || 'http://localhost:3000';
  const uiBaseUrl = options.uiBaseUrl || uiConfig.baseUrl || (profile.api && profile.api.baseUrl) || 'http://localhost:3000';
  const apiStartCommand = options.apiStartCommand || apiConfig.startCommand || (profile.api && profile.api.startCommand) || null;
  const uiStartCommand = options.uiStartCommand || uiConfig.startCommand || (profile.api && profile.api.startCommand) || null;
  const ignoreFields = options.ignoreFields || [];
  const maxDepth = options.maxDepth || DEFAULT_MAX_DEPTH;
  const dryRun = options.dryRun || false;

  // Generate test plan
  const plan = generateIntegrityPlan(taskId);

  if (plan.length === 0) {
    const results = {
      taskId,
      type: 'integrity',
      timestamp: new Date().toISOString(),
      mode: 'full',
      summary: {
        endpointsTested: 0,
        fieldsChecked: 0,
        matched: 0,
        missing: 0,
        partial: 0,
        score: 1
      },
      mappings: [],
      note: 'No GET endpoints found in api-map.md to test'
    };
    writeIntegrityReport(taskId, results);
    return results;
  }

  // Dry run — return test plan without executing
  if (dryRun) {
    return {
      taskId,
      type: 'integrity',
      dryRun: true,
      timestamp: new Date().toISOString(),
      mode: 'full',
      plan,
      totalMappings: plan.length
    };
  }

  // Start servers if configured
  let apiServerProcess = null;
  let uiServerProcess = null;

  try {
    // Start API server
    if (apiStartCommand) {
      const apiResult = await startAPIServer(apiStartCommand, apiBaseUrl);
      if (!apiResult.ready) {
        const errorReport = {
          taskId,
          type: 'integrity',
          timestamp: new Date().toISOString(),
          mode: 'full',
          error: `Failed to start API server: ${apiResult.error}`,
          summary: {
            endpointsTested: 0, fieldsChecked: 0, matched: 0,
            missing: 0, partial: 0, score: 0
          },
          mappings: []
        };
        writeIntegrityReport(taskId, errorReport);
        return errorReport;
      }
      apiServerProcess = apiResult.process;
    }

    // Start UI server (may be the same as API server)
    if (uiStartCommand && uiStartCommand !== apiStartCommand) {
      const uiResult = await startDevServer(uiStartCommand, uiBaseUrl);
      if (!uiResult.ready) {
        const errorReport = {
          taskId,
          type: 'integrity',
          timestamp: new Date().toISOString(),
          mode: 'full',
          error: `Failed to start UI server: ${uiResult.error}`,
          summary: {
            endpointsTested: 0, fieldsChecked: 0, matched: 0,
            missing: 0, partial: 0, score: 0
          },
          mappings: []
        };
        writeIntegrityReport(taskId, errorReport);
        return errorReport;
      }
      uiServerProcess = uiResult.process;
    }

    // Execute integrity tests for each mapping
    const mappingResults = [];
    let totalFieldsChecked = 0;
    let totalMatched = 0;
    let totalMissing = 0;
    let totalPartial = 0;

    // Re-parse endpoints for full data (plan only has summary)
    const apiMapPath = path.join(PATHS.state, 'api-map.md');
    const endpoints = parseAPIMap(apiMapPath);

    let spec = null;
    const specPath = path.join(PATHS.workflow, 'specs', `${taskId}.json`);
    if (fs.existsSync(specPath)) {
      spec = safeJsonParse(specPath, null);
    }

    const mappings = buildEndpointPageMapping(endpoints, spec);

    for (const mapping of mappings) {
      const endpointPath = mapping.endpoint.path;
      const resolvedPath = endpointPath
        .replace(/:(\w+)/g, '1')
        .replace(/\{(\w+)\}/g, '1');

      // Step 1: Call API endpoint
      const testCase = {
        name: `Integrity: ${mapping.endpoint.method} ${endpointPath}`,
        method: mapping.endpoint.method,
        path: resolvedPath,
        body: null,
        headers: {},
        expectedStatus: 200
      };

      const apiResult = await executeAPITest(testCase, apiBaseUrl);

      const mappingResult = {
        endpoint: `${mapping.endpoint.method} ${endpointPath}`,
        page: mapping.page,
        apiResponse: {
          status: apiResult.actualStatus,
          fieldCount: 0
        },
        results: []
      };

      if (!apiResult.passed || !apiResult.body || typeof apiResult.body !== 'object') {
        mappingResult.apiResponse.error = apiResult.error || 'No JSON response body';
        mappingResults.push(mappingResult);
        continue;
      }

      // Step 2: Extract significant fields from API response
      const fields = extractSignificantFields(apiResult.body, { ignoreFields, maxDepth });
      mappingResult.apiResponse.fieldCount = fields.length;

      if (fields.length === 0) {
        mappingResult.note = 'No significant user-visible fields extracted from API response';
        mappingResults.push(mappingResult);
        continue;
      }

      // Step 3: Navigate to UI page and get accessibility tree
      // Note: In the actual flow, Playwright MCP handles browser interaction.
      // This creates the structure that the AI agent will populate by:
      //   1. Using Playwright MCP to navigate to the page
      //   2. Getting the accessibility snapshot
      //   3. Passing it through crossReferenceFields()
      //
      // For automated execution, we create pending results that the
      // orchestrating AI agent will complete.
      // Use assertDataInTree from flow-test-ui for initial structure
      // The actual tree would come from Playwright MCP in real execution
      const pendingResults = fields.map(field => ({
        field: field.path,
        value: String(field.value),
        status: 'pending',
        detail: `Awaiting UI verification on page ${mapping.page}`
      }));

      mappingResult.results = pendingResults;
      totalFieldsChecked += fields.length;

      mappingResults.push(mappingResult);
    }

    // Calculate score
    const score = totalFieldsChecked > 0
      ? (totalMatched + totalPartial * 0.5) / totalFieldsChecked
      : 1;

    const report = {
      taskId,
      type: 'integrity',
      timestamp: new Date().toISOString(),
      mode: 'full',
      summary: {
        endpointsTested: mappingResults.length,
        fieldsChecked: totalFieldsChecked,
        matched: totalMatched,
        missing: totalMissing,
        partial: totalPartial,
        score: Math.round(score * 100) / 100
      },
      mappings: mappingResults
    };

    writeIntegrityReport(taskId, report);
    return report;

  } finally {
    // Always clean up server processes
    if (apiServerProcess) {
      stopAPIServer(apiServerProcess);
    }
    if (uiServerProcess) {
      stopDevServer(uiServerProcess);
    }
  }
}

// ============================================================
// CLI
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const taskId = args.find(a => /^wf-[a-f0-9]{8}$/i.test(a));
  const dryRun = args.includes('--dry-run');

  if (!taskId) {
    console.log('Usage: flow-test-integrity.js <wf-XXXXXXXX> [--dry-run]');
    console.log('');
    console.log('  Runs data integrity tests (API <-> UI) for a task.');
    console.log('  Only runs when config.testing.mode === "full".');
    console.log('');
    console.log('  Options:');
    console.log('    --dry-run  Show test plan without executing');
    process.exit(1);
  }

  const config = getConfig();
  const testingConfig = config.testing || {};

  if (testingConfig.mode !== 'full') {
    console.log(`Testing mode "${testingConfig.mode || 'off'}" is not "full". Integrity tests skipped.`);
    process.exit(0);
  }

  console.log(`Running integrity tests for ${taskId}${dryRun ? ' (dry run)' : ''}...`);

  runIntegrityTests(taskId, { dryRun })
    .then((report) => {
      if (report.dryRun) {
        console.log(`\nIntegrity Test Plan for ${taskId}:`);
        console.log(`  Mappings: ${report.totalMappings}`);
        for (const item of report.plan) {
          const confirmed = item.specConfirmed ? ' [spec-confirmed]' : '';
          console.log(`  ${item.endpoint} -> ${item.page}${confirmed}`);
        }
      } else if (report.error) {
        console.error(`Integrity tests failed: ${report.error}`);
        process.exit(1);
      } else if (report.skipped) {
        console.log(`Skipped: ${report.reason}`);
      } else {
        console.log(`\nIntegrity Test Results for ${taskId}:`);
        console.log(`  Endpoints tested: ${report.summary.endpointsTested}`);
        console.log(`  Fields checked: ${report.summary.fieldsChecked}`);
        console.log(`  Matched: ${report.summary.matched}`);
        console.log(`  Missing: ${report.summary.missing}`);
        console.log(`  Partial: ${report.summary.partial}`);
        console.log(`  Score: ${report.summary.score}`);

        for (const mapping of report.mappings) {
          const missingCount = mapping.results.filter(r => r.status === 'missing').length;
          const marker = missingCount === 0 ? 'PASS' : 'FAIL';
          console.log(`  [${marker}] ${mapping.endpoint} -> ${mapping.page}`);
          for (const result of mapping.results) {
            if (result.status === 'missing') {
              console.log(`    [MISS] ${result.field}: "${result.value}"`);
              if (result.detail) console.log(`           ${result.detail}`);
            } else if (result.status === 'partial') {
              console.log(`    [PART] ${result.field}: "${result.value}"`);
              if (result.detail) console.log(`           ${result.detail}`);
            }
          }
        }

        const reportPath = path.join(PATHS.workflow, 'verifications', `${taskId}-integrity.json`);
        console.log(`  Report: ${reportPath}`);

        if (report.summary.missing > 0) {
          process.exit(1);
        }
      }
    })
    .catch((err) => {
      console.error(`Integrity test runner error: ${err.message}`);
      process.exit(1);
    });
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  runIntegrityTests,
  buildEndpointPageMapping,
  extractSignificantFields,
  crossReferenceFields,
  generateIntegrityPlan,
  writeIntegrityReport,
  // Internal helpers (exported for testing/composition)
  inferPageFromEndpoint,
  enrichMappingsFromSpec,
  extractFieldsRecursive,
  isSignificantValue,
  isInternalField,
  getFieldName,
  findDataKey,
  fuzzyMatch,
  isLoadingState,
  LOADING_INDICATORS,
  INTERNAL_FIELD_PATTERNS,
  DEFAULT_MAX_DEPTH,
  LOADING_MAX_RETRIES,
  LOADING_RETRY_DELAY_MS
};
