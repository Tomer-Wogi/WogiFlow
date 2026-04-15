/**
 * ESLint 9.x Flat Config
 * Wogi Flow project — catches latent no-undef crashes + unused-vars drift.
 */

module.exports = [
  {
    // Apply to all JS files
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: {
        // Node.js classic globals
        console: 'readonly',
        process: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        // Node 18+ / ES2022+ globals (missing from prior config — caused
        // 50+ false-positive no-undef errors for URL, fetch, AbortController,
        // AbortSignal, structuredClone)
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        Headers: 'readonly',
        FormData: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        structuredClone: 'readonly',
        globalThis: 'readonly',
        queueMicrotask: 'readonly',
        performance: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
      }
    },
    rules: {
      // Crash-prevention (all error)
      'no-undef': 'error',
      'no-const-assign': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      // no-unreachable upgraded from warn → error (cons-c05, wf-5a6df88a)
      // Currently 0 violations so upgrade is safe.
      'no-unreachable': 'error',
      // Drift-detection (remains warn until story wf-9c4170cd cleans up the
      // ~975 existing warnings from test helpers + imports. Upgrading now
      // would break this project's own CI.)
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }],
    }
  },
  {
    // Ignore patterns
    ignores: [
      'node_modules/**',
      'mcp-memory-server/**',
      '.workflow/**',
      '.claude/**',
    ]
  }
];
