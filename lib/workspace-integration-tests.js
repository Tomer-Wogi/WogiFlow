#!/usr/bin/env node

/**
 * Wogi Workspace — Integration Test Triggers
 *
 * When a provider changes an endpoint, auto-generate integration test specs
 * for consumer repos and verify consumer API calls match the new provider
 * signature via static analysis.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { safeReadJson } = require('./utils');

const { buildIntegrationMap } = require('./workspace-contracts');

// ============================================================
// Endpoint Change Detection
// ============================================================

/**
 * Detect which endpoints changed by comparing old and new manifests.
 *
 * @param {Object} oldManifest — previous workspace manifest
 * @param {Object} newManifest — current workspace manifest
 * @returns {Array<{ repo: string, endpoint: string, change: 'added'|'removed'|'modified' }>}
 */
function detectEndpointChanges(oldManifest, newManifest) {
  const changes = [];

  for (const [name, member] of Object.entries(newManifest.members || {})) {
    const oldMember = oldManifest?.members?.[name];
    const newProvides = new Set(member.provides || []);
    const oldProvides = new Set(oldMember?.provides || []);

    // New endpoints
    for (const ep of newProvides) {
      if (!oldProvides.has(ep)) {
        changes.push({ repo: name, endpoint: ep, change: 'added' });
      }
    }

    // Removed endpoints
    for (const ep of oldProvides) {
      if (!newProvides.has(ep)) {
        changes.push({ repo: name, endpoint: ep, change: 'removed' });
      }
    }
  }

  return changes;
}

// ============================================================
// Consumer Impact Analysis
// ============================================================

/**
 * For a list of changed endpoints, find which consumers are affected
 * and what their API calls look like.
 *
 * @param {Array<Object>} endpointChanges — from detectEndpointChanges()
 * @param {Object} manifest
 * @returns {Array<Object>} consumer impacts
 */
function analyzeConsumerImpact(endpointChanges, manifest) {
  const integrationMap = buildIntegrationMap(manifest);
  const impacts = [];

  for (const change of endpointChanges) {
    // Find consumers of this endpoint
    const match = integrationMap.matched?.find(m =>
      m.endpoint === change.endpoint ||
      m.providers?.includes(change.repo)
    );

    if (match) {
      for (const consumer of match.consumers || []) {
        impacts.push({
          consumer,
          provider: change.repo,
          endpoint: change.endpoint,
          change: change.change,
          matchScore: match.matchScore,
          severity: change.change === 'removed' ? 'critical' : 'high'
        });
      }
    }
  }

  return impacts;
}

// ============================================================
// Integration Test Spec Generation
// ============================================================

/**
 * Generate an integration test specification for a consumer repo
 * to verify its usage of a changed endpoint.
 *
 * @param {Object} impact — single impact from analyzeConsumerImpact()
 * @param {Object} [providerContract] — OpenAPI spec if available
 * @returns {Object} test spec
 */
function generateIntegrationTestSpec(impact, providerContract) {
  const spec = {
    consumer: impact.consumer,
    provider: impact.provider,
    endpoint: impact.endpoint,
    changeType: impact.change,
    severity: impact.severity,
    generatedAt: new Date().toISOString(),
    testCases: []
  };

  // Parse endpoint for method and path
  const parts = impact.endpoint.split(' ');
  const method = parts[0] || 'GET';
  const routePath = parts.slice(1).join(' ') || '/unknown';

  // Basic connectivity test
  spec.testCases.push({
    name: `${method} ${routePath} — endpoint exists`,
    type: 'connectivity',
    description: `Verify that ${impact.provider} still serves ${method} ${routePath}`,
    method,
    path: routePath,
    expectedStatus: impact.change === 'removed' ? 404 : 200
  });

  // Response shape test (if contract available)
  if (providerContract?.paths) {
    const pathKey = routePath.replace(/:([^/]+)/g, '{$1}');
    const pathSpec = providerContract.paths[pathKey];
    const methodSpec = pathSpec?.[method.toLowerCase()];

    if (methodSpec?.responses?.['200']?.content?.['application/json']?.schema) {
      const schema = methodSpec.responses['200'].content['application/json'].schema;
      spec.testCases.push({
        name: `${method} ${routePath} — response shape matches contract`,
        type: 'schema-validation',
        description: 'Verify response body matches the OpenAPI schema',
        method,
        path: routePath,
        expectedSchema: schema
      });
    }
  }

  // Breaking change test
  if (impact.change === 'removed') {
    spec.testCases.push({
      name: `${method} ${routePath} — handle removed endpoint gracefully`,
      type: 'error-handling',
      description: `Endpoint was REMOVED by ${impact.provider}. Consumer must handle 404/connection errors.`,
      method,
      path: routePath,
      expectedBehavior: 'Consumer should degrade gracefully when endpoint is unavailable'
    });
  }

  return spec;
}

/**
 * Generate integration test specs for ALL affected consumers
 * after a provider changes endpoints.
 *
 * @param {string} workspaceRoot
 * @param {Object} oldManifest
 * @param {Object} newManifest
 * @returns {{ changes: Array, impacts: Array, specs: Array }}
 */
function generateAllIntegrationSpecs(workspaceRoot, oldManifest, newManifest) {
  const changes = detectEndpointChanges(oldManifest, newManifest);
  if (changes.length === 0) {
    return { changes: [], impacts: [], specs: [] };
  }

  const impacts = analyzeConsumerImpact(changes, newManifest);
  const specs = [];

  // Try to load provider contracts for richer test specs
  const contractsDir = path.join(workspaceRoot, '.workspace', 'contracts');

  for (const impact of impacts) {
    let contract = null;
    try {
      const contractPath = path.join(contractsDir, `${impact.provider}.json`);
      if (fs.existsSync(contractPath)) {
        contract = safeReadJson(contractPath);
      }
    } catch (_err) {
      // No contract available — generate basic tests
    }

    specs.push(generateIntegrationTestSpec(impact, contract));
  }

  return { changes, impacts, specs };
}

/**
 * Write integration test specs to workspace for tracking.
 *
 * @param {string} workspaceRoot
 * @param {Array<Object>} specs — from generateAllIntegrationSpecs()
 * @returns {Array<string>} file paths written
 */
function writeTestSpecs(workspaceRoot, specs) {
  const specsDir = path.join(workspaceRoot, '.workspace', 'specs', 'integration-tests');
  fs.mkdirSync(specsDir, { recursive: true });

  // Use deterministic file names (consumer-provider pair) to prevent unbounded accumulation
  const paths = [];
  for (const spec of specs) {
    const fileName = `${spec.consumer}-${spec.provider}.json`;
    const filePath = path.join(specsDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(spec, null, 2));
    paths.push(filePath);
  }

  return paths;
}

// ============================================================
// Consumer Call Verification (Static Analysis)
// ============================================================

/**
 * Verify that consumer API calls match the provider's current signature.
 * Reads consumer's api-map and compares against provider's api-index.
 *
 * @param {Object} manifest — workspace manifest
 * @param {string} consumerName — consumer repo
 * @param {string} providerName — provider repo
 * @returns {{ matching: Array, mismatched: Array, orphaned: Array }}
 */
function verifyConsumerCalls(manifest, consumerName, providerName) {
  const consumer = manifest.members[consumerName];
  const provider = manifest.members[providerName];

  if (!consumer || !provider) {
    return { matching: [], mismatched: [], orphaned: [] };
  }

  const providerEndpoints = new Set((provider.provides || []).map(e => e.toLowerCase()));
  const matching = [];
  const mismatched = [];
  const orphaned = [];

  for (const consumed of consumer.consumes || []) {
    const consumedLower = consumed.toLowerCase();
    if (providerEndpoints.has(consumedLower)) {
      matching.push(consumed);
    } else {
      // Check for partial matches (path matches but method differs, etc.)
      let partialMatch = false;
      const consumedPath = consumed.split(' ').slice(1).join(' ').toLowerCase();

      for (const provided of providerEndpoints) {
        const providedPath = provided.split(' ').slice(1).join(' ');
        if (consumedPath === providedPath) {
          mismatched.push({ consumed, reason: 'Method mismatch' });
          partialMatch = true;
          break;
        }
      }

      if (!partialMatch) {
        orphaned.push(consumed);
      }
    }
  }

  return { matching, mismatched, orphaned };
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Change detection
  detectEndpointChanges,

  // Consumer impact
  analyzeConsumerImpact,

  // Test spec generation
  generateIntegrationTestSpec,
  generateAllIntegrationSpecs,
  writeTestSpecs,

  // Call verification
  verifyConsumerCalls
};
