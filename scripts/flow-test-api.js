#!/usr/bin/env node

/**
 * Wogi Flow - API Test Runner
 *
 * Executes API tests using native fetch() with zero external dependencies.
 * Tests endpoints from api-map.md, generated test specs, and OpenAPI specs.
 *
 * Part of the Auto-Testing Suite (Story 3: API Testing Suite).
 *
 * Usage (CLI):
 *   node flow-test-api.js wf-XXXXXXXX
 *   node flow-test-api.js wf-XXXXXXXX --dry-run
 *
 * Usage (library):
 *   const { runAPITests, parseAPIMap, executeAPITest, validateResponseSchema } = require('./flow-test-api');
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { getProjectRoot, PATHS, ensureDir, safeJsonParse, safeJsonParseString } = require('./flow-utils');
const { getConfig } = require('./flow-config-loader');

const PROJECT_ROOT = getProjectRoot();

// ============================================================
// Constants
// ============================================================

const DEFAULT_BASE_URL = 'http://localhost:3000';
const SERVER_READY_TIMEOUT = 30000;
const SERVER_POLL_INTERVAL = 500;
const REQUEST_TIMEOUT = 10000;

// ============================================================
// API Map Parsing
// ============================================================

/**
 * Parse api-map.md for endpoint definitions.
 *
 * Expects markdown table format:
 *   | Method | Path | Description |
 *   |--------|------|-------------|
 *   | GET    | /api/users | List all users |
 *
 * @param {string} apiMapPath - Path to api-map.md
 * @returns {object[]} Array of {method, path, description, params}
 */
function parseAPIMap(apiMapPath) {
  if (!fs.existsSync(apiMapPath)) {
    return [];
  }

  let content;
  try {
    content = fs.readFileSync(apiMapPath, 'utf-8');
  } catch (err) {
    return [];
  }

  const endpoints = [];
  const lines = content.split('\n');

  // Find table rows (skip header and separator lines)
  let inTable = false;
  let headerSkipped = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect table start by looking for | Method |
    if (!inTable && /^\|\s*Method\s*\|/i.test(trimmed)) {
      inTable = true;
      continue;
    }

    // Skip separator line (|---|---|---|)
    if (inTable && !headerSkipped && /^\|[\s-:|]+\|$/.test(trimmed)) {
      headerSkipped = true;
      continue;
    }

    // Parse data rows
    if (inTable && headerSkipped) {
      // End of table
      if (!trimmed.startsWith('|')) {
        inTable = false;
        headerSkipped = false;
        continue;
      }

      const cells = trimmed.split('|').map(c => c.trim()).filter(c => c !== '');
      if (cells.length >= 2) {
        const method = cells[0].toUpperCase();
        const endpointPath = cells[1];
        const description = cells[2] || '';

        // Validate method
        if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method)) {
          // Extract path parameters (e.g., :id, {id})
          const params = [];
          const colonParams = endpointPath.match(/:(\w+)/g);
          const braceParams = endpointPath.match(/\{(\w+)\}/g);

          if (colonParams) {
            params.push(...colonParams.map(p => p.slice(1)));
          }
          if (braceParams) {
            params.push(...braceParams.map(p => p.slice(1, -1)));
          }

          endpoints.push({ method, path: endpointPath, description, params });
        }
      }
    }
  }

  return endpoints;
}

// ============================================================
// OpenAPI Spec Parsing (simplified — no external deps)
// ============================================================

/**
 * Parse OpenAPI/Swagger spec for schema validation.
 * Handles JSON specs directly; YAML is parsed with a minimal line-based parser.
 *
 * @param {string} specPath - Path to openapi.yaml/.yml or swagger.json/.yaml
 * @returns {object} Parsed spec with endpoint schemas: { endpoints: [{method, path, responses, requestBody}] }
 */
function parseOpenAPISpec(specPath) {
  if (!fs.existsSync(specPath)) {
    return { endpoints: [], raw: null };
  }

  let content;
  try {
    content = fs.readFileSync(specPath, 'utf-8');
  } catch (err) {
    return { endpoints: [], raw: null };
  }

  let spec;
  const ext = path.extname(specPath).toLowerCase();

  if (ext === '.json') {
    spec = safeJsonParseString(content, null);
    if (!spec) {
      return { endpoints: [], raw: null };
    }
  } else if (['.yaml', '.yml'].includes(ext)) {
    // Minimal YAML parsing — handles flat OpenAPI structures
    spec = parseSimpleYAML(content);
  } else {
    return { endpoints: [], raw: null };
  }

  if (!spec || !spec.paths) {
    return { endpoints: [], raw: spec };
  }

  const endpoints = [];

  for (const [endpointPath, methods] of Object.entries(spec.paths)) {
    if (typeof methods !== 'object' || methods === null) continue;

    for (const [method, details] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) {
        continue;
      }

      if (typeof details !== 'object' || details === null) continue;

      const endpoint = {
        method: method.toUpperCase(),
        path: endpointPath,
        summary: details.summary || '',
        responses: {},
        requestBody: null,
        parameters: details.parameters || []
      };

      // Extract response schemas
      if (details.responses) {
        for (const [statusCode, response] of Object.entries(details.responses)) {
          const schema = extractSchema(response);
          endpoint.responses[statusCode] = {
            description: response.description || '',
            schema
          };
        }
      }

      // Extract request body schema
      if (details.requestBody) {
        endpoint.requestBody = extractSchema(details.requestBody);
      }

      endpoints.push(endpoint);
    }
  }

  return { endpoints, raw: spec };
}

/**
 * Extract a JSON Schema from an OpenAPI response/requestBody object.
 * Handles both OpenAPI 3.x (content.application/json.schema) and Swagger 2.x (schema) formats.
 *
 * @param {object} obj - Response or requestBody object
 * @returns {object|null} JSON Schema or null
 */
function extractSchema(obj) {
  if (!obj || typeof obj !== 'object') return null;

  // OpenAPI 3.x: content -> application/json -> schema
  if (obj.content && obj.content['application/json'] && obj.content['application/json'].schema) {
    return obj.content['application/json'].schema;
  }

  // Swagger 2.x: direct schema property
  if (obj.schema) {
    return obj.schema;
  }

  return null;
}

/**
 * Minimal YAML parser for flat/shallow OpenAPI structures.
 * NOT a full YAML parser — handles the subset used in typical OpenAPI specs.
 *
 * @param {string} yamlContent - YAML string
 * @returns {object} Parsed object (best effort)
 */
function parseSimpleYAML(yamlContent) {
  // Try to detect JSON embedded in YAML (some specs are JSON with .yaml extension)
  const trimmed = yamlContent.trim();
  if (trimmed.startsWith('{')) {
    const parsed = safeJsonParseString(trimmed, null);
    if (parsed) return parsed;
    // Not JSON or failed safety check, continue with YAML parsing
  }

  const result = {};
  const lines = yamlContent.split('\n');
  const stack = [{ obj: result, indent: -1 }];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const rawLine = line.replace(/\r$/, '');

    // Skip comments and empty lines
    if (/^\s*#/.test(rawLine) || /^\s*$/.test(rawLine)) continue;

    // Skip document markers
    if (rawLine === '---' || rawLine === '...') continue;

    const indentMatch = rawLine.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1].length : 0;
    const content = rawLine.trim();

    // Pop stack to find parent
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].obj;

    // Key-value pair
    const kvMatch = content.match(/^([^:]+?):\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim().replace(/^['"]|['"]$/g, '');
      let value = kvMatch[2].trim();

      if (value === '' || value === '|' || value === '>') {
        // Block value or nested object — create nested object
        const nested = {};
        if (typeof parent === 'object' && !Array.isArray(parent)) {
          parent[key] = nested;
        }
        stack.push({ obj: nested, indent });
      } else {
        // Scalar value
        if (typeof parent === 'object' && !Array.isArray(parent)) {
          parent[key] = parseYAMLValue(value);
        }
      }
    }
  }

  return result;
}

/**
 * Parse a YAML scalar value into its JavaScript type.
 * @param {string} value
 * @returns {*}
 */
function parseYAMLValue(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;

  // Remove quotes
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  // Numbers
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);

  return value;
}

// ============================================================
// Response Schema Validation
// ============================================================

/**
 * Validate response body against expected schema (simplified JSON Schema subset).
 *
 * Supports: type checking, required fields, nested objects, arrays.
 * Does NOT support: $ref, allOf/anyOf/oneOf, pattern, format, etc.
 *
 * @param {object} body - Response body
 * @param {object} schema - Expected schema (simplified JSON Schema subset)
 * @returns {object} {valid: boolean, errors: Array<{path: string, error: string}>}
 */
function validateResponseSchema(body, schema) {
  const errors = [];
  validateNode(body, schema, '', errors);
  return { valid: errors.length === 0, errors };
}

/**
 * Recursively validate a value against a schema node.
 * @param {*} value
 * @param {object} schema
 * @param {string} currentPath
 * @param {Array} errors
 */
function validateNode(value, schema, currentPath, errors) {
  if (!schema || typeof schema !== 'object') return;

  // Type checking
  if (schema.type) {
    const actualType = getJSONType(value);
    if (schema.type !== actualType) {
      // Allow null for nullable fields
      if (!(value === null && schema.nullable)) {
        errors.push({ path: currentPath || '(root)', error: `expected ${schema.type}, got ${actualType}` });
        return; // Don't continue checking children if type is wrong
      }
    }
  }

  // Object validation
  if (schema.type === 'object' && schema.properties && typeof value === 'object' && value !== null) {
    // Check required fields
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!(key in value)) {
          errors.push({ path: joinPath(currentPath, key), error: 'missing required field' });
        }
      }
    }

    // Validate each known property
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in value) {
        validateNode(value[key], propSchema, joinPath(currentPath, key), errors);
      }
    }
  }

  // Array validation
  if (schema.type === 'array' && schema.items && Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      validateNode(value[i], schema.items, `${currentPath}[${i}]`, errors);
    }
  }
}

/**
 * Get the JSON Schema type name for a JavaScript value.
 * @param {*} value
 * @returns {string}
 */
function getJSONType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number';
  }
  return typeof value; // string, boolean, object, undefined
}

/**
 * Join path segments for error reporting.
 * @param {string} base
 * @param {string} key
 * @returns {string}
 */
function joinPath(base, key) {
  if (!base) return key;
  return `${base}.${key}`;
}

// ============================================================
// Error Test Generation
// ============================================================

/**
 * Generate error test cases for an endpoint based on its method and path.
 *
 * @param {object} endpoint - {method, path, params}
 * @param {object} [options] - {requiresAuth: boolean}
 * @returns {object[]} Error test cases: [{name, method, path, body, headers, expectedStatus}]
 */
function generateErrorTests(endpoint, options = {}) {
  const { requiresAuth = false } = options;
  const tests = [];
  const method = endpoint.method.toUpperCase();
  const hasIdParam = endpoint.params && endpoint.params.length > 0;

  // 404 for endpoints with path parameters
  if (hasIdParam) {
    const invalidPath = endpoint.path.replace(/:(\w+)/g, '99999999').replace(/\{(\w+)\}/g, '99999999');
    tests.push({
      name: `${method} ${endpoint.path} — 404 with invalid ID`,
      method,
      path: invalidPath,
      body: null,
      headers: {},
      expectedStatus: 404
    });
  }

  // 400/422 for write methods with invalid body
  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    tests.push({
      name: `${method} ${endpoint.path} — 400 with empty body`,
      method,
      path: endpoint.path.replace(/:(\w+)/g, '1').replace(/\{(\w+)\}/g, '1'),
      body: {},
      headers: { 'Content-Type': 'application/json' },
      expectedStatus: 400
    });

    tests.push({
      name: `${method} ${endpoint.path} — 422 with invalid data`,
      method,
      path: endpoint.path.replace(/:(\w+)/g, '1').replace(/\{(\w+)\}/g, '1'),
      body: { __invalid__: true },
      headers: { 'Content-Type': 'application/json' },
      expectedStatus: 422
    });
  }

  // 401 for auth-required endpoints
  if (requiresAuth) {
    tests.push({
      name: `${method} ${endpoint.path} — 401 without auth`,
      method,
      path: endpoint.path.replace(/:(\w+)/g, '1').replace(/\{(\w+)\}/g, '1'),
      body: null,
      headers: {},
      expectedStatus: 401,
      skipAuth: true
    });
  }

  return tests;
}

// ============================================================
// API Test Execution
// ============================================================

/**
 * Execute a single API test case.
 *
 * @param {object} testCase - {name, method, path, body, headers, expectedStatus, expectedSchema}
 * @param {string} baseUrl - API base URL (e.g., http://localhost:3000)
 * @param {object} [options] - {timeout, authHeaders}
 * @returns {Promise<object>} Result: {passed, name, method, path, expectedStatus, actualStatus, schemaValid, schemaErrors, duration, error}
 */
async function executeAPITest(testCase, baseUrl, options = {}) {
  const { timeout = REQUEST_TIMEOUT, authHeaders = {} } = options;
  const startTime = Date.now();

  const url = new URL(testCase.path, baseUrl).href;
  const headers = { ...authHeaders, ...testCase.headers };

  // Skip auth headers if test explicitly tests unauthenticated access
  if (testCase.skipAuth) {
    for (const key of Object.keys(authHeaders)) {
      delete headers[key];
    }
  }

  const fetchOptions = {
    method: testCase.method,
    headers,
    signal: AbortSignal.timeout(timeout)
  };

  if (testCase.body && ['POST', 'PUT', 'PATCH'].includes(testCase.method.toUpperCase())) {
    fetchOptions.body = JSON.stringify(testCase.body);
    if (!headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
  }

  try {
    const response = await fetch(url, fetchOptions);
    const duration = Date.now() - startTime;

    let body = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        body = await response.json();
      } catch (err) {
        body = null;
      }
    } else {
      try {
        body = await response.text();
      } catch (err) {
        body = null;
      }
    }

    const result = {
      passed: true,
      name: testCase.name,
      method: testCase.method,
      path: testCase.path,
      expectedStatus: testCase.expectedStatus,
      actualStatus: response.status,
      schemaValid: null,
      schemaErrors: [],
      body,
      duration,
      error: null
    };

    // Check status code
    if (testCase.expectedStatus && response.status !== testCase.expectedStatus) {
      result.passed = false;
      result.error = `Expected ${testCase.expectedStatus}, got ${response.status}`;
    }

    // Validate response schema if provided
    if (testCase.expectedSchema && body && typeof body === 'object') {
      const schemaResult = validateResponseSchema(body, testCase.expectedSchema);
      result.schemaValid = schemaResult.valid;
      result.schemaErrors = schemaResult.errors;
      if (!schemaResult.valid) {
        result.passed = false;
        if (!result.error) {
          result.error = `Schema validation failed: ${schemaResult.errors.map(e => `${e.path}: ${e.error}`).join(', ')}`;
        }
      }
    }

    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    return {
      passed: false,
      name: testCase.name,
      method: testCase.method,
      path: testCase.path,
      expectedStatus: testCase.expectedStatus,
      actualStatus: null,
      schemaValid: null,
      schemaErrors: [],
      body: null,
      duration,
      error: err.name === 'TimeoutError' ? `Request timed out after ${timeout}ms` : err.message
    };
  }
}

// ============================================================
// Server Management
// ============================================================

/**
 * Start API server and wait for it to be ready.
 *
 * @param {string} command - Shell command to start the server (e.g., "npm run dev")
 * @param {string} baseUrl - URL to poll for readiness
 * @param {number} [timeout=30000] - Max wait time in ms
 * @returns {Promise<{process: object, ready: boolean, error: string|null}>}
 */
async function startAPIServer(command, baseUrl, timeout = SERVER_READY_TIMEOUT) {
  const parts = command.split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);

  const serverProcess = spawn(cmd, args, {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    shell: true,
    env: { ...process.env, NODE_ENV: 'test' }
  });

  let serverOutput = '';
  let serverError = '';

  serverProcess.stdout.on('data', (data) => {
    serverOutput += data.toString();
  });

  serverProcess.stderr.on('data', (data) => {
    serverError += data.toString();
  });

  // Wait for process to fail or become ready
  const processExited = new Promise((resolve) => {
    serverProcess.on('error', (err) => {
      resolve({ exitError: err.message });
    });
    serverProcess.on('exit', (code) => {
      if (code !== null && code !== 0) {
        resolve({ exitError: `Server exited with code ${code}` });
      }
    });
  });

  // Poll for server readiness
  const startTime = Date.now();
  const healthUrl = new URL('/health', baseUrl).href;
  const rootUrl = baseUrl;

  while (Date.now() - startTime < timeout) {
    // Check if process already exited with error
    const exitResult = await Promise.race([
      processExited,
      new Promise(resolve => setTimeout(() => resolve(null), SERVER_POLL_INTERVAL))
    ]);

    if (exitResult && exitResult.exitError) {
      return {
        process: serverProcess,
        ready: false,
        error: `${exitResult.exitError}\nstdout: ${serverOutput.slice(-500)}\nstderr: ${serverError.slice(-500)}`
      };
    }

    // Try health endpoint first, then root
    for (const url of [healthUrl, rootUrl]) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(2000)
        });
        if (response.ok || response.status < 500) {
          return { process: serverProcess, ready: true, error: null };
        }
      } catch (err) {
        // Server not ready yet — continue polling
      }
    }
  }

  // Timeout — kill the server
  stopAPIServer(serverProcess);
  return {
    process: null,
    ready: false,
    error: `Server did not become ready within ${timeout}ms\nstdout: ${serverOutput.slice(-500)}\nstderr: ${serverError.slice(-500)}`
  };
}

/**
 * Stop API server process and its process group.
 *
 * @param {object} serverProcess - Child process returned by spawn
 */
function stopAPIServer(serverProcess) {
  if (!serverProcess || serverProcess.killed) return;

  try {
    // Kill process group (negative PID) to clean up all child processes
    if (serverProcess.pid) {
      try {
        process.kill(-serverProcess.pid, 'SIGTERM');
      } catch (err) {
        // Process group kill failed — try direct kill
        try {
          serverProcess.kill('SIGTERM');
        } catch (err2) {
          // Already dead
        }
      }

      // Force kill after 5 seconds if still alive
      setTimeout(() => {
        try {
          if (!serverProcess.killed) {
            process.kill(-serverProcess.pid, 'SIGKILL');
          }
        } catch (err) {
          // Already dead
        }
      }, 5000);
    }
  } catch (err) {
    // Process already terminated
  }
}

// ============================================================
// Test Data Setup/Teardown
// ============================================================

/**
 * Load test data setup/teardown configuration.
 * Looks for .workflow/tests/api-fixtures.json or config.testing.api.fixtures.
 *
 * @param {string} taskId
 * @returns {{ setup: object[], teardown: object[], fixtures: object }}
 */
function loadTestData(taskId) {
  const result = { setup: [], teardown: [], fixtures: {} };

  // Check for task-specific fixtures
  const taskFixturesPath = path.join(PROJECT_ROOT, '.workflow', 'tests', 'generated', taskId, 'api-fixtures.json');
  const taskFixtures = safeJsonParse(taskFixturesPath, null);
  if (taskFixtures) {
    if (taskFixtures.setup) result.setup = taskFixtures.setup;
    if (taskFixtures.teardown) result.teardown = taskFixtures.teardown;
    if (taskFixtures.fixtures) result.fixtures = taskFixtures.fixtures;
  }

  // Check for global fixtures
  const globalFixturesPath = path.join(PROJECT_ROOT, '.workflow', 'tests', 'api-fixtures.json');
  const globalFixtures = safeJsonParse(globalFixturesPath, null);
  if (globalFixtures) {
    // Merge — task-specific takes precedence
    if (globalFixtures.setup && result.setup.length === 0) result.setup = globalFixtures.setup;
    if (globalFixtures.teardown && result.teardown.length === 0) result.teardown = globalFixtures.teardown;
    if (globalFixtures.fixtures) result.fixtures = { ...globalFixtures.fixtures, ...result.fixtures };
  }

  return result;
}

/**
 * Execute setup or teardown requests against the API.
 *
 * @param {object[]} requests - Array of {method, path, body, headers}
 * @param {string} baseUrl
 * @returns {Promise<object[]>} Results
 */
async function executeFixtureRequests(requests, baseUrl) {
  const results = [];

  for (const req of requests) {
    try {
      const url = new URL(req.path, baseUrl).href;
      const fetchOptions = {
        method: req.method || 'POST',
        headers: { 'Content-Type': 'application/json', ...(req.headers || {}) },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT)
      };

      if (req.body) {
        fetchOptions.body = JSON.stringify(req.body);
      }

      const response = await fetch(url, fetchOptions);
      results.push({ path: req.path, status: response.status, ok: response.ok });
    } catch (err) {
      results.push({ path: req.path, status: null, ok: false, error: err.message });
    }
  }

  return results;
}

// ============================================================
// Test Building (from multiple sources)
// ============================================================

/**
 * Build test cases from api-map endpoints.
 *
 * @param {object[]} endpoints - Parsed api-map endpoints
 * @param {object} openAPISpec - Parsed OpenAPI spec (or {endpoints: []})
 * @param {object} [options] - {includeErrorTests: boolean, requiresAuth: boolean}
 * @returns {object[]} Test cases grouped by endpoint
 */
function buildTestCases(endpoints, openAPISpec, options = {}) {
  const { includeErrorTests = true, requiresAuth = false } = options;
  const specEndpoints = openAPISpec.endpoints || [];

  const testGroups = [];

  for (const endpoint of endpoints) {
    const group = {
      method: endpoint.method,
      path: endpoint.path,
      description: endpoint.description,
      tests: []
    };

    // Find matching spec endpoint for schema
    const specMatch = specEndpoints.find(
      se => se.method === endpoint.method && normalizePath(se.path) === normalizePath(endpoint.path)
    );

    // Happy path test
    const happyPath = {
      name: `${endpoint.method} ${endpoint.path} — 200 OK`,
      method: endpoint.method,
      path: endpoint.path.replace(/:(\w+)/g, '1').replace(/\{(\w+)\}/g, '1'),
      body: null,
      headers: {},
      expectedStatus: 200
    };

    // Add request body for write methods
    if (['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
      happyPath.headers['Content-Type'] = 'application/json';
      happyPath.expectedStatus = endpoint.method === 'POST' ? 201 : 200;
      happyPath.name = `${endpoint.method} ${endpoint.path} — ${happyPath.expectedStatus} success`;

      // Use request body schema from spec if available
      if (specMatch && specMatch.requestBody) {
        happyPath.body = generateSampleBody(specMatch.requestBody);
      } else {
        happyPath.body = {};
      }
    }

    // Add response schema from spec if available
    if (specMatch) {
      const successCode = String(happyPath.expectedStatus);
      const response = specMatch.responses[successCode] || specMatch.responses['200'] || specMatch.responses['201'];
      if (response && response.schema) {
        happyPath.expectedSchema = response.schema;
      }
    }

    group.tests.push(happyPath);

    // Error tests
    if (includeErrorTests) {
      const errorTests = generateErrorTests(endpoint, { requiresAuth });
      group.tests.push(...errorTests);
    }

    testGroups.push(group);
  }

  return testGroups;
}

/**
 * Normalize an endpoint path for comparison (handle :id vs {id} formats).
 * @param {string} p
 * @returns {string}
 */
function normalizePath(p) {
  return p.replace(/\{(\w+)\}/g, ':$1').toLowerCase();
}

/**
 * Generate a sample request body from a JSON Schema.
 * Produces minimal valid data based on required fields and types.
 *
 * @param {object} schema
 * @returns {object}
 */
function generateSampleBody(schema) {
  if (!schema || typeof schema !== 'object') return {};

  if (schema.type === 'object' && schema.properties) {
    const body = {};
    const fieldsToInclude = schema.required || Object.keys(schema.properties);

    for (const key of fieldsToInclude) {
      const prop = schema.properties[key];
      if (!prop) continue;

      switch (prop.type) {
        case 'string': body[key] = prop.example || `test-${key}`; break;
        case 'integer': body[key] = prop.example || 1; break;
        case 'number': body[key] = prop.example || 1.0; break;
        case 'boolean': body[key] = prop.example !== undefined ? prop.example : true; break;
        case 'array': body[key] = []; break;
        case 'object': body[key] = generateSampleBody(prop); break;
        default: body[key] = null;
      }
    }

    return body;
  }

  return {};
}

// ============================================================
// Report Generation
// ============================================================

/**
 * Generate and write the API test report.
 *
 * @param {string} taskId
 * @param {object[]} testGroups - Test groups with results
 * @param {object} schemaInfo - {specFile, endpointsChecked, schemaErrors}
 * @returns {object} Report object
 */
function generateReport(taskId, testGroups, schemaInfo) {
  let passed = 0;
  let failed = 0;

  const endpoints = testGroups.map(group => {
    const tests = group.tests.map(test => {
      if (test.result) {
        if (test.result.passed) passed++;
        else failed++;

        return {
          name: test.name,
          status: test.result.passed ? 'passed' : 'failed',
          expectedStatus: test.expectedStatus,
          actualStatus: test.result.actualStatus,
          schemaValid: test.result.schemaValid,
          duration: test.result.duration,
          error: test.result.error || undefined
        };
      }

      return {
        name: test.name,
        status: 'skipped',
        expectedStatus: test.expectedStatus
      };
    });

    return {
      method: group.method,
      path: group.path,
      tests
    };
  });

  return {
    taskId,
    type: 'api',
    timestamp: new Date().toISOString(),
    summary: { passed, failed, total: passed + failed },
    endpoints,
    schemaValidation: schemaInfo
  };
}

/**
 * Write the test report to the verifications directory.
 *
 * @param {string} taskId
 * @param {object} report
 * @returns {string} Path to the written report
 */
function writeReport(taskId, report) {
  const verificationsDir = path.join(PATHS.workflow, 'verifications');
  ensureDir(verificationsDir);

  const reportPath = path.join(verificationsDir, `${taskId}-api.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  return reportPath;
}

// ============================================================
// Main Runner
// ============================================================

/**
 * Run API tests for a specific task.
 *
 * Orchestrates: config loading, server start, test data setup, test execution,
 * teardown, server stop, and report generation.
 *
 * @param {string} taskId - Task ID (wf-XXXXXXXX)
 * @param {object} [options] - Override options
 * @param {string} [options.baseUrl] - Override base URL
 * @param {string} [options.startCommand] - Override server start command
 * @param {string} [options.specFile] - Override OpenAPI spec path
 * @param {boolean} [options.includeErrorTests] - Include error test generation (default true)
 * @param {boolean} [options.dryRun] - Don't execute tests, just build and return test plan
 * @returns {Promise<object>} Test report
 */
async function runAPITests(taskId, options = {}) {
  const config = getConfig();
  const testingConfig = config.testing || {};
  const apiConfig = testingConfig.api || {};

  // Resolve configuration (options override config)
  const baseUrl = options.baseUrl || apiConfig.baseUrl || DEFAULT_BASE_URL;
  const startCommand = options.startCommand || apiConfig.startCommand || null;
  const specFile = options.specFile || apiConfig.specFile || null;
  const includeErrorTests = options.includeErrorTests !== undefined ? options.includeErrorTests : true;
  const dryRun = options.dryRun || false;

  // 1. Load API endpoints from api-map.md
  const apiMapPath = path.join(PATHS.state, 'api-map.md');
  const endpoints = parseAPIMap(apiMapPath);

  // 2. Load OpenAPI spec if available
  let openAPISpec = { endpoints: [], raw: null };
  if (specFile) {
    const specPath = path.isAbsolute(specFile) ? specFile : path.join(PROJECT_ROOT, specFile);
    openAPISpec = parseOpenAPISpec(specPath);
  }

  // 3. Build test cases
  const testGroups = buildTestCases(endpoints, openAPISpec, {
    includeErrorTests,
    requiresAuth: !!apiConfig.authHeaders
  });

  // Add spec-only endpoints not in api-map
  if (openAPISpec.endpoints.length > 0) {
    for (const specEndpoint of openAPISpec.endpoints) {
      const alreadyIncluded = testGroups.some(
        g => g.method === specEndpoint.method && normalizePath(g.path) === normalizePath(specEndpoint.path)
      );

      if (!alreadyIncluded) {
        const fakeEndpoint = {
          method: specEndpoint.method,
          path: specEndpoint.path,
          description: specEndpoint.summary,
          params: (specEndpoint.path.match(/:(\w+)/g) || []).map(p => p.slice(1))
        };

        const group = buildTestCases([fakeEndpoint], openAPISpec, {
          includeErrorTests,
          requiresAuth: !!apiConfig.authHeaders
        });

        testGroups.push(...group);
      }
    }
  }

  const schemaInfo = {
    specFile: specFile || null,
    endpointsChecked: openAPISpec.endpoints.length,
    schemaErrors: []
  };

  // Dry run — return test plan without executing
  if (dryRun) {
    return {
      taskId,
      type: 'api',
      dryRun: true,
      timestamp: new Date().toISOString(),
      testPlan: testGroups.map(g => ({
        method: g.method,
        path: g.path,
        testCount: g.tests.length,
        tests: g.tests.map(t => ({ name: t.name, expectedStatus: t.expectedStatus }))
      })),
      totalTests: testGroups.reduce((sum, g) => sum + g.tests.length, 0),
      schemaValidation: schemaInfo
    };
  }

  // 4. Start API server if configured
  let serverProcess = null;

  if (startCommand) {
    const serverResult = await startAPIServer(startCommand, baseUrl);
    if (!serverResult.ready) {
      return {
        taskId,
        type: 'api',
        timestamp: new Date().toISOString(),
        summary: { passed: 0, failed: 0, total: 0 },
        endpoints: [],
        schemaValidation: schemaInfo,
        error: `Failed to start API server: ${serverResult.error}`
      };
    }
    serverProcess = serverResult.process;
  }

  try {
    // 5. Load and execute test data setup
    const testData = loadTestData(taskId);
    if (testData.setup.length > 0) {
      await executeFixtureRequests(testData.setup, baseUrl);
    }

    // 6. Execute tests
    const authHeaders = apiConfig.authHeaders || {};

    for (const group of testGroups) {
      for (const test of group.tests) {
        test.result = await executeAPITest(test, baseUrl, { authHeaders });
      }
    }

    // 7. Execute teardown
    if (testData.teardown.length > 0) {
      await executeFixtureRequests(testData.teardown, baseUrl);
    }

    // 8. Generate and write report
    const report = generateReport(taskId, testGroups, schemaInfo);
    const reportPath = writeReport(taskId, report);
    report.reportPath = reportPath;

    return report;
  } finally {
    // 9. Stop API server
    if (serverProcess) {
      stopAPIServer(serverProcess);
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
    console.log('Usage: flow-test-api.js <wf-XXXXXXXX> [--dry-run]');
    console.log('');
    console.log('  Runs API tests for a task using endpoints from api-map.md and OpenAPI spec.');
    console.log('');
    console.log('  Options:');
    console.log('    --dry-run  Show test plan without executing');
    process.exit(1);
  }

  // Check if testing is enabled
  const config = getConfig();
  const testingConfig = config.testing || {};

  if (!testingConfig.enabled) {
    console.log('Testing is disabled (config.testing.enabled = false). Skipping.');
    process.exit(0);
  }

  const mode = testingConfig.mode || 'auto';
  if (!['api', 'full', 'auto'].includes(mode)) {
    console.log(`Testing mode "${mode}" does not include API tests. Skipping.`);
    process.exit(0);
  }

  runAPITests(taskId, { dryRun })
    .then((report) => {
      if (report.dryRun) {
        console.log(`API Test Plan for ${taskId}:`);
        console.log(`  Total tests: ${report.totalTests}`);
        for (const group of report.testPlan) {
          console.log(`  ${group.method} ${group.path} (${group.testCount} tests)`);
          for (const test of group.tests) {
            console.log(`    - ${test.name}`);
          }
        }
      } else if (report.error) {
        console.error(`API tests failed: ${report.error}`);
        process.exit(1);
      } else {
        console.log(`API Test Results for ${taskId}:`);
        console.log(`  Passed: ${report.summary.passed}`);
        console.log(`  Failed: ${report.summary.failed}`);
        console.log(`  Total: ${report.summary.total}`);

        if (report.reportPath) {
          console.log(`  Report: ${report.reportPath}`);
        }

        for (const endpoint of report.endpoints) {
          const endpointPassed = endpoint.tests.every(t => t.status === 'passed');
          const marker = endpointPassed ? 'PASS' : 'FAIL';
          console.log(`  [${marker}] ${endpoint.method} ${endpoint.path}`);
          for (const test of endpoint.tests) {
            const testMarker = test.status === 'passed' ? 'OK' : 'FAIL';
            console.log(`    [${testMarker}] ${test.name} (${test.duration}ms)`);
            if (test.error) {
              console.log(`           ${test.error}`);
            }
          }
        }

        if (report.summary.failed > 0) {
          process.exit(1);
        }
      }
    })
    .catch((err) => {
      console.error(`API test runner error: ${err.message}`);
      process.exit(1);
    });
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  runAPITests,
  parseAPIMap,
  parseOpenAPISpec,
  executeAPITest,
  validateResponseSchema,
  generateErrorTests,
  startAPIServer,
  stopAPIServer,
  buildTestCases,
  generateSampleBody,
  loadTestData,
  executeFixtureRequests,
  generateReport,
  writeReport,
  normalizePath
};
