#!/usr/bin/env node

/**
 * Wogi Flow - HTTP Client
 *
 * Shared HTTP client with consistent error handling, timeouts, and retries.
 * Extracted from flow-team.js, flow-jira-integration.js, flow-linear-integration.js.
 *
 * Usage:
 *   const { HttpClient, fetchJson, postJson } = require('./flow-http-client');
 *   const client = new HttpClient('https://api.example.com', { timeout: 30000 });
 *   const data = await client.get('/endpoint');
 */

const https = require('https');
const http = require('http');
const { TIMEOUTS, LIMITS, BACKOFF } = require('./flow-constants');

/**
 * HTTP Client class with built-in error handling and retries
 */
class HttpClient {
  constructor(baseUrl, options = {}) {
    this.baseUrl = baseUrl;
    this.defaultHeaders = options.headers || {};
    this.timeout = options.timeout || TIMEOUTS.HTTP_DEFAULT;
    this.maxRetries = options.maxRetries || LIMITS.HTTP_MAX_RETRIES;
  }

  /**
   * Make an HTTP request
   * @param {string} method - HTTP method
   * @param {string} path - URL path
   * @param {object|null} body - Request body (will be JSON stringified)
   * @param {object} options - Additional options
   * @returns {Promise<{status: number, data: any, headers: object}>}
   */
  async request(method, path, body = null, options = {}) {
    const url = new URL(path, this.baseUrl);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const headers = {
      ...this.defaultHeaders,
      ...options.headers,
    };

    if (body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const requestOptions = {
      method,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      headers,
      timeout: options.timeout || this.timeout,
    };

    return this._executeWithRetry(lib, requestOptions, body, options.retries || 0);
  }

  /**
   * Execute request with retry logic
   */
  async _executeWithRetry(lib, options, body, attempt) {
    try {
      return await this._execute(lib, options, body);
    } catch (err) {
      if (attempt < this.maxRetries && this._isRetryable(err)) {
        const delay = this._calculateBackoff(attempt);
        await this._sleep(delay);
        return this._executeWithRetry(lib, options, body, attempt + 1);
      }
      throw err;
    }
  }

  /**
   * Execute a single HTTP request
   */
  _execute(lib, options, body) {
    return new Promise((resolve, reject) => {
      const req = lib.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          let parsed = data;
          try {
            if (data && res.headers['content-type']?.includes('application/json')) {
              parsed = JSON.parse(data);
            }
          } catch (err) {
            // Keep as string if not valid JSON, but log for debugging
            if (process.env.DEBUG) {
              console.warn(`[HttpClient] Failed to parse JSON response: ${err.message}`);
            }
          }

          resolve({
            status: res.statusCode,
            data: parsed,
            headers: res.headers,
          });
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (body) {
        if (Buffer.isBuffer(body)) {
          req.write(body);
        } else if (typeof body === 'string') {
          req.write(body);
        } else {
          req.write(JSON.stringify(body));
        }
      }
      req.end();
    });
  }

  /**
   * Check if error is retryable
   */
  _isRetryable(err) {
    if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') return true;
    if (err.message === 'Request timeout') return true;
    return false;
  }

  /**
   * Calculate exponential backoff delay
   */
  _calculateBackoff(attempt) {
    const base = BACKOFF.BASE_DELAY * Math.pow(BACKOFF.MULTIPLIER, attempt);
    const jitter = base * BACKOFF.JITTER * Math.random();
    return Math.min(base + jitter, BACKOFF.MAX_DELAY);
  }

  /**
   * Sleep helper
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Convenience methods
  get(path, options = {}) {
    return this.request('GET', path, null, options);
  }

  post(path, body, options = {}) {
    return this.request('POST', path, body, options);
  }

  put(path, body, options = {}) {
    return this.request('PUT', path, body, options);
  }

  patch(path, body, options = {}) {
    return this.request('PATCH', path, body, options);
  }

  delete(path, options = {}) {
    return this.request('DELETE', path, null, options);
  }

  /**
   * Post multipart form data (for file uploads)
   * @param {string} path - URL path
   * @param {Array<{name: string, value: string|Buffer, filename?: string, contentType?: string}>} parts - Form parts
   * @param {object} options - Additional options
   * @returns {Promise<{status: number, data: any, headers: object}>}
   */
  async postMultipart(path, parts, options = {}) {
    const boundary = '----HttpClientBoundary' + Math.random().toString(36).substring(2);
    const chunks = [];

    for (const part of parts) {
      chunks.push(Buffer.from(`--${boundary}\r\n`));

      if (part.filename) {
        // File part
        chunks.push(Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`
        ));
        chunks.push(Buffer.from(
          `Content-Type: ${part.contentType || 'application/octet-stream'}\r\n\r\n`
        ));
      } else {
        // Regular field
        chunks.push(Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"\r\n\r\n`
        ));
      }

      chunks.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(String(part.value)));
      chunks.push(Buffer.from('\r\n'));
    }

    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(chunks);

    return this.request('POST', path, body, {
      ...options,
      headers: {
        ...options.headers,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    });
  }
}

/**
 * Simple fetch JSON helper (for one-off requests)
 */
async function fetchJson(url, options = {}) {
  const client = new HttpClient(url, { timeout: options.timeout || TIMEOUTS.HTTP_DEFAULT });
  const parsedUrl = new URL(url);
  const response = await client.get(parsedUrl.pathname + parsedUrl.search, {
    headers: options.headers,
  });
  return response.data;
}

/**
 * Simple post JSON helper (for one-off requests)
 */
async function postJson(url, body, options = {}) {
  const client = new HttpClient(url, { timeout: options.timeout || TIMEOUTS.HTTP_DEFAULT });
  const parsedUrl = new URL(url);
  const response = await client.post(parsedUrl.pathname + parsedUrl.search, body, {
    headers: options.headers,
  });
  return response.data;
}

module.exports = {
  HttpClient,
  fetchJson,
  postJson,
};
