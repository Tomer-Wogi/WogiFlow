#!/usr/bin/env node

/**
 * Wogi Flow - Scenario Engine
 *
 * Executes declarative verification scenarios — stateful multi-step test flows
 * that run as one atomic operation with zero AI in the loop during execution.
 *
 * Replaces sequential curl-like endpoint testing with a declarative JSON format
 * that handles prerequisites, variable propagation, assertions, and teardown.
 *
 * Usage (CLI):
 *   node flow-scenario-engine.js <scenario.json> [--dry-run] [--verbose]
 *
 * Usage (library):
 *   const { executeScenario, generateScenario, resolveVariables, extractByPath } = require('./flow-scenario-engine');
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { getProjectRoot, safeJsonParseString, PATHS } = require('./flow-utils');

let verificationProfile;
try {
  verificationProfile = require('./flow-verification-profile');
} catch (err) {
  verificationProfile = null;
}

// ============================================================
// Constants
// ============================================================

const DEFAULT_REQUEST_TIMEOUT = 30000;
const DEFAULT_SCENARIO_TIMEOUT = 120000;
const DEFAULT_BASE_URL = 'http://localhost:3000';

// ============================================================
// Variable Resolution
// ============================================================

/**
 * Generate a UUID v4. Uses crypto.randomUUID() if available, falls back to manual.
 * @returns {string}
 */
function generateUUID() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older Node.js
  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Generate a random hex string.
 * @param {number} [length=8]
 * @returns {string}
 */
function randomHex(length = 8) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

/**
 * Resolve all template variables in a value.
 * Handles: {{varName}}, {{$uuid}}, {{$timestamp}}, {{$random}}
 *
 * Variables can appear in strings, objects (recursively), and arrays.
 *
 * @param {*} value - The value to resolve (string, object, array, or primitive)
 * @param {object} context - Variable context (key-value pairs from saved step results)
 * @returns {*} The resolved value
 */
function resolveVariables(value, context) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return value.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
      const trimmed = varName.trim();

      // Built-in variables
      if (trimmed === '$uuid') return generateUUID();
      if (trimmed === '$timestamp') return new Date().toISOString();
      if (trimmed === '$random') return randomHex(8);

      // Context variables
      if (Object.hasOwn(context, trimmed)) {
        return String(context[trimmed]);
      }

      // Unresolved — leave as-is
      return match;
    });
  }

  if (Array.isArray(value)) {
    return value.map(item => resolveVariables(item, context));
  }

  if (typeof value === 'object') {
    const resolved = {};
    for (const key of Object.keys(value)) {
      // Block prototype pollution
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }
      resolved[key] = resolveVariables(value[key], context);
    }
    return resolved;
  }

  // Primitive (number, boolean) — return as-is
  return value;
}

// ============================================================
// JSONPath Extraction
// ============================================================

/**
 * Extract a value from a response body using JSONPath-like syntax.
 * Supports: $.field, $.nested.field, $.array[0].field
 *
 * @param {object} obj - The object to extract from
 * @param {string} jsonPath - The path expression (e.g., "$.title", "$.data[0].id")
 * @returns {*} The extracted value, or undefined if path doesn't resolve
 */
function extractByPath(obj, jsonPath) {
  if (!obj || typeof obj !== 'object' || !jsonPath) {
    return undefined;
  }

  // Remove leading $. if present
  let pathStr = jsonPath;
  if (pathStr.startsWith('$.')) {
    pathStr = pathStr.slice(2);
  } else if (pathStr === '$') {
    return obj;
  }

  // Split on . and [] — handle array indices
  // e.g., "data[0].name" => ["data", "0", "name"]
  const segments = [];
  let current = '';

  for (let i = 0; i < pathStr.length; i++) {
    const ch = pathStr[i];

    if (ch === '.') {
      if (current) segments.push(current);
      current = '';
    } else if (ch === '[') {
      if (current) segments.push(current);
      current = '';
    } else if (ch === ']') {
      if (current) segments.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) segments.push(current);

  // Traverse
  let result = obj;
  for (const segment of segments) {
    if (result === null || result === undefined) {
      return undefined;
    }

    // Array index
    if (/^\d+$/.test(segment)) {
      const index = parseInt(segment, 10);
      if (Array.isArray(result)) {
        result = result[index];
      } else if (typeof result === 'object') {
        result = result[segment];
      } else {
        return undefined;
      }
    } else {
      if (typeof result !== 'object') {
        return undefined;
      }
      result = result[segment];
    }
  }

  return result;
}

// ============================================================
// HTTP Request Execution
// ============================================================

/**
 * Execute a single HTTP step (prerequisite, action, or teardown).
 *
 * @param {object} step - Step definition {method, path, headers, body, expectedStatus}
 * @param {string} baseUrl - Base URL for the API
 * @param {object} context - Variable context
 * @param {object} [options] - {timeout}
 * @returns {Promise<object>} Step result
 */
async function executeStep(step, baseUrl, context, options = {}) {
  const { timeout = DEFAULT_REQUEST_TIMEOUT } = options;
  const startTime = Date.now();

  // Resolve variables in path, headers, body
  const resolvedPath = resolveVariables(step.path, context);
  const resolvedHeaders = resolveVariables(step.headers || {}, context);
  const resolvedBody = step.body ? resolveVariables(step.body, context) : null;

  const url = new URL(resolvedPath, baseUrl).href;

  const fetchOptions = {
    method: (step.method || 'GET').toUpperCase(),
    headers: resolvedHeaders,
    signal: AbortSignal.timeout(timeout)
  };

  if (resolvedBody && ['POST', 'PUT', 'PATCH'].includes(fetchOptions.method)) {
    fetchOptions.body = JSON.stringify(resolvedBody);
    if (!resolvedHeaders['Content-Type'] && !resolvedHeaders['content-type']) {
      fetchOptions.headers['Content-Type'] = 'application/json';
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

    return {
      step: step.step || 'unnamed',
      passed: true,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
      duration,
      request: {
        method: fetchOptions.method,
        url,
        headers: resolvedHeaders,
        body: resolvedBody
      },
      error: null
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    return {
      step: step.step || 'unnamed',
      passed: false,
      status: null,
      headers: {},
      body: null,
      duration,
      request: {
        method: fetchOptions.method,
        url,
        headers: resolvedHeaders,
        body: resolvedBody
      },
      error: err.name === 'TimeoutError' ? `Request timed out after ${timeout}ms` : err.message
    };
  }
}

// ============================================================
// Assertion Engine
// ============================================================

/**
 * Run a single assertion against a step result.
 *
 * @param {object} assertion - Assertion definition
 * @param {object} stepResult - The step result to assert against
 * @param {object} context - Variable context (for resolving expected values)
 * @returns {object} {passed, type, message, expected, actual}
 */
function runAssertion(assertion, stepResult, context) {
  const type = assertion.type;

  switch (type) {
    case 'status': {
      const expected = assertion.expected;
      const actual = stepResult.status;
      return {
        passed: actual === expected,
        type,
        message: actual === expected ? `Status ${actual} matches` : `Expected status ${expected}, got ${actual}`,
        expected,
        actual
      };
    }

    case 'bodyField': {
      const actual = extractByPath(stepResult.body, assertion.path);
      const expected = resolveVariables(String(assertion.expected), context);
      const actualStr = actual !== undefined ? String(actual) : undefined;
      return {
        passed: actualStr === expected,
        type,
        message: actualStr === expected
          ? `${assertion.path} = ${expected}`
          : `${assertion.path}: expected "${expected}", got "${actualStr}"`,
        expected,
        actual: actualStr
      };
    }

    case 'bodyFieldExists': {
      const actual = extractByPath(stepResult.body, assertion.path);
      const exists = actual !== undefined;
      return {
        passed: exists,
        type,
        message: exists ? `${assertion.path} exists` : `${assertion.path} does not exist`,
        expected: 'exists',
        actual: exists ? 'exists' : 'undefined'
      };
    }

    case 'bodyFieldType': {
      const actual = extractByPath(stepResult.body, assertion.path);
      const actualType = actual === null ? 'null' :
                         Array.isArray(actual) ? 'array' : typeof actual;
      const expected = assertion.expected;
      return {
        passed: actualType === expected,
        type,
        message: actualType === expected
          ? `${assertion.path} is ${expected}`
          : `${assertion.path}: expected type "${expected}", got "${actualType}"`,
        expected,
        actual: actualType
      };
    }

    case 'bodyFieldMatch': {
      const actual = extractByPath(stepResult.body, assertion.path);
      const actualStr = actual !== undefined ? String(actual) : '';
      let passed = false;

      // Guard against ReDoS: cap regex length and reject dangerous patterns
      const MAX_REGEX_LENGTH = 500;
      if (assertion.expected && assertion.expected.length > MAX_REGEX_LENGTH) {
        return {
          passed: false,
          type,
          message: `Regex too long (${assertion.expected.length} chars, max ${MAX_REGEX_LENGTH})`,
          expected: assertion.expected.substring(0, 50) + '...',
          actual: actualStr
        };
      }

      try {
        const regex = new RegExp(assertion.expected);
        passed = regex.test(actualStr);
      } catch (err) {
        return {
          passed: false,
          type,
          message: `Invalid regex: ${assertion.expected}`,
          expected: assertion.expected,
          actual: actualStr
        };
      }
      return {
        passed,
        type,
        message: passed
          ? `${assertion.path} matches /${assertion.expected}/`
          : `${assertion.path}: "${actualStr}" does not match /${assertion.expected}/`,
        expected: assertion.expected,
        actual: actualStr
      };
    }

    case 'headerField': {
      const headerName = (assertion.name || assertion.path || '').toLowerCase();
      const actual = stepResult.headers[headerName];
      const expected = resolveVariables(String(assertion.expected), context);
      return {
        passed: actual === expected,
        type,
        message: actual === expected
          ? `Header ${headerName} = ${expected}`
          : `Header ${headerName}: expected "${expected}", got "${actual}"`,
        expected,
        actual
      };
    }

    default:
      return {
        passed: false,
        type,
        message: `Unknown assertion type: ${type}`,
        expected: null,
        actual: null
      };
  }
}

// ============================================================
// Teardown
// ============================================================

/**
 * Run teardown steps (reverse DELETE or custom).
 *
 * @param {object} scenario - The scenario object
 * @param {object} context - Variable context
 * @param {object} [options] - {timeout, verbose}
 * @returns {Promise<object[]>} Array of teardown step results
 */
async function runTeardown(scenario, context, options = {}) {
  const { timeout = DEFAULT_REQUEST_TIMEOUT, verbose = false } = options;

  if (!scenario.teardown) {
    return [];
  }

  const strategy = scenario.teardown.strategy || 'reverse';

  if (strategy === 'none') {
    return [];
  }

  const steps = scenario.teardown.steps || [];
  if (steps.length === 0) {
    return [];
  }

  const baseUrl = scenario.baseUrl || DEFAULT_BASE_URL;
  const results = [];

  for (const step of steps) {
    const result = await executeStep(step, baseUrl, context, { timeout });
    results.push(result);

    if (verbose) {
      const status = result.status || 'ERR';
      console.log(`  [teardown] ${step.method || 'DELETE'} ${step.path} => ${status}`);
    }
  }

  return results;
}

// ============================================================
// Scenario Execution
// ============================================================

/**
 * Execute a complete verification scenario.
 * Returns structured result with pass/fail per step+assertion, timing, request/response log.
 *
 * @param {object} scenario - The scenario definition (JSON)
 * @param {object} [options] - {dryRun, verbose, requestTimeout, scenarioTimeout}
 * @returns {Promise<object>} Structured result
 */
async function executeScenario(scenario, options = {}) {
  const {
    dryRun = false,
    verbose = false,
    requestTimeout = DEFAULT_REQUEST_TIMEOUT,
    scenarioTimeout = DEFAULT_SCENARIO_TIMEOUT
  } = options;

  const startTime = Date.now();
  const context = {};
  const baseUrl = resolveBaseUrl(scenario);

  const result = {
    name: scenario.name || 'Unnamed scenario',
    description: scenario.description || '',
    baseUrl,
    passed: true,
    prerequisites: [],
    action: null,
    assertions: [],
    teardown: [],
    timing: { startedAt: new Date().toISOString(), duration: 0 },
    error: null
  };

  // Dry run — just return the plan
  if (dryRun) {
    result.dryRun = true;
    result.plan = {
      prerequisites: (scenario.prerequisites || []).map(p => `${p.method} ${p.path} (${p.step})`),
      action: scenario.action ? `${scenario.action.method} ${scenario.action.path} (${scenario.action.step})` : null,
      assertions: (scenario.assertions || []).map(a => `${a.type}: ${a.path || a.expected || ''}`),
      teardown: scenario.teardown ? `${scenario.teardown.strategy} (${(scenario.teardown.steps || []).length} steps)` : 'none'
    };
    return result;
  }

  // Check environment isolation tier
  scenario = applyIsolationStrategy(scenario);

  // Scenario-level timeout via AbortController
  const scenarioAbort = new AbortController();
  const scenarioTimer = setTimeout(() => scenarioAbort.abort(), scenarioTimeout);

  try {
    // --- Prerequisites ---
    const prerequisites = scenario.prerequisites || [];
    for (const prereq of prerequisites) {
      if (scenarioAbort.signal.aborted) {
        result.error = `Scenario timed out after ${scenarioTimeout}ms`;
        result.passed = false;
        break;
      }

      const stepResult = await executeStep(prereq, baseUrl, context, { timeout: requestTimeout });

      // Check expected status
      if (prereq.expectedStatus && stepResult.status !== prereq.expectedStatus) {
        stepResult.passed = false;
        stepResult.error = `Expected status ${prereq.expectedStatus}, got ${stepResult.status}`;
      }

      result.prerequisites.push(stepResult);

      if (!stepResult.passed) {
        result.passed = false;
        result.error = `Prerequisite "${prereq.step}" failed: ${stepResult.error}`;
        // Don't stop — continue to teardown
        break;
      }

      // Extract and save variables
      if (prereq.save && stepResult.body && typeof stepResult.body === 'object') {
        for (const [varName, jsonPathExpr] of Object.entries(prereq.save)) {
          if (varName === '__proto__' || varName === 'constructor' || varName === 'prototype') {
            continue;
          }
          const extracted = extractByPath(stepResult.body, jsonPathExpr);
          if (extracted !== undefined) {
            context[varName] = extracted;
          }
        }
      }

      if (verbose) {
        console.log(`  [prereq] ${prereq.step}: ${stepResult.status} (${stepResult.duration}ms)`);
      }
    }

    // --- Action ---
    if (result.passed && scenario.action) {
      if (scenarioAbort.signal.aborted) {
        result.error = `Scenario timed out after ${scenarioTimeout}ms`;
        result.passed = false;
      } else {
        const actionResult = await executeStep(scenario.action, baseUrl, context, { timeout: requestTimeout });

        // Save action response variables if defined
        if (scenario.action.save && actionResult.body && typeof actionResult.body === 'object') {
          for (const [varName, jsonPathExpr] of Object.entries(scenario.action.save)) {
            if (varName === '__proto__' || varName === 'constructor' || varName === 'prototype') {
              continue;
            }
            const extracted = extractByPath(actionResult.body, jsonPathExpr);
            if (extracted !== undefined) {
              context[varName] = extracted;
            }
          }
        }

        result.action = actionResult;

        if (verbose) {
          console.log(`  [action] ${scenario.action.step}: ${actionResult.status} (${actionResult.duration}ms)`);
        }

        // --- Assertions ---
        const assertions = scenario.assertions || [];
        for (const assertion of assertions) {
          const assertionResult = runAssertion(assertion, actionResult, context);
          result.assertions.push(assertionResult);

          if (!assertionResult.passed) {
            result.passed = false;
          }

          if (verbose) {
            const marker = assertionResult.passed ? 'PASS' : 'FAIL';
            console.log(`  [assert] [${marker}] ${assertionResult.message}`);
          }
        }
      }
    }
  } catch (err) {
    result.passed = false;
    result.error = err.message;
  } finally {
    clearTimeout(scenarioTimer);

    // --- Teardown (always runs) ---
    try {
      result.teardown = await runTeardown(scenario, context, { timeout: requestTimeout, verbose });
    } catch (err) {
      result.teardown = [{ step: 'teardown', passed: false, error: err.message }];
    }

    result.timing.duration = Date.now() - startTime;
  }

  return result;
}

/**
 * Resolve the base URL for a scenario, checking verification profile.
 *
 * @param {object} scenario - The scenario definition
 * @returns {string} Base URL
 */
function resolveBaseUrl(scenario) {
  if (scenario.baseUrl) {
    return scenario.baseUrl;
  }

  // Try verification profile
  if (verificationProfile) {
    try {
      const profile = verificationProfile.loadProfile();
      if (profile && profile.api && profile.api.baseUrl) {
        return profile.api.baseUrl;
      }
    } catch (err) {
      // Fall through to default
    }
  }

  return DEFAULT_BASE_URL;
}

/**
 * Apply environment isolation strategy based on verification profile.
 * Modifies scenario.teardown in-place if needed.
 *
 * @param {object} scenario - The scenario definition (modified in-place)
 */
function applyIsolationStrategy(scenario) {
  if (!verificationProfile) return scenario;

  try {
    const profile = verificationProfile.loadProfile();
    if (!profile) return scenario;

    if (verificationProfile.hasCapability(profile, 'testcontainers')) {
      // Tier 1: Container will be destroyed — skip teardown
      // Clone to avoid mutating caller's scenario object
      return { ...scenario, teardown: { strategy: 'none' } };
    }
    // Tier 2 (database) and Tier 3 (reverse DELETE) use default teardown
  } catch (err) {
    // Non-fatal — use existing teardown config
  }
  return scenario;
}

// ============================================================
// API Map Parsing (for scenario generation)
// ============================================================

/**
 * Parse API map markdown to extract endpoint definitions.
 *
 * @param {string} apiMapContent - Contents of api-map.md
 * @returns {object[]} Array of {method, path, description, params, requiresAuth}
 */
function parseApiMap(apiMapContent) {
  if (!apiMapContent || typeof apiMapContent !== 'string') {
    return [];
  }

  const endpoints = [];
  const lines = apiMapContent.split('\n');

  let inTable = false;
  let headerSkipped = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!inTable && /^\|\s*Method\s*\|/i.test(trimmed)) {
      inTable = true;
      continue;
    }

    if (inTable && !headerSkipped && /^\|[\s-:|]+\|$/.test(trimmed)) {
      headerSkipped = true;
      continue;
    }

    if (inTable && headerSkipped) {
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

        if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method)) {
          const params = [];
          const colonParams = endpointPath.match(/:(\w+)/g);
          const braceParams = endpointPath.match(/\{(\w+)\}/g);

          if (colonParams) params.push(...colonParams.map(p => p.slice(1)));
          if (braceParams) params.push(...braceParams.map(p => p.slice(1, -1)));

          // Heuristic: endpoints with "auth" or "token" in headers column likely require auth
          const authHint = cells[3] || '';
          const requiresAuth = /auth|token|bearer/i.test(authHint) ||
                               /auth|token|bearer/i.test(description) ||
                               params.some(p => /user|project|team/i.test(p));

          endpoints.push({ method, path: endpointPath, description, params, requiresAuth });
        }
      }
    }
  }

  return endpoints;
}

// ============================================================
// Scenario Generation
// ============================================================

/**
 * Generate a scenario JSON from acceptance criteria text + API map.
 * Uses pattern matching to infer prerequisites and assertions.
 *
 * @param {string} criterionText - Acceptance criterion text
 * @param {string} apiMapContent - Contents of api-map.md (or null)
 * @param {object} [options] - {baseUrl}
 * @returns {object|null} Generated scenario or null if can't generate
 */
function generateScenario(criterionText, apiMapContent, options = {}) {
  if (!criterionText) return null;

  const { baseUrl = DEFAULT_BASE_URL } = options;
  const text = criterionText.toLowerCase();

  const endpoints = apiMapContent ? parseApiMap(apiMapContent) : [];

  // Detect HTTP method from criterion text
  let actionMethod = null;
  let actionKeyword = null;

  if (/\b(create|add|register|sign\s*up|post)\b/.test(text)) {
    actionMethod = 'POST';
    actionKeyword = text.match(/\b(create|add|register|sign\s*up)\b/)?.[0] || 'create';
  } else if (/\b(update|edit|modify|patch|put)\b/.test(text)) {
    actionMethod = text.includes('patch') ? 'PATCH' : 'PUT';
    actionKeyword = text.match(/\b(update|edit|modify)\b/)?.[0] || 'update';
  } else if (/\b(delete|remove|destroy)\b/.test(text)) {
    actionMethod = 'DELETE';
    actionKeyword = text.match(/\b(delete|remove|destroy)\b/)?.[0] || 'delete';
  } else if (/\b(list|get|fetch|retrieve|show|view)\b/.test(text)) {
    actionMethod = 'GET';
    actionKeyword = text.match(/\b(list|get|fetch|retrieve|show|view)\b/)?.[0] || 'get';
  }

  if (!actionMethod) return null;

  // Find matching endpoint
  let actionEndpoint = null;
  for (const ep of endpoints) {
    if (ep.method === actionMethod) {
      // Fuzzy match: check if criterion text mentions the endpoint resource
      const pathParts = ep.path.split('/').filter(p => p && !p.startsWith(':') && !p.startsWith('{'));
      const lastPart = pathParts[pathParts.length - 1];
      if (lastPart && text.includes(lastPart.toLowerCase().replace(/s$/, ''))) {
        actionEndpoint = ep;
        break;
      }
    }
  }

  // If no match found, try less specific matching
  if (!actionEndpoint) {
    const methodMatches = endpoints.filter(ep => ep.method === actionMethod);
    if (methodMatches.length === 1) {
      actionEndpoint = methodMatches[0];
    } else if (methodMatches.length > 0) {
      actionEndpoint = methodMatches[0]; // Take first match
    }
  }

  if (!actionEndpoint) return null;

  // Build scenario
  const scenario = {
    name: `${actionKeyword} scenario (auto-generated)`,
    description: criterionText,
    baseUrl,
    prerequisites: [],
    action: {
      step: actionKeyword,
      method: actionEndpoint.method,
      path: actionEndpoint.path,
      headers: {},
      body: actionMethod === 'GET' || actionMethod === 'DELETE' ? undefined : {},
      expectedStatus: actionMethod === 'POST' ? 201 : 200
    },
    assertions: [],
    teardown: { strategy: 'reverse', steps: [] }
  };

  // Infer prerequisites
  if (actionEndpoint.requiresAuth || actionEndpoint.params.some(p => /user/i.test(p))) {
    // Add auth prerequisite
    const registerEndpoint = endpoints.find(ep => ep.method === 'POST' && /register|signup|auth/i.test(ep.path));
    const loginEndpoint = endpoints.find(ep => ep.method === 'POST' && /login|auth.*session/i.test(ep.path));

    if (registerEndpoint) {
      scenario.prerequisites.push({
        step: 'register user',
        method: 'POST',
        path: registerEndpoint.path,
        body: { email: 'test-{{$uuid}}@test.com', password: 'Test123!' },
        save: { userId: '$.id', token: '$.token' },
        expectedStatus: 201
      });
    } else if (loginEndpoint) {
      scenario.prerequisites.push({
        step: 'login',
        method: 'POST',
        path: loginEndpoint.path,
        body: { email: 'test@test.com', password: 'Test123!' },
        save: { token: '$.token' },
        expectedStatus: 200
      });
    }

    scenario.action.headers = { Authorization: 'Bearer {{token}}' };
  }

  // Add prerequisites for path parameters (e.g., :projectId)
  for (const param of actionEndpoint.params) {
    if (/id$/i.test(param) && param !== 'id') {
      const resourceName = param.replace(/Id$/i, '');
      const createEndpoint = endpoints.find(ep =>
        ep.method === 'POST' && ep.path.includes(resourceName)
      );

      if (createEndpoint) {
        scenario.prerequisites.push({
          step: `create ${resourceName}`,
          method: 'POST',
          path: createEndpoint.path,
          headers: { Authorization: 'Bearer {{token}}' },
          body: { name: `Test ${resourceName}` },
          save: { [param]: '$.id' },
          expectedStatus: 201
        });
      }
    }
  }

  // Infer assertions from criterion text
  const assertionPatterns = [
    { regex: /should\s+return\s+(\d{3})/, type: 'status', extract: (m) => ({ expected: parseInt(m[1], 10) }) },
    { regex: /should\s+have\s+(?:a\s+)?(\w+)/, type: 'bodyFieldExists', extract: (m) => ({ path: `$.${m[1]}` }) },
    { regex: /should\s+contain\s+"([^"]+)"/, type: 'bodyFieldMatch', extract: (m) => ({ path: '$', expected: m[1] }) }
  ];

  // Always add status assertion
  scenario.assertions.push({
    type: 'status',
    expected: scenario.action.expectedStatus
  });

  for (const pattern of assertionPatterns) {
    const match = text.match(pattern.regex);
    if (match) {
      const assertion = { type: pattern.type, ...pattern.extract(match) };
      // Avoid duplicate status assertions
      if (assertion.type !== 'status') {
        scenario.assertions.push(assertion);
      }
    }
  }

  // Generate teardown (reverse DELETEs)
  if (actionMethod === 'POST') {
    // The action itself created something — add DELETE for it
    const deletePath = actionEndpoint.path.replace(/:(\w+)/g, '{{$1}}');
    scenario.teardown.steps.push({
      method: 'DELETE',
      path: deletePath,
      headers: scenario.action.headers
    });
  }

  // Teardown prerequisites in reverse
  for (let i = scenario.prerequisites.length - 1; i >= 0; i--) {
    const prereq = scenario.prerequisites[i];
    if (prereq.save) {
      for (const [varName] of Object.entries(prereq.save)) {
        if (/id$/i.test(varName) && varName !== 'token' && varName !== 'userId') {
          // Attempt to build a DELETE path
          const resourceName = varName.replace(/Id$/i, '');
          const deleteEndpoint = endpoints.find(ep =>
            ep.method === 'DELETE' && ep.path.includes(resourceName)
          );
          if (deleteEndpoint) {
            scenario.teardown.steps.push({
              method: 'DELETE',
              path: deleteEndpoint.path.replace(/:(\w+)/g, (match, param) => `{{${param}}}`),
              headers: { Authorization: 'Bearer {{token}}' }
            });
          }
        }
      }
    }
  }

  return scenario;
}

// ============================================================
// CLI
// ============================================================

if (require.main === module) {
  (async () => {
  const args = process.argv.slice(2);
  const scenarioFile = args.find(a => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose');

  if (!scenarioFile) {
    console.log('Usage: flow-scenario-engine.js <scenario.json> [--dry-run] [--verbose]');
    console.log('');
    console.log('  Executes a declarative verification scenario.');
    console.log('');
    console.log('  Options:');
    console.log('    --dry-run   Show execution plan without running');
    console.log('    --verbose   Print step-by-step output');
    process.exit(1);
  }

  const scenarioPath = path.isAbsolute(scenarioFile) ? scenarioFile : path.join(process.cwd(), scenarioFile);

  let scenario;
  try {
    const content = fs.readFileSync(scenarioPath, 'utf-8');
    scenario = safeJsonParseString(content, null);
    if (!scenario) {
      console.error('Failed to load scenario: invalid JSON');
      process.exit(1);
    }
  } catch (err) {
    console.error(`Failed to load scenario: ${err.message}`);
    process.exit(1);
  }

  try {
    const result = await executeScenario(scenario, { dryRun, verbose });
    if (dryRun) {
      console.log(`Scenario: ${result.name}`);
      console.log('Plan:');
      if (result.plan.prerequisites.length > 0) {
        console.log('  Prerequisites:');
        for (const p of result.plan.prerequisites) {
          console.log(`    - ${p}`);
        }
      }
      if (result.plan.action) {
        console.log(`  Action: ${result.plan.action}`);
      }
      if (result.plan.assertions.length > 0) {
        console.log('  Assertions:');
        for (const a of result.plan.assertions) {
          console.log(`    - ${a}`);
        }
      }
      console.log(`  Teardown: ${result.plan.teardown}`);
    } else {
      const marker = result.passed ? 'PASS' : 'FAIL';
      console.log(`[${marker}] ${result.name} (${result.timing.duration}ms)`);

      if (result.prerequisites.length > 0) {
        console.log('  Prerequisites:');
        for (const p of result.prerequisites) {
          const m = p.passed ? 'OK' : 'FAIL';
          console.log(`    [${m}] ${p.step}: ${p.status || 'ERR'} (${p.duration}ms)`);
          if (p.error) console.log(`         ${p.error}`);
        }
      }

      if (result.action) {
        const am = result.action.passed !== false ? 'OK' : 'FAIL';
        console.log(`  Action: [${am}] ${result.action.step}: ${result.action.status || 'ERR'} (${result.action.duration}ms)`);
      }

      if (result.assertions.length > 0) {
        console.log('  Assertions:');
        for (const a of result.assertions) {
          const am = a.passed ? 'PASS' : 'FAIL';
          console.log(`    [${am}] ${a.message}`);
        }
      }

      if (result.error) {
        console.log(`  Error: ${result.error}`);
      }

      process.exit(result.passed ? 0 : 1);
    }
  } catch (err) {
    console.error(`Scenario engine error: ${err.message}`);
    process.exit(1);
  }
  })();
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  executeScenario,
  generateScenario,
  resolveVariables,
  extractByPath,
  runTeardown,
  parseApiMap,
  // Internal helpers (exported for testing/composition)
  runAssertion,
  executeStep,
  generateUUID,
  randomHex,
  resolveBaseUrl,
  applyIsolationStrategy,
  DEFAULT_REQUEST_TIMEOUT,
  DEFAULT_SCENARIO_TIMEOUT,
  DEFAULT_BASE_URL
};
