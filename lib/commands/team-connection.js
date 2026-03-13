#!/usr/bin/env node
'use strict';

/**
 * Shared team-connection utilities for login/logout commands.
 *
 * Extracted to avoid DRY violations between login.js and logout.js.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const CONNECTION_FILE = '.workflow/team-connection.json';
const REQUEST_TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 1 * 1024 * 1024; // 1 MB cap on response body

/**
 * Safely parse JSON with prototype pollution protection.
 * Checks for dangerous keys in parsed objects (including nested).
 */
function safeParseJson(str, fallback) {
  try {
    const obj = JSON.parse(str);
    if (obj && typeof obj === 'object') {
      stripDangerousKeys(obj);
    }
    return obj;
  } catch {
    return fallback;
  }
}

/**
 * Recursively strip __proto__, constructor, prototype keys from an object.
 */
function stripDangerousKeys(obj) {
  if (!obj || typeof obj !== 'object') return;
  const dangerous = ['__proto__', 'constructor', 'prototype'];
  for (const key of dangerous) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      delete obj[key];
    }
  }
  for (const key of Object.keys(obj)) {
    if (obj[key] && typeof obj[key] === 'object') {
      stripDangerousKeys(obj[key]);
    }
  }
}

/**
 * Read team connection from .workflow/team-connection.json
 * @returns {Object|null} Connection object or null if not found/invalid
 */
function getTeamConnection() {
  try {
    const filePath = path.resolve(process.cwd(), CONNECTION_FILE);
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = safeParseJson(content, null);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Save team connection to .workflow/team-connection.json
 * @param {Object} connection - Connection data to save
 */
function saveTeamConnection(connection) {
  try {
    const dir = path.resolve(process.cwd(), '.workflow');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filePath = path.resolve(process.cwd(), CONNECTION_FILE);
    fs.writeFileSync(filePath, JSON.stringify(connection, null, 2), { mode: 0o600 });
  } catch (err) {
    throw new Error(`Failed to save team connection: ${err.message}`);
  }
}

/**
 * Remove team connection file
 */
function removeTeamConnection() {
  const filePath = path.resolve(process.cwd(), CONNECTION_FILE);
  try {
    fs.unlinkSync(filePath);
  } catch {
    // File may not exist — that's fine
  }
}

/**
 * Validate a URL is well-formed and uses HTTPS (unless explicitly dev).
 * @param {string} url - URL to validate
 * @param {boolean} [allowHttp=false] - Allow HTTP (for local dev only)
 * @returns {URL} Parsed URL object
 * @throws {Error} If URL is invalid or not HTTPS
 */
function validateUrl(url, allowHttp = false) {
  const parsedUrl = new URL(url);
  if (!allowHttp && parsedUrl.protocol !== 'https:') {
    throw new Error(`Only HTTPS connections are permitted (got ${parsedUrl.protocol}). Use --allow-http for local development.`);
  }
  return parsedUrl;
}

/**
 * Make an HTTP/HTTPS request with timeout, size limit, and safe JSON parsing.
 *
 * @param {string} url - Full URL to request
 * @param {Object} [options] - Request options
 * @param {string} [options.method] - HTTP method (default: GET)
 * @param {Object} [options.body] - JSON body to send
 * @param {Object} [options.headers] - Additional headers
 * @param {boolean} [options.allowHttp] - Allow HTTP (for local dev)
 * @returns {Promise<{statusCode: number, body: any}>}
 */
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = validateUrl(url, options.allowHttp || false);
    const transport = parsedUrl.protocol === 'http:' ? http : https;
    const body = options.body ? JSON.stringify(options.body) : null;
    const req = transport.request({
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'http:' ? 80 : 443),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(body && { 'Content-Length': Buffer.byteLength(body) }),
        ...(options.headers || {})
      }
    }, (res) => {
      let data = '';
      let bytesRead = 0;
      res.on('data', chunk => {
        bytesRead += chunk.length;
        if (bytesRead > MAX_RESPONSE_BYTES) {
          req.destroy(new Error('Response too large'));
          return;
        }
        data += chunk;
      });
      res.on('end', () => {
        const parsedBody = safeParseJson(data, data);
        resolve({ statusCode: res.statusCode, body: parsedBody });
      });
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Make an authenticated API request using saved connection.
 *
 * @param {string} urlPath - API path (e.g., /api/auth/logout)
 * @param {Object} [options] - Request options (method, body, headers)
 * @returns {Promise<{statusCode: number, body: any}>}
 */
function authenticatedRequest(urlPath, options = {}) {
  const conn = getTeamConnection();
  if (!conn) throw new Error('Not connected');
  const base = conn.apiBase || 'https://api.wogiflow.com';
  const fullUrl = new URL(urlPath, base).toString();
  return request(fullUrl, {
    ...options,
    headers: {
      'Authorization': `Bearer ${conn.accessToken}`,
      ...(options.headers || {})
    }
  });
}

module.exports = {
  getTeamConnection,
  saveTeamConnection,
  removeTeamConnection,
  request,
  authenticatedRequest,
  validateUrl,
  CONNECTION_FILE
};
