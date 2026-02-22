'use strict';

/**
 * Schema/Model Registry Plugin
 *
 * Detects and tracks database schema structures:
 * - Prisma (single-file and multi-file schemas)
 * - TypeORM entities
 * - Django models (basic detection)
 *
 * Produces: schema-map.md (human-readable) + schema-index.json (machine-readable)
 */

const fs = require('fs');
const path = require('path');
const { RegistryPlugin } = require('../flow-registry-manager');
const { getProjectRoot, safeJsonParse: safeJsonParseFile } = require('../flow-utils');

const PROJECT_ROOT = getProjectRoot();
const STATE_DIR = path.join(PROJECT_ROOT, '.workflow', 'state');
const INDEX_PATH = path.join(STATE_DIR, 'schema-index.json');
const MAP_PATH = path.join(STATE_DIR, 'schema-map.md');

class SchemaRegistry extends RegistryPlugin {
  static id = 'schemas';
  static name = 'Schema/Model Registry';
  static mapFile = 'schema-map.md';
  static indexFile = 'schema-index.json';
  static category = 'database';
  static type = 'schemas';

  constructor() {
    super();
    this.models = [];
    this.enums = [];
    this.metadata = {};
  }

  /**
   * Activate when an ORM is detected in the project stack.
   */
  activateWhen(stack) {
    if (!stack) return false;
    if (stack.orm) return true;

    // Check package.json for ORM packages
    const pkgPath = path.join(PROJECT_ROOT, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = safeJsonParseFile(pkgPath, {});
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        const ormPackages = ['prisma', '@prisma/client', 'typeorm', 'drizzle-orm', 'sequelize', 'mongoose'];
        if (ormPackages.some(p => allDeps[p])) return true;
      } catch (err) {
        // ignore
      }
    }

    // Check for Django models (manage.py + models.py)
    if (fs.existsSync(path.join(PROJECT_ROOT, 'manage.py'))) return true;

    return false;
  }

  async scan() {
    this.models = [];
    this.enums = [];
    this.metadata = {};

    // Try Prisma first
    const prismaResults = this._scanPrisma();
    if (prismaResults) {
      this.metadata.orm = 'Prisma';
      return this._buildIndex();
    }

    // Try TypeORM
    const typeormResults = this._scanTypeORM();
    if (typeormResults) {
      this.metadata.orm = 'TypeORM';
      return this._buildIndex();
    }

    // Nothing found
    if (this.models.length === 0) return null;
    return this._buildIndex();
  }

  prune() {
    const before = this.models.length;
    this.models = this.models.filter(m => {
      if (!m.file) return true;
      return fs.existsSync(path.join(PROJECT_ROOT, m.file));
    });
    this.enums = this.enums.filter(e => {
      if (!e.file) return true;
      return fs.existsSync(path.join(PROJECT_ROOT, e.file));
    });
    const removed = before - this.models.length;
    if (removed > 0) {
      this.save();
      this.generateMap();
    }
    return removed;
  }

  save() {
    const index = this._buildIndex();
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
  }

  generateMap() {
    const lines = ['# Schema Map\n'];

    if (this.metadata.orm) {
      lines.push(`**ORM**: ${this.metadata.orm}`);
    }
    if (this.metadata.organization) {
      lines.push(`**Schema Organization**: ${this.metadata.organization}`);
    }
    if (this.metadata.provider) {
      lines.push(`**Provider**: ${this.metadata.provider}`);
    }
    if (this.metadata.previewFeatures && this.metadata.previewFeatures.length > 0) {
      lines.push(`**Preview Features**: ${this.metadata.previewFeatures.join(', ')}`);
    }
    lines.push('');

    // Models table
    if (this.models.length > 0) {
      lines.push('## Models\n');
      lines.push('| Model | File | Fields | Relations | Indexes |');
      lines.push('|-------|------|--------|-----------|---------|');

      for (const model of this.models) {
        const relDesc = model.relations.length > 0
          ? model.relations.map(r => `${r.type} ${r.target}`).join(', ')
          : '-';
        const idxDesc = model.indexes.length > 0
          ? model.indexes.map(i => `${i.fields.join('+')}${i.unique ? ' (unique)' : ''}`).join(', ')
          : '-';
        lines.push(`| ${model.name} | ${model.file} | ${model.fields.length} | ${relDesc} | ${idxDesc} |`);
      }
      lines.push('');
    }

    // Enums table
    if (this.enums.length > 0) {
      lines.push('## Enums\n');
      lines.push('| Enum | Values | File |');
      lines.push('|------|--------|------|');

      for (const enumDef of this.enums) {
        const vals = enumDef.values.length > 5
          ? enumDef.values.slice(0, 5).join(', ') + ` (+${enumDef.values.length - 5} more)`
          : enumDef.values.join(', ');
        lines.push(`| ${enumDef.name} | ${vals} | ${enumDef.file} |`);
      }
      lines.push('');
    }

    if (this.models.length === 0 && this.enums.length === 0) {
      lines.push('*No schemas detected. Run `flow registry-manager scan` after adding ORM models.*\n');
    }

    lines.push(`---\n*Auto-generated by Schema Registry — ${new Date().toISOString().split('T')[0]}*\n`);

    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(MAP_PATH, lines.join('\n'));
  }

  _getActivateWhenLabel() {
    return 'ORM detected (Prisma, TypeORM, Django, etc.)';
  }

  // ============================================================
  // Prisma Scanner
  // ============================================================

  _scanPrisma() {
    const schemaDir = path.join(PROJECT_ROOT, 'prisma', 'schema');
    const singleFile = path.join(PROJECT_ROOT, 'prisma', 'schema.prisma');

    let files = [];

    if (fs.existsSync(schemaDir)) {
      // Multi-file schema (prismaSchemaFolder)
      this.metadata.organization = 'multi-file (prismaSchemaFolder)';
      files = this._findPrismaFiles(schemaDir);
    } else if (fs.existsSync(singleFile)) {
      // Single-file schema
      this.metadata.organization = 'single-file';
      files = [singleFile];
    } else {
      return false;
    }

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const relPath = path.relative(PROJECT_ROOT, file);
        this._parsePrismaFile(content, relPath);
      } catch (err) {
        // Skip unreadable files
      }
    }

    return this.models.length > 0 || this.enums.length > 0;
  }

  _findPrismaFiles(dir) {
    const results = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...this._findPrismaFiles(fullPath));
        } else if (entry.name.endsWith('.prisma')) {
          results.push(fullPath);
        }
      }
    } catch (err) {
      // Skip unreadable directories
    }
    return results;
  }

  _parsePrismaFile(content, filePath) {
    // Parse datasource block for provider
    const providerMatch = content.match(/datasource\s+\w+\s*\{[^}]*provider\s*=\s*"(\w+)"/s);
    if (providerMatch) {
      this.metadata.provider = providerMatch[1];
    }

    // Parse generator block for preview features
    const previewMatch = content.match(/previewFeatures\s*=\s*\[([^\]]+)\]/);
    if (previewMatch) {
      const features = previewMatch[1].match(/"([^"]+)"/g);
      if (features) {
        this.metadata.previewFeatures = features.map(f => f.replace(/"/g, ''));
      }
    }

    // Parse models
    // Use non-greedy match with length limit to avoid ReDoS on nested braces
    const modelRegex = /model\s+(\w+)\s*\{([^}]{1,5000})\}/g;
    let match;
    while ((match = modelRegex.exec(content)) !== null) {
      const modelName = match[1];
      const body = match[2];
      const model = this._parsePrismaModel(modelName, body, filePath);
      this.models.push(model);
    }

    // Parse enums
    const enumRegex = /enum\s+(\w+)\s*\{([^}]+)\}/g;
    while ((match = enumRegex.exec(content)) !== null) {
      const enumName = match[1];
      const body = match[2];
      const values = body.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('//') && !line.startsWith('@@'));
      this.enums.push({ name: enumName, values, file: filePath });
    }
  }

  _parsePrismaModel(name, body, filePath) {
    const fields = [];
    const relations = [];
    const indexes = [];

    const lines = body.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//'));

    for (const line of lines) {
      // Skip block-level attributes
      if (line.startsWith('@@')) {
        // Parse @@index and @@unique
        const indexMatch = line.match(/@@(index|unique)\(\[([^\]]+)\]/);
        if (indexMatch) {
          const indexFields = indexMatch[2].split(',').map(f => f.trim());
          indexes.push({ fields: indexFields, unique: indexMatch[1] === 'unique' });
        }
        continue;
      }

      // Parse field: name Type @attributes
      const fieldMatch = line.match(/^(\w+)\s+(\w+)(\[\])?\s*(.*)?$/);
      if (!fieldMatch) continue;

      const fieldName = fieldMatch[1];
      const fieldType = fieldMatch[2];
      const isArray = !!fieldMatch[3];
      const attrs = fieldMatch[4] || '';

      fields.push({ name: fieldName, type: fieldType, isArray });

      // Check for @relation
      const relationMatch = attrs.match(/@relation/);
      if (relationMatch || (fieldType[0] === fieldType[0].toUpperCase() && fieldType !== 'String' && fieldType !== 'Int' && fieldType !== 'Float' && fieldType !== 'Boolean' && fieldType !== 'DateTime' && fieldType !== 'Json' && fieldType !== 'Bytes' && fieldType !== 'BigInt' && fieldType !== 'Decimal')) {
        const relType = isArray ? 'has many' : 'has one';
        relations.push({ target: fieldType, type: relType, field: fieldName });
      }

      // Check for @unique
      if (attrs.includes('@unique')) {
        indexes.push({ fields: [fieldName], unique: true });
      }

      // Check for @id
      if (attrs.includes('@id')) {
        indexes.push({ fields: [fieldName], unique: true });
      }
    }

    return { name, fields, relations, indexes, file: filePath };
  }

  // ============================================================
  // TypeORM Scanner
  // ============================================================

  _scanTypeORM() {
    // Look for TypeORM entities in common locations
    const searchDirs = ['src', 'src/entities', 'src/entity', 'src/models', 'lib'];
    const entityFiles = [];

    for (const dir of searchDirs) {
      const fullDir = path.join(PROJECT_ROOT, dir);
      if (fs.existsSync(fullDir)) {
        this._findTypeORMEntities(fullDir, entityFiles);
      }
    }

    if (entityFiles.length === 0) return false;

    for (const entry of entityFiles) {
      try {
        // Use cached content from discovery phase to avoid N+1 reads
        const filePath = typeof entry === 'string' ? entry : entry.path;
        const content = typeof entry === 'string' ? fs.readFileSync(entry, 'utf-8') : entry.content;
        const relPath = path.relative(PROJECT_ROOT, filePath);
        this._parseTypeORMFile(content, relPath);
      } catch {
        // Skip unreadable files
      }
    }

    return this.models.length > 0;
  }

  _findTypeORMEntities(dir, results, depth = 0) {
    if (depth > 5) return; // Prevent deep recursion
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          this._findTypeORMEntities(fullPath, results, depth + 1);
        } else if ((entry.name.endsWith('.ts') || entry.name.endsWith('.js')) &&
                   (entry.name.includes('entity') || entry.name.includes('model'))) {
          // Quick check if file contains @Entity — cache content to avoid re-reading during parse
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            if (content.includes('@Entity')) {
              results.push({ path: fullPath, content });
            }
          } catch {
            // Skip unreadable files
          }
        }
      }
    } catch (err) {
      // Skip unreadable directories
    }
  }

  _parseTypeORMFile(content, filePath) {
    // Parse @Entity() decorated classes
    const entityRegex = /@Entity\([^)]*\)\s*(?:export\s+)?class\s+(\w+)/g;
    let match;

    while ((match = entityRegex.exec(content)) !== null) {
      const className = match[1];
      const fields = [];
      const relations = [];
      const indexes = [];

      // Parse @Column decorators
      const columnRegex = /@Column\([^)]*\)\s*(\w+)\s*[!?]?\s*:\s*(\w+)/g;
      let colMatch;
      while ((colMatch = columnRegex.exec(content)) !== null) {
        fields.push({ name: colMatch[1], type: colMatch[2], isArray: false });
      }

      // Parse relation decorators
      const relPatterns = [
        { regex: /@OneToMany\([^)]*\)\s*(\w+)/g, type: 'has many' },
        { regex: /@ManyToOne\([^)]*\)\s*(\w+)/g, type: 'belongs to' },
        { regex: /@OneToOne\([^)]*\)\s*(\w+)/g, type: 'has one' },
        { regex: /@ManyToMany\([^)]*\)\s*(\w+)/g, type: 'many to many' }
      ];

      for (const { regex, type } of relPatterns) {
        let relMatch;
        while ((relMatch = regex.exec(content)) !== null) {
          relations.push({ target: relMatch[1], type, field: relMatch[1] });
        }
      }

      this.models.push({ name: className, fields, relations, indexes, file: filePath });
    }
  }

  // ============================================================
  // Index Builder
  // ============================================================

  _buildIndex() {
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      orm: this.metadata.orm || 'unknown',
      organization: this.metadata.organization || 'unknown',
      provider: this.metadata.provider || null,
      previewFeatures: this.metadata.previewFeatures || [],
      models: this.models.map(m => ({
        name: m.name,
        file: m.file,
        fieldCount: m.fields.length,
        relations: m.relations,
        indexes: m.indexes
      })),
      enums: this.enums.map(e => ({
        name: e.name,
        values: e.values,
        file: e.file
      })),
      summary: {
        modelCount: this.models.length,
        enumCount: this.enums.length,
        relationCount: this.models.reduce((sum, m) => sum + m.relations.length, 0)
      }
    };
  }
}

module.exports = { SchemaRegistry };
