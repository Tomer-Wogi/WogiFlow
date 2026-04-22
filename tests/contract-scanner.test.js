'use strict';

/**
 * Tests for contract-scanner.js
 *
 * Uses temp directories with mock project structures to test each scanner.
 * Run: NODE_ENV=test node --test tests/contract-scanner.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Suppress console output during tests
const _originalConsole = { ...console };
console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const {
  scanHttpClients,
  scanRouteDefinitions,
  scanEventBus,
  scanSharedTypes,
  scanEnvVars,
  detectProjectType,
  scanContracts,
  walkSourceFiles,
  CONTRACT_SURFACE_VERSION
} = require('../scripts/registries/contract-scanner');

// ============================================================
// Helpers
// ============================================================

let tmpDir;

function createTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-scan-test-'));
  return dir;
}

function writeFile(dir, relativePath, content) {
  const fullPath = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
  return fullPath;
}

function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_err) {
    // best effort
  }
}

// ============================================================
// walkSourceFiles
// ============================================================

describe('walkSourceFiles', () => {
  beforeEach(() => { tmpDir = createTmpDir(); });
  afterEach(() => { cleanupDir(tmpDir); });

  it('finds .js, .ts, .tsx, .jsx files', () => {
    writeFile(tmpDir, 'src/app.js', '// app');
    writeFile(tmpDir, 'src/utils.ts', '// utils');
    writeFile(tmpDir, 'src/page.tsx', '// page');
    writeFile(tmpDir, 'src/comp.jsx', '// comp');
    writeFile(tmpDir, 'src/style.css', '/* css */');
    writeFile(tmpDir, 'src/data.json', '{}');

    const files = walkSourceFiles(tmpDir);
    const names = files.map(f => path.basename(f));
    assert.ok(names.includes('app.js'));
    assert.ok(names.includes('utils.ts'));
    assert.ok(names.includes('page.tsx'));
    assert.ok(names.includes('comp.jsx'));
    assert.ok(!names.includes('style.css'));
    assert.ok(!names.includes('data.json'));
  });

  it('skips node_modules, dist, .git', () => {
    writeFile(tmpDir, 'node_modules/pkg/index.js', '// pkg');
    writeFile(tmpDir, 'dist/bundle.js', '// bundle');
    writeFile(tmpDir, '.git/objects/ab.js', '// git');
    writeFile(tmpDir, 'src/app.js', '// app');

    const files = walkSourceFiles(tmpDir);
    const names = files.map(f => path.basename(f));
    assert.ok(names.includes('app.js'));
    assert.ok(!names.includes('index.js'));
    assert.ok(!names.includes('bundle.js'));
    assert.ok(!names.includes('ab.js'));
  });

  it('respects maxDepth', () => {
    writeFile(tmpDir, 'a/b/c/d/e/f/g/deep.js', '// deep');
    writeFile(tmpDir, 'a/shallow.js', '// shallow');

    // maxDepth 2 should find shallow but not deep (7 levels)
    const files = walkSourceFiles(tmpDir, { maxDepth: 2 });
    const names = files.map(f => path.basename(f));
    assert.ok(names.includes('shallow.js'));
    assert.ok(!names.includes('deep.js'));
  });

  it('respects maxFiles', () => {
    for (let i = 0; i < 10; i++) {
      writeFile(tmpDir, `src/file${i}.js`, `// file ${i}`);
    }

    const files = walkSourceFiles(tmpDir, { maxFiles: 3 });
    assert.ok(files.length <= 3);
  });
});

// ============================================================
// scanHttpClients
// ============================================================

describe('scanHttpClients', () => {
  beforeEach(() => { tmpDir = createTmpDir(); });
  afterEach(() => { cleanupDir(tmpDir); });

  it('detects axios.get() calls', () => {
    writeFile(tmpDir, 'src/api.js', `
      const users = await axios.get('/api/users');
      const user = await axios.post('/api/users', data);
    `);

    const results = scanHttpClients(tmpDir);
    assert.equal(results.length, 2);
    assert.equal(results[0].method, 'GET');
    assert.equal(results[0].path, '/api/users');
    assert.equal(results[0].client, 'axios');
    assert.equal(results[1].method, 'POST');
    assert.equal(results[1].path, '/api/users');
  });

  it('detects fetch() calls', () => {
    writeFile(tmpDir, 'src/client.js', `
      const resp = await fetch('/api/items');
      const resp2 = await fetch('/api/items', { method: 'POST' });
    `);

    const results = scanHttpClients(tmpDir);
    assert.equal(results.length, 2);
    assert.equal(results[0].method, 'GET');
    assert.equal(results[0].path, '/api/items');
    assert.equal(results[0].client, 'fetch');
    assert.equal(results[1].method, 'POST');
    assert.equal(results[1].path, '/api/items');
  });

  it('detects $fetch (Nuxt) calls', () => {
    writeFile(tmpDir, 'src/nuxt.js', `
      const data = await $fetch('/api/data');
    `);

    const results = scanHttpClients(tmpDir);
    assert.equal(results.length, 1);
    assert.equal(results[0].client, '$fetch');
    assert.equal(results[0].path, '/api/data');
  });

  it('detects ky and got calls', () => {
    writeFile(tmpDir, 'src/http.js', `
      const a = ky.get('/api/a');
      const b = got.post('/api/b');
    `);

    const results = scanHttpClients(tmpDir);
    assert.equal(results.length, 2);
    assert.ok(results.some(r => r.client === 'ky' && r.method === 'GET'));
    assert.ok(results.some(r => r.client === 'got' && r.method === 'POST'));
  });

  it('includes source file and line number', () => {
    writeFile(tmpDir, 'src/api.js', `// line 1
// line 2
const x = axios.get('/api/test');`);

    const results = scanHttpClients(tmpDir);
    assert.equal(results.length, 1);
    assert.match(results[0].source, /^src\/api\.js:3$/);
  });
});

// ============================================================
// scanRouteDefinitions
// ============================================================

describe('scanRouteDefinitions', () => {
  beforeEach(() => { tmpDir = createTmpDir(); });
  afterEach(() => { cleanupDir(tmpDir); });

  it('detects Express router.get/post patterns', () => {
    writeFile(tmpDir, 'src/routes.js', `
      const router = require('express').Router();
      router.get('/api/users', getUsers);
      router.post('/api/users', createUser);
      router.delete('/api/users/:id', deleteUser);
    `);

    const results = scanRouteDefinitions(tmpDir);
    assert.equal(results.length, 3);
    assert.ok(results.some(r => r.method === 'GET' && r.path === '/api/users'));
    assert.ok(results.some(r => r.method === 'POST' && r.path === '/api/users'));
    assert.ok(results.some(r => r.method === 'DELETE' && r.path === '/api/users/:id'));
    assert.equal(results[0].framework, 'express');
  });

  it('detects app.get/post patterns', () => {
    writeFile(tmpDir, 'src/server.js', `
      const app = express();
      app.get('/health', healthCheck);
      app.post('/api/data', handleData);
    `);

    const results = scanRouteDefinitions(tmpDir);
    assert.equal(results.length, 2);
  });

  it('detects NestJS decorators', () => {
    writeFile(tmpDir, 'src/controller.ts', `
      @Controller('users')
      export class UsersController {
        @Get('/list')
        async findAll() {}

        @Post('/')
        async create() {}
      }
    `);

    const results = scanRouteDefinitions(tmpDir);
    assert.ok(results.some(r => r.method === 'GET' && r.path === '/list' && r.framework === 'nestjs'));
    assert.ok(results.some(r => r.method === 'POST' && r.path === '/' && r.framework === 'nestjs'));
  });

  it('detects NestJS handler names', () => {
    writeFile(tmpDir, 'src/ctrl.ts', `
      @Get('/users/:id')
      async getUserById(@Param('id') id: string) { return id; }
    `);

    const results = scanRouteDefinitions(tmpDir);
    assert.equal(results.length, 1);
    assert.equal(results[0].handler, 'getUserById');
  });

  it('detects Next.js pages/api routes', () => {
    writeFile(tmpDir, 'pages/api/users.ts', `
      export default function handler(req, res) { res.json([]); }
    `);
    writeFile(tmpDir, 'pages/api/users/[id].ts', `
      export default function handler(req, res) { res.json({}); }
    `);

    const results = scanRouteDefinitions(tmpDir);
    assert.ok(results.some(r => r.path === '/api/users' && r.framework === 'nextjs-pages'));
    assert.ok(results.some(r => r.path === '/api/users/[id]' && r.framework === 'nextjs-pages'));
  });

  it('detects Next.js app router routes with exported methods', () => {
    writeFile(tmpDir, 'app/api/items/route.ts', `
      export async function GET(request) { return Response.json([]); }
      export async function POST(request) { return Response.json({}); }
    `);

    const results = scanRouteDefinitions(tmpDir);
    assert.ok(results.some(r => r.method === 'GET' && r.path === '/api/items' && r.framework === 'nextjs-app'));
    assert.ok(results.some(r => r.method === 'POST' && r.path === '/api/items' && r.framework === 'nextjs-app'));
  });
});

// ============================================================
// scanEventBus
// ============================================================

describe('scanEventBus', () => {
  beforeEach(() => { tmpDir = createTmpDir(); });
  afterEach(() => { cleanupDir(tmpDir); });

  it('detects emit and on patterns', () => {
    writeFile(tmpDir, 'src/events.js', `
      emitter.emit('user:created', user);
      emitter.on('user:created', handleCreated);
      bus.publish('order:completed', order);
      bus.subscribe('order:completed', handleOrder);
    `);

    const result = scanEventBus(tmpDir);
    assert.ok(result.emits.some(e => e.event === 'user:created'));
    assert.ok(result.emits.some(e => e.event === 'order:completed'));
    assert.ok(result.listensTo.some(e => e.event === 'user:created'));
    assert.ok(result.listensTo.some(e => e.event === 'order:completed'));
  });

  it('detects socket.emit and socket.on', () => {
    writeFile(tmpDir, 'src/socket.js', `
      socket.emit('join-room', roomId);
      socket.on('message', handleMessage);
    `);

    const result = scanEventBus(tmpDir);
    assert.ok(result.emits.some(e => e.event === 'join-room'));
    assert.ok(result.listensTo.some(e => e.event === 'message'));
  });

  it('includes source location', () => {
    writeFile(tmpDir, 'src/evt.js', `// line 1
emitter.emit('test-event', data);`);

    const result = scanEventBus(tmpDir);
    assert.equal(result.emits.length, 1);
    assert.match(result.emits[0].source, /^src\/evt\.js:2$/);
  });
});

// ============================================================
// scanSharedTypes
// ============================================================

describe('scanSharedTypes', () => {
  beforeEach(() => { tmpDir = createTmpDir(); });
  afterEach(() => { cleanupDir(tmpDir); });

  it('detects @scoped package imports', () => {
    writeFile(tmpDir, 'src/user.ts', `
      import { User } from '@shared/types';
      import type { Order } from '@myorg/common';
    `);

    const result = scanSharedTypes(tmpDir);
    assert.ok(result.imports.some(i => i.package === '@shared/types'));
    assert.ok(result.imports.some(i => i.package === '@myorg/common'));
  });

  it('detects require of scoped packages', () => {
    writeFile(tmpDir, 'src/lib.js', `
      const { Config } = require('@shared/config');
    `);

    const result = scanSharedTypes(tmpDir);
    assert.ok(result.imports.some(i => i.package === '@shared/config'));
  });

  it('detects type exports in shared directories', () => {
    writeFile(tmpDir, 'src/shared/types.ts', `
      export type User = { id: string; name: string };
      export interface Order { id: string; total: number };
    `);

    const result = scanSharedTypes(tmpDir);
    // Exports should be detected in files with "shared" or "types" in path
    assert.ok(result.exports.length > 0);
  });
});

// ============================================================
// scanEnvVars
// ============================================================

describe('scanEnvVars', () => {
  beforeEach(() => { tmpDir = createTmpDir(); });
  afterEach(() => { cleanupDir(tmpDir); });

  it('detects process.env.VAR_NAME', () => {
    writeFile(tmpDir, 'src/config.js', `
      const apiUrl = process.env.API_URL;
      const secret = process.env.JWT_SECRET;
    `);

    const result = scanEnvVars(tmpDir);
    assert.ok(result.requires.some(r => r.name === 'API_URL'));
    assert.ok(result.requires.some(r => r.name === 'JWT_SECRET'));
  });

  it('detects process.env["VAR_NAME"] bracket syntax', () => {
    writeFile(tmpDir, 'src/config.js', `
      const port = process.env["PORT_NUMBER"];
    `);

    const result = scanEnvVars(tmpDir);
    assert.ok(result.requires.some(r => r.name === 'PORT_NUMBER'));
  });

  it('skips common built-in env vars like NODE_ENV', () => {
    writeFile(tmpDir, 'src/config.js', `
      const env = process.env.NODE_ENV;
      const home = process.env.HOME;
      const custom = process.env.MY_CUSTOM_VAR;
    `);

    const result = scanEnvVars(tmpDir);
    assert.ok(!result.requires.some(r => r.name === 'NODE_ENV'));
    assert.ok(!result.requires.some(r => r.name === 'HOME'));
    assert.ok(result.requires.some(r => r.name === 'MY_CUSTOM_VAR'));
  });

  it('detects .env file definitions', () => {
    writeFile(tmpDir, '.env.example', `
API_URL=https://api.example.com
JWT_SECRET=changeme
DATABASE_URL=postgres://localhost/db
`);

    const result = scanEnvVars(tmpDir);
    assert.ok(result.exposes.some(e => e.name === 'API_URL'));
    assert.ok(result.exposes.some(e => e.name === 'JWT_SECRET'));
    assert.ok(result.exposes.some(e => e.name === 'DATABASE_URL'));
  });

  it('tracks definedIn for .env variables', () => {
    writeFile(tmpDir, '.env', 'API_URL=a');
    writeFile(tmpDir, '.env.example', 'API_URL=b');

    const result = scanEnvVars(tmpDir);
    const apiVar = result.exposes.find(e => e.name === 'API_URL');
    assert.ok(apiVar);
    assert.ok(apiVar.definedIn.includes('.env'));
    assert.ok(apiVar.definedIn.includes('.env.example'));
  });

  it('detects import.meta.env (Vite)', () => {
    writeFile(tmpDir, 'src/vite-app.ts', `
      const url = import.meta.env.VITE_API_URL;
    `);

    const result = scanEnvVars(tmpDir);
    assert.ok(result.requires.some(r => r.name === 'VITE_API_URL'));
  });
});

// ============================================================
// detectProjectType
// ============================================================

describe('detectProjectType', () => {
  beforeEach(() => { tmpDir = createTmpDir(); });
  afterEach(() => { cleanupDir(tmpDir); });

  it('detects frontend (React)', () => {
    writeFile(tmpDir, 'package.json', JSON.stringify({
      dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' }
    }));

    assert.equal(detectProjectType(tmpDir), 'frontend');
  });

  it('detects backend (Express)', () => {
    writeFile(tmpDir, 'package.json', JSON.stringify({
      dependencies: { express: '^4.0.0' }
    }));

    assert.equal(detectProjectType(tmpDir), 'backend');
  });

  it('detects fullstack (React + Express)', () => {
    writeFile(tmpDir, 'package.json', JSON.stringify({
      dependencies: { react: '^18.0.0', express: '^4.0.0' }
    }));

    assert.equal(detectProjectType(tmpDir), 'fullstack');
  });

  it('detects monorepo (turbo + packages)', () => {
    writeFile(tmpDir, 'turbo.json', '{}');
    writeFile(tmpDir, 'packages/web/package.json', '{}');
    writeFile(tmpDir, 'packages/api/package.json', '{}');
    writeFile(tmpDir, 'package.json', '{}');

    assert.equal(detectProjectType(tmpDir), 'monorepo');
  });

  it('detects library (main/module export, no framework)', () => {
    writeFile(tmpDir, 'package.json', JSON.stringify({
      main: 'dist/index.js',
      module: 'dist/index.mjs',
      dependencies: { lodash: '^4.0.0' }
    }));

    assert.equal(detectProjectType(tmpDir), 'library');
  });

  it('returns unknown for empty project', () => {
    writeFile(tmpDir, 'package.json', '{}');
    assert.equal(detectProjectType(tmpDir), 'unknown');
  });

  it('detects backend from manage.py (Django)', () => {
    writeFile(tmpDir, 'manage.py', '#!/usr/bin/env python');
    assert.equal(detectProjectType(tmpDir), 'backend');
  });
});

// ============================================================
// scanContracts (integration)
// ============================================================

describe('scanContracts', () => {
  beforeEach(() => { tmpDir = createTmpDir(); });
  afterEach(() => { cleanupDir(tmpDir); });

  it('returns complete surface structure', () => {
    writeFile(tmpDir, 'package.json', JSON.stringify({
      dependencies: { express: '^4.0.0' }
    }));
    writeFile(tmpDir, 'src/routes.js', `
      router.get('/api/health', healthCheck);
    `);
    writeFile(tmpDir, 'src/client.js', `
      const data = await axios.get('/api/external');
    `);
    writeFile(tmpDir, 'src/events.js', `
      emitter.emit('task:done', task);
    `);
    writeFile(tmpDir, '.env.example', 'API_KEY=xxx');

    const surface = scanContracts(tmpDir);

    // Structure checks
    assert.equal(surface.version, CONTRACT_SURFACE_VERSION);
    assert.ok(surface.generatedAt);
    assert.ok(surface.projectName);
    assert.equal(surface.projectType, 'backend');

    // Content checks
    assert.ok(surface.endpoints.consumes.length > 0);
    assert.ok(surface.endpoints.exposes.length > 0);
    assert.ok(surface.events.emits.length > 0);
    assert.ok(surface.environment.exposes.length > 0);
  });

  it('respects projectType override', () => {
    writeFile(tmpDir, 'package.json', '{}');

    const surface = scanContracts(tmpDir, { projectType: 'frontend' });
    assert.equal(surface.projectType, 'frontend');
  });

  it('respects projectName override', () => {
    writeFile(tmpDir, 'package.json', '{}');

    const surface = scanContracts(tmpDir, { projectName: 'my-project' });
    assert.equal(surface.projectName, 'my-project');
  });

  it('handles empty project gracefully', () => {
    const surface = scanContracts(tmpDir);

    assert.equal(surface.endpoints.consumes.length, 0);
    assert.equal(surface.endpoints.exposes.length, 0);
    assert.equal(surface.events.emits.length, 0);
    assert.equal(surface.events.listensTo.length, 0);
    assert.equal(surface.sharedTypes.imports.length, 0);
    assert.equal(surface.sharedTypes.exports.length, 0);
    assert.equal(surface.environment.requires.length, 0);
    assert.equal(surface.environment.exposes.length, 0);
  });

  it('respects maxFiles option', () => {
    // Create many files
    for (let i = 0; i < 20; i++) {
      writeFile(tmpDir, `src/file${i}.js`, `const x = axios.get('/api/route${i}');`);
    }

    // With maxFiles=5, scanner should stop after 5 files
    const surface = scanContracts(tmpDir, { maxFiles: 5 });
    // We can't guarantee exact count since walk order varies, but it should be bounded
    assert.ok(surface.endpoints.consumes.length <= 5);
  });
});
